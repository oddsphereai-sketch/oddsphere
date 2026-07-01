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
import { isDisplayableAmericanOdds } from "../../lib/streaming/oddsSanity";
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

/**
 * Max point step (totals/spreads) that still counts as the SAME main line
 * moving. A larger jump (e.g. total 9.0 → 11.0) is an alternate line slipping
 * through unflagged — excluded from current/movement so it can't fake
 * movement. Legit main-line moves step by 0.5; 1.0 leaves headroom for a
 * double-step while still catching alternates (the observed bad jumps were
 * +2.0 / +4.0 / +6.0).
 */
const MAX_MAIN_LINE_STEP = 1.0;

/** 1-in-N sampling for unresolved-event audit rows — keeps the resolution
 * diagnostic visible while cutting the out-of-slate noise volume ~95%. */
const UNRESOLVED_SAMPLE_RATE = 20;

export type StreamPipelineDeps = {
  provider?: string; // default 'sharpapi_ws'
  resolveGame: GameResolver;
  writer: StreamWriter;
  health: HealthTracker;
  debouncer: MovementDebouncer;
  recompute: RecomputeClient | null;
  recomputeActive: boolean;
  shadow: boolean;
  /** When false (default), skip per-frame odds_events_raw audit writes for
   * accepted/alternate ticks (the dominant write load; never read by the app).
   * Unresolved events are still logged. See config flag rawAuditEnabled. */
  rawAuditEnabled?: boolean;
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
  /** Counter for 1-in-N sampling of unresolved-event audit rows (see processEvent). */
  private unresolvedSeen = 0;

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
      // SharpAPI streams the WHOLE league; most unresolved events are simply
      // games NOT on our slate — pure noise at volume (~hundreds/min). Sample
      // 1-in-N so genuine resolution/alias gaps still surface (a consistently-
      // failing real team appears regularly) without flooding odds_events_raw.
      if (this.unresolvedSeen++ % UNRESOLVED_SAMPLE_RATE === 0) {
        await this.d.writer.writeRawEvents([this.rawRow(ev, null, null, "unresolved", ev.isAlternate)]);
        this.d.health.onWrite();
      }
      return;
    }

    const gameId = resolved.id;
    const market = String(ev.marketType);
    const book = ev.sportsbook;
    const side = ev.side;
    const removed = ev.kind === "removed";
    const key = `${gameId}:${market}:${book}:${side}`;
    const prev = this.throttle.get(key);

    // Alternate-line guard (2026-06-16): alternate totals/spreads must NOT
    // pollute the main line's current snapshot or movement log. Exclude:
    //   (a) provider-flagged alternates (ev.isAlternate), and
    //   (b) point markets whose line jumps more than MAX_MAIN_LINE_STEP from
    //       the tracked main line — catches UNFLAGGED alternates (a main total
    //       at 9.0 followed by an 11.0 alt would otherwise log a fake +2.0).
    // Non-main ticks are STILL appended to odds_events_raw (is_alternate=true)
    // for audit/replay, but never touch current / movement / trigger / throttle.
    const pointMarket =
      market === "total" || market === "spread" || market === "first_inning_total";
    const jumpExcluded =
      pointMarket &&
      !removed &&
      prev?.line != null &&
      ev.lineValue != null &&
      Math.abs(ev.lineValue - prev.line) > MAX_MAIN_LINE_STEP;
    if (ev.isAlternate || jumpExcluded) {
      // Alternate tick — audit-only (never drives current/movement). Skip the
      // write entirely unless raw audit is explicitly enabled (it's the bulk
      // write load and the app never reads odds_events_raw).
      if (this.d.rawAuditEnabled === true) {
        await this.d.writer.writeRawEvents([this.rawRow(ev, gameId, resolved.externalId, "accepted", true)]);
        this.d.health.onWrite();
      }
      return;
    }

    // Provider sanity guard: impossible American odds must never enter the
    // current-price table, movement table, trigger path, or throttle state.
    // Keep this intentionally narrow so legitimate big-but-valid moves can
    // still be audited while display readers independently fail closed.
    if (!removed && !isDisplayableAmericanOdds(ev.oddsAmerican)) {
      if (this.d.rawAuditEnabled === true) {
        await this.d.writer.writeRawEvents([this.rawRow(ev, gameId, resolved.externalId, "dropped", false)]);
        this.d.health.onWrite();
      }
      return;
    }

    // Throttle: drop identical consecutive price (no raw, no current, no movement).
    if (!removed && prev !== undefined && prev.odds === ev.oddsAmerican && prev.line === ev.lineValue) {
      return;
    }

    // Record the accepted/removed MAIN-line tick to the odds_events_raw audit
    // log. This was the DOMINANT write load (one row per tick × books × markets
    // × MLB+soccer) that saturated the DB; the app never reads odds_events_raw,
    // so it's gated OFF by default. The app-used writes (odds_current_stream +
    // line_movements, below) ALWAYS run regardless.
    if (this.d.rawAuditEnabled === true) {
      await this.d.writer.writeRawEvents([this.rawRow(ev, gameId, resolved.externalId, "accepted", false)]);
      this.d.health.onWrite();
    }
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
    isAlternate = false,
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
      is_alternate: isAlternate,
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
