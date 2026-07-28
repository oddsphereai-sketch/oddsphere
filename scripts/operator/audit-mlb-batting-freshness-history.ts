/**
 * Leakage-safe batting freshness replay.
 *
 * Replays the captured V2.2 run model with official MLB hitter aggregates
 * ending on the day BEFORE each slate. It never writes to the database.
 *
 * Historical roster limitation is handled conservatively: only currently
 * active, provider-mapped hitters whose MLB Stats team on the historical
 * aggregate matches their mapped team are included. Dates/teams without at
 * least three qualified hitters are excluded rather than imputed.
 */

import { supabase } from "../../lib/db/supabase";
import {
  getMlbHitterStatsByDateRange,
} from "../../lib/providers/real_api/_mlbStatsApiClient";
import { blendPosterior } from "../../lib/automodel/mlbV22PosteriorBlend";
import {
  applyMlbTeamResidualRunCorrection,
  V22_MAX_DISTANCE_PP_OU,
  V22_SHRINK_K_OU,
} from "../../lib/automodel/mlbAutoModelV2_2";
import {
  homeWinProbabilityPoisson,
  overProbabilityPoisson,
} from "../../lib/automodel/runDistribution";
import { regularizeProbability } from "../../lib/automodel/mlbProbabilityRegularization";
import { computePlayGrade } from "../../lib/automodel/playGrade";
import { noVigPair as marketNoVigPair } from "../../lib/automodel/marketPrior";
import { mlbStatsTeamIdFromAbbr } from "../../lib/providers/real_api/_teamNameNormalizer";

type Row = Record<string, any>;
type Grade = "best_angle" | "lean" | "market_aligned" | "no_bet" | "provisional" | "hold";
type MarketResult = {
  date: string;
  market: "moneyline" | "total";
  oldPick: string;
  newPick: string;
  oldGrade: Grade;
  newGrade: Grade;
  oldProb: number;
  newProb: number;
  outcome: 0 | 1;
  oldOdds: number | null;
  odds: number | null;
};

const START_DATE = process.argv.find((arg) => arg.startsWith("--start="))?.split("=")[1] ?? "2026-07-16";
const END_DATE = process.argv.find((arg) => arg.startsWith("--end="))?.split("=")[1] ?? "2026-07-27";
const SEASON = Number(START_DATE.slice(0, 4));
const SEASON_START = `${SEASON}-03-25`;
const LEAGUE_OPS = 0.72;
const FACTOR_MIN = 0.7;
const FACTOR_MAX = 1.35;
const ML_SHRINK = 0.1;
const ML_DISTANCE_CAP = 6;

