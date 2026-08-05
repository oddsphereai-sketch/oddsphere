/**
 * Operator audit · verify-grading-correctness
 *
 * Deep grading-correctness verification. READ-ONLY.
 *
 * For every settled prediction_grade on the target slate:
 *   1. Re-fetch MLB Stats for the game (independent source of truth).
 *   2. Reconcile game identity:
 *        - DB home_team_id / away_team_id → abbreviation
 *        - MLB Stats teams.home.team.name → abbrev (via normalizer)
 *        - Both must match.
 *   3. Reconcile scores:
 *        - DB.home_score === MLB Stats teams.home.score
 *        - DB.away_score === MLB Stats teams.away.score
 *        - DB.first_inning_runs === sum of MLB Stats linescore.innings[0]
 *   4. Re-compute every grade from scratch using gradePrediction with
 *      the snapshotted pick + line + the LIVE-reconciled scores.
 *   5. Compare the freshly-computed grade to the stored grade row.
 *   6. Apply hand-derived sanity checks per market.
 *   7. Flag every discrepancy.
 *
 * STRICT CONTRACT:
 *   • Never writes to the DB (refuses --apply).
 *   • Never modifies prediction_records, prediction_grades, games, or any
 *     other table.
 *   • Never infers scores from any source other than MLB Stats API.
 *   • Output is purely diagnostic.
 *
 * USAGE:
 *   npx tsx --env-file=.env.local scripts/operator/verify-grading-correctness.ts
 *   npx tsx --env-file=.env.local scripts/operator/verify-grading-correctness.ts 2026-06-07
 *
 * EXIT CODE:
 *   0 — verification passed (zero FAIL problems; WARN allowed)
 *   1 — one or more FAIL problems detected
 *
 * SUMMARY LINE:
 *   The final line of output is machine-grep-friendly:
 *     "SUMMARY date=<date> records=N settled=N matched=N scores_ok=N grades_ok=N fail=N warn=N"
 */

import { createClient } from "@supabase/supabase-js";
import {
  fetchMlbStatsSchedule,
  extractGamesFromSchedule,
  normalizeMlbStatsStatus,
  extractFirstInningTotal,
  type MlbStatsRawGame,
} from "../../lib/services/mlbLinescoreIngestService";
import { normalizeMlbTeamName } from "../../lib/providers/real_api/_teamNameNormalizer";
import { gradePrediction } from "../../lib/services/predictionGrader";

const APPLY_REQUESTED = process.argv.includes("--apply");
const DATE_ARG = process.argv.find((a) => /^\d{4}-\d{2}-\d{2}$/.test(a));
const ET_TODAY = new Date().toLocaleDateString("en-CA", { timeZone: "America/New_York" });
const TARGET_DATE = DATE_ARG ?? ET_TODAY;

type ProblemSeverity = "INFO" | "WARN" | "FAIL";
type Problem = { severity: ProblemSeverity; matchup: string; rec_id?: number; market?: string; detail: string };

function selectMlbStatsGame(
  candidates: MlbStatsRawGame[],
  dbGameDate: string | null,
): MlbStatsRawGame | null {
  if (candidates.length === 0) return null;
  if (candidates.length === 1) return candidates[0]!;

  const dbTime = dbGameDate === null ? Number.NaN : Date.parse(dbGameDate);
  if (!Number.isFinite(dbTime)) return null;

  const ranked = candidates
    .map((game) => ({ game, distance: Math.abs(Date.parse(game.gameDate ?? "") - dbTime) }))
    .filter((entry) => Number.isFinite(entry.distance))
    .sort((a, b) => a.distance - b.distance);
  if (ranked.length === 0) return null;
  if (ranked.length > 1 && ranked[0]!.distance === ranked[1]!.distance) return null;
  return ranked[0]!.game;
}

