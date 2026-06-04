/**
 * Phase 4.2.C.1.R-15 — bullpen ingest orchestration service.
 *
 * Reusable service that the operator script AND any future cron /
 * Daily-Edge orchestrator can call directly. The operator script is a
 * thin CLI wrapper around the functions exported here.
 *
 * Two top-level entry points:
 *   • `planBullpenIngestForSlate(slate_date)` — fetches tonight's teams
 *     from `games`, fetches their active rosters from MLB Stats, plans
 *     bullpen selections.
 *   • `planBullpenIngestForAllTeams()` — fetches all 30 teams' rosters
 *     directly from the static MLB Stats id map. Used for one-shot
 *     foundation backfills and the broader maintenance refresh.
 *
 * Both return a plan that the caller can pass to `applyBullpenIngest`
 * to insert player rows. `applyBullpenIngest` is gated separately so
 * the same plan-building code path is shared between dry-run and write.
 *
 * Idempotency: every call queries existing `players.mlb_person_id`
 * before classifying; persons already in the DB are filtered out by
 * the planner. Repeated runs are safe.
 *
 * Fail handling: per-team failures (MLB Stats 5xx, network timeout)
 * are recorded in the plan as `teamErrors`; the rest of the run
 * continues. The Daily Edge orchestrator can decide whether degraded
 * coverage is acceptable.
 *
 * No DB writes happen inside the planning functions. Writes only
 * happen inside `applyBullpenIngest`, which is itself gated by the
 * `BULLPEN_DB_WRITES_ENABLED=true` operator env flag (defense-in-depth
 * check is in the operator script).
 */

import { supabase } from "../db/supabase";
import {
  getActiveRoster,
  getPersonById,
  getPitcherSeasonStats,
  type MlbRosterEntry,
  type MlbPersonProfile,
} from "../providers/real_api/_mlbStatsApiClient";
import {
  MLB_STATS_TEAM_IDS,
  mlbStatsTeamIdFromAbbr,
  type MlbTeamAbbrev,
} from "../providers/real_api/_teamNameNormalizer";
import {
  planBullpenSelections,
  type BullpenPlanResult,
  type BullpenPlanRow,
  type RosterStatsLite,
} from "./bullpenIngestPlanner";
import {
  planPlayerInsertFromMlbProfile,
  type PlannedPlayerInsert,
} from "./missingPlayerIngestPlanner";

// ─── Public types ─────────────────────────────────────────────────────

/**
 * Per-team result inside a slate or all-teams plan. Carries enough
 * detail for the operator to print a per-team table and for the
 * Daily-Edge orchestrator to decide whether degraded coverage is OK.
 */
export type TeamBullpenPlan = {
  teamId: number;          // our internal `teams.id` (slate mode only)
  abbreviation: MlbTeamAbbrev;
  mlbStatsTeamId: number;
  rosterFetched: boolean;
  rosterError: string | null;
  rosterSize: number;
  pitcherCount: number;
  selected: BullpenPlanRow[];
  skipped: BullpenPlanRow[];
};

export type SlateBullpenPlan = {
  slate_date: string;
  season: number;
  teamPlans: TeamBullpenPlan[];
  teamErrors: Array<{ abbreviation: MlbTeamAbbrev; error: string }>;
  totalsSelected: number;
};

export type AllTeamsBullpenPlan = {
  season: number;
  teamPlans: TeamBullpenPlan[];
  teamErrors: Array<{ abbreviation: MlbTeamAbbrev; error: string }>;
  totalsSelected: number;
};

export type ApplyBullpenIngestOptions = {
  /** Hard cap on inserts per run. Required by operator (`--limit N`). */
  limit?: number;
  /** Whether to actually INSERT to DB. Defaults to false (dry-run). */
  write?: boolean;
  /** ISO timestamp stamped onto each provider_ids.mlb_stats.ingested_at. */
  ingestedAtIso?: string;
  /** Inject a sleep between MLB Stats /people/{id} calls (ms). */
  perPersonDelayMs?: number;
};

