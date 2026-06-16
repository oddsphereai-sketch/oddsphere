/**
 * Stream pipeline: raw WS frame → adapter → dedup/throttle → record (raw +
 * current + movement) → meaningful-movement trigger → debounce → (gated)
 * lock-safe recompute request.
 *
 * Pure orchestration with all I/O injected (resolver, writer, recompute,
 * health, pick provider, clock), so the mock-WS integration tests exercise the
 * full flow with no network and no DB. The worker NEVER mutates predictions —
 * recompute requests go through the authenticated route and are issued ONLY
 * when STREAM_RECOMPUTE_ACTIVE is on.
 */

import { createHash } from "node:crypto";
import {
  adaptSharpWsMessage,
  classifyWsMessage,
  type NormalizedOddsEvent,
} from "../../lib/providers/real_api/ws/sharpApiWsAdapter";
import {
  evaluateMovement,
  DEFAULT_TRIGGER_CONFIG,
  type TriggerConfig,
  type ActiveGrade,
} from "../../lib/streaming/movementTriggers";
import { MovementDebouncer } from "../../lib/streaming/debounce";
import {
  classifyMove,
  noVigTwoWayProb,
  americanCentsDelta,
} from "../../lib/streaming/lineDirection";
import type {
  StreamWriter,
  RawEventRow,
  CurrentRow,
  MovementRow,
} from "./streamTypes";
import type { GameResolver } from "./gameResolver";
import type { HealthTracker } from "./health";
import type { RecomputeClient } from "./recomputeClient";

/** Supplies the model's current pick + grade for a (game, market), if known. */
export type PickProvider = (gameId: number, market: string) => { pickSide: string | null; activeGrade: ActiveGrade };

const DEFAULT_PICK_PROVIDER: PickProvider = () => ({ pickSide: null, activeGrade: null });

export type StreamPipelineDeps = {
  provider?: string; // default 'sharpapi_ws'
  resolveGame: GameResolver;
  writer: StreamWriter;
  health: HealthTracker;
  debouncer: MovementDebouncer;
  recompute: RecomputeClient | null;
  recomputeActive: boolean;
  shadow: boolean;
  triggerConfig?: TriggerConfig;
  pickProvider?: PickProvider;
  now?: () => number;
  log?: (line: string) => void;
};

function otherSideOf(side: string): string | null {
  switch (side) {
    case "home": return "away";
    case "away": return "home";
    case "over": return "under";
    case "under": return "over";
    case "yes": return "no";
    case "no": return "yes";
    default: return null;
  }
}

/** Deterministic dedup hash of the normalized tuple — NEVER includes the api key. */
export function hashEvent(ev: NormalizedOddsEvent): string {
  const tuple = [
    ev.providerEventId ?? "",
    ev.marketType ?? "",
    ev.sportsbook ?? "",
    ev.side ?? "",
    ev.lineValue ?? "",
    ev.oddsAmerican ?? "",
    ev.providerTs ?? "",
    ev.kind,
  ].join("|");
  return createHash("sha256").update(tuple).digest("hex");
}

export class StreamPipeline {
  private readonly d: Required<Pick<StreamPipelineDeps, "provider" | "now" | "pickProvider" | "triggerConfig">> & StreamPipelineDeps;
  private ready = false; // becomes true on snapshot:complete
  /** last accepted price per `${gameId}:${market}:${book}:${side}`. */
  private readonly throttle = new Map<string, { odds: number | null; line: number | null }>();
  /** both-sides current odds per `${gameId}:${market}:${book}` for no-vig. */
  private readonly twoSide = new Map<string, Map<string, number>>();
  /** externalId → recompute grouping metadata. */
  private readonly gameMeta = new Map<number, { sport: string; date: string; gameDate: string }>();

  constructor(deps: StreamPipelineDeps) {
    this.d = {
      ...deps,
      provider: deps.provider ?? "sharpapi_ws",
      now: deps.now ?? (() => Date.now()),
      pickProvider: deps.pickProvider ?? DEFAULT_PICK_PROVIDER,
      triggerConfig: deps.triggerConfig ?? DEFAULT_TRIGGER_CONFIG,
    };
  }

  /** Test/inspection helper. */
  isReady(): boolean {
    return this.ready;
  }

