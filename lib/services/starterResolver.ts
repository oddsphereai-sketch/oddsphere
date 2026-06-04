/**
 * Phase 4.2.C.1.G-1 — pure parsers + merge helper for starter ingestion.
 *
 * Three responsibilities, all pure (no I/O, no DB, no network):
 *   1. parseMlbStatsSchedule         — read the MLB Stats `/api/v1/schedule
 *                                       ?date=YYYY-MM-DD&sportId=1
 *                                       &hydrate=probablePitcher` payload
 *   2. parseBdlGameStarters /
 *      parseBdlLineupsForStarter     — read BDL /games and /lineups payloads
 *   3. mergeStarter                   — decide whether to keep, write, or
 *                                       flag a scratch given an existing
 *                                       (player_id, source, confidence) and
 *                                       a candidate from a fresh source
 *
 * No DB writes, no schema changes. Provenance is modelled in TS only. A
 * future migration may persist `games.{home,away}_starter_provenance`,
 * `..._starter_set_at`, `..._starter_is_confirmed` — those decisions are
 * out of scope for this phase.
 *
 * Inputs/outputs are deliberately conservative:
 *   • Parsers accept `unknown` and fail-closed (skip malformed rows; never
 *     throw on shape mismatch).
 *   • mergeStarter returns a planned action; the operator script writes,
 *     not this module.
 */

// ─── Types ────────────────────────────────────────────────────────────

/**
 * Provenance of a starter assignment. Each source is the *origin endpoint*,
 * not the player. Ordered roughly by tier in `mergeStarter`'s rules but the
 * exact priority is encoded in `mergeStarter`, not here.
 */
export type StarterSource =
  | "mlb_stats_probable"
  | "bdl_games"
  | "bdl_lineups_probable"
  | "bdl_lineups_confirmed"
  | "manual";

/**
 * Two-tier confidence. We deliberately collapse all "confirmed-ish" signals
 * into one bucket — BDL `is_confirmed=true` is the only explicit confirmed
 * indicator; everything else from any source is `probable`.
 */
export type StarterConfidence = "probable" | "confirmed";

/**
 * Normalized game-status enum produced by `parseMlbStatsSchedule`. MLB
 * Stats' `status.detailedState` has dozens of strings; we collapse them.
 */
export type ParsedGameStatus =
  | "scheduled"
  | "in_progress"
  | "final"
  | "postponed"
  | "cancelled"
  | "other";

/**
 * A starter as parsed from a source. The `externalId` is in the source's
 * native id space (NOT a `players.id`). The operator translates to internal
 * id before calling `mergeStarter`.
 */
export interface ParsedStarter {
  source: StarterSource;
  confidence: StarterConfidence;
  externalId: number;
  externalIdKind: "mlb_person_id" | "bdl_player_id";
  fullName: string | null;
}

/**
 * One game from the MLB Stats /schedule response. Doubleheaders appear as
 * two distinct entries (different gamePk, gameNumber 1 vs 2). Postponed/
 * cancelled games are still returned so the caller can skip them with full
 * context.
 */
export interface ParsedScheduleGame {
  gamePk: number;
  gameDate: string;
  gameNumber: number;
  doubleHeader: "N" | "S" | "Y";
  status: ParsedGameStatus;
  homeTeamId: number | null;
  awayTeamId: number | null;
  homeProbable: ParsedStarter | null;
  awayProbable: ParsedStarter | null;
}

/**
 * The current state of a starter assignment in our DB. Until provenance is
 * persisted (future migration), `source` and `confidence` will be `null` for
 * legacy rows — `mergeStarter` treats `null` confidence as the weakest tier
 * (`probable`) so confirmed candidates can still upgrade.
 */
export interface ExistingStarter {
  playerId: number | null;
  source: StarterSource | null;
  confidence: StarterConfidence | null;
}

/**
 * A candidate that's already been resolved from `externalId` → internal
 * `players.id` by the operator. mergeStarter operates on internal ids only.
 */
export interface NormalizedStarterCandidate {
  playerId: number;
  source: StarterSource;
  confidence: StarterConfidence;
}