export type ApplyBullpenIngestResult = {
  attempted: number;
  inserted: number;
  skipped: Array<{ personId: number; reason: string }>;
  errors: Array<{ personId: number; error: string }>;
};

// ─── Internal helpers ─────────────────────────────────────────────────

function pickEmbedded(
  value: unknown
): { id: number; abbreviation: string } | null {
  if (value === null || value === undefined) return null;
  const candidate = Array.isArray(value) ? value[0] : value;
  if (
    candidate &&
    typeof candidate === "object" &&
    typeof (candidate as { id?: unknown }).id === "number" &&
    typeof (candidate as { abbreviation?: unknown }).abbreviation === "string"
  ) {
    return {
      id: (candidate as { id: number }).id,
      abbreviation: (candidate as { abbreviation: string }).abbreviation,
    };
  }
  return null;
}

function deriveSeason(slate_date: string): number {
  const match = slate_date.match(/^(\d{4})-/);
  return match ? Number.parseInt(match[1]!, 10) : new Date().getUTCFullYear();
}

async function getExistingMlbIds(
  personIds: ReadonlyArray<number>
): Promise<Set<number>> {
  if (personIds.length === 0) return new Set();
  const { data, error } = await supabase
    .from("players")
    .select("mlb_person_id, provider_ids")
    .or(
      // Either column-level or JSONB fallback shape — we test both.
      `mlb_person_id.in.(${personIds.join(",")})`
    );
  if (error !== null) {
    throw new Error(`bullpenIngestService: existing-id lookup failed: ${error.message}`);
  }
  const present = new Set<number>();
  for (const row of (data ?? []) as Array<{
    mlb_person_id: number | null;
    provider_ids: Record<string, unknown> | null;
  }>) {
    if (typeof row.mlb_person_id === "number") present.add(row.mlb_person_id);
    const mlb = row.provider_ids?.mlb_stats as
      | { id?: number }
      | undefined;
    if (typeof mlb?.id === "number") present.add(mlb.id);
  }
  return present;
}

async function getCurrentStarterMlbIds(
  slate_date: string
): Promise<Set<number>> {
  // Identify probable starters by joining today's `games` rows to
  // `players.mlb_person_id`. Anyone in this set is excluded from
  // bullpen selection — they have their own `refresh-starters` path.
  const { data: games, error: gErr } = await supabase
    .from("games")
    .select("home_pitcher_id, away_pitcher_id")
    .eq("sport", "mlb")
    .eq("slate_date", slate_date);
  if (gErr !== null) {
    throw new Error(`bullpenIngestService: starters lookup failed: ${gErr.message}`);
  }
  const ids = new Set<number>();
  for (const g of (games ?? []) as Array<{
    home_pitcher_id: number | null;
    away_pitcher_id: number | null;
  }>) {
    if (g.home_pitcher_id !== null) ids.add(g.home_pitcher_id);
    if (g.away_pitcher_id !== null) ids.add(g.away_pitcher_id);
  }
  if (ids.size === 0) return new Set();
  const { data, error } = await supabase
    .from("players")
    .select("mlb_person_id")
    .in("id", Array.from(ids));
  if (error !== null) {
    throw new Error(`bullpenIngestService: starter mlb_person_id lookup failed: ${error.message}`);
  }
  const out = new Set<number>();
  for (const r of (data ?? []) as Array<{ mlb_person_id: number | null }>) {
    if (typeof r.mlb_person_id === "number") out.add(r.mlb_person_id);
  }
  return out;
}

