/**
 * SharpAPI WebSocket adapter seam (2026-06-16). PURE — no socket, no DB, no
 * Next. Worker-safe. This is the ONLY place that touches the raw WS frame
 * shape, so the exact `odds:update` payload can be finalized here once real
 * frames are captured without changing any other module.
 *
 * Protocol (docs.sharpapi.io/en/streaming/websocket): message types are
 *   connected · subscribed · opportunities_snapshot · initial ·
 *   snapshot:complete · odds:update · odds:removed · ev:detected ·
 *   ev:expired · heartbeat
 * v1 consumes the `odds` channel only. ev:* are ignored here.
 *
 * Reuses the REST value mappers (lib/providers/real_api/_oddsMappers) +
 * normalizeMlbTeamName so the WS vocab can never drift from the REST path.
 * Parsing is DEFENSIVE: unknown/unsupported shapes (props, alt lines,
 * unrecognized markets/sides) yield no event rather than a guess — mirroring
 * the REST discipline. Field-name fallbacks are intentionally broad until the
 * exact frame schema is verified against real payloads (TODO below).
 */

import type { MarketType, Side } from "../../../types/domain/Lines";
import {
  asNumberOrNull,
  asStringOrNull,
  mapMarketType,
  mapSide,
  mapSportsbook,
} from "../_oddsMappers";
import { normalizeMlbTeamName } from "../_teamNameNormalizer";
import {
  normalizeSharpApiMarketType,
  normalizeMatchResultSelection,
  normalizeDoubleChanceSelection,
  normalizeTotalSelection,
  normalizeBttsSelection,
  type OfficialSoccerMarket,
  type TeamNameCtx,
} from "../_soccerMarketNormalizer";
import { isBlockedSportsbook } from "../../../config/blockedSportsbooks";

/** A normalized odds observation extracted from one WS frame. */
export type NormalizedOddsEvent = {
  /** "update" = price/point present; "removed" = market/line went unavailable. */
  kind: "update" | "removed";
  providerEventId: string | null;
  /** SharpAPI sport vocab as sent (e.g. "baseball", "soccer"). */
  sport: string | null;
  league: string | null;
  homeRaw: string | null;
  awayRaw: string | null;
  /** Normalized abbreviation for MLB (via normalizeMlbTeamName); null for other sports. */
  homeAbbrev: string | null;
  awayAbbrev: string | null;
  sportsbook: string | null; // lowercased
  isBlockedBook: boolean; // kalshi/fliff — caller drops before write
  marketType: MarketType | null;
  side: Side | null;
  lineValue: number | null;
  oddsAmerican: number | null;
  oddsDecimal: number | null;
  impliedProbability: number | null;
  providerTs: string | null;
  globalSeq: number | null;
  /**
   * True when SharpAPI marks this as an ALTERNATE total/spread (not the main
   * line). Alternates are appended to odds_events_raw for audit but MUST NOT
   * drive odds_current_stream / line_movements / triggers — otherwise an alt
   * total at 11.0 overwrites the main 9.0 and emits fake "movement".
   */
  isAlternate: boolean;
};

export type WsMessageKind =
  | "connected"
  | "subscribed"
  | "opportunities_snapshot"
  | "initial"
  | "snapshot:complete"
  | "odds:update"
  | "odds:removed"
  | "ev:detected"
  | "ev:expired"
  | "heartbeat"
  | "unknown";

const ODDS_BEARING_TYPES = new Set<WsMessageKind>([
  "odds:update",
  "odds:removed",
  "initial",
  "opportunities_snapshot",
]);

function asRecord(v: unknown): Record<string, unknown> | null {
  return v !== null && typeof v === "object" && !Array.isArray(v)
    ? (v as Record<string, unknown>)
    : null;
}