export type MergeDecision =
  | {
      kind: "no_change";
      reason:
        | "no_existing_no_candidate"
        | "null_candidate_preserve_existing"
        | "manual_protected"
        | "same_player_no_upgrade"
        | "different_player_lower_confidence";
    }
  | {
      kind: "write";
      reason:
        | "fresh"
        | "upgrade_same_player"
        | "upgrade_with_scratch"
        | "same_tier_scratch";
      value: NormalizedStarterCandidate;
      previousPlayerId: number | null;
      scratchDetected: boolean;
    };

// ─── Defensive coercion helpers ───────────────────────────────────────

function asNumberOrNull(v: unknown): number | null {
  if (v === null || v === undefined) return null;
  const n = typeof v === "number" ? v : Number(v);
  return Number.isFinite(n) ? n : null;
}

function asStringOrNull(v: unknown): string | null {
  if (v === null || v === undefined) return null;
  const s = String(v).trim();
  return s.length === 0 ? null : s;
}

function asBoolOrFalse(v: unknown): boolean {
  return v === true || v === "true" || v === 1 || v === "1";
}

function asObjectOrNull(v: unknown): Record<string, unknown> | null {
  if (v === null || v === undefined) return null;
  if (typeof v !== "object") return null;
  return v as Record<string, unknown>;
}

function asArrayOrEmpty(v: unknown): unknown[] {
  return Array.isArray(v) ? v : [];
}

// ─── MLB Stats /schedule parser ───────────────────────────────────────

/**
 * MLB Stats `status.detailedState` is a free-text field that's stable enough
 * to map by exact string. We bucket every observed value to one of the six
 * `ParsedGameStatus` values; anything else lands in "other" so the caller
 * always gets a well-typed value.
 */
function normalizeMlbStatsStatus(detailed: string | null): ParsedGameStatus {
  if (detailed === null) return "other";
  const s = detailed.toLowerCase();
  if (
    s === "scheduled" ||
    s === "pre-game" ||
    s === "warmup" ||
    s === "delayed start"
  )
    return "scheduled";
  if (s === "in progress" || s === "manager challenge" || s === "delayed")
    return "in_progress";
  if (s === "final" || s === "game over" || s === "completed early")
    return "final";
  if (s === "postponed") return "postponed";
  if (s === "cancelled" || s === "canceled") return "cancelled";
  return "other";
}

function normalizeDoubleHeader(v: unknown): "N" | "S" | "Y" {
  const s = asStringOrNull(v);
  if (s === "S" || s === "Y") return s;
  return "N";
}

function parseMlbProbableTeamSide(
  raw: Record<string, unknown> | null
): { teamId: number | null; probable: ParsedStarter | null } {
  if (raw === null) return { teamId: null, probable: null };
  const team = asObjectOrNull(raw.team);
  const teamId = team === null ? null : asNumberOrNull(team.id);
  const pp = asObjectOrNull(raw.probablePitcher);
  if (pp === null) return { teamId, probable: null };
  const id = asNumberOrNull(pp.id);
  if (id === null) return { teamId, probable: null };
  return {
    teamId,
    probable: {
      source: "mlb_stats_probable",
      confidence: "probable",
      externalId: id,
      externalIdKind: "mlb_person_id",
      fullName: asStringOrNull(pp.fullName),
    },
  };
}

/**
 * Parse the response from
 *   GET https://statsapi.mlb.com/api/v1/schedule
 *       ?date=YYYY-MM-DD&sportId=1&hydrate=probablePitcher
 *
 * Returns one entry per game (including doubleheaders, which appear as two
 * games with distinct gamePk + gameNumber). Postponed and cancelled games
 * are included with the right `status` so the caller can skip them
 * explicitly rather than silently dropping data.
 *
 * Malformed top-level shape → empty array. Malformed individual games →
 * skipped. Either side missing a `probablePitcher` → that side's
 * `homeProbable`/`awayProbable` is null, the game still returns.
 */