async function fetchRosterAndStats(
  abbr: MlbTeamAbbrev,
  season: number,
  fetchStatsForAll: boolean,
  perStatDelayMs: number
): Promise<{
  rosterFetched: boolean;
  rosterError: string | null;
  roster: MlbRosterEntry[];
  statsMap: Map<number, RosterStatsLite>;
}> {
  const mlbId = MLB_STATS_TEAM_IDS[abbr];
  let roster: MlbRosterEntry[] | null = null;
  let rosterError: string | null = null;
  try {
    roster = await getActiveRoster(mlbId, { quiet: true });
  } catch (e: unknown) {
    rosterError = (e as Error).message ?? "unknown error";
  }
  if (roster === null) {
    return {
      rosterFetched: false,
      rosterError: rosterError ?? "roster fetch returned null",
      roster: [],
      statsMap: new Map(),
    };
  }
  if (!fetchStatsForAll) {
    return {
      rosterFetched: true,
      rosterError: null,
      roster,
      statsMap: new Map(),
    };
  }
  // Fetch season pitching stats per pitcher in the roster. Throttled to
  // avoid hammering MLB Stats during a 30-team all-teams run.
  const statsMap = new Map<number, RosterStatsLite>();
  for (const entry of roster) {
    const isPitcher =
      (entry.positionType ?? "").toLowerCase() === "pitcher" ||
      (entry.positionAbbreviation ?? "").toUpperCase() === "P";
    if (!isPitcher) continue;
    const rec = await getPitcherSeasonStats(entry.personId, season, { quiet: true });
    if (rec !== null) {
      statsMap.set(entry.personId, { gamesStarted: rec.games_started ?? null });
    }
    if (perStatDelayMs > 0) {
      await new Promise((r) => setTimeout(r, perStatDelayMs));
    }
  }
  return { rosterFetched: true, rosterError: null, roster, statsMap };
}

// ─── Slate-mode plan builder ─────────────────────────────────────────

export async function planBullpenIngestForSlate(
  slate_date: string,
  opts?: { withStats?: boolean; perStatDelayMs?: number }
): Promise<SlateBullpenPlan> {
  const season = deriveSeason(slate_date);
  const withStats = opts?.withStats ?? true;
  const perStatDelayMs = opts?.perStatDelayMs ?? 100;

  // Fetch tonight's teams (de-duped) from the schedule.
  const { data: gameRows, error: gErr } = await supabase
    .from("games")
    .select(
      "home_team_id, away_team_id, home_team:teams!games_home_team_id_fkey(id, abbreviation), away_team:teams!games_away_team_id_fkey(id, abbreviation)"
    )
    .eq("sport", "mlb")
    .eq("slate_date", slate_date);
  if (gErr !== null) {
    throw new Error(`bullpenIngestService: slate-games lookup failed: ${gErr.message}`);
  }
  const teamMap = new Map<MlbTeamAbbrev, number>();
  for (const g of (gameRows ?? []) as Array<Record<string, unknown>>) {
    // Supabase embedded relations come back as either a single object or
    // an array depending on FK shape; normalize either to a single row.
    const home = pickEmbedded(g.home_team);
    const away = pickEmbedded(g.away_team);
    if (home !== null) {
      const abbr = home.abbreviation as MlbTeamAbbrev;
      if (mlbStatsTeamIdFromAbbr(abbr) !== null) teamMap.set(abbr, home.id);
    }
    if (away !== null) {
      const abbr = away.abbreviation as MlbTeamAbbrev;
      if (mlbStatsTeamIdFromAbbr(abbr) !== null) teamMap.set(abbr, away.id);
    }
  }

  const currentStarterMlbIds = await getCurrentStarterMlbIds(slate_date);
  return buildPlanForAbbreviations(
    Array.from(teamMap.entries()),
    season,
    withStats,
    perStatDelayMs,
    currentStarterMlbIds,
    { slate_date }
  );
}

// ─── All-teams plan builder ──────────────────────────────────────────

export async function planBullpenIngestForAllTeams(opts?: {
  season?: number;
  withStats?: boolean;
  perStatDelayMs?: number;
}): Promise<AllTeamsBullpenPlan> {
  const season = opts?.season ?? new Date().getUTCFullYear();
  const withStats = opts?.withStats ?? true;
  const perStatDelayMs = opts?.perStatDelayMs ?? 100;
  // No starter exclusion for all-teams mode — there's no slate context.
  // The planner's other exclusions (already_in_db, regular_starter via
  // games_started>=5) still gate inserts.
  const allAbbrs = Object.keys(MLB_STATS_TEAM_IDS) as MlbTeamAbbrev[];
  // Resolve internal team.id when possible for diagnostic output (not
  // required for inserts since `team_id` will be looked up later).
  const { data: teamsRaw } = await supabase
    .from("teams")
    .select("id, abbreviation")
    .eq("sport", "mlb");
  const teamIdByAbbr = new Map<string, number>();
  for (const t of (teamsRaw ?? []) as Array<{ id: number; abbreviation: string }>) {
    teamIdByAbbr.set(t.abbreviation, t.id);
  }
  const pairs: Array<[MlbTeamAbbrev, number]> = allAbbrs.map((a) => [
    a,
    teamIdByAbbr.get(a) ?? -1,
  ]);
  const plan = await buildPlanForAbbreviations(
    pairs,
    season,
    withStats,
    perStatDelayMs,
    new Set<number>(),
    null
  );
  return {
    season,
    teamPlans: plan.teamPlans,
    teamErrors: plan.teamErrors,
    totalsSelected: plan.totalsSelected,
  };
}