  async handleMessage(raw: unknown): Promise<void> {
    const { kind, globalSeq } = classifyWsMessage(raw);
    this.d.health.onMessage(globalSeq);

    if (kind === "heartbeat") { this.d.health.onHeartbeat(); return; }
    if (kind === "connected") { this.d.health.onConnect(); return; }
    if (kind === "snapshot:complete") { this.ready = true; return; }
    if (kind === "subscribed" || kind === "ev:detected" || kind === "ev:expired" || kind === "unknown") {
      return;
    }

    const events = adaptSharpWsMessage(raw);
    for (const ev of events) {
      await this.processEvent(ev);
    }
  }

  private async processEvent(ev: NormalizedOddsEvent): Promise<void> {
    if (ev.sportsbook === null || ev.side === null || ev.marketType === null) return;
    // Blocked books are dropped before any write (no spam, no leak).
    if (ev.isBlockedBook) return;

    const resolved = await this.d.resolveGame(ev);
    if (resolved === null) {
      await this.d.writer.writeRawEvents([this.rawRow(ev, null, null, "unresolved")]);
      this.d.health.onWrite();
      return;
    }

    const gameId = resolved.id;
    const market = String(ev.marketType);
    const book = ev.sportsbook;
    const side = ev.side;
    const removed = ev.kind === "removed";
    const key = `${gameId}:${market}:${book}:${side}`;
    const prev = this.throttle.get(key);

    // Throttle: drop identical consecutive price (no raw, no current, no movement).
    if (!removed && prev !== undefined && prev.odds === ev.oddsAmerican && prev.line === ev.lineValue) {
      return;
    }

    // Always record the accepted/removed tick (audit/replay/CLV).
    await this.d.writer.writeRawEvents([this.rawRow(ev, gameId, resolved.externalId, "accepted")]);
    this.d.health.onWrite();
    this.gameMeta.set(resolved.externalId, { sport: resolved.sport, date: resolved.slateDate, gameDate: resolved.gameDate });

    // No-vig (two-sided) before/after applying this tick.
    const tsKey = `${gameId}:${market}:${book}`;
    const ts = this.twoSide.get(tsKey) ?? new Map<string, number>();
    const other = otherSideOf(side);
    const otherOdds = other !== null ? (ts.get(other) ?? null) : null;
    const prevSideOdds = ts.get(side) ?? prev?.odds ?? null;
    const prevNoVig = noVigTwoWayProb(prevSideOdds, otherOdds);
    if (removed) ts.delete(side);
    else if (ev.oddsAmerican !== null) ts.set(side, ev.oddsAmerican);
    this.twoSide.set(tsKey, ts);
    const nextSideOdds = removed ? null : ev.oddsAmerican;
    const nextNoVig = noVigTwoWayProb(nextSideOdds, otherOdds);

    // Current snapshot (skip on removed — the price is gone).
    if (!removed) {
      await this.d.writer.upsertCurrents([this.currentRow(ev, gameId)]);
    }

    const { pickSide, activeGrade } = this.d.pickProvider(gameId, market);
    const minutesToStart = this.minutesToStart(resolved.gameDate);

    const decision = evaluateMovement(
      {
        marketType: market,
        prevOddsAmerican: prev?.odds ?? null,
        nextOddsAmerican: nextSideOdds,
        prevNoVigProb: prevNoVig,
        nextNoVigProb: nextNoVig,
        prevPoint: prev?.line ?? null,
        nextPoint: removed ? null : ev.lineValue,
        pickSide,
        movedSide: side,
        activeGrade,
        wasAvailable: prev !== undefined,
        isAvailable: !removed,
        minutesToStart,
      },
      this.d.triggerConfig,
    );

    // Movement log (when there is a prior price to compare, or an availability change).
    if (prev !== undefined || removed) {
      const dir = pickSide !== null && side === pickSide ? mapDir(classifyMove(prev?.odds ?? null, nextSideOdds)) : pickSide !== null ? "neutral" : null;
      const movement: MovementRow = {
        game_id: gameId,
        market_type: market,
        sportsbook: book,
        side,
        prev_odds_american: prev?.odds ?? null,
        next_odds_american: nextSideOdds,
        prev_line_value: prev?.line ?? null,
        next_line_value: removed ? null : ev.lineValue,
        delta_cents: americanCentsDelta(prev?.odds ?? null, nextSideOdds),
        delta_novig_pp: prevNoVig !== null && nextNoVig !== null ? (nextNoVig - prevNoVig) * 100 : null,
        delta_points: prev?.line != null && ev.lineValue != null ? ev.lineValue - prev.line : null,
        crossed_key_number: decision.reasons.includes("key_number"),
        direction_vs_pick: dir,
      };
      await this.d.writer.writeMovements([movement]);
    }

    // Register meaningful movement — but only once the initial snapshot has
    // fully loaded, so the snapshot's first-sighting "became_available" wave
    // never triggers a recompute storm.
    if (this.ready && decision.fire) {
      this.d.debouncer.register(resolved.externalId, market, decision.reasons[0], this.d.now());
    }

    // Update last-accepted price.
    this.throttle.set(key, { odds: removed ? null : ev.oddsAmerican, line: removed ? null : ev.lineValue });
  }

