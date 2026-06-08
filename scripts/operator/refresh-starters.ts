/**
 * Phase 4.2.C.1.G-2 / G-3 — starter refresh operator.
 *
 * USAGE:
 *   Dry-run (default):
 *     npx tsx --env-file=.env.local \
 *       scripts/operator/refresh-starters.ts --date 2026-06-03
 *
 *   Apply (two-key gate + interactive y/N + required --limit):
 *     STARTER_DB_WRITES_ENABLED=true \
 *       npx tsx --env-file=.env.local \
 *       scripts/operator/refresh-starters.ts \
 *       --date 2026-06-03 --limit 1 --apply
 *
 * WRITE GATING (G-3, mirrors ingest-missing-pitchers):
 *   1. `--apply` flag AND `STARTER_DB_WRITES_ENABLED=true` env must BOTH
 *      be present. Without both, the script runs dry-run.
 *   2. `--limit N` is REQUIRED in apply mode (N counts GAMES, not sides;
 *      a 1-game smoke writes both home + away sides for that one game
 *      when both have `decision.kind === "write"`).
 *   3. Interactive y/N confirmation listing the exact per-side updates.
 *   4. Per-game UPDATE loop — only columns whose side decided to write
 *      are touched; `updated_at` is set to now. Never null-overwrites
 *      (mergeStarter would have returned no_change instead).
 *
 * Scratch detection from `mergeStarter` is preserved — when fired, the
 * apply prints a [SCRATCH] tag on the confirmation row so the operator
 * can abort if a swap is unexpected.
 *
 * FLOW:
 *   1. Load DB games for the slate date + their teams.
 *   2. Fetch MLB Stats `/api/v1/schedule?hydrate=probablePitcher`.
 *   3. Fetch BDL slate via the existing `BallDontLieSlateProvider` (which
 *      internally tries `/games` first then `/lineups`).
 *   4. For each DB game, build per-side starter candidates:
 *        primary  = MLB Stats probable (mlb_person_id space)
 *        fallback = BDL game starter   (bdl_player_id space)
 *      Pick the first non-null via `pickPrimaryCandidate`.
 *   5. Resolve the chosen `externalId` to internal `players.id`:
 *        mlb_person_id → `players.mlb_person_id` IN (...)
 *                        with JSONB fallback on `provider_ids.mlb_stats.id`
 *        bdl_player_id → `players.external_id` IN (...)
 *   6. Build an `ExistingStarter` from the current `games.*_pitcher_id`
 *      (provenance unknown until the G-4 schema additive) and call
 *      `mergeStarter` for the planned action.
 *   7. Print a per-game table + summary.
 *
 * SAFETY:
 *   • No DB writes.
 *   • `--write` rejected via `rejectWriteFlag`.
 *   • All Supabase calls are SELECT only — no INSERT/UPDATE/DELETE.
 *   • No prediction generation, no publish/hide/unlock, no cron wiring.
 *
 * BDL CONFIDENCE LIMITATION:
 *   The slate provider's existing `/games` + `/lineups` fallback returns
 *   a single `*_pitcher_external_id` without exposing whether the row
 *   came from `is_confirmed=true`. For G-2 we tag every BDL-sourced
 *   starter as `bdl_games` / `probable`. Phase G-3 will add a direct
 *   `/lineups` fetch to detect confirmed-tier signals when needed.
 */

import * as readline from "node:readline/promises";
import { stdin as input, stdout as output } from "node:process";

import { supabase } from "../../lib/db/supabase";
import { BallDontLieSlateProvider } from "../../lib/providers/real_api/BallDontLieSlateProvider";
import { fetchMlbStatsScheduleRaw } from "../../lib/providers/real_api/_mlbStatsApiClient";
import type { Sport } from "../../lib/types/domain/Sport";
import {
  type CandidateDbGame,
  type ExistingStarter,
  type MergeDecision,
  type NormalizedStarterCandidate,
  type ParsedStarter,
  matchScheduleGameToDbGame,
  mergeStarter,
  mlbStatsTeamIdToAbbr,
  parseMlbStatsSchedule,
  pickPrimaryCandidate,
} from "../../lib/services/starterResolver";
import {
  buildGameKey,
  fetchEspnProbablePitchers,
  isEspnSecondarySourceEnabled,
  mapEspnPitcherToPlayer,
  type EspnMappingStatus,
  type EspnProbablesForGame,
} from "../../lib/services/espnProbablePitcherService";
import {
  readBoolFlag,
  readNumberFlag,
  readStringFlag,
  todayUTC,
} from "./_cliCommon";

// ─── DB row shapes ────────────────────────────────────────────────────

type DbGame = {
  id: number;
  external_id: number;
  game_date: string;
  home_team_id: number | null;
  away_team_id: number | null;
  home_pitcher_id: number | null;
  away_pitcher_id: number | null;
};

type DbTeam = {
  id: number;
  abbreviation: string;
  external_id: number;
};

// Subset of BDL SlateGameRecord we care about — kept loose to avoid
// importing the BDL types here (this is an operator, not a typed service).
type BdlSlateRecord = {
  external_id: number;
  home_pitcher_external_id: number | null;
  away_pitcher_external_id: number | null;
};

// ─── Per-side decision shape (operator-internal) ─────────────────────

type ResolutionKind =
  | "provider_ids_mlb_stats"
  | "mlb_person_id"
  | "bdl_external_id"
  | "espn_resolved"
  | "espn_ambiguous"
  | "espn_not_found"
  | "unresolved"
  | "no_candidate";