// ─── Shared plan builder ─────────────────────────────────────────────

async function buildPlanForAbbreviations(
  teamPairs: ReadonlyArray<[MlbTeamAbbrev, number]>,
  season: number,
  withStats: boolean,
  perStatDelayMs: number,
  currentStarterMlbIds: ReadonlySet<number>,
  slateCtx: { slate_date: string } | null
): Promise<SlateBullpenPlan> {
  const teamPlans: TeamBullpenPlan[] = [];
  const teamErrors: Array<{ abbreviation: MlbTeamAbbrev; error: string }> = [];

  // Collect all roster persons across teams first so we can de-dupe DB
  // lookups in a single batch.
  const perTeamRosters = new Map<
    MlbTeamAbbrev,
    {
      teamId: number;
      mlbStatsTeamId: number;
      rosterFetched: boolean;
      rosterError: string | null;
      roster: MlbRosterEntry[];
      statsMap: Map<number, RosterStatsLite>;
    }
  >();

  for (const [abbr, teamId] of teamPairs) {
    const mlbStatsTeamId = MLB_STATS_TEAM_IDS[abbr];
    const res = await fetchRosterAndStats(
      abbr,
      season,
      withStats,
      perStatDelayMs
    );
    if (!res.rosterFetched) {
      teamErrors.push({
        abbreviation: abbr,
        error: res.rosterError ?? "unknown roster failure",
      });
    }
    perTeamRosters.set(abbr, {
      teamId,
      mlbStatsTeamId,
      ...res,
    });
  }

  const allPersonIds = new Set<number>();
  for (const v of perTeamRosters.values()) {
    for (const e of v.roster) allPersonIds.add(e.personId);
  }
  const existingPlayerMlbIds = await getExistingMlbIds(Array.from(allPersonIds));

  let totalsSelected = 0;
  for (const [abbr, payload] of perTeamRosters.entries()) {
    const pitcherCount = payload.roster.filter((e) => {
      return (
        (e.positionType ?? "").toLowerCase() === "pitcher" ||
        (e.positionAbbreviation ?? "").toUpperCase() === "P"
      );
    }).length;

    const planResult: BullpenPlanResult = planBullpenSelections({
      roster: payload.roster,
      existingPlayerMlbIds,
      currentStarterMlbIds,
      seasonStatsByPersonId: payload.statsMap,
    });
    totalsSelected += planResult.selected.length;
    teamPlans.push({
      teamId: payload.teamId,
      abbreviation: abbr,
      mlbStatsTeamId: payload.mlbStatsTeamId,
      rosterFetched: payload.rosterFetched,
      rosterError: payload.rosterError,
      rosterSize: payload.roster.length,
      pitcherCount,
      selected: planResult.selected,
      skipped: planResult.skipped,
    });
  }

  return {
    slate_date: slateCtx?.slate_date ?? "",
    season,
    teamPlans,
    teamErrors,
    totalsSelected,
  };
}

// ─── Apply phase ─────────────────────────────────────────────────────