export function parseMlbStatsSchedule(raw: unknown): ParsedScheduleGame[] {
  const root = asObjectOrNull(raw);
  if (root === null) return [];
  const dates = asArrayOrEmpty(root.dates);
  const out: ParsedScheduleGame[] = [];
  for (const dateEntry of dates) {
    const de = asObjectOrNull(dateEntry);
    if (de === null) continue;
    const games = asArrayOrEmpty(de.games);
    for (const g of games) {
      const game = asObjectOrNull(g);
      if (game === null) continue;
      const gamePk = asNumberOrNull(game.gamePk);
      if (gamePk === null) continue;
      const status = asObjectOrNull(game.status);
      const detailed = status === null ? null : asStringOrNull(status.detailedState);
      const teams = asObjectOrNull(game.teams);
      const home = parseMlbProbableTeamSide(asObjectOrNull(teams?.home));
      const away = parseMlbProbableTeamSide(asObjectOrNull(teams?.away));
      out.push({
        gamePk,
        gameDate: asStringOrNull(game.gameDate) ?? "",
        gameNumber: asNumberOrNull(game.gameNumber) ?? 1,
        doubleHeader: normalizeDoubleHeader(game.doubleHeader),
        status: normalizeMlbStatsStatus(detailed),
        homeTeamId: home.teamId,
        awayTeamId: away.teamId,
        homeProbable: home.probable,
        awayProbable: away.probable,
      });
    }
  }
  return out;
}

// ─── BDL /games starter parser ────────────────────────────────────────

/**
 * Read the probable-starter fields off a single BDL `/games` row. BDL
 * exposes them two equivalent ways (`home_team_pitcher.id` nested, or
 * `home_team_pitcher_id` flat) — we accept either. Source is `bdl_games`,
 * confidence is `probable` (BDL's `/games` endpoint has no confirmed flag).
 *
 * Returns `{ home: null, away: null }` for any malformed input. Pitcher IDs
 * of `0` are treated as null (BDL occasionally returns 0 for "unknown").
 */
export function parseBdlGameStarters(rawGame: unknown): {
  home: ParsedStarter | null;
  away: ParsedStarter | null;
} {
  const g = asObjectOrNull(rawGame);
  if (g === null) return { home: null, away: null };
  const homeNested = asObjectOrNull(g.home_team_pitcher);
  const awayNested = asObjectOrNull(g.away_team_pitcher);
  const homeId =
    (homeNested === null ? null : asNumberOrNull(homeNested.id)) ??
    asNumberOrNull(g.home_team_pitcher_id);
  const awayId =
    (awayNested === null ? null : asNumberOrNull(awayNested.id)) ??
    asNumberOrNull(g.away_team_pitcher_id);
  const home: ParsedStarter | null =
    homeId !== null && homeId > 0
      ? {
          source: "bdl_games",
          confidence: "probable",
          externalId: homeId,
          externalIdKind: "bdl_player_id",
          fullName: null,
        }
      : null;
  const away: ParsedStarter | null =
    awayId !== null && awayId > 0
      ? {
          source: "bdl_games",
          confidence: "probable",
          externalId: awayId,
          externalIdKind: "bdl_player_id",
          fullName: null,
        }
      : null;
  return { home, away };
}

// ─── BDL /lineups starter parser ──────────────────────────────────────

/**
 * Read probable-starter rows from a BDL `/lineups?game_ids[]=N` response
 * for ONE game. Caller passes the home/away BDL team_ids so we can side-map
 * each row.
 *
 * Selection rule per side:
 *   • Keep only rows where `is_probable_pitcher=true`.
 *   • If multiple match, prefer the one with `is_confirmed=true`.
 *   • If multiple still match after that, last wins (BDL doesn't repeat
 *     probables in practice; defensive only).
 *
 * Source is `bdl_lineups_confirmed` when `is_confirmed=true`, otherwise
 * `bdl_lineups_probable`. Confidence follows: confirmed rows land in
 * `confirmed`, everything else in `probable`.
 */
