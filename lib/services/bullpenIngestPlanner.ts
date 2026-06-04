/**
 * Phase 4.2.C.1.R-15 — pure planner for bullpen-pitcher ingestion.
 *
 * Selects "likely bullpen" candidates from a team's active roster using
 * the R-15 A3 rule:
 *
 *     pitcher AND (games_started < 5 OR position in {RP, CL, MR})
 *
 * Pitcher detection uses MLB Stats' `position.type === "Pitcher"` when
 * available, with `positionAbbreviation === "P"` as fallback. The "P"
 * default is the MLB Stats convention — it doesn't distinguish SP from
 * RP at the roster level. The games_started gate is the deciding signal.
 *
 * V1 conventions (Daniel-approved):
 *   • Anyone in `currentStarterMlbIds` is excluded (probable starter for
 *     a current slate; never reclassified as bullpen).
 *   • Anyone in `existingPlayerMlbIds` is skipped (already in DB). The
 *     planner is idempotent: re-running it on a slate after a successful
 *     apply produces zero new selections.
 *   • When `games_started` is null (rookie / no season-stats row yet),
 *     the player IS selected. Rookies who debut as relievers SHOULD be
 *     in the bullpen pool — leaning inclusive is the safe default for
 *     a starter-quality fallback model.
 *   • All selected candidates are inserted with `position_abbr = "RP"`
 *     so the existing featureSnapshot.ts query picks them up.
 *
 * Pure / no I/O. The orchestration service (bullpenIngestService.ts)
 * does the network + DB; this file only decides who to keep.
 */

import type { MlbRosterEntry } from "../providers/real_api/_mlbStatsApiClient";

// ─── Public types ─────────────────────────────────────────────────────

/** Stats hydration passed in per-person by the orchestrator. */
export type RosterStatsLite = {
  /** Season games started. Null when no `player_season_stats` row exists. */
  gamesStarted: number | null;
};

/** A single planner decision. */
export type BullpenPlanRow = {
  personId: number;
  fullName: string;
  positionAbbreviation: string | null;
  /** `true` when this person should be inserted; `false` when skipped. */
  selected: boolean;
  /** Set when `selected === false`. Empty string otherwise. */
  skipReason: BullpenSkipReason | "";
  /** When `selected === true`, the rule that fired. */
  selectionReason: BullpenSelectionReason | "";
  /** Echoed for diagnostic output. May be null when stats are missing. */
  gamesStarted: number | null;
};

export type BullpenSkipReason =
  | "not_pitcher"
  | "current_starter"
  | "already_in_db"
  | "regular_starter"     // games_started >= 5 AND position is plain "P"
  | "missing_person_id";

export type BullpenSelectionReason =
  | "rp_cl_mr_position"
  | "low_games_started"
  | "no_season_stats";    // hedged-inclusive default when stats missing

/** Aggregate output. */
export type BullpenPlanResult = {
  /** Persons selected for insertion (idempotent — dedupes by personId). */
  selected: BullpenPlanRow[];
  /** Persons not selected, with reasons. */
  skipped: BullpenPlanRow[];
  /** Summary counters by skipReason. */
  skipCountsByReason: Record<BullpenSkipReason, number>;
};

/** Inputs to `planBullpenSelections`. All sets/maps default to empty. */
export type BullpenPlanInputs = {
  roster: ReadonlyArray<MlbRosterEntry>;
  /** MLB person IDs already present in our `players` table. */
  existingPlayerMlbIds?: ReadonlySet<number>;
  /** MLB person IDs of probable starters for a current/upcoming slate. */
  currentStarterMlbIds?: ReadonlySet<number>;
  /** Per-person season stats hydration (light shape — `gamesStarted` only). */
  seasonStatsByPersonId?: ReadonlyMap<number, RosterStatsLite>;
};

// ─── Internal helpers ─────────────────────────────────────────────────

const RP_POSITION_CODES = new Set(["RP", "CL", "MR"]);
const PITCHER_POSITION_CODES = new Set(["P", "SP", "RP", "CL", "MR"]);
const LOW_GS_THRESHOLD = 5; // R-15 A3 — pitcher with gs < 5 is a bullpen candidate

function isPitcher(entry: MlbRosterEntry): boolean {
  if (entry.positionType !== null && entry.positionType.toLowerCase() === "pitcher") {
    return true;
  }
  const abbr = (entry.positionAbbreviation ?? "").trim().toUpperCase();
  return PITCHER_POSITION_CODES.has(abbr);
}

function dedupeByPersonId(
  roster: ReadonlyArray<MlbRosterEntry>
): MlbRosterEntry[] {
  const seen = new Set<number>();
  const out: MlbRosterEntry[] = [];
  for (const r of roster) {
    if (seen.has(r.personId)) continue;
    seen.add(r.personId);
    out.push(r);
  }
  return out;
}