/** Read the message `type` defensively (accepts `type` or `event`). */
export function classifyWsMessage(raw: unknown): { kind: WsMessageKind; globalSeq: number | null } {
  const msg = asRecord(raw);
  if (msg === null) return { kind: "unknown", globalSeq: null };
  const t = asStringOrNull(msg.type) ?? asStringOrNull(msg.event);
  const globalSeq = readGlobalSeq(raw);
  const known: WsMessageKind[] = [
    "connected", "subscribed", "opportunities_snapshot", "initial",
    "snapshot:complete", "odds:update", "odds:removed", "ev:detected",
    "ev:expired", "heartbeat",
  ];
  const kind = (known as string[]).includes(t ?? "") ? (t as WsMessageKind) : "unknown";
  return { kind, globalSeq };
}

/** Read the monotonic sequence for resume=true&from_seq=N (accepts a few names). */
export function readGlobalSeq(raw: unknown): number | null {
  const msg = asRecord(raw);
  if (msg === null) return null;
  return (
    asNumberOrNull(msg.global_seq) ??
    asNumberOrNull(msg.globalSeq) ??
    asNumberOrNull(msg.seq) ??
    null
  );
}

/** Collect candidate odds rows from a message (single object or array under common keys). */
function extractRows(msg: Record<string, unknown>): Record<string, unknown>[] {
  // The odds payload may live under `data`, `odds`, `payload`, or be the
  // message itself. Accept array or single object. Verified against real
  // frames during go-live (TODO: lock this to the confirmed key).
  const candidates: unknown[] = [];
  for (const key of ["data", "odds", "payload", "rows"]) {
    const v = msg[key];
    if (Array.isArray(v)) candidates.push(...v);
    else if (v !== null && typeof v === "object") candidates.push(v);
  }
  if (candidates.length === 0) candidates.push(msg); // message itself carries fields
  return candidates.map(asRecord).filter((r): r is Record<string, unknown> => r !== null);
}

function pick(row: Record<string, unknown>, keys: string[]): unknown {
  for (const k of keys) {
    if (row[k] !== undefined && row[k] !== null) return row[k];
  }
  return null;
}

/** Coerce a truthy flag (true / "true" / 1) → boolean; default false. */
function asBool(v: unknown): boolean {
  return v === true || v === "true" || v === 1 || v === "1";
}

/** Is this event a soccer / FIFA World Cup event? Sport-vocab + league fallback. */
function isSoccerCtx(sport: string | null, league: string | null): boolean {
  const s = (sport ?? "").toLowerCase();
  const l = (league ?? "").toLowerCase();
  return s === "soccer" || s === "football" || l.includes("fifa") || l.includes("world_cup");
}

/**
 * Soccer side normalization — dispatches to the REST soccer normalizer (single
 * source of truth) per market. Needs the fixture team names to map
 * "{team}" → home/away on 1X2 / double_chance. Returns the canonical side
 * string (home/draw/away · home_or_draw/away_or_draw/home_or_away · over/under ·
 * yes/no) or null when unparseable.
 */
function normalizeSoccerSide(
  market: OfficialSoccerMarket,
  rawSelection: string,
  teams: TeamNameCtx,
): Side | null {
  switch (market) {
    case "match_result":
      return normalizeMatchResultSelection(rawSelection, teams);
    case "double_chance":
      return normalizeDoubleChanceSelection(rawSelection, teams);
    case "total":
      return normalizeTotalSelection(rawSelection);
    case "btts":
      return normalizeBttsSelection(rawSelection);
    default:
      return null;
  }
}