interface SideDecision {
  side: "home" | "away";
  mlbCandidate: ParsedStarter | null;
  bdlCandidate: ParsedStarter | null;
  /** Phase 6B.31a — ESPN secondary candidate (pre-resolved to players.id). */
  espnCandidate: ParsedStarter | null;
  /** Phase 6B.31a — populated when ESPN was consulted but mapping failed. */
  espnSkipReason: { name: string; teamId: number | null; status: Exclude<EspnMappingStatus, "matched"> } | null;
  chosenCandidate: ParsedStarter | null;
  resolvedPlayerId: number | null;
  resolution: ResolutionKind;
  existing: ExistingStarter;
  decision: MergeDecision;
}

interface PerGameRow {
  dbGame: DbGame;
  homeTeamAbbr: string | null;
  awayTeamAbbr: string | null;
  mlbMatched: boolean;
  bdlMatched: boolean;
  home: SideDecision;
  away: SideDecision;
}

// ─── Helpers ──────────────────────────────────────────────────────────

function fmtSide(s: SideDecision): string {
  const mlb = s.mlbCandidate
    ? `mlb=${s.mlbCandidate.externalId}`
    : "mlb=—";
  const bdl = s.bdlCandidate ? `bdl=${s.bdlCandidate.externalId}` : "bdl=—";
  const chosen =
    s.chosenCandidate !== null
      ? `chose=${s.chosenCandidate.source}/${s.chosenCandidate.externalId}`
      : "chose=—";
  const resolved =
    s.resolvedPlayerId !== null
      ? `→ pid=${s.resolvedPlayerId} (${s.resolution})`
      : `→ ${s.resolution}`;
  const action =
    s.decision.kind === "write"
      ? `WRITE/${s.decision.reason}${s.decision.scratchDetected ? " [SCRATCH]" : ""}`
      : `no_change/${s.decision.reason}`;
  const existing =
    s.existing.playerId === null
      ? "existing=null"
      : `existing=pid${s.existing.playerId}`;
  return (
    `${s.side.padEnd(4)} ${existing.padEnd(18)} ` +
    `${mlb.padEnd(13)} ${bdl.padEnd(13)} ` +
    `${chosen.padEnd(34)} ${resolved.padEnd(28)} ${action}`
  );
}

// ─── Apply gate ───────────────────────────────────────────────────────

function resolveApplyGate(argv: readonly string[]): {
  applyRequested: boolean;
  envEnabled: boolean;
  canApply: boolean;
} {
  const applyRequested = readBoolFlag(argv, "--apply");
  const envEnabled = process.env.STARTER_DB_WRITES_ENABLED === "true";
  return {
    applyRequested,
    envEnabled,
    canApply: applyRequested && envEnabled,
  };
}

function refuseApplyMisconfig(
  applyRequested: boolean,
  envEnabled: boolean
): void {
  if (!applyRequested) return;
  if (envEnabled) return;
  console.error(
    [
      "✗ --apply requires STARTER_DB_WRITES_ENABLED=true in the environment.",
      "  Two-key gate: both must be present before any games UPDATE.",
      "  To opt in for this command:",
      "",
      "    STARTER_DB_WRITES_ENABLED=true \\",
      "      npx tsx --env-file=.env.local \\",
      "      scripts/operator/refresh-starters.ts \\",
      "      --date YYYY-MM-DD --limit N --apply",
    ].join("\n")
  );
  process.exit(1);
}

interface PlannedGameWrite {
  dbGameId: number;
  externalId: number;
  homeTeamAbbr: string | null;
  awayTeamAbbr: string | null;
  home: SideDecision | null; // null when this side decided no_change
  away: SideDecision | null;
}

async function confirmApply(plans: PlannedGameWrite[]): Promise<boolean> {
  const rl = readline.createInterface({ input, output });
  try {
    const totalSides = plans.reduce(
      (n, p) => n + (p.home !== null ? 1 : 0) + (p.away !== null ? 1 : 0),
      0
    );
    console.log();
    console.log(
      `About to UPDATE ${plans.length} game(s) — ${totalSides} starter side(s) total:`
    );
    for (const p of plans) {
      const teams = `${p.awayTeamAbbr ?? "?"} @ ${p.homeTeamAbbr ?? "?"}`;
      console.log(
        `  game id=${p.dbGameId} ext=${p.externalId}  ${teams}`
      );
      const sides: Array<{ label: string; s: SideDecision }> = [];
      if (p.home !== null) sides.push({ label: "home", s: p.home });
      if (p.away !== null) sides.push({ label: "away", s: p.away });
      for (const { label, s } of sides) {
        if (s.decision.kind !== "write") continue; // safety — should never happen
        const d = s.decision;
        const prev = d.previousPlayerId === null ? "null" : String(d.previousPlayerId);
        const next = d.value.playerId;
        const src = d.value.source;
        const scratch = d.scratchDetected ? " [SCRATCH]" : "";
        console.log(
          `    ${label.padEnd(4)} current=${prev.padEnd(8)} → proposed=${String(next).padEnd(8)} ` +
            `source=${src.padEnd(28)} reason=${d.reason}${scratch}`
        );
      }
    }
    console.log();
    const ans = await rl.question(
      `Continue with ${totalSides} starter UPDATE(s) across ${plans.length} game(s)? [y/N]: `
    );
    return /^y(es)?$/i.test(ans.trim());
  } finally {
    rl.close();
  }
}