export function parseBdlLineupsForStarter(
  rows: unknown[],
  homeTeamId: number | null,
  awayTeamId: number | null
): { home: ParsedStarter | null; away: ParsedStarter | null } {
  let home: ParsedStarter | null = null;
  let away: ParsedStarter | null = null;

  for (const rRaw of rows) {
    const r = asObjectOrNull(rRaw);
    if (r === null) continue;
    if (!asBoolOrFalse(r.is_probable_pitcher)) continue;
    const teamId = asNumberOrNull(r.team_id);
    const playerId = asNumberOrNull(r.player_id);
    if (teamId === null || playerId === null || playerId <= 0) continue;
    const isConfirmed = asBoolOrFalse(r.is_confirmed);
    const candidate: ParsedStarter = {
      source: isConfirmed ? "bdl_lineups_confirmed" : "bdl_lineups_probable",
      confidence: isConfirmed ? "confirmed" : "probable",
      externalId: playerId,
      externalIdKind: "bdl_player_id",
      fullName: null,
    };
    const side: "home" | "away" | null =
      homeTeamId !== null && teamId === homeTeamId
        ? "home"
        : awayTeamId !== null && teamId === awayTeamId
          ? "away"
          : null;
    if (side === null) continue;
    const current = side === "home" ? home : away;
    // Confirmed beats probable. Same-tier last wins.
    if (current === null) {
      if (side === "home") home = candidate;
      else away = candidate;
      continue;
    }
    if (current.confidence === "confirmed") continue;
    // current is probable; candidate (probable or confirmed) wins.
    if (side === "home") home = candidate;
    else away = candidate;
  }
  return { home, away };
}

// ─── Merge helper ─────────────────────────────────────────────────────

/** Tier rank for ordering. confirmed > probable. */
function tierRank(c: StarterConfidence | null): 0 | 1 {
  return c === "confirmed" ? 1 : 0;
}

/**
 * Decide what to do given the current DB state and a new candidate from a
 * fresh source. The five rules (from Phase 4.2.C.1.G planning):
 *
 *   1. Never null-overwrite an existing starter.
 *   2. Confirmed beats probable (tier upgrade).
 *   3. Manual beats automated.
 *   4. Same-tier later non-null source can update if it differs (scratch).
 *   5. Scratch is detected whenever a non-null new starter differs from
 *      the existing one and is allowed to win per rules 2-4.
 *
 * Notes:
 *   • `existing.confidence === null` is treated as `probable` so legacy
 *     rows can be upgraded by a confirmed candidate but not by a same-tier
 *     probable that points at the same player (no-op).
 *   • A *different* player at the *same* tier is treated as a scratch and
 *     writes (rule 4 + 5).
 *   • A *different* player at a *lower* tier than existing → no_change
 *     (we never downgrade confirmed→probable for a different person).
 *   • `existing.source === null` does NOT count as `manual` (rule 3 only
 *     applies to explicit operator entries).
 *
 * Output is a planned action with full provenance — the operator script
 * is responsible for the actual DB write and any logging of scratch events.
 */
export function mergeStarter(
  existing: ExistingStarter,
  candidate: NormalizedStarterCandidate | null
): MergeDecision {
  if (candidate === null) {
    if (existing.playerId === null) {
      return { kind: "no_change", reason: "no_existing_no_candidate" };
    }
    return { kind: "no_change", reason: "null_candidate_preserve_existing" };
  }
  if (existing.playerId === null) {
    return {
      kind: "write",
      reason: "fresh",
      value: candidate,
      previousPlayerId: null,
      scratchDetected: false,
    };
  }
  if (existing.source === "manual" && candidate.source !== "manual") {
    return { kind: "no_change", reason: "manual_protected" };
  }
  const existingTier = tierRank(existing.confidence);
  const candidateTier = tierRank(candidate.confidence);
  if (existing.playerId === candidate.playerId) {
    if (candidateTier > existingTier) {
      return {
        kind: "write",
        reason: "upgrade_same_player",
        value: candidate,
        previousPlayerId: existing.playerId,
        scratchDetected: false,
      };
    }
    return { kind: "no_change", reason: "same_player_no_upgrade" };
  }
  // Different player.
  if (candidateTier > existingTier) {
    return {
      kind: "write",
      reason: "upgrade_with_scratch",
      value: candidate,
      previousPlayerId: existing.playerId,
      scratchDetected: true,
    };
  }
  if (candidateTier === existingTier) {
    return {
      kind: "write",
      reason: "same_tier_scratch",
      value: candidate,
      previousPlayerId: existing.playerId,
      scratchDetected: true,
    };
  }
  return { kind: "no_change", reason: "different_player_lower_confidence" };
}