/**
 * Apply (or dry-run) a plan. Iterates the per-team selected lists in
 * deterministic order, fetches MLB Stats /people/{id} per selected
 * person, builds a `players` row payload via the existing
 * `planPlayerInsertFromMlbProfile`, and (if `write === true`) inserts
 * it. Idempotent via `mlb_person_id` pre-check (also enforced by the
 * partial UNIQUE index on `players.mlb_person_id IS NOT NULL`).
 *
 * Sets `position_abbr = "RP"` on every inserted reliever per R-15
 * Daniel-approved convention so featureSnapshot.ts auto-detects them.
 */
export async function applyBullpenIngest(
  plan: { teamPlans: ReadonlyArray<TeamBullpenPlan> },
  options: ApplyBullpenIngestOptions = {}
): Promise<ApplyBullpenIngestResult> {
  const limit = options.limit;
  const write = options.write === true;
  const ingestedAtIso = options.ingestedAtIso ?? new Date().toISOString();
  const perPersonDelayMs = options.perPersonDelayMs ?? 150;

  // Flat ordered list: per-team selected, sorted by abbreviation +
  // personId for determinism. Apply `--limit` after sorting.
  type Task = {
    personId: number;
    abbreviation: string;
    teamId: number;
    fullName: string;
  };
  const tasks: Task[] = [];
  for (const t of plan.teamPlans) {
    for (const s of t.selected) {
      tasks.push({
        personId: s.personId,
        abbreviation: t.abbreviation,
        teamId: t.teamId,
        fullName: s.fullName,
      });
    }
  }
  tasks.sort((a, b) =>
    a.abbreviation === b.abbreviation
      ? a.personId - b.personId
      : a.abbreviation.localeCompare(b.abbreviation)
  );
  // Dedupe by personId — `--all-teams` mode emits the same MLB Stats team
  // id twice for the OAK/ATH franchise (both abbreviations map to id 133),
  // so without dedupe we'd attempt 2 inserts per reliever. First-team-wins.
  const seenPersonIds = new Set<number>();
  const tasksDeduped: Task[] = [];
  for (const t of tasks) {
    if (seenPersonIds.has(t.personId)) continue;
    seenPersonIds.add(t.personId);
    tasksDeduped.push(t);
  }
  const tasksLimited =
    typeof limit === "number" && limit >= 0
      ? tasksDeduped.slice(0, limit)
      : tasksDeduped;

  const result: ApplyBullpenIngestResult = {
    attempted: tasksLimited.length,
    inserted: 0,
    skipped: [],
    errors: [],
  };

  for (const task of tasksLimited) {
    let profile: MlbPersonProfile | null;
    try {
      profile = await getPersonById(task.personId, { quiet: true });
    } catch (e: unknown) {
      result.errors.push({
        personId: task.personId,
        error: `getPersonById threw: ${(e as Error).message ?? "unknown"}`,
      });
      continue;
    }
    if (profile === null) {
      result.errors.push({
        personId: task.personId,
        error: "getPersonById returned null",
      });
      continue;
    }
    const planned = planPlayerInsertFromMlbProfile(profile, {
      teamId: task.teamId > 0 ? task.teamId : null,
      ingestedAtIso,
    });
    if (planned.kind === "skip") {
      result.skipped.push({
        personId: task.personId,
        reason: planned.reason,
      });
      continue;
    }
    // R-15 convention — force position_abbr to "RP" so featureSnapshot
    // picks the row up regardless of how MLB Stats classifies the
    // primary position. This is the only field we override from the
    // upstream planner.
    const row: PlannedPlayerInsert = {
      ...planned.insert,
      position_abbr: "RP",
    };
    if (!write) {
      result.inserted += 1;
      continue;
    }
    const { error } = await supabase.from("players").insert(row);
    if (error !== null) {
      // The partial UNIQUE index will catch a race; treat as benign skip.
      const isDupe =
        error.code === "23505" || /duplicate/i.test(error.message ?? "");
      if (isDupe) {
        result.skipped.push({
          personId: task.personId,
          reason: "duplicate (unique index caught race)",
        });
        continue;
      }
      result.errors.push({
        personId: task.personId,
        error: `insert failed: ${error.message}`,
      });
      continue;
    }
    result.inserted += 1;
    if (perPersonDelayMs > 0) {
      await new Promise((r) => setTimeout(r, perPersonDelayMs));
    }
  }

  return result;
}