async function main(): Promise<void> {
  if (APPLY_REQUESTED) {
    console.error("ERROR: --apply not supported. This operator is read-only.");
    process.exit(1);
  }

  const sb = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { persistSession: false } },
  );

  console.log(`\n═════════ Deep Grading Correctness Verification · ${TARGET_DATE} ═════════\n`);

  // ── 1. Fetch authoritative source ────────────────────────────────
  console.log("── Fetching MLB Stats schedule ──");
  const schedule = await fetchMlbStatsSchedule(TARGET_DATE);
  const mlbGames = extractGamesFromSchedule(schedule);
  console.log(`MLB Stats returned ${mlbGames.length} games for ${TARGET_DATE}.\n`);

  // ── 2. Load DB state ─────────────────────────────────────────────
  const { data: prRows } = await sb
    .from("prediction_records")
    .select("*")
    .eq("sport", "mlb")
    .eq("slate_date", TARGET_DATE)
    .not("locked_at", "is", null);
  const recs = (prRows ?? []) as Array<{
    id: number;
    game_id: number;
    matchup: string;
    market: string;
    pick: string | null;
    side: string | null;
    line_value: number | null;
    no_bet: boolean;
    [k: string]: unknown;
  }>;
  const recIds = recs.map((r) => r.id);

  const { data: gradeRows } = await sb
    .from("prediction_grades")
    .select("*")
    .in("prediction_record_id", recIds);
  const gradesByRec = new Map<number, any>(
    (gradeRows ?? []).map((g: any) => [g.prediction_record_id, g]),
  );

  const gameIds = Array.from(new Set(recs.map((r) => r.game_id)));
  const { data: gameRows } = await sb
    .from("games")
    .select("id, external_id, game_date, status, home_team_id, away_team_id, home_score, away_score, first_inning_runs, inning_scores")
    .in("id", gameIds);
  const dbGameById = new Map<number, any>((gameRows ?? []).map((g: any) => [g.id, g]));

  const { data: teamRows } = await sb
    .from("teams")
    .select("id, abbreviation")
    .in("id", Array.from(new Set([
      ...(gameRows ?? []).map((g: any) => g.home_team_id),
      ...(gameRows ?? []).map((g: any) => g.away_team_id),
    ])));
  const abbrevByTeamId = new Map<number, string>(
    (teamRows ?? []).map((t: any) => [t.id, t.abbreviation]),
  );

  // ── 3. Build MLB Stats lookup keyed by (homeAbbrev, awayAbbrev) ──
  // Keep every game for a pair: doubleheaders and postponed makeups can put
  // the same clubs on the same schedule date. Match the DB game by start time.
  const mlbByPair = new Map<string, MlbStatsRawGame[]>();
  for (const m of mlbGames) {
    const h = normalizeMlbTeamName(m.teams?.home?.team?.name);
    const a = normalizeMlbTeamName(m.teams?.away?.team?.name);
    if (h && a) {
      const key = `${h}|${a}`;
      mlbByPair.set(key, [...(mlbByPair.get(key) ?? []), m]);
    }
  }

  // ── 4. Verify each settled grade row ─────────────────────────────
  const problems: Problem[] = [];
  let checkedRecords = 0;
  let checkedSettled = 0;
  let mlbMatched = 0;
  let scoreMatched = 0;
  let gradeMatched = 0;

  for (const r of recs) {
    checkedRecords++;
    const dbGame = dbGameById.get(r.game_id);
    if (!dbGame) {
      problems.push({ severity: "FAIL", matchup: r.matchup, rec_id: r.id, market: r.market, detail: "DB games row missing for game_id " + r.game_id });
      continue;
    }
    const grade = gradesByRec.get(r.id);
    if (!grade) {
      problems.push({ severity: "FAIL", matchup: r.matchup, rec_id: r.id, market: r.market, detail: "no grade row at all" });
      continue;
    }
    if (grade.pending === true || grade.result === "pending") continue;
    checkedSettled++;

    const homeAbbrev = abbrevByTeamId.get(dbGame.home_team_id) ?? "?";
    const awayAbbrev = abbrevByTeamId.get(dbGame.away_team_id) ?? "?";

    // ── 4a. Identity reconciliation ────────────────────────────────
    const mlb = selectMlbStatsGame(
      mlbByPair.get(`${homeAbbrev}|${awayAbbrev}`) ?? [],
      typeof dbGame.game_date === "string" ? dbGame.game_date : null,
    );
    if (!mlb) {
      problems.push({
        severity: "WARN",
        matchup: `${awayAbbrev}@${homeAbbrev}`,
        rec_id: r.id,
        market: r.market,
        detail: `MLB Stats has no unambiguous game matching DB team pair/time (${awayAbbrev}@${homeAbbrev}, ${dbGame.game_date ?? "unknown time"}). Grade can't be independently verified.`,
      });
      continue;
    }
    mlbMatched++;

    // ── 4b. Score reconciliation ───────────────────────────────────
    const mlbHomeScore = typeof mlb.teams?.home?.score === "number" ? mlb.teams.home.score : null;
    const mlbAwayScore = typeof mlb.teams?.away?.score === "number" ? mlb.teams.away.score : null;
    const fi = extractFirstInningTotal(mlb);
    const mlbFi = fi.total;

    let scoreOK = true;
    if (r.market !== "first_inning") {
      if (dbGame.home_score !== mlbHomeScore) {
        problems.push({ severity: "FAIL", matchup: `${awayAbbrev}@${homeAbbrev}`, rec_id: r.id, market: r.market, detail: `DB home_score=${dbGame.home_score} ≠ MLB ${mlbHomeScore}` });
        scoreOK = false;
      }
      if (dbGame.away_score !== mlbAwayScore) {
        problems.push({ severity: "FAIL", matchup: `${awayAbbrev}@${homeAbbrev}`, rec_id: r.id, market: r.market, detail: `DB away_score=${dbGame.away_score} ≠ MLB ${mlbAwayScore}` });
        scoreOK = false;
      }
    } else {
      if (dbGame.first_inning_runs !== mlbFi) {
        problems.push({ severity: "FAIL", matchup: `${awayAbbrev}@${homeAbbrev}`, rec_id: r.id, market: r.market, detail: `DB first_inning_runs=${dbGame.first_inning_runs} ≠ MLB linescore ${mlbFi}` });
        scoreOK = false;
      }
    }
    if (scoreOK) scoreMatched++;

    // ── 4c. Re-compute grade from scratch using MLB Stats scores ──
    const freshGrade = gradePrediction({
      record: r as any,
      game: {
        status: dbGame.status,
        home_score: mlbHomeScore,
        away_score: mlbAwayScore,
        first_inning_runs: mlbFi,
      },
      source: "auto_score_ingest",
    });

    const storedResult = grade.result;
    const freshResult = freshGrade.result;

    if (storedResult !== freshResult) {
      problems.push({
        severity: "FAIL",
        matchup: `${awayAbbrev}@${homeAbbrev}`,
        rec_id: r.id,
        market: r.market,
        detail: `STORED grade="${storedResult}" but FRESH compute from MLB Stats="${freshResult}". pick=${r.pick} side=${r.side} line=${r.line_value}. away=${mlbAwayScore} home=${mlbHomeScore} fi=${mlbFi}`,
      });
    } else {
      gradeMatched++;
    }

    // ── 4d. Hand-derived ML sanity ─────────────────────────────────
    if (r.market === "moneyline" && mlbHomeScore !== null && mlbAwayScore !== null) {
      const realWinner = mlbHomeScore > mlbAwayScore ? "home" : mlbAwayScore > mlbHomeScore ? "away" : "tie";
      const expectedResult = realWinner === "tie" ? "void" : (r.pick === realWinner ? "win" : "loss");
      if (storedResult !== expectedResult) {
        problems.push({
          severity: "FAIL",
          matchup: `${awayAbbrev}@${homeAbbrev}`,
          rec_id: r.id,
          market: "moneyline",
          detail: `Hand-derived ML expected=${expectedResult} (pick=${r.pick}, winner=${realWinner}, score=${mlbAwayScore}-${mlbHomeScore}) but stored=${storedResult}`,
        });
      }
    }

    // ── 4e. Hand-derived O/U sanity ────────────────────────────────
    if (r.market === "total" && mlbHomeScore !== null && mlbAwayScore !== null && r.line_value !== null) {
      const total = mlbHomeScore + mlbAwayScore;
      const expectedResult =
        total > r.line_value
          ? (r.pick === "over" ? "win" : "loss")
          : total < r.line_value
            ? (r.pick === "under" ? "win" : "loss")
            : "push";
      if (storedResult !== expectedResult) {
        problems.push({
          severity: "FAIL",
          matchup: `${awayAbbrev}@${homeAbbrev}`,
          rec_id: r.id,
          market: "total",
          detail: `Hand-derived OU expected=${expectedResult} (pick=${r.pick}, total=${total} vs line ${r.line_value}) but stored=${storedResult}`,
        });
      }
    }

    // ── 4f. Hand-derived FI sanity ─────────────────────────────────
    if (r.market === "first_inning" && r.no_bet !== true && mlbFi !== null) {
      const pick = String(r.pick ?? "").toUpperCase();
      const expectedResult = mlbFi === 0
        ? (pick === "NRFI" ? "win" : pick === "YRFI" ? "loss" : "void")
        : (pick === "YRFI" ? "win" : pick === "NRFI" ? "loss" : "void");
      if (storedResult !== expectedResult) {
        problems.push({
          severity: "FAIL",
          matchup: `${awayAbbrev}@${homeAbbrev}`,
          rec_id: r.id,
          market: "first_inning",
          detail: `Hand-derived FI expected=${expectedResult} (pick=${r.pick}, fi=${mlbFi}) but stored=${storedResult}`,
        });
      }
    }
  }

  // ── 5. Summary ───────────────────────────────────────────────────
  console.log("── Summary ──");
  console.log(`  Records checked:             ${checkedRecords}`);
  console.log(`  Settled rows reviewed:       ${checkedSettled}`);
  console.log(`  MLB Stats game matched:      ${mlbMatched}/${checkedSettled}`);
  console.log(`  Scores match MLB Stats:      ${scoreMatched}/${checkedSettled}`);
  console.log(`  Stored grade matches fresh:  ${gradeMatched}/${checkedSettled}`);

  const fails = problems.filter((p) => p.severity === "FAIL");
  const warns = problems.filter((p) => p.severity === "WARN");
  console.log(`  Problems: ${fails.length} FAIL, ${warns.length} WARN`);

  if (problems.length > 0) {
    console.log("\n── Problems ──");
    for (const p of problems) {
      console.log(`  [${p.severity}] ${p.matchup}${p.rec_id ? ` rec=${p.rec_id}` : ""}${p.market ? ` mkt=${p.market}` : ""}: ${p.detail}`);
    }
  } else {
    console.log("\n  ✅ No discrepancies found between MLB Stats and stored grades.");
  }

  // ── 6. Per-game reconciliation table ─────────────────────────────
  console.log("\n── Per-game reconciliation (settled only) ──");
  const settledGameIds = Array.from(new Set(
    recs.filter((r) => {
      const g = gradesByRec.get(r.id);
      return g && g.pending !== true;
    }).map((r) => r.game_id),
  ));
  for (const gid of settledGameIds) {
    const dbGame = dbGameById.get(gid);
    const homeAbbrev = abbrevByTeamId.get(dbGame.home_team_id) ?? "?";
    const awayAbbrev = abbrevByTeamId.get(dbGame.away_team_id) ?? "?";
    const mlb = selectMlbStatsGame(
      mlbByPair.get(`${homeAbbrev}|${awayAbbrev}`) ?? [],
      typeof dbGame.game_date === "string" ? dbGame.game_date : null,
    );
    if (!mlb) continue;
    const mlbStatus = normalizeMlbStatsStatus(mlb);
    const mlbHome = mlb.teams?.home?.score ?? null;
    const mlbAway = mlb.teams?.away?.score ?? null;
    const mlbFi = extractFirstInningTotal(mlb).total;
    console.log(`\n  ${awayAbbrev}@${homeAbbrev} (g=${gid})`);
    console.log(`    DB:  status=${dbGame.status} score=${dbGame.away_score}-${dbGame.home_score} fi=${dbGame.first_inning_runs}`);
    console.log(`    MLB: status=${mlbStatus.toUpperCase()} score=${mlbAway}-${mlbHome} fi=${mlbFi}`);
    const gameRecs = recs.filter((r) => r.game_id === gid);
    for (const r of gameRecs) {
      const g = gradesByRec.get(r.id);
      if (!g || g.pending === true) continue;
      console.log(`      rec=${r.id} mkt=${r.market.padEnd(13)} pick=${(r.pick ?? "-").padEnd(8)} line=${r.line_value ?? "-"} → STORED=${g.result.padEnd(5)}${r.no_bet ? " (no_bet)" : ""}`);
    }
  }

  // ── 7. Machine-readable summary line ─────────────────────────────
  console.log(
    `\nSUMMARY date=${TARGET_DATE} records=${checkedRecords} settled=${checkedSettled} matched=${mlbMatched} scores_ok=${scoreMatched} grades_ok=${gradeMatched} fail=${fails.length} warn=${warns.length}`,
  );

  process.exit(fails.length > 0 ? 1 : 0);
}

if (require.main === module) {
  main().catch((e) => {
    console.error("FATAL:", e?.message ?? e);
    process.exit(1);
  });
}