function priorDate(date: string): string {
  const d = new Date(`${date}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() - 1);
  return d.toISOString().slice(0, 10);
}

function finite(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function relation(value: unknown): Row | null {
  return Array.isArray(value) ? (value[0] ?? null) : (value as Row | null);
}

function clampFactor(ops: number): number {
  return Math.max(FACTOR_MIN, Math.min(FACTOR_MAX, ops / LEAGUE_OPS));
}

function americanProfit(outcome: 0 | 1, odds: number | null): number | null {
  if (odds === null || odds === 0) return null;
  if (outcome === 0) return -1;
  return odds > 0 ? odds / 100 : 100 / Math.abs(odds);
}

function representativeOdds(
  snapshot: Row,
  market: "moneyline" | "total",
  side: string,
  line: number | null,
): number | null {
  const rows = Array.isArray(snapshot?.lines_at_lock) ? snapshot.lines_at_lock : [];
  const marketType = market === "moneyline" ? "moneyline" : "total";
  const candidates = rows
    .filter((row: Row) =>
      row?.market_type === marketType &&
      String(row?.side ?? "").toLowerCase() === side &&
      (market === "moneyline" || line === null || Number(row?.line_value) === line) &&
      finite(row?.odds_american) !== null,
    )
    .sort((a: Row, b: Row) => Date.parse(String(b.fetched_at)) - Date.parse(String(a.fetched_at)));
  if (!candidates.length) return null;
  const newestAt = String(candidates[0]?.fetched_at ?? "");
  const newest = candidates
    .filter((row: Row) => String(row.fetched_at ?? "") === newestAt)
    .map((row: Row) => Number(row.odds_american))
    .sort((a: number, b: number) => a - b);
  return newest[Math.floor(newest.length / 2)] ?? null;
}

function correctedGrade(
  market: "moneyline" | "total",
  args: Parameters<typeof computePlayGrade>[0],
): Grade {
  const result = computePlayGrade(args);
  if (
    market === "total" &&
    (result.grade === "lean" || result.grade === "best_angle") &&
    (result.edgePct === null || Math.abs(result.edgePct) < 5)
  ) {
    return "market_aligned";
  }
  return result.grade;
}

function metrics(rows: MarketResult[]) {
  const settled = rows.length;
  const wins = rows.filter((row) => row.outcome === 1).length;
  const priced = rows.flatMap((row) => {
    const value = americanProfit(row.outcome, row.odds);
    return value === null ? [] : [value];
  });
  const units = priced.reduce((sum, value) => sum + value, 0);
  const brier = rows.reduce((sum, row) => sum + (row.newProb - row.outcome) ** 2, 0);
  const logLoss = rows.reduce((sum, row) => {
    const p = Math.max(0.001, Math.min(0.999, row.newProb));
    return sum - (row.outcome * Math.log(p) + (1 - row.outcome) * Math.log(1 - p));
  }, 0);
  return {
    rows: settled,
    record: `${wins}-${settled - wins}`,
    winRatePct: settled ? Number((wins / settled * 100).toFixed(1)) : null,
    priced: priced.length,
    units: Number(units.toFixed(3)),
    roiPct: priced.length ? Number((units / priced.length * 100).toFixed(1)) : null,
    brier: settled ? Number((brier / settled).toFixed(4)) : null,
    logLoss: settled ? Number((logLoss / settled).toFixed(4)) : null,
  };
}

function splitLabel(date: string): string {
  if (date <= "2026-07-21") return "train_07_16_to_21";
  if (date <= "2026-07-24") return "validation_07_22_to_24";
  return "untouched_07_25_to_27";
}

async function pageRows(): Promise<Row[]> {
  const output: Row[] = [];
  for (let from = 0; ; from += 1000) {
    const { data, error } = await supabase
      .from("prediction_records")
      .select([
        "id", "game_id", "slate_date", "market", "pick", "side",
        "line_value", "odds_american", "snapshot_json", "locked_at",
        "prediction_grades(result,actual_total)",
        "games(home_score,away_score,home_team_id,away_team_id)",
      ].join(","))
      .eq("sport", "mlb")
      .in("market", ["moneyline", "total"])
      .gte("slate_date", START_DATE)
      .lte("slate_date", END_DATE)
      .not("locked_at", "is", null)
      .order("id")
      .range(from, from + 999);
    if (error) throw new Error(error.message);
    output.push(...((data ?? []) as Row[]));
    if ((data ?? []).length < 1000) return output;
  }
}

async function main(): Promise<void> {
  const rows = await pageRows();
  const captured = rows.filter((row) =>
    row.snapshot_json?.v2_2_audit?.feature_capture?.team?.home?.team_avg_batter_ops &&
    row.snapshot_json?.v2_2_audit?.feature_capture?.team?.away?.team_avg_batter_ops,
  );
  const teamIds = Array.from(new Set(captured.flatMap((row) => {
    const game = relation(row.games);
    return [game?.home_team_id, game?.away_team_id].filter((id): id is number => typeof id === "number");
  })));
  const { data: teams, error: teamError } = await supabase
    .from("teams")
    .select("id, external_id, abbreviation")
    .eq("sport", "mlb");
  if (teamError) throw new Error(teamError.message);
  const externalByInternal = new Map((teams ?? []).map((team) => [team.id as number, team.external_id as number]));
  const mlbStatsByInternal = new Map((teams ?? []).flatMap((team) => {
    const mlbId = mlbStatsTeamIdFromAbbr(team.abbreviation as string | null);
    return mlbId === null ? [] : [[team.id as number, mlbId] as const];
  }));
  const { data: players, error: playerError } = await supabase
    .from("players")
    .select("id, team_id, mlb_person_id, provider_ids")
    .eq("sport", "mlb")
    .eq("active", true)
    .eq("is_pitcher", false);
  if (playerError) throw new Error(playerError.message);
  const activeByMlb = new Map<number, { teamExternalId: number }>();
  for (const player of players ?? []) {
    const provider = player.provider_ids as Row | null;
    const nested = provider?.mlb_stats;
    const nestedId = typeof nested === "object" && nested !== null ? Number((nested as Row).id) : NaN;
    const mlbId = Number.isSafeInteger(nestedId) ? nestedId : Number(player.mlb_person_id);
    const teamExternalId = mlbStatsByInternal.get(player.team_id as number);
    if (Number.isSafeInteger(mlbId) && teamExternalId !== undefined) activeByMlb.set(mlbId, { teamExternalId });
  }

  const dates = Array.from(new Set(captured.map((row) => String(row.slate_date)))).sort();
  const opsByDate = new Map<string, Map<number, { ops: number; pa: number; hitters: number }>>();
  const coverage: Row[] = [];
  for (const date of dates) {
    const providerRows = await getMlbHitterStatsByDateRange(SEASON, SEASON_START, priorDate(date), { quiet: true });
    if (!providerRows?.length) throw new Error(`historical MLB batting response empty for ${date}`);
    const aggregate = new Map<number, { weighted: number; pa: number; hitters: number }>();
    for (const stat of providerRows) {
      const active = activeByMlb.get(stat.mlb_person_id);
      if (!active || stat.team_id !== active.teamExternalId || stat.ops === null || stat.plate_appearances === null || stat.plate_appearances < 100) continue;
      const value = aggregate.get(active.teamExternalId) ?? { weighted: 0, pa: 0, hitters: 0 };
      value.weighted += stat.ops * stat.plate_appearances;
      value.pa += stat.plate_appearances;
      value.hitters++;
      aggregate.set(active.teamExternalId, value);
    }
    const usable = new Map<number, { ops: number; pa: number; hitters: number }>();
    for (const [teamId, value] of aggregate) {
      if (value.hitters < 3 || value.pa <= 0) continue;
      usable.set(teamId, { ops: value.weighted / value.pa, pa: value.pa, hitters: value.hitters });
    }
    opsByDate.set(date, usable);
    coverage.push({ date, providerRows: providerRows.length, teams: usable.size });
  }

  const gameRows = new Map<number, Row>();
  for (const row of captured) if (!gameRows.has(row.game_id as number)) gameRows.set(row.game_id as number, row);
  const results: MarketResult[] = [];
  const skipped: Row[] = [];
  for (const row of gameRows.values()) {
    const game = relation(row.games);
    const homeScore = finite(game?.home_score);
    const awayScore = finite(game?.away_score);
    if (homeScore === null || awayScore === null || homeScore === awayScore) continue;
    const homeExternal = mlbStatsByInternal.get(game?.home_team_id as number);
    const awayExternal = mlbStatsByInternal.get(game?.away_team_id as number);
    const dateOps = opsByDate.get(String(row.slate_date));
    const freshHome = homeExternal === undefined ? undefined : dateOps?.get(homeExternal);
    const freshAway = awayExternal === undefined ? undefined : dateOps?.get(awayExternal);
    if (!freshHome || !freshAway) {
      skipped.push({ game_id: row.game_id, date: row.slate_date, reason: "historical_active_roster_coverage" });
      continue;
    }

    const snapshot = row.snapshot_json as Row;
    const audit = snapshot.v2_2_audit as Row;
    const capture = audit.feature_capture as Row;
    const oldIndHome = Number(audit.independent_home_runs);
    const oldIndAway = Number(audit.independent_away_runs);
    const oldHomeOff = Number(capture.factors.home.offense);
    const oldAwayOff = Number(capture.factors.away.offense);
    const homeField = Number(capture.factors.home.home_field ?? 0.11);
    const awayField = Number(capture.factors.away.home_field ?? -0.11);
    const newIndHome = Math.max(0.1, (oldIndHome - homeField) * clampFactor(freshHome.ops) / oldHomeOff + homeField);
    const newIndAway = Math.max(0.1, (oldIndAway - awayField) * clampFactor(freshAway.ops) / oldAwayOff + awayField);
    const trust = Number(audit.trust_independent);
    const residual = audit.team_residual_correction as Row | undefined;
    const oldBlendHome = Number(audit.posterior_home_runs) - Number(residual?.home_runs ?? 0);
    const oldBlendAway = Number(audit.posterior_away_runs) - Number(residual?.away_runs ?? 0);
    const hasMarket = trust < 0.999 && finite(audit.market_total) !== null;
    const marketHome = hasMarket ? (oldBlendHome - trust * oldIndHome) / (1 - trust) : null;
    const marketAway = hasMarket ? (oldBlendAway - trust * oldIndAway) / (1 - trust) : null;
    const posterior = blendPosterior({
      independent: {
        home_expected_runs: newIndHome,
        away_expected_runs: newIndAway,
        total_expected_runs: newIndHome + newIndAway,
        home_run_diff: newIndHome - newIndAway,
        data_quality_tier: audit.data_quality_tier,
        feature_audit: { missing_count: audit.feature_missing_count } as any,
        audit_per_team: capture.factors,
      },
      market: hasMarket ? {
        dataQuality: "ok",
        listedTotal: Number(audit.market_total),
        homeImpliedTotal: marketHome,
        awayImpliedTotal: marketAway,
      } as any : null,
    });
    const corrected = applyMlbTeamResidualRunCorrection({
      homeTeam: capture.team.home.abbr,
      awayTeam: capture.team.away.abbr,
      homeRuns: posterior.home_expected_runs,
      awayRuns: posterior.away_expected_runs,
    });
    const oldHomeRaw = homeWinProbabilityPoisson(Number(audit.posterior_home_runs), Number(audit.posterior_away_runs));
    const newHomeRaw = homeWinProbabilityPoisson(corrected.homeRuns, corrected.awayRuns);
    const oldMlSide = oldHomeRaw >= 0.5 ? "home" : "away";
    const newMlSide = newHomeRaw >= 0.5 ? "home" : "away";
    const mlMarketHome = finite(audit.market_home_win_prob);
    const mlMarketAway = finite(audit.market_away_win_prob);
    const oldMlMarket = oldMlSide === "home" ? mlMarketHome : mlMarketAway;
    const newMlMarket = newMlSide === "home" ? mlMarketHome : mlMarketAway;
    const oldMlRawPicked = oldMlSide === "home" ? oldHomeRaw : 1 - oldHomeRaw;
    const newMlRawPicked = newMlSide === "home" ? newHomeRaw : 1 - newHomeRaw;
    const oldMlReg = regularizeProbability({ rawProb: oldMlRawPicked, marketProb: oldMlMarket, k: ML_SHRINK, maxDistancePp: ML_DISTANCE_CAP });
    const newMlReg = regularizeProbability({ rawProb: newMlRawPicked, marketProb: newMlMarket, k: ML_SHRINK, maxDistancePp: ML_DISTANCE_CAP });
    const oldMlOdds = representativeOdds(snapshot, "moneyline", oldMlSide, null);
    const newMlOdds = representativeOdds(snapshot, "moneyline", newMlSide, null);
    const commonGrade = {
      dataQualityTier: audit.data_quality_tier,
      provisional: Boolean(audit.provisional),
      isHeld: false,
      minBestAngleEdgePct: 3,
      minBestAngleConfidencePct: 56,
      marketProbIsFallback: Boolean(audit.ml_market_prob_was_fallback),
      bestAngleHardBlockReason: audit.ml_best_angle_blocked ? String(audit.ml_best_angle_block_reason ?? "historical hard block") : null,
    } as const;
    results.push({
      date: String(row.slate_date),
      market: "moneyline",
      oldPick: oldMlSide,
      newPick: newMlSide,
      oldGrade: correctedGrade("moneyline", { ...commonGrade, modelProb: oldMlReg.regularizedProb, marketProb: oldMlMarket, americanOdds: oldMlOdds }),
      newGrade: correctedGrade("moneyline", { ...commonGrade, modelProb: newMlReg.regularizedProb, marketProb: newMlMarket, americanOdds: newMlOdds }),
      oldProb: oldMlRawPicked,
      newProb: newMlRawPicked,
      outcome: (newMlSide === "home") === (homeScore > awayScore) ? 1 : 0,
      oldOdds: oldMlOdds,
      odds: newMlOdds,
    });

    const line = finite(audit.market_total);
    if (line === null || homeScore + awayScore === line) continue;
    const oldOverRaw = overProbabilityPoisson(Number(audit.posterior_home_runs), Number(audit.posterior_away_runs), line);
    const newOverRaw = overProbabilityPoisson(corrected.homeRuns, corrected.awayRuns, line);
    const oldOuSide = oldOverRaw >= 0.5 ? "over" : "under";
    const newOuSide = newOverRaw >= 0.5 ? "over" : "under";
    const overOdds = finite(audit.over_odds_american);
    const underOdds = finite(audit.under_odds_american);
    const ouPair = overOdds !== null && underOdds !== null ? marketNoVigPair(overOdds, underOdds) : null;
    const oldOuMarket = ouPair ? (oldOuSide === "over" ? ouPair.home : ouPair.away) : null;
    const newOuMarket = ouPair ? (newOuSide === "over" ? ouPair.home : ouPair.away) : null;
    const oldOuRawPicked = oldOuSide === "over" ? oldOverRaw : 1 - oldOverRaw;
    const newOuRawPicked = newOuSide === "over" ? newOverRaw : 1 - newOverRaw;
    const oldOuReg = regularizeProbability({ rawProb: oldOuRawPicked, marketProb: oldOuMarket, k: V22_SHRINK_K_OU, maxDistancePp: V22_MAX_DISTANCE_PP_OU });
    const newOuReg = regularizeProbability({ rawProb: newOuRawPicked, marketProb: newOuMarket, k: V22_SHRINK_K_OU, maxDistancePp: V22_MAX_DISTANCE_PP_OU });
    const oldOuOdds = oldOuSide === "over" ? overOdds : underOdds;
    const newOuOdds = newOuSide === "over" ? overOdds : underOdds;
    const ouGradeCommon = {
      dataQualityTier: audit.data_quality_tier,
      provisional: Boolean(audit.provisional),
      isHeld: false,
      minBestAngleEdgePct: 5,
      minBestAngleConfidencePct: 56,
      marketProbIsFallback: newOuMarket === null,
      bestAngleHardBlockReason: audit.ou_best_angle_blocked ? String(audit.ou_best_angle_block_reason ?? "historical hard block") : null,
    } as const;
    results.push({
      date: String(row.slate_date),
      market: "total",
      oldPick: oldOuSide,
      newPick: newOuSide,
      oldGrade: correctedGrade("total", { ...ouGradeCommon, modelProb: oldOuReg.regularizedProb, marketProb: oldOuMarket, americanOdds: oldOuOdds }),
      newGrade: correctedGrade("total", { ...ouGradeCommon, modelProb: newOuReg.regularizedProb, marketProb: newOuMarket, americanOdds: newOuOdds }),
      oldProb: oldOuRawPicked,
      newProb: newOuRawPicked,
      outcome: (newOuSide === "over") === (homeScore + awayScore > line) ? 1 : 0,
      oldOdds: oldOuOdds,
      odds: newOuOdds,
    });
  }

  const summarize = (source: MarketResult[]) => ({
    all: metrics(source),
    byMarket: Object.fromEntries(["moneyline", "total"].map((market) => [market, metrics(source.filter((row) => row.market === market))])),
    bySplit: Object.fromEntries(["train_07_16_to_21", "validation_07_22_to_24", "untouched_07_25_to_27"].map((split) => [split, metrics(source.filter((row) => splitLabel(row.date) === split))])),
    actionable: metrics(source.filter((row) => row.newGrade === "best_angle" || row.newGrade === "lean")),
    byGrade: Object.fromEntries(["best_angle", "lean", "market_aligned", "no_bet", "provisional", "hold"].map((grade) => [grade, metrics(source.filter((row) => row.newGrade === grade))])),
  });
  const oldRows = results.map((row) => {
    const outcome = row.oldPick === row.newPick ? row.outcome : (row.outcome === 1 ? 0 : 1) as 0 | 1;
    return { ...row, newPick: row.oldPick, newGrade: row.oldGrade, newProb: row.oldProb, outcome, odds: row.oldOdds };
  });
  console.log(JSON.stringify({
    mode: "read_only_leakage_safe_batting_freshness_replay",
    noWrites: true,
    range: { start: START_DATE, end: END_DATE, statsCutoff: "previous_calendar_day" },
    historicalRosterPolicy: "current-active stable-team matches only; missing coverage excluded",
    coverage,
    capturedRows: captured.length,
    eligibleGames: results.filter((row) => row.market === "moneyline").length,
    skippedGames: skipped.length,
    pickChanges: results.filter((row) => row.oldPick !== row.newPick).length,
    gradeChanges: results.filter((row) => row.oldGrade !== row.newGrade).length,
    promotions: results.filter((row) => !["best_angle", "lean"].includes(row.oldGrade) && ["best_angle", "lean"].includes(row.newGrade)).length,
    demotions: results.filter((row) => ["best_angle", "lean"].includes(row.oldGrade) && !["best_angle", "lean"].includes(row.newGrade)).length,
    baseline: summarize(oldRows),
    freshBatting: summarize(results),
  }, null, 2));
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