// ─── Extracted cycle helper (R-17 Step 2) ───────────────────────────
//
// `runStarterRefreshCycle` lifts the body of main() so the automation
// orchestrator can invoke it in-process. Behaviour for the CLI path is
// unchanged — main() just builds args from argv, supplies the
// interactive `confirmApply`, then calls this helper.
//
// The helper never calls process.exit; it returns a structured
// `RunStarterRefreshResult` so the orchestrator can aggregate per-step
// status. Argv validation (--write rejection, --limit-required-in-apply,
// gate misconfig) stays in main() — by the time the helper runs, the
// caller has committed to a (writeMode, limit) decision.

export type RunStarterRefreshArgs = {
  sport: Sport;
  date: string;
  writeMode: boolean;
  /**
   * Counts GAMES (each game has up to 2 sides). Required in writeMode
   * (caller enforces). For the orchestrator path, the caller passes the
   * slate size so the full slate's starters can refresh.
   */
  limit?: number;
  /**
   * Called before any UPDATE. Return false to abort writes. When omitted
   * AND writeMode=true, the helper auto-confirms — the caller is expected
   * to have already obtained operator confirmation (e.g. orchestrator's
   * top-level y/N).
   */
  confirm?: (plans: PlannedGameWrite[]) => Promise<boolean>;
  /** Logger; defaults to console.log. */
  log?: (msg: string) => void;
};

export type RunStarterRefreshStatus =
  | "dry_run"
  | "wrote"
  | "no_changes"
  | "cancelled"
  | "failed"
  | "empty_slate";

/**
 * Phase 6B.31a — per-assignment audit record. One entry per
 * planned-write side (home or away) including the source that won
 * priority and any ESPN skip reasons for operator visibility. The
 * orchestrator persists this in `step.details` JSONB so historical
 * starter provenance is queryable without a schema migration.
 */
export type StarterAssignmentRecord = {
  external_id: number;
  side: "home" | "away";
  /** What the cycle ended up doing for this side. */
  action:
    | "wrote"            // planned a write — used the source listed below
    | "no_change"        // kept existing assignment (mergeStarter no-op)
    | "preserved_existing" // existing kept because chosen candidate was unresolved
    | "no_candidate";    // no source had a probable for this side
  /** Source that won priority — null when action=no_candidate. */
  source: "mlb_stats_probable" | "bdl_games" | "espn_scoreboard" | null;
  /** Resolved players.id at decision time — null when no resolution. */
  player_id: number | null;
  /** ESPN-specific skip reason — null unless ESPN was consulted and skipped. */
  espn_skip: "ambiguous" | "not_found" | null;
};

export type RunStarterRefreshResult = {
  status: RunStarterRefreshStatus;
  games_in_slate: number;
  planned_writes: number;
  games_updated: number;
  sides_written: number;
  errors: number;
  unresolved: number;
  unmatched_mlb_games: number;
  /** Phase 6B.31a — per-side audit trail. */
  starter_assignments: StarterAssignmentRecord[];
  message?: string;
};