  /**
   * Flush matured debounced triggers into (gated) recompute requests, grouped
   * by (sport, slate date). Returns a summary for tests/health. Issues NO
   * recompute calls when recomputeActive is false.
   */
  async flush(now: number = this.d.now()): Promise<{ groups: number; gamesRecomputed: number }> {
    const batch = this.d.debouncer.drainBatch(now);
    if (batch.gameExternalIds.length === 0) return { groups: 0, gamesRecomputed: 0 };

    // Group external ids by (sport, date).
    const groups = new Map<string, { sport: string; date: string; ids: number[] }>();
    for (const extId of batch.gameExternalIds) {
      const meta = this.gameMeta.get(extId);
      if (meta === undefined) continue;
      const gk = `${meta.sport}::${meta.date}`;
      const g = groups.get(gk) ?? { sport: meta.sport, date: meta.date, ids: [] };
      g.ids.push(extId);
      groups.set(gk, g);
    }

    if (!this.d.recomputeActive || this.d.recompute === null) {
      this.d.log?.(`recompute suppressed (flag off): ${batch.gameExternalIds.length} game(s)`);
      return { groups: groups.size, gamesRecomputed: 0 };
    }

    let recomputed = 0;
    for (const g of groups.values()) {
      const res = await this.d.recompute.requestRecompute({
        sport: g.sport,
        date: g.date,
        gameExternalIds: g.ids,
        reason: batch.reasons.join(","),
        shadow: this.d.shadow,
      });
      if (res.ok) {
        this.d.health.onRecompute();
        recomputed += g.ids.length;
      }
    }
    return { groups: groups.size, gamesRecomputed: recomputed };
  }

  private minutesToStart(gameDate: string): number | null {
    const t = new Date(gameDate).getTime();
    if (!Number.isFinite(t)) return null;
    return (t - this.d.now()) / 60000;
  }

  private rawRow(
    ev: NormalizedOddsEvent,
    gameId: number | null,
    externalId: number | null,
    status: RawEventRow["status"],
  ): RawEventRow {
    return {
      provider: this.d.provider,
      provider_event_id: ev.providerEventId,
      sport: ev.sport ?? "unknown",
      league: ev.league,
      game_id: gameId,
      external_id: externalId,
      sportsbook: ev.sportsbook ?? "unknown",
      market_type: String(ev.marketType ?? "unknown"),
      side: ev.side,
      line_value: ev.lineValue,
      odds_american: ev.oddsAmerican,
      odds_decimal: ev.oddsDecimal,
      implied_probability: ev.impliedProbability,
      provider_ts: ev.providerTs,
      payload_hash: hashEvent(ev),
      status,
    };
  }

  private currentRow(ev: NormalizedOddsEvent, gameId: number): CurrentRow {
    return {
      game_id: gameId,
      market_type: String(ev.marketType),
      sportsbook: ev.sportsbook as string,
      side: ev.side as string,
      line_value: ev.lineValue,
      odds_american: ev.oddsAmerican,
      odds_decimal: ev.oddsDecimal,
      implied_probability: ev.impliedProbability,
      provider_ts: ev.providerTs,
    };
  }
}

function mapDir(d: "toward" | "against" | "flat"): "toward" | "against" | "neutral" {
  return d === "flat" ? "neutral" : d;
}
