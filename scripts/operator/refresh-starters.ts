/**
 * Phase 4.2.C.1.G-2 — DRY-RUN starter refresh operator.
 *
 * USAGE:
 *   npx tsx --env-file=.env.local \
 *     scripts/operator/refresh-starters.ts --date 2026-06-03
 *
 * READ-ONLY by design. Phase G-3 will add the two-key `--apply` /
 * `STARTER_DB_WRITES_ENABLED=true` write path; until then, `--write` is
 * rejected at the CLI surface.
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

import { supabase } from "../../lib/db/supabase";
import { BallDontLieSlateProvider } from "../../lib/providers/real_api/BallDontLieSlateProvider";
import { fetchMlbStatsScheduleRaw } from "../../lib/providers/real_api/_mlbStatsApiClient";
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
import { readStringFlag, rejectWriteFlag, todayUTC } from "./_cliCommon";

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
  | "unresolved"
  | "no_candidate";

interface SideDecision {
  side: "home" | "away";
  mlbCandidate: ParsedStarter | null;
  bdlCandidate: ParsedStarter | null;
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

// ─── Main ─────────────────────────────────────────────────────────────

async function main() {
  rejectWriteFlag(process.argv);

  const date = readStringFlag(process.argv, "--date") ?? todayUTC();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
    console.error(`✗ invalid --date "${date}". Expected YYYY-MM-DD.`);
    process.exit(1);
  }

  console.log(
    `[refresh-starters] mode=DRY-RUN sport=mlb date=${date}`
  );
  console.log(`             DRY RUN — NO DB WRITES`);
  console.log();

  // 1. Load DB games for the slate
  const { data: dbGamesRaw, error: gErr } = await supabase
    .from("games")
    .select(
      "id, external_id, game_date, home_team_id, away_team_id, home_pitcher_id, away_pitcher_id"
    )
    .eq("sport", "mlb")
    .eq("slate_date", date)
    .order("game_date");
  if (gErr !== null) {
    console.error(`✗ games load failed: ${gErr.message}`);
    process.exit(1);
  }
  const dbGames = (dbGamesRaw ?? []) as DbGame[];
  console.log(`Loaded ${dbGames.length} DB game(s) for ${date}.`);
  if (dbGames.length === 0) {
    console.log("Nothing to do — slate is empty. Exiting.");
    return;
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
  console.log(`Fetching MLB Stats /schedule…`);
  const rawSchedule = await fetchMlbStatsScheduleRaw(date);
  if (rawSchedule === null) {
    console.log(
      "  WARNING: MLB Stats /schedule fetch returned null. Proceeding with BDL-only fallback."
    );
  }
  const scheduleGames = parseMlbStatsSchedule(rawSchedule);
  console.log(`  parsed ${scheduleGames.length} schedule game(s).`);

  // 4. BDL slate (uses existing provider — /games + /lineups fallback baked in)
  const bdlApiKey = process.env.BALLDONTLIE_API_KEY ?? "";
  let bdlSlate: BdlSlateRecord[] = [];
  if (bdlApiKey === "") {
    console.log(
      "  WARNING: BALLDONTLIE_API_KEY not set — skipping BDL fallback."
    );
  } else {
    try {
      const provider = new BallDontLieSlateProvider(bdlApiKey);
      const raw = await provider.getGames(date, "mlb");
      bdlSlate = raw.map((r) => ({
        external_id: r.external_id,
        home_pitcher_external_id: r.home_pitcher_external_id,
        away_pitcher_external_id: r.away_pitcher_external_id,
      }));
      console.log(`  BDL slate fetched: ${bdlSlate.length} game(s).`);
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      console.log(`  WARNING: BDL slate fetch failed: ${msg}`);
    }
  }
  const bdlByExternalId = new Map<number, BdlSlateRecord>();
  for (const b of bdlSlate) bdlByExternalId.set(b.external_id, b);

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
      bdlCand: ParsedStarter | null
    ): SideDecision {
      const chosen = pickPrimaryCandidate(mlbCand, bdlCand);
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
          chosenCandidate: null,
          resolvedPlayerId: null,
          resolution: "no_candidate",
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
      } else {
        const pid = playerByBdlId.get(chosen.externalId);
        if (pid !== undefined) {
          resolvedPid = pid;
          resolution = "bdl_external_id";
        }
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
        chosenCandidate: chosen,
        resolvedPlayerId: resolvedPid,
        resolution,
        existing,
        decision: mergeStarter(existing, candidate),
      };
    }

    rows.push({
      dbGame,
      homeTeamAbbr: c.homeAbbr,
      awayTeamAbbr: c.awayAbbr,
      mlbMatched: mlbMatch !== undefined,
      bdlMatched: bdlMatch !== null,
      home: processSide("home", dbGame.home_pitcher_id, mlbHome, bdlHome),
      away: processSide("away", dbGame.away_pitcher_id, mlbAway, bdlAway),
    });
  }

  // 11. Per-game plan output
  console.log();
  console.log("━━━ Per-game plan ━━━");
  for (const r of rows) {
    const teams = `${r.awayTeamAbbr ?? "?"} @ ${r.homeTeamAbbr ?? "?"}`;
    console.log(
      `game id=${r.dbGame.id} ext=${r.dbGame.external_id}  ${teams.padEnd(15)}  ` +
        `match: mlb=${r.mlbMatched ? "Y" : "N"} bdl=${r.bdlMatched ? "Y" : "N"}`
    );
    console.log(`  ${fmtSide(r.home)}`);
    console.log(`  ${fmtSide(r.away)}`);
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

  console.log();
  console.log("━━━ Summary ━━━");
  console.log(`  Total games:                                ${rows.length}`);
  console.log(`  Games with BOTH starters set BEFORE:        ${bothBefore}`);
  console.log(`  Games with BOTH starters set AFTER (plan):  ${bothAfter}`);
  console.log(`  Proposed home writes:                       ${proposedHome}`);
  console.log(`  Proposed away writes:                       ${proposedAway}`);
  console.log(`  Unresolved candidates:                      ${unresolved}`);
  console.log(`  Scratch detections:                         ${scratches}`);
  console.log();
  console.log("  Source breakdown (proposed writes):");
  const entries = Object.entries(sourceBreakdown).sort((a, b) => b[1] - a[1]);
  if (entries.length === 0) {
    console.log("    (no writes proposed)");
  } else {
    for (const [src, n] of entries) {
      console.log(`    ${src.padEnd(30)} ${n}`);
    }
  }
  if (mlbUnmatched.length > 0) {
    console.log();
    console.log(`  MLB Stats games not matched to a DB game: ${mlbUnmatched.length}`);
    for (const u of mlbUnmatched) {
      console.log(
        `    gamePk=${u.gamePk}  ${u.away ?? "?"} @ ${u.home ?? "?"}  status=${u.status}`
      );
    }
  }
  console.log();
  console.log("  DRY RUN — NO DB WRITES PERFORMED.");
}

main().catch((err) => {
  console.error("Fatal:", err);
  process.exit(1);
});