export async function runStarterRefreshCycle(
  args: RunStarterRefreshArgs
): Promise<RunStarterRefreshResult> {
  const { sport, date, writeMode } = args;
  const limit = args.limit;
  const log = args.log ?? ((m: string) => console.log(m));

  log(
    `[refresh-starters] mode=${writeMode ? "APPLY" : "DRY-RUN"} sport=${sport} date=${date}` +
      (limit !== undefined ? ` limit=${limit}` : "")
  );
  if (!writeMode) log(`             DRY RUN — NO DB WRITES`);
  log("");

  // 1. Load DB games for the slate
  const { data: dbGamesRaw, error: gErr } = await supabase
    .from("games")
    .select(
      "id, external_id, game_date, home_team_id, away_team_id, home_pitcher_id, away_pitcher_id"
    )
    .eq("sport", sport)
    .eq("slate_date", date)
    .order("game_date");
  if (gErr !== null) {
    return {
      status: "failed",
      games_in_slate: 0,
      planned_writes: 0,
      games_updated: 0,
      sides_written: 0,
      errors: 1,
      unresolved: 0,
      unmatched_mlb_games: 0,
      starter_assignments: [],
      message: `games load failed: ${gErr.message}`,
    };
  }
  const dbGames = (dbGamesRaw ?? []) as DbGame[];
  log(`Loaded ${dbGames.length} DB game(s) for ${date}.`);
  if (dbGames.length === 0) {
    log("Nothing to do — slate is empty.");
    return {
      status: "empty_slate",
      games_in_slate: 0,
      planned_writes: 0,
      games_updated: 0,
      sides_written: 0,
      errors: 0,
      unresolved: 0,
      unmatched_mlb_games: 0,
      starter_assignments: [],
    };
  }

  // 2. Load involved teams (for abbreviation matching)
  const teamIds = new Set<number>();
  for (const g of dbGames) {
    if (g.home_team_id !== null) teamIds.add(g.home_team_id);
    if (g.away_team_id !== null) teamIds.add(g.away_team_id);
  }
  const { data: dbTeamsRaw } = await supabase
    .from("teams")
    .select("id, abbreviation, external_id")
    .in("id", Array.from(teamIds));
  const dbTeams = (dbTeamsRaw ?? []) as DbTeam[];
  const abbrByDbId = new Map<number, string>();
  for (const t of dbTeams) abbrByDbId.set(t.id, t.abbreviation);

  // 3. MLB Stats /schedule
  log(`Fetching MLB Stats /schedule…`);
  const rawSchedule = await fetchMlbStatsScheduleRaw(date);
  if (rawSchedule === null) {
    log(
      "  WARNING: MLB Stats /schedule fetch returned null. Proceeding with BDL-only fallback."
    );
  }
  const scheduleGames = parseMlbStatsSchedule(rawSchedule);
  log(`  parsed ${scheduleGames.length} schedule game(s).`);

  // 4. BDL slate (uses existing provider — /games + /lineups fallback baked in)
  const bdlApiKey = process.env.BALLDONTLIE_API_KEY ?? "";
  let bdlSlate: BdlSlateRecord[] = [];
  if (bdlApiKey === "") {
    log("  WARNING: BALLDONTLIE_API_KEY not set — skipping BDL fallback.");
  } else {
    try {
      const provider = new BallDontLieSlateProvider(bdlApiKey);
      const raw = await provider.getGames(date, sport);
      bdlSlate = raw.map((r) => ({
        external_id: r.external_id,
        home_pitcher_external_id: r.home_pitcher_external_id,
        away_pitcher_external_id: r.away_pitcher_external_id,
      }));
      log(`  BDL slate fetched: ${bdlSlate.length} game(s).`);
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      log(`  WARNING: BDL slate fetch failed: ${msg}`);
    }
  }
  const bdlByExternalId = new Map<number, BdlSlateRecord>();
  for (const b of bdlSlate) bdlByExternalId.set(b.external_id, b);

  // 4.5. Phase 6B.31a — ESPN scoreboard as TERTIARY probable-pitcher
  // source. Only consulted later (in step 10) when both MLB Stats AND
  // BDL returned null for a side. ESPN never overwrites higher-priority
  // sources. Fetch failure (network, malformed JSON) yields an empty
  // map per the espn service contract.
  const espnEnabled = isEspnSecondarySourceEnabled();
  let espnByGameKey: Map<string, EspnProbablesForGame> = new Map();
  if (espnEnabled) {
    log(`Fetching ESPN scoreboard (Phase 6B.31a secondary source)…`);
    espnByGameKey = await fetchEspnProbablePitchers(date, { log });
  } else {
    log("  ESPN secondary source disabled via ESPN_SECONDARY_PROBABLE_PITCHER=false; skipping fetch.");
  }

  // 5. Build CandidateDbGame list for matchScheduleGameToDbGame
  const candidates: CandidateDbGame[] = dbGames.map((g) => ({
    id: g.id,
    externalId: g.external_id,
    homeAbbr: g.home_team_id !== null ? abbrByDbId.get(g.home_team_id) ?? null : null,
    awayAbbr: g.away_team_id !== null ? abbrByDbId.get(g.away_team_id) ?? null : null,
  }));

  // 6. Match each MLB Stats schedule game to a DB game
  type MlbMatch = {
    dbGameId: number;
    homeProbable: ParsedStarter | null;
    awayProbable: ParsedStarter | null;
    schedStatus: string;
  };
  const mlbMatches: MlbMatch[] = [];
  const mlbUnmatched: Array<{ gamePk: number; home: string | null; away: string | null; status: string }> = [];
  const claimedDbGameIds = new Set<number>();
  for (const sg of scheduleGames) {
    const homeAbbr = mlbStatsTeamIdToAbbr(sg.homeTeamId);
    const awayAbbr = mlbStatsTeamIdToAbbr(sg.awayTeamId);
    // Doubleheader handling: skip already-claimed DB games so the 2nd
    // schedule entry can match a different candidate. Today's slate has
    // none, but defensive.
    const remaining = candidates.filter((c) => !claimedDbGameIds.has(c.id));
    const match = matchScheduleGameToDbGame(homeAbbr, awayAbbr, remaining);
    if (match === null) {
      mlbUnmatched.push({ gamePk: sg.gamePk, home: homeAbbr, away: awayAbbr, status: sg.status });
      continue;
    }
    claimedDbGameIds.add(match.id);
    mlbMatches.push({
      dbGameId: match.id,
      homeProbable: sg.homeProbable,
      awayProbable: sg.awayProbable,
      schedStatus: sg.status,
    });
  }

  // 7. Collect external IDs that need resolution to players.id
  const mlbPersonIds = new Set<number>();
  const bdlPlayerIds = new Set<number>();
  for (const m of mlbMatches) {
    if (m.homeProbable?.externalIdKind === "mlb_person_id") mlbPersonIds.add(m.homeProbable.externalId);
    if (m.awayProbable?.externalIdKind === "mlb_person_id") mlbPersonIds.add(m.awayProbable.externalId);
  }
  for (const b of bdlSlate) {
    if (b.home_pitcher_external_id !== null && b.home_pitcher_external_id > 0)
      bdlPlayerIds.add(b.home_pitcher_external_id);
    if (b.away_pitcher_external_id !== null && b.away_pitcher_external_id > 0)
      bdlPlayerIds.add(b.away_pitcher_external_id);
  }

  // 8. Resolve mlb_person_id → players.id (primary lookup on top-level column)
  const playerByMlbId = new Map<number, number>();
  const playerMlbResolution = new Map<number, ResolutionKind>();
  if (mlbPersonIds.size > 0) {
    const { data } = await supabase
      .from("players")
      .select("id, mlb_person_id")
      .in("mlb_person_id", Array.from(mlbPersonIds));
    for (const r of (data ?? []) as Array<{ id: number; mlb_person_id: number }>) {
      playerByMlbId.set(r.mlb_person_id, r.id);
      playerMlbResolution.set(r.mlb_person_id, "mlb_person_id");
    }
    // Fallback: provider_ids.mlb_stats.id JSONB path — for players that
    // were mapped in Phase 4.2.C.1.M but haven't been mlb_person_id-synced
    // yet by Phase 4.2.C.1.F. Per-id .eq() because Supabase JSONB-path
    // .in() filters can be unreliable; N is small (≤30) in practice.
    const unresolved = Array.from(mlbPersonIds).filter((id) => !playerByMlbId.has(id));
    for (const id of unresolved) {
      const { data: pData } = await supabase
        .from("players")
        .select("id, provider_ids")
        .eq("provider_ids->mlb_stats->>id", String(id))
        .limit(1);
      const row = (pData ?? [])[0] as { id: number } | undefined;
      if (row !== undefined) {
        playerByMlbId.set(id, row.id);
        playerMlbResolution.set(id, "provider_ids_mlb_stats");
      }
    }
  }

  // 9. Resolve bdl_player_id → players.id (single batched lookup on external_id)
  const playerByBdlId = new Map<number, number>();
  if (bdlPlayerIds.size > 0) {
    const { data } = await supabase
      .from("players")
      .select("id, external_id")
      .in("external_id", Array.from(bdlPlayerIds));
    for (const r of (data ?? []) as Array<{ id: number; external_id: number }>) {
      playerByBdlId.set(r.external_id, r.id);
    }
  }

  // 9.5. Phase 6B.31a — Resolve ESPN candidates to players.id via
  // strict name + team + active + is_pitcher mapping. ESPN's athlete id
  // is NOT in our players table, so resolution goes through name match
  // scoped to the team. Only consulted for game sides where MLB Stats
  // AND BDL would both be null (we determine that in step 10 inside
  // processSide). Pre-resolving here keeps the per-side decision pure.
  type EspnSideCandidate = {
    candidate: ParsedStarter | null;
    skipReason: { name: string; teamId: number | null; status: Exclude<EspnMappingStatus, "matched"> } | null;
  };
  const espnByDbGameSide = new Map<string, { home: EspnSideCandidate; away: EspnSideCandidate }>();
  if (espnEnabled && espnByGameKey.size > 0) {
    for (const c of candidates) {
      const key = c.homeAbbr !== null && c.awayAbbr !== null
        ? buildGameKey(c.awayAbbr, c.homeAbbr)
        : null;
      const espnEntry = key !== null ? espnByGameKey.get(key) ?? null : null;
      const dbGame = dbGames.find((g) => g.id === c.id)!;
      const homeTeamId = dbGame.home_team_id;
      const awayTeamId = dbGame.away_team_id;

      async function resolveSide(
        espnProbable: { fullName: string; espnAthleteId: number } | null,
        teamId: number | null,
      ): Promise<EspnSideCandidate> {
        if (espnProbable === null || teamId === null) {
          return { candidate: null, skipReason: null };
        }
        const result = await mapEspnPitcherToPlayer(supabase, espnProbable.fullName, teamId);
        if (result.status !== "matched" || result.playerId === null) {
          // result.status is "ambiguous" or "not_found" here; the wider
          // `result.playerId === null` branch can also fire spuriously if
          // status is "matched" with null playerId (impossible per the
          // service contract, but TS doesn't see that). Default to
          // "not_found" in that defensive case.
          const skipStatus: Exclude<EspnMappingStatus, "matched"> =
            result.status === "matched" ? "not_found" : result.status;
          return {
            candidate: null,
            skipReason: { name: espnProbable.fullName, teamId, status: skipStatus },
          };
        }
        return {
          candidate: {
            source: "espn_scoreboard",
            confidence: "probable",
            externalId: result.playerId,
            externalIdKind: "espn_resolved",
            fullName: espnProbable.fullName,
          },
          skipReason: null,
        };
      }

      const home = await resolveSide(espnEntry?.home ?? null, homeTeamId);
      const away = await resolveSide(espnEntry?.away ?? null, awayTeamId);
      espnByDbGameSide.set(String(c.id), { home, away });
    }
  }

  // 10. Build per-game decisions
  const rows: PerGameRow[] = [];
  for (const c of candidates) {
    const dbGame = dbGames.find((g) => g.id === c.id)!;
    const mlbMatch = mlbMatches.find((m) => m.dbGameId === c.id);
    const bdlMatch = bdlByExternalId.get(c.externalId) ?? null;

    const mlbHome = mlbMatch?.homeProbable ?? null;
    const mlbAway = mlbMatch?.awayProbable ?? null;

    const bdlHome: ParsedStarter | null =
      bdlMatch !== null &&
      bdlMatch.home_pitcher_external_id !== null &&
      bdlMatch.home_pitcher_external_id > 0
        ? {
            source: "bdl_games",
            confidence: "probable",
            externalId: bdlMatch.home_pitcher_external_id,
            externalIdKind: "bdl_player_id",
            fullName: null,
          }
        : null;
    const bdlAway: ParsedStarter | null =
      bdlMatch !== null &&
      bdlMatch.away_pitcher_external_id !== null &&
      bdlMatch.away_pitcher_external_id > 0
        ? {
            source: "bdl_games",
            confidence: "probable",
            externalId: bdlMatch.away_pitcher_external_id,
            externalIdKind: "bdl_player_id",
            fullName: null,
          }
        : null;

    function processSide(
      side: "home" | "away",
      existingPid: number | null,
      mlbCand: ParsedStarter | null,
      bdlCand: ParsedStarter | null,
      espnSide: EspnSideCandidate
    ): SideDecision {
      // Phase 6B.31a — pickPrimaryCandidate is variadic and picks the
      // first non-null in order. MLB Stats > BDL > ESPN. ESPN is only
      // selected when both MLB Stats and BDL produced null candidates.
      const chosen = pickPrimaryCandidate(mlbCand, bdlCand, espnSide.candidate);
      const existing: ExistingStarter = {
        playerId: existingPid,
        source: null,
        confidence: null,
      };
      if (chosen === null) {
        return {
          side,
          mlbCandidate: mlbCand,
          bdlCandidate: bdlCand,
          espnCandidate: null,
          espnSkipReason: espnSide.skipReason,
          chosenCandidate: null,
          resolvedPlayerId: null,
          resolution: espnSide.skipReason !== null
            ? (espnSide.skipReason.status === "ambiguous" ? "espn_ambiguous" : "espn_not_found")
            : "no_candidate",
          existing,
          decision: mergeStarter(existing, null),
        };
      }
      // Resolve to internal id
      let resolvedPid: number | null = null;
      let resolution: ResolutionKind = "unresolved";
      if (chosen.externalIdKind === "mlb_person_id") {
        const pid = playerByMlbId.get(chosen.externalId);
        if (pid !== undefined) {
          resolvedPid = pid;
          resolution = playerMlbResolution.get(chosen.externalId) ?? "mlb_person_id";
        }
      } else if (chosen.externalIdKind === "bdl_player_id") {
        const pid = playerByBdlId.get(chosen.externalId);
        if (pid !== undefined) {
          resolvedPid = pid;
          resolution = "bdl_external_id";
        }
      } else if (chosen.externalIdKind === "espn_resolved") {
        // ESPN candidates are pre-resolved by espnProbablePitcherService —
        // the externalId IS the players.id (strict name + team + active +
        // pitcher match returned exactly 1 row upstream).
        resolvedPid = chosen.externalId;
        resolution = "espn_resolved";
      }
      if (resolvedPid === null) {
        // Cannot merge without an internal id — record as unresolved.
        // mergeStarter is called with null so the planned action is
        // "preserve existing" (we never null-overwrite); the dry-run
        // printout surfaces the unresolved status to the operator.
        return {
          side,
          mlbCandidate: mlbCand,
          bdlCandidate: bdlCand,
          espnCandidate: espnSide.candidate,
          espnSkipReason: espnSide.skipReason,
          chosenCandidate: chosen,
          resolvedPlayerId: null,
          resolution,
          existing,
          decision: mergeStarter(existing, null),
        };
      }
      const candidate: NormalizedStarterCandidate = {
        playerId: resolvedPid,
        source: chosen.source,
        confidence: chosen.confidence,
      };
      return {
        side,
        mlbCandidate: mlbCand,
        bdlCandidate: bdlCand,
        espnCandidate: espnSide.candidate,
        espnSkipReason: espnSide.skipReason,
        chosenCandidate: chosen,
        resolvedPlayerId: resolvedPid,
        resolution,
        existing,
        decision: mergeStarter(existing, candidate),
      };
    }

    const espnForGame = espnByDbGameSide.get(String(c.id))
      ?? { home: { candidate: null, skipReason: null }, away: { candidate: null, skipReason: null } };
    rows.push({
      dbGame,
      homeTeamAbbr: c.homeAbbr,
      awayTeamAbbr: c.awayAbbr,
      mlbMatched: mlbMatch !== undefined,
      bdlMatched: bdlMatch !== null,
      home: processSide("home", dbGame.home_pitcher_id, mlbHome, bdlHome, espnForGame.home),
      away: processSide("away", dbGame.away_pitcher_id, mlbAway, bdlAway, espnForGame.away),
    });
  }

  // 11. Per-game plan output
  log("");
  log("━━━ Per-game plan ━━━");
  for (const r of rows) {
    const teams = `${r.awayTeamAbbr ?? "?"} @ ${r.homeTeamAbbr ?? "?"}`;
    log(
      `game id=${r.dbGame.id} ext=${r.dbGame.external_id}  ${teams.padEnd(15)}  ` +
        `match: mlb=${r.mlbMatched ? "Y" : "N"} bdl=${r.bdlMatched ? "Y" : "N"}`
    );
    log(`  ${fmtSide(r.home)}`);
    log(`  ${fmtSide(r.away)}`);
  }

  // 12. Summary
  let bothBefore = 0;
  let bothAfter = 0;
  let proposedHome = 0;
  let proposedAway = 0;
  let unresolved = 0;
  let scratches = 0;
  const sourceBreakdown: Record<string, number> = {};
  for (const r of rows) {
    const homeBefore = r.dbGame.home_pitcher_id !== null;
    const awayBefore = r.dbGame.away_pitcher_id !== null;
    if (homeBefore && awayBefore) bothBefore++;
    const homeAfter = r.home.decision.kind === "write" ? true : homeBefore;
    const awayAfter = r.away.decision.kind === "write" ? true : awayBefore;
    if (homeAfter && awayAfter) bothAfter++;
    if (r.home.decision.kind === "write") {
      proposedHome++;
      if (r.home.decision.scratchDetected) scratches++;
      const src = r.home.chosenCandidate?.source ?? "?";
      sourceBreakdown[src] = (sourceBreakdown[src] ?? 0) + 1;
    }
    if (r.away.decision.kind === "write") {
      proposedAway++;
      if (r.away.decision.scratchDetected) scratches++;
      const src = r.away.chosenCandidate?.source ?? "?";
      sourceBreakdown[src] = (sourceBreakdown[src] ?? 0) + 1;
    }
    if (r.home.resolution === "unresolved") unresolved++;
    if (r.away.resolution === "unresolved") unresolved++;
  }

  log("");
  log("━━━ Summary ━━━");
  log(`  Total games:                                ${rows.length}`);
  log(`  Games with BOTH starters set BEFORE:        ${bothBefore}`);
  log(`  Games with BOTH starters set AFTER (plan):  ${bothAfter}`);
  log(`  Proposed home writes:                       ${proposedHome}`);
  log(`  Proposed away writes:                       ${proposedAway}`);
  log(`  Unresolved candidates:                      ${unresolved}`);
  log(`  Scratch detections:                         ${scratches}`);
  log("");
  log("  Source breakdown (proposed writes):");
  const entries = Object.entries(sourceBreakdown).sort((a, b) => b[1] - a[1]);
  if (entries.length === 0) {
    log("    (no writes proposed)");
  } else {
    for (const [src, n] of entries) {
      log(`    ${src.padEnd(30)} ${n}`);
    }
  }
  if (mlbUnmatched.length > 0) {
    log("");
    log(`  MLB Stats games not matched to a DB game: ${mlbUnmatched.length}`);
    for (const u of mlbUnmatched) {
      log(
        `    gamePk=${u.gamePk}  ${u.away ?? "?"} @ ${u.home ?? "?"}  status=${u.status}`
      );
    }
  }

  // Phase 6B.31a — log ESPN skip reasons (operator visibility for the
  // secondary-source coverage gap class).
  const espnSkips: Array<{ ext: number; side: "home" | "away"; name: string; status: string }> = [];
  for (const r of rows) {
    if (r.home.espnSkipReason !== null) espnSkips.push({ ext: r.dbGame.external_id, side: "home", name: r.home.espnSkipReason.name, status: r.home.espnSkipReason.status });
    if (r.away.espnSkipReason !== null) espnSkips.push({ ext: r.dbGame.external_id, side: "away", name: r.away.espnSkipReason.name, status: r.away.espnSkipReason.status });
  }
  if (espnSkips.length > 0) {
    log("");
    log(`  ESPN secondary-source skips (mapping failed): ${espnSkips.length}`);
    for (const s of espnSkips) {
      log(`    ext=${s.ext} side=${s.side} espn_name="${s.name}" status=${s.status}`);
    }
  }
  log("");

  // 12.5. Phase 6B.31a — Build the structured starter_assignments[]
  // audit trail. One entry per side, per game. Includes the source that
  // won priority (or null for no_candidate) and any ESPN skip reasons.
  // The orchestrator persists this in step.details JSONB.
  function buildAssignment(
    side: "home" | "away",
    dec: SideDecision,
    extId: number,
  ): StarterAssignmentRecord {
    let action: StarterAssignmentRecord["action"];
    if (dec.decision.kind === "write") action = "wrote";
    else if (dec.decision.kind === "no_change") action = "no_change";
    else if (dec.chosenCandidate !== null && dec.resolvedPlayerId === null) action = "preserved_existing";
    else action = "no_candidate";
    let source: StarterAssignmentRecord["source"] = null;
    if (dec.chosenCandidate !== null) {
      const s = dec.chosenCandidate.source;
      source = s === "mlb_stats_probable" || s === "bdl_games" || s === "espn_scoreboard" ? s : null;
    }
    const espnSkip: StarterAssignmentRecord["espn_skip"] =
      dec.espnSkipReason !== null ? dec.espnSkipReason.status : null;
    return {
      external_id: extId,
      side,
      action,
      source,
      player_id:
        dec.decision.kind === "write"
          ? dec.decision.value.playerId
          : dec.resolvedPlayerId,
      espn_skip: espnSkip,
    };
  }
  const starterAssignments: StarterAssignmentRecord[] = rows.flatMap((r) => [
    buildAssignment("home", r.home, r.dbGame.external_id),
    buildAssignment("away", r.away, r.dbGame.external_id),
  ]);

  // 13. Build planned-game-writes list. A game appears here when at least
  // one side decided to write. Sides whose decision is no_change are
  // captured as `null` on the PlannedGameWrite (won't be UPDATEd).
  const allPlannedGames: PlannedGameWrite[] = rows
    .filter((r) => r.home.decision.kind === "write" || r.away.decision.kind === "write")
    .map((r) => ({
      dbGameId: r.dbGame.id,
      externalId: r.dbGame.external_id,
      homeTeamAbbr: r.homeTeamAbbr,
      awayTeamAbbr: r.awayTeamAbbr,
      home: r.home.decision.kind === "write" ? r.home : null,
      away: r.away.decision.kind === "write" ? r.away : null,
    }))
    .sort((a, b) => a.dbGameId - b.dbGameId);
  const plannedGames =
    limit === undefined
      ? allPlannedGames
      : allPlannedGames.slice(0, Math.max(0, limit));
  const heldByLimit = allPlannedGames.length - plannedGames.length;
  if (heldByLimit > 0) {
    log(
      `  Games held by --limit ${limit}: ${heldByLimit} of ${allPlannedGames.length}`
    );
    log("");
  }

  // 14. Dry-run exit OR apply path.
  if (!writeMode) {
    log("  DRY RUN — NO DB WRITES PERFORMED.");
    return {
      status: "dry_run",
      games_in_slate: rows.length,
      planned_writes: allPlannedGames.length,
      games_updated: 0,
      sides_written: 0,
      errors: 0,
      unresolved,
      unmatched_mlb_games: mlbUnmatched.length,
      starter_assignments: starterAssignments,
    };
  }

  if (plannedGames.length === 0) {
    log("  Nothing to write (post-limit). Exiting without changes.");
    return {
      status: "no_changes",
      games_in_slate: rows.length,
      planned_writes: 0,
      games_updated: 0,
      sides_written: 0,
      errors: 0,
      unresolved,
      unmatched_mlb_games: mlbUnmatched.length,
      starter_assignments: starterAssignments,
    };
  }

  const confirmed = args.confirm
    ? await args.confirm(plannedGames)
    : true;
  if (!confirmed) {
    log("Cancelled by operator. No writes performed.");
    return {
      status: "cancelled",
      games_in_slate: rows.length,
      planned_writes: plannedGames.length,
      games_updated: 0,
      sides_written: 0,
      errors: 0,
      unresolved,
      unmatched_mlb_games: mlbUnmatched.length,
      starter_assignments: starterAssignments,
    };
  }

  log("");
  log("Writing UPDATE(s)…");
  let gamesWrote = 0;
  let gamesErrored = 0;
  let sidesWrote = 0;
  for (const p of plannedGames) {
    // Build payload covering only the sides that decided to write.
    const payload: Record<string, number | string> = {
      updated_at: new Date().toISOString(),
    };
    if (p.home !== null && p.home.decision.kind === "write") {
      payload.home_pitcher_id = p.home.decision.value.playerId;
    }
    if (p.away !== null && p.away.decision.kind === "write") {
      payload.away_pitcher_id = p.away.decision.value.playerId;
    }
    const { error } = await supabase
      .from("games")
      .update(payload)
      .eq("id", p.dbGameId);
    const sideCount =
      (p.home !== null ? 1 : 0) + (p.away !== null ? 1 : 0);
    if (error !== null) {
      gamesErrored++;
      log(
        `  ✗ UPDATE failed for game id=${p.dbGameId} ext=${p.externalId}: ${error.message}`
      );
      continue;
    }
    gamesWrote++;
    sidesWrote += sideCount;
    const homePart =
      p.home !== null && p.home.decision.kind === "write"
        ? ` home→pid${p.home.decision.value.playerId}`
        : "";
    const awayPart =
      p.away !== null && p.away.decision.kind === "write"
        ? ` away→pid${p.away.decision.value.playerId}`
        : "";
    log(
      `  ✓ UPDATEd game id=${p.dbGameId} ext=${p.externalId}${homePart}${awayPart}`
    );
  }

  log("");
  log("━━━ Apply complete ━━━");
  log(`  Games updated:  ${gamesWrote}`);
  log(`  Sides written:  ${sidesWrote}`);
  log(`  Games errored:  ${gamesErrored}`);

  return {
    status: gamesErrored > 0 && gamesWrote === 0 ? "failed" : "wrote",
    games_in_slate: rows.length,
    planned_writes: plannedGames.length,
    games_updated: gamesWrote,
    sides_written: sidesWrote,
    errors: gamesErrored,
    unresolved,
    unmatched_mlb_games: mlbUnmatched.length,
    starter_assignments: starterAssignments,
  };
}