// ─── Source-priority picker ───────────────────────────────────────────

/**
 * Variadic priority picker. Returns the first non-null candidate, or
 * `null` if all sources are null. Used by the starter-refresh operator
 * to enforce "MLB Stats primary, BDL fallback" without conditionals at
 * the call site.
 */
export function pickPrimaryCandidate(
  ...sources: Array<ParsedStarter | null>
): ParsedStarter | null {
  for (const s of sources) if (s !== null) return s;
  return null;
}

// ─── MLB Stats team-id → internal-abbreviation mapping ───────────────

/**
 * MLB Stats Person/Team API uses its own team-id space (stable across
 * seasons). Our `teams.abbreviation` column carries 3-letter codes that
 * mostly match the conventional MLB Stats names — with one repo-specific
 * choice: `ATH` for the Athletics (verified against the live `teams`
 * table). Anything not in this map → `null`; the operator caller treats
 * the schedule row as "no match" and logs it.
 *
 * 30 entries. Frozen to prevent accidental mutation.
 */
export const MLB_STATS_TEAM_ID_TO_ABBR: Readonly<Record<number, string>> = Object.freeze({
  108: "LAA",
  109: "ARI",
  110: "BAL",
  111: "BOS",
  112: "CHC",
  113: "CIN",
  114: "CLE",
  115: "COL",
  116: "DET",
  117: "HOU",
  118: "KC",
  119: "LAD",
  120: "WSH",
  121: "NYM",
  133: "ATH",
  134: "PIT",
  135: "SD",
  136: "SEA",
  137: "SF",
  138: "STL",
  139: "TB",
  140: "TEX",
  141: "TOR",
  142: "MIN",
  143: "PHI",
  144: "ATL",
  145: "CWS",
  146: "MIA",
  147: "NYY",
  158: "MIL",
});

/** Lookup helper. `null` input or unknown id → `null`. */
export function mlbStatsTeamIdToAbbr(id: number | null): string | null {
  if (id === null) return null;
  return MLB_STATS_TEAM_ID_TO_ABBR[id] ?? null;
}

// ─── Schedule-game ↔ DB-game matcher ─────────────────────────────────

/**
 * Internal-id shape that the matcher accepts. The operator builds these
 * from the `games` table at runtime; the matcher is pure so it can be
 * unit-tested without DB I/O.
 */
export interface CandidateDbGame {
  id: number;
  externalId: number;
  homeAbbr: string | null;
  awayAbbr: string | null;
}

/**
 * Match a parsed MLB Stats schedule game to a DB game by team
 * abbreviation. Both sides must match exactly (caller has already
 * translated MLB Stats team_ids → abbreviations via
 * `mlbStatsTeamIdToAbbr`).
 *
 * Returns the first matching candidate. For doubleheaders the caller is
 * responsible for handling the multiple-MLB-games-per-matchup case
 * (typically by tracking which DB games have already been claimed and
 * filtering them out of subsequent calls).
 *
 * Either-side `null` → no match.
 */
export function matchScheduleGameToDbGame(
  scheduleHomeAbbr: string | null,
  scheduleAwayAbbr: string | null,
  candidates: ReadonlyArray<CandidateDbGame>
): CandidateDbGame | null {
  if (scheduleHomeAbbr === null || scheduleAwayAbbr === null) return null;
  for (const c of candidates) {
    if (c.homeAbbr === scheduleHomeAbbr && c.awayAbbr === scheduleAwayAbbr) {
      return c;
    }
  }
  return null;
}