// ─── Public API ───────────────────────────────────────────────────────

/**
 * R-15 — classify each roster entry as selected (bullpen candidate) or
 * skipped (with reason). Pure.
 *
 * Output is deterministic: candidates are returned in ascending
 * `personId` order so re-runs with the same inputs produce identical
 * output. Useful for `--limit` truncation in the operator.
 */
export function planBullpenSelections(
  inputs: BullpenPlanInputs
): BullpenPlanResult {
  const existing = inputs.existingPlayerMlbIds ?? new Set<number>();
  const starters = inputs.currentStarterMlbIds ?? new Set<number>();
  const statsMap = inputs.seasonStatsByPersonId ?? new Map<number, RosterStatsLite>();

  const rows: BullpenPlanRow[] = [];

  // Roster API can occasionally return duplicate person ids when a
  // player is on multiple sub-rosters; dedupe before classification so
  // we don't emit duplicate decisions.
  for (const entry of dedupeByPersonId(inputs.roster)) {
    const stats = statsMap.get(entry.personId) ?? { gamesStarted: null };
    const decision = classify(entry, {
      isCurrentStarter: starters.has(entry.personId),
      isAlreadyInDb: existing.has(entry.personId),
      gamesStarted: stats.gamesStarted,
    });
    rows.push(decision);
  }

  rows.sort((a, b) => a.personId - b.personId);

  const selected = rows.filter((r) => r.selected);
  const skipped = rows.filter((r) => !r.selected);

  const skipCountsByReason: Record<BullpenSkipReason, number> = {
    not_pitcher: 0,
    current_starter: 0,
    already_in_db: 0,
    regular_starter: 0,
    missing_person_id: 0,
  };
  for (const r of skipped) {
    if (r.skipReason !== "") {
      skipCountsByReason[r.skipReason] += 1;
    }
  }

  return { selected, skipped, skipCountsByReason };
}

function classify(
  entry: MlbRosterEntry,
  ctx: {
    isCurrentStarter: boolean;
    isAlreadyInDb: boolean;
    gamesStarted: number | null;
  }
): BullpenPlanRow {
  const base = {
    personId: entry.personId,
    fullName: entry.fullName,
    positionAbbreviation: entry.positionAbbreviation,
    gamesStarted: ctx.gamesStarted,
  };

  if (entry.personId === null || !Number.isFinite(entry.personId)) {
    return {
      ...base,
      selected: false,
      skipReason: "missing_person_id",
      selectionReason: "",
    };
  }

  if (!isPitcher(entry)) {
    return {
      ...base,
      selected: false,
      skipReason: "not_pitcher",
      selectionReason: "",
    };
  }

  // Idempotency gate: a person already in our players table is skipped
  // regardless of role. The orchestrator may still want to refresh their
  // stats, but the planner's job here is ingestion-only.
  if (ctx.isAlreadyInDb) {
    return {
      ...base,
      selected: false,
      skipReason: "already_in_db",
      selectionReason: "",
    };
  }

  // Never reclassify tonight's probable starter as bullpen — they have
  // their own ingestion path through `refresh-starters`.
  if (ctx.isCurrentStarter) {
    return {
      ...base,
      selected: false,
      skipReason: "current_starter",
      selectionReason: "",
    };
  }

  // R-15 A3 rule
  const abbr = (entry.positionAbbreviation ?? "").trim().toUpperCase();
  if (RP_POSITION_CODES.has(abbr)) {
    return {
      ...base,
      selected: true,
      skipReason: "",
      selectionReason: "rp_cl_mr_position",
    };
  }
  if (ctx.gamesStarted === null) {
    // Hedged-inclusive default: rookies / no-stats players selected.
    return {
      ...base,
      selected: true,
      skipReason: "",
      selectionReason: "no_season_stats",
    };
  }
  if (ctx.gamesStarted < LOW_GS_THRESHOLD) {
    return {
      ...base,
      selected: true,
      skipReason: "",
      selectionReason: "low_games_started",
    };
  }
  return {
    ...base,
    selected: false,
    skipReason: "regular_starter",
    selectionReason: "",
  };
}

/**
 * Apply a `--limit N` truncation deterministically. The planner already
 * sorts by ascending personId, so re-runs with the same `--limit` always
 * pick the same rows.
 */
export function truncateBullpenSelections<T>(
  rows: ReadonlyArray<T>,
  limit: number | undefined
): T[] {
  if (limit === undefined) return [...rows];
  if (limit <= 0) return [];
  return rows.slice(0, limit);
}