// ─── Main (CLI shim) ─────────────────────────────────────────────────

async function main() {
  // --write is the wrong flag for this operator; clear error rather than
  // silently dry-running.
  if (process.argv.includes("--write")) {
    console.error(
      "✗ --write is not supported by this script. Use --apply (with STARTER_DB_WRITES_ENABLED=true)."
    );
    process.exit(1);
  }

  const gate = resolveApplyGate(process.argv);
  refuseApplyMisconfig(gate.applyRequested, gate.envEnabled);
  const writeMode = gate.canApply;

  const date = readStringFlag(process.argv, "--date") ?? todayUTC();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
    console.error(`✗ invalid --date "${date}". Expected YYYY-MM-DD.`);
    process.exit(1);
  }

  // --limit is REQUIRED in apply mode to bound blast radius. Limit counts
  // GAMES (each game has up to 2 sides to write). Dry-run accepts an
  // optional --limit for parity / preview.
  const limit = readNumberFlag(process.argv, "--limit");
  if (writeMode) {
    if (limit === undefined) {
      console.error(
        "✗ --limit is required when --apply is set. Pass --limit 1 for a single-game smoke."
      );
      process.exit(1);
    }
    if (limit <= 0) {
      console.error(`✗ --limit must be >= 1 in apply mode (got ${limit}).`);
      process.exit(1);
    }
  }

  const result = await runStarterRefreshCycle({
    sport: "mlb",
    date,
    writeMode,
    limit,
    confirm: confirmApply,
  });

  if (result.status === "failed") {
    if (result.message) console.error(`✗ ${result.message}`);
    process.exit(1);
  }
}

// Only invoke main() when this file is run directly (not when the
// orchestrator imports `runStarterRefreshCycle`). tsx + the project's
// CJS compile mode lets us use `require.main === module` here even
// though the source uses ESM `import` syntax.
if (require.main === module) {
  main().catch((err) => {
    console.error("Fatal:", err);
    process.exit(1);
  });
}