function normalizeRow(
  row: Record<string, unknown>,
  ctx: { kind: "update" | "removed"; sport: string | null; league: string | null; globalSeq: number | null },
): NormalizedOddsEvent | null {
  const homeRaw = asStringOrNull(pick(row, ["home_team", "home", "home_team_name"]));
  const awayRaw = asStringOrNull(pick(row, ["away_team", "away", "away_team_name"]));
  const isBaseball = (ctx.sport ?? "").toLowerCase() === "baseball" || (ctx.league ?? "").toLowerCase() === "mlb";
  const isSoccer = isSoccerCtx(ctx.sport, ctx.league);

  const rawMarket = asStringOrNull(pick(row, ["market_type", "market"]));
  const rawSelection = asStringOrNull(pick(row, ["selection_type", "side", "selection"]));

  let marketType: MarketType | null;
  let side: Side | null;
  if (isSoccer) {
    // Soccer/WC: SharpAPI REUSES "moneyline" for the 1X2 match_result market,
    // so it must NOT go through the MLB mapper (which would emit MLB-moneyline).
    // Team names are required — both to resolve the game downstream AND to map
    // "{team}" → home/away safely (empty names would mis-bucket). Reuse the REST
    // soccer normalizer so WS and REST never drift.
    if (homeRaw === null || awayRaw === null) return null;
    const soccerMarket =
      rawMarket === null ? null : normalizeSharpApiMarketType(rawMarket.toLowerCase().trim());
    marketType = soccerMarket;
    side =
      soccerMarket === null || rawSelection === null
        ? null
        : normalizeSoccerSide(soccerMarket, rawSelection, { home_team: homeRaw, away_team: awayRaw });
  } else {
    // MLB (and any abbrev-normalized sport) — unchanged path.
    marketType = mapMarketType(rawMarket);
    side = mapSide(rawSelection);
  }
  // Unsupported market or side → drop (mirrors REST: props/alt-lines/unknown).
  if (marketType === null || side === null) return null;

  const sportsbookRaw = asStringOrNull(pick(row, ["sportsbook", "book", "bookmaker"]));
  const sportsbook = mapSportsbook(sportsbookRaw);

  const homeAbbrev = isBaseball ? normalizeMlbTeamName(homeRaw) : null;
  const awayAbbrev = isBaseball ? normalizeMlbTeamName(awayRaw) : null;

  return {
    kind: ctx.kind,
    providerEventId: asStringOrNull(pick(row, ["event_id", "eventId", "id"])),
    sport: ctx.sport,
    league: ctx.league,
    homeRaw,
    awayRaw,
    homeAbbrev,
    awayAbbrev,
    sportsbook,
    isBlockedBook: isBlockedSportsbook(sportsbook),
    marketType,
    side,
    lineValue: asNumberOrNull(pick(row, ["line", "point", "total", "line_value"])),
    oddsAmerican: asNumberOrNull(pick(row, ["odds_american", "american", "price"])),
    oddsDecimal: asNumberOrNull(pick(row, ["odds_decimal", "decimal"])),
    impliedProbability: asNumberOrNull(pick(row, ["odds_probability", "implied_probability", "probability"])),
    providerTs: asStringOrNull(pick(row, ["last_seen_at", "wire_received_at", "timestamp", "ts", "updated_at"])),
    globalSeq: ctx.globalSeq,
    isAlternate: asBool(pick(row, ["is_alternate_line", "is_alternate", "alternate", "is_alt", "alt"])),
  };
}

/**
 * Adapt one parsed WS frame into normalized odds events. Returns [] for
 * control/lifecycle frames (connected/subscribed/heartbeat/snapshot:complete/
 * ev:*) and for unparseable payloads. The caller is responsible for dropping
 * `isBlockedBook` rows before any write.
 */
export function adaptSharpWsMessage(raw: unknown): NormalizedOddsEvent[] {
  const msg = asRecord(raw);
  if (msg === null) return [];
  const { kind, globalSeq } = classifyWsMessage(raw);
  if (!ODDS_BEARING_TYPES.has(kind)) return [];

  const sport = asStringOrNull(msg.sport);
  const league = asStringOrNull(msg.league);
  const evKind: "update" | "removed" = kind === "odds:removed" ? "removed" : "update";

  return extractRows(msg)
    .map((row) => {
      // A row may carry its own sport/league overriding the envelope.
      const rowSport = asStringOrNull(pick(row, ["sport"])) ?? sport;
      const rowLeague = asStringOrNull(pick(row, ["league"])) ?? league;
      return normalizeRow(row, { kind: evKind, sport: rowSport, league: rowLeague, globalSeq });
    })
    .filter((e): e is NormalizedOddsEvent => e !== null);
}
