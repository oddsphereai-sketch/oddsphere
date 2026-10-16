/**
 * Read-only MLB foundational scoreboard and innings-weighted pitching replay.
 *
 * Uses immutable prediction_records snapshots only. It never rewrites a lock
 * or promotes a candidate. Historical releases remain separated in output.
 *
 * Usage:
 *   npx tsx --env-file=.env.local scripts/operator/audit-mlb-foundational-scoreboard.ts \
 *     --from=2026-06-07 --to=2026-10-15 --out-dir=/tmp/mlb-audit
 */
import { mkdir, writeFile } from "node:fs/promises";
import { supabase } from "../../lib/db/supabase";
import {
  homeMinus1_5Probability,
  overProbabilityPoisson,
  poissonPmf,
} from "../../lib/automodel/runDistribution";
import { regularizeProbability } from "../../lib/automodel/mlbProbabilityRegularization";
import { computePlayGrade } from "../../lib/automodel/playGrade";
import { computeConfidence } from "../../lib/automodel/mlbV22PosteriorBlend";
import { reconcileTotalProjection } from "../../lib/automodel/totalProjectionReconciliation";
import {
  buildGameOddsSnapshot,
  buildPredictionRecordsFromSlate,
} from "../../lib/services/predictionRecordService";

type Grade = {
  result: string | null;
  actual_home_score: number | null;
  actual_away_score: number | null;
};

type Row = {
  id: number;
  game_id: number;
  slate_date: string;
  market: string;
  side: string | null;
  line_value: number | null;
  odds_american: number | null;
  model_probability: number | null;
  market_probability: number | null;
  play_grade: string | null;
  best_angle: boolean | null;
  market_aligned: boolean | null;
  locked_at: string | null;
  published_at: string | null;
  snapshot_json: Record<string, unknown> | null;
  prediction_grades: Grade | Grade[] | null;
};

type Game = {
  gameId: number;
  date: string;
  home: number;
  away: number;
  ml: Row | null;
  total: Row | null;
};

type Scores = { home: number; away: number };
type Side = "home" | "away";
type TotalSide = "over" | "under";
type Outcome = "win" | "loss" | "push";
type PitchingMode = "arithmetic" | "geometric" | "arithmetic_preserve_margin";

type PickRow = {
  gameId: number;
  date: string;
  release: string;
  outcome: Outcome;
  odds: number | null;
};

type Metric = {
  n: number;
  decided: number;
  wins: number;
  losses: number;
  pushes: number;
  winPct: number | null;
  units: number;
  roiPct: number | null;
};

type ErrorMetric = {
  n: number;
  homeMae: number;
  awayMae: number;
  totalMae: number;
  totalBias: number;
  marginMae: number;
  winnerPct: number;
};

type CandidateTotalDecision = {
  side: TotalSide;
  meanSide: TotalSide;
  rawProbabilitySide: TotalSide;
  regularizedProbabilitySide: TotalSide;
  rawOverProbability: number;
  regularizedOverProbability: number;
  calibratedOverProbability: number;
  modelProbability: number;
  marketProbability: number | null;
  edgePct: number | null;
  grade: string;
  predictionType: string | null;
  noBetReason: string | null;
  marketAligned: boolean;
  bestAngleReason: string | null;
  bestAngleBlocked: boolean;
  bestAngleBlockReason: string | null;
  baseBestAngleEligible: boolean;
  requiresMarketConfirmation: boolean;
};

type PushNormalizedTotalDecision = {
  rawSide: TotalSide;
  regularizedSide: TotalSide;
  calibratedSide: TotalSide;
  rawOverProbability: number;
  regularizedOverProbability: number;
  calibratedOverProbability: number;
  pushProbability: number;
};

type ScoreGapCalibration = {
  intercept: number;
  slope: number;
  trainGames: number;
  trainPushesExcluded: number;
};

type WriterArgs = Parameters<typeof buildPredictionRecordsFromSlate>[0];
type WriterGame = WriterArgs["games"][number];
type WriterPrediction = WriterArgs["predictionByGameId"] extends ReadonlyMap<number, infer Value>
  ? Value
  : never;
type WriterLine = NonNullable<WriterArgs["currentLinesByGameId"]> extends ReadonlyMap<number, ReadonlyArray<infer Value>>
  ? Value
  : never;
type WriterOpener = NonNullable<WriterArgs["openersByGameId"]> extends ReadonlyMap<number, ReadonlyArray<infer Value>>
  ? Value
  : never;
type WriterSignal = NonNullable<WriterArgs["signalsByGameId"]> extends ReadonlyMap<number, ReadonlyArray<infer Value>>
  ? Value
  : never;
type WriterSplit = NonNullable<WriterArgs["sourceAwareSplitsByGameId"]> extends ReadonlyMap<number, ReadonlyArray<infer Value>>
  ? Value
  : never;

const COMPETITOR = {
  source: "owner-provided screenshot; methodology not yet normalized",
  moneyline: { wins: 1366, losses: 1081, pct: 1366 / 2447 },
  runLine: { wins: 1330, losses: 1117, pct: 1330 / 2447 },
  runLinePlus1: { wins: 1626, losses: 821, pct: 1626 / 2447 },
  runLinePlus2: { wins: 1762, losses: 685, pct: 1762 / 2447 },
  total: { wins: 1192, losses: 1183, pct: 1192 / 2375 },
  totalPlus1: { wins: 1406, losses: 955, pct: 1406 / 2361 },
  totalPlus2: { wins: 1635, losses: 747, pct: 1635 / 2382 },
};

function args(): { from: string; to: string; outDir: string } {
  const parsed = { from: "2026-06-07", to: "2026-10-15", outDir: "ops-local/learning-lab" };
  for (const raw of process.argv.slice(2)) {
    const m = raw.match(/^--([^=]+)=(.*)$/);
    if (!m) continue;
    if (m[1] === "from") parsed.from = m[2];
    if (m[1] === "to") parsed.to = m[2];
    if (m[1] === "out-dir") parsed.outDir = m[2];
  }
  return parsed;
}

function obj(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
}

function num(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string" && value.trim() !== "" && Number.isFinite(Number(value))) return Number(value);
  return null;
}

function one<T>(value: T | T[] | null): T | null {
  return Array.isArray(value) ? value[0] ?? null : value;
}

function round(value: number, places = 3): number {
  const f = 10 ** places;
  return Math.round(value * f) / f;
}

function snapshot(row: Row | null): Record<string, unknown> {
  return obj(row?.snapshot_json);
}

function v22(row: Row | null): Record<string, unknown> {
  return obj(snapshot(row).v2_2_audit);
}

function release(row: Row | null): string {
  const layers = obj(snapshot(row).model_layer_versions);
  return String(layers.decision_release_id ?? "unstamped_legacy");
}

function actual(row: Row): Scores | null {
  const grade = one(row.prediction_grades);
  return typeof grade?.actual_home_score === "number" && typeof grade.actual_away_score === "number"
    ? { home: grade.actual_home_score, away: grade.actual_away_score }
    : null;
}

async function loadRows(from: string, to: string): Promise<Row[]> {
  const rows: Row[] = [];
  for (let start = 0; ; start += 750) {
    const { data, error } = await supabase
      .from("prediction_records")
      .select("id,game_id,slate_date,market,side,line_value,odds_american,model_probability,market_probability,play_grade,best_angle,market_aligned,locked_at,published_at,snapshot_json,prediction_grades(result,actual_home_score,actual_away_score)")
      .eq("sport", "mlb")
      .gte("slate_date", from)
      .lte("slate_date", to)
      .in("market", ["moneyline", "total"])
      .order("slate_date", { ascending: true })
      .order("id", { ascending: true })
      .range(start, start + 749);
    if (error) throw new Error(`prediction_records read failed: ${error.message}`);
    rows.push(...((data ?? []) as Row[]));
    if ((data ?? []).length < 750) break;
  }
  return rows;
}

function gamesFromRows(rows: Row[]): Game[] {
  const map = new Map<number, Game>();
  for (const row of rows) {
    const score = actual(row);
    if (!score) continue;
    const current = map.get(row.game_id) ?? {
      gameId: row.game_id,
      date: row.slate_date,
      home: score.home,
      away: score.away,
      ml: null,
      total: null,
    };
    if (row.market === "moneyline") current.ml = row;
    if (row.market === "total") current.total = row;
    map.set(row.game_id, current);
  }
  return [...map.values()].sort((a, b) => a.date.localeCompare(b.date) || a.gameId - b.gameId);
}

function profit(odds: number | null, outcome: Outcome): number {
  if (outcome === "push") return 0;
  if (outcome === "loss") return -1;
  if (odds === null || odds === 0) return 0;
  return odds > 0 ? odds / 100 : 100 / Math.abs(odds);
}

function metric(rows: PickRow[]): Metric {
  const wins = rows.filter((r) => r.outcome === "win").length;
  const losses = rows.filter((r) => r.outcome === "loss").length;
  const pushes = rows.length - wins - losses;
  const priced = rows.filter((r) => r.outcome !== "push" && r.odds !== null);
  const units = round(priced.reduce((sum, r) => sum + profit(r.odds, r.outcome), 0));
  return {
    n: rows.length,
    decided: wins + losses,
    wins,
    losses,
    pushes,
    winPct: wins + losses ? round(wins / (wins + losses), 4) : null,
    units,
    roiPct: priced.length ? round((units / priced.length) * 100, 2) : null,
  };
}

function mlOutcome(game: Game, side: Side): Outcome {
  const margin = side === "home" ? game.home - game.away : game.away - game.home;
  return margin > 0 ? "win" : margin < 0 ? "loss" : "push";
}

function handicapOutcome(side: Side, line: number, game: Game): Outcome {
  const margin = side === "home" ? game.home - game.away : game.away - game.home;
  const result = margin + line;
  return result > 0 ? "win" : result < 0 ? "loss" : "push";
}

function totalOutcome(side: TotalSide, line: number, game: Game): Outcome {
  const total = game.home + game.away;
  if (total === line) return "push";
  return side === "over"
    ? total > line ? "win" : "loss"
    : total < line ? "win" : "loss";
}

function homeMarketProbability(row: Row | null): number | null {
  const audit = v22(row);
  return num(audit.market_home_win_prob);
}

function lineForSelectedRunLine(game: Game, side: Side): number | null {
  const pHome = homeMarketProbability(game.ml);
  if (pHome === null) return null;
  const homeLine = pHome >= 0.5 ? -1.5 : 1.5;
  return side === "home" ? homeLine : -homeLine;
}

function candidateRunLineSide(game: Game): Side | null {
  const score = candidatePosterior(game, "arithmetic_preserve_margin");
  const pHomeMarket = homeMarketProbability(game.ml);
  if (!score || pHomeMarket === null) return null;
  const homeLine = pHomeMarket >= 0.5 ? -1.5 : 1.5;
  const homeCoverProbability = homeLine < 0
    ? homeMinus1_5Probability(score.home, score.away)
    : 1 - homeMinus1_5Probability(score.away, score.home);
  return homeCoverProbability >= 0.5 ? "home" : "away";
}

function storedMlSide(game: Game): Side | null {
  return game.ml?.side === "home" || game.ml?.side === "away" ? game.ml.side : null;
}

function projectedMlSide(game: Game, key: "posterior_home_diff" | "independent_home_diff"): Side | null {
  const diff = num(v22(game.ml)[key]);
  return diff === null ? null : diff >= 0 ? "home" : "away";
}

function marketMlSide(game: Game): Side | null {
  const p = homeMarketProbability(game.ml);
  return p === null ? null : p >= 0.5 ? "home" : "away";
}

function storedTotalSide(game: Game): TotalSide | null {
  return game.total?.side === "over" || game.total?.side === "under" ? game.total.side : null;
}

function totalLine(game: Game): number | null {
  return game.total?.line_value ?? num(v22(game.total).market_total);
}

function projectionTotalSide(game: Game, key: "posterior_total" | "independent_total"): TotalSide | null {
  const line = totalLine(game);
  const projected = num(v22(game.total)[key]);
  if (line === null || projected === null) return null;
  return projected >= line ? "over" : "under";
}

function reconciliationTotalSide(
  game: Game,
  key: "raw_probability_side" | "mean_direction_side" | "holistic_side" | "reconciled_total_side",
): TotalSide | null {
  const value = obj(snapshot(game.total).total_projection_reconciliation)[key];
  return value === "over" || value === "under" ? value : null;
}

function regularizedQuarterTotalSide(game: Game): TotalSide | null {
  const row = game.total;
  if (!row) return null;
  const audit = v22(row);
  const shipped = storedTotalSide(game);
  if (!shipped) return null;
  const line = totalLine(game);
  const posteriorHome = num(audit.posterior_home_runs);
  const posteriorAway = num(audit.posterior_away_runs);
  if (line === null || posteriorHome === null || posteriorAway === null) return null;
  const rawOver = overProbabilityPoisson(posteriorHome, posteriorAway, line);
  const marketPicked = row.market_probability ?? num(audit.ou_market_prob);
  const marketOver = marketPicked === null ? null : shipped === "over" ? marketPicked : 1 - marketPicked;
  const reg = regularizeProbability({ rawProb: rawOver, marketProb: marketOver, k: 0.25, maxDistancePp: 5 });
  return (reg.regularizedProb ?? rawOver) >= 0.5 ? "over" : "under";
}

function factor(objValue: Record<string, unknown>, key: string, fallback = 1): number {
  return num(objValue[key]) ?? fallback;
}

function innings(v: unknown): { starter: number; bullpen: number } | null {
  const o = obj(v);
  const starter = num(o.starter_innings);
  const bullpen = num(o.bullpen_innings);
  if (starter === null || bullpen === null || starter + bullpen <= 0) return null;
  return { starter, bullpen };
}

function inningsWeightedIndependent(game: Game, mode: PitchingMode): Scores | null {
  const audit = v22(game.ml ?? game.total);
  const capture = obj(audit.feature_capture);
  const factors = obj(capture.factors);
  const home = obj(factors.home);
  const away = obj(factors.away);
  if (!Object.keys(home).length || !Object.keys(away).length) return null;
  const homeWorkload = innings(audit.home_starter_workload);
  const awayWorkload = innings(audit.away_starter_workload);
  if (!homeWorkload || !awayWorkload) return null;

  const weighted = (pitcher: number, bullpen: number, workload: { starter: number; bullpen: number }): number => {
    const total = workload.starter + workload.bullpen;
    const starterWeight = workload.starter / total;
    const bullpenWeight = workload.bullpen / total;
    return mode === "arithmetic" || mode === "arithmetic_preserve_margin"
      ? pitcher * starterWeight + bullpen * bullpenWeight
      : Math.pow(pitcher, starterWeight) * Math.pow(bullpen, bullpenWeight);
  };

  const homePitching = weighted(
    factor(home, "pitcher_factor_opp"),
    factor(home, "bullpen_factor_opp"),
    awayWorkload,
  );
  const awayPitching = weighted(
    factor(away, "pitcher_factor_opp"),
    factor(away, "bullpen_factor_opp"),
    homeWorkload,
  );
  const score = (side: Record<string, unknown>, pitching: number): number => Math.max(
    0.1,
    factor(side, "base", 4.45) *
      factor(side, "offense") *
      pitching *
      factor(side, "park") *
      factor(side, "weather") *
      factor(side, "handedness") +
      factor(side, "home_field", 0),
  );
  const projected = { home: score(home, homePitching), away: score(away, awayPitching) };
  if (mode !== "arithmetic_preserve_margin") return projected;
  const storedMargin = num(audit.independent_home_diff);
  if (storedMargin === null) return null;
  const total = projected.home + projected.away;
  return {
    home: Math.max(0.1, (total + storedMargin) / 2),
    away: Math.max(0.1, (total - storedMargin) / 2),
  };
}

function candidatePosterior(game: Game, mode: PitchingMode): Scores | null {
  const row = game.ml ?? game.total;
  const audit = v22(row);
  const candidateIndependent = inningsWeightedIndependent(game, mode);
  const storedIndependent = {
    home: num(audit.independent_home_runs),
    away: num(audit.independent_away_runs),
  };
  const storedPosterior = {
    home: num(audit.posterior_home_runs),
    away: num(audit.posterior_away_runs),
  };
  const trust = num(audit.trust_independent);
  if (
    !candidateIndependent || storedIndependent.home === null || storedIndependent.away === null ||
    storedPosterior.home === null || storedPosterior.away === null || trust === null || trust >= 0.999 ||
    audit.capped_by_total === true || audit.capped_by_diff === true
  ) return null;
  const correction = obj(audit.team_residual_correction);
  const homeCorrection = num(correction.home_runs) ?? 0;
  const awayCorrection = num(correction.away_runs) ?? 0;
  const preHome = storedPosterior.home - homeCorrection;
  const preAway = storedPosterior.away - awayCorrection;
  const marketWeight = 1 - trust;
  const marketHome = (preHome - trust * storedIndependent.home) / marketWeight;
  const marketAway = (preAway - trust * storedIndependent.away) / marketWeight;
  return {
    home: Math.max(0.05, trust * candidateIndependent.home + marketWeight * marketHome + homeCorrection),
    away: Math.max(0.05, trust * candidateIndependent.away + marketWeight * marketAway + awayCorrection),
  };
}

function scoreMetric(rows: Array<{ game: Game; prediction: Scores }>): ErrorMetric {
  const sum = rows.reduce((acc, row) => {
    const predTotal = row.prediction.home + row.prediction.away;
    const actualTotal = row.game.home + row.game.away;
    acc.home += Math.abs(row.prediction.home - row.game.home);
    acc.away += Math.abs(row.prediction.away - row.game.away);
    acc.total += Math.abs(predTotal - actualTotal);
    acc.bias += predTotal - actualTotal;
    acc.margin += Math.abs((row.prediction.home - row.prediction.away) - (row.game.home - row.game.away));
    acc.winner += (row.prediction.home >= row.prediction.away) === (row.game.home > row.game.away) ? 1 : 0;
    return acc;
  }, { home: 0, away: 0, total: 0, bias: 0, margin: 0, winner: 0 });
  const n = rows.length || 1;
  return {
    n: rows.length,
    homeMae: round(sum.home / n),
    awayMae: round(sum.away / n),
    totalMae: round(sum.total / n),
    totalBias: round(sum.bias / n),
    marginMae: round(sum.margin / n),
    winnerPct: round(sum.winner / n, 4),
  };
}

function chronologicalLabel(games: Game[], game: Game): "train" | "validation" | "holdout" {
  const index = games.findIndex((g) => g.gameId === game.gameId);
  const ratio = index / Math.max(1, games.length);
  return ratio < 0.6 ? "train" : ratio < 0.8 ? "validation" : "holdout";
}

function picksByRule(
  games: Game[],
  sideFn: (game: Game) => Side | null,
  outcomeFn: (game: Game, side: Side) => Outcome,
): PickRow[] {
  return games.flatMap((game) => {
    const side = sideFn(game);
    return side ? [{ gameId: game.gameId, date: game.date, release: release(game.ml), outcome: outcomeFn(game, side), odds: mlSideOdds(game, side) }] : [];
  });
}

function mlSideOdds(game: Game, side: Side): number | null {
  const row = game.ml;
  if (!row) return null;
  if (row.side === side && row.odds_american !== null) return row.odds_american;
  const source = obj(obj(snapshot(row).odds_source_at_lock_ml)[side]);
  const sourceOdds = num(source.odds);
  if (sourceOdds !== null) return sourceOdds;
  const lines = snapshot(row).lines_at_lock;
  if (!Array.isArray(lines)) return null;
  const prices = lines
    .map(obj)
    .filter((line) => line.market_type === "moneyline" && line.side === side)
    .map((line) => num(line.odds_american))
    .filter((value): value is number => value !== null);
  return prices.length ? Math.max(...prices) : null;
}

function totalSideOdds(game: Game, side: TotalSide): number | null {
  const row = game.total;
  if (!row) return null;
  const audit = v22(row);
  return side === "over"
    ? num(audit.over_odds_american) ?? (row.side === side ? row.odds_american : null)
    : num(audit.under_odds_american) ?? (row.side === side ? row.odds_american : null);
}

function totalsByRule(
  games: Game[],
  sideFn: (game: Game) => TotalSide | null,
  lineAdjust = 0,
): PickRow[] {
  return games.flatMap((game) => {
    const side = sideFn(game);
    const line = totalLine(game);
    if (!side || line === null) return [];
    const favorableLine = side === "over" ? line - lineAdjust : line + lineAdjust;
    return [{
      gameId: game.gameId,
      date: game.date,
      release: release(game.total),
      outcome: totalOutcome(side, favorableLine, game),
      odds: lineAdjust === 0 ? totalSideOdds(game, side) : null,
    }];
  });
}

function summarizeChronology(games: Game[], rows: PickRow[]): Record<string, Metric> {
  const gameMap = new Map(games.map((g) => [g.gameId, g]));
  return Object.fromEntries(["train", "validation", "holdout"].map((part) => [
    part,
    metric(rows.filter((r) => {
      const game = gameMap.get(r.gameId);
      return game ? chronologicalLabel(games, game) === part : false;
    })),
  ]));
}

function byRelease(rows: PickRow[]): Record<string, Metric> {
  const groups = new Map<string, PickRow[]>();
  for (const row of rows) groups.set(row.release, [...(groups.get(row.release) ?? []), row]);
  return Object.fromEntries([...groups.entries()].sort((a, b) => b[1].length - a[1].length).map(([key, values]) => [key, metric(values)]));
}

function scoreRule(
  games: Game[],
  fn: (game: Game) => Scores | null,
  chronologyUniverse: Game[] = games,
): Record<string, ErrorMetric> {
  const rows = games.flatMap((game) => {
    const prediction = fn(game);
    return prediction ? [{ game, prediction }] : [];
  });
  return {
    all: scoreMetric(rows),
    train: scoreMetric(rows.filter((r) => chronologicalLabel(chronologyUniverse, r.game) === "train")),
    validation: scoreMetric(rows.filter((r) => chronologicalLabel(chronologyUniverse, r.game) === "validation")),
    holdout: scoreMetric(rows.filter((r) => chronologicalLabel(chronologyUniverse, r.game) === "holdout")),
  };
}

function candidateSide(game: Game, mode: PitchingMode): Side | null {
  const score = candidatePosterior(game, mode);
  return score ? score.home >= score.away ? "home" : "away" : null;
}

function candidateTotalSide(game: Game, mode: PitchingMode): TotalSide | null {
  const score = candidatePosterior(game, mode);
  const line = totalLine(game);
  if (!score || line === null) return null;
  return score.home + score.away >= line ? "over" : "under";
}

function americanImpliedProbability(odds: number | null): number | null {
  if (odds === null || odds === 0) return null;
  return odds < 0 ? Math.abs(odds) / (Math.abs(odds) + 100) : 100 / (odds + 100);
}

function totalNoVigProbability(game: Game): { over: number; under: number } | null {
  const audit = v22(game.total);
  const over = americanImpliedProbability(num(audit.over_odds_american));
  const under = americanImpliedProbability(num(audit.under_odds_american));
  if (over === null || under === null || over + under <= 0) return null;
  return { over: over / (over + under), under: under / (over + under) };
}

function totalMarketPriceSide(game: Game): TotalSide | null {
  const noVig = totalNoVigProbability(game);
  if (noVig === null) return null;
  return noVig.over >= noVig.under ? "over" : "under";
}

function pushNormalizedTotalDecision(
  game: Game,
  score: Scores | null,
): PushNormalizedTotalDecision | null {
  const line = totalLine(game);
  const row = game.total;
  if (!row || !score || line === null) return null;
  const audit = v22(row);
  const unconditionedOver = overProbabilityPoisson(score.away, score.home, line);
  const pushProbability = Number.isInteger(line)
    ? poissonPmf(line, Math.max(0, score.away) + Math.max(0, score.home))
    : 0;
  const unconditionedUnder = Math.max(0, 1 - unconditionedOver - pushProbability);
  const decidedMass = unconditionedOver + unconditionedUnder;
  const rawOverProbability = decidedMass > 0
    ? unconditionedOver / decidedMass
    : 0.5;
  const noVig = totalNoVigProbability(game);
  const exclusion = obj(audit.evaluation_only_price_exclusion);
  const regularizationExcluded = exclusion.total_probability_regularization_excluded === true;
  const regularized = regularizeProbability({
    rawProb: rawOverProbability,
    marketProb: regularizationExcluded ? null : noVig?.over ?? null,
    k: 0.4,
    maxDistancePp: 8,
  });
  const regularizedOverProbability = regularized.regularizedProb ?? rawOverProbability;
  const storedCalibration = obj(audit.total_regime_calibration);
  const prior = obj(storedCalibration.prior);
  const smoothedOverRate = num(prior.smoothedOverRate);
  const regimeWeight = num(storedCalibration.regimeWeight) ?? 0.35;
  const calibratedOverProbability =
    storedCalibration.applied === true && smoothedOverRate !== null
      ? Math.max(0.01, Math.min(0.99,
          (1 - regimeWeight) * regularizedOverProbability + regimeWeight * smoothedOverRate,
        ))
      : regularizedOverProbability;
  return {
    rawSide: rawOverProbability >= 0.5 ? "over" : "under",
    regularizedSide: regularizedOverProbability >= 0.5 ? "over" : "under",
    calibratedSide: calibratedOverProbability >= 0.5 ? "over" : "under",
    rawOverProbability,
    regularizedOverProbability,
    calibratedOverProbability,
    pushProbability,
  };
}

function storedPosteriorScore(game: Game): Scores | null {
  const audit = v22(game.total ?? game.ml);
  const home = num(audit.posterior_home_runs);
  const away = num(audit.posterior_away_runs);
  return home !== null && away !== null ? { home, away } : null;
}

/**
 * Replay the pure V2.2 Total probability + grade layers around the structural
 * candidate. This deliberately stops before predictionRecordService's later
 * market arbitration, promotions, and demotions; those require a full locked
 * writer replay and are reported separately from this model-layer board.
 */
function candidateTotalDecision(
  game: Game,
  pushNormalize = false,
): CandidateTotalDecision | null {
  const row = game.total;
  const score = candidatePosterior(game, "arithmetic_preserve_margin");
  const line = totalLine(game);
  if (!row || !score || line === null) return null;

  const audit = v22(row);
  const unconditionedOverProbability = overProbabilityPoisson(score.away, score.home, line);
  const pushProbability = pushNormalize && Number.isInteger(line)
    ? poissonPmf(line, Math.max(0, score.away) + Math.max(0, score.home))
    : 0;
  const unconditionedUnderProbability = Math.max(
    0,
    1 - unconditionedOverProbability - pushProbability,
  );
  const decidedProbabilityMass =
    unconditionedOverProbability + unconditionedUnderProbability;
  const rawOverProbability = pushNormalize && decidedProbabilityMass > 0
    ? unconditionedOverProbability / decidedProbabilityMass
    : unconditionedOverProbability;
  const preRegimeSide: TotalSide = rawOverProbability >= 0.5 ? "over" : "under";
  const rawPickedProbability = preRegimeSide === "over"
    ? rawOverProbability
    : 1 - rawOverProbability;
  const noVig = totalNoVigProbability(game);
  const preRegimeMarketProbability = noVig === null
    ? null
    : preRegimeSide === "over" ? noVig.over : noVig.under;
  const exclusion = obj(audit.evaluation_only_price_exclusion);
  const regularizationExcluded = exclusion.total_probability_regularization_excluded === true;
  const regularized = regularizeProbability({
    rawProb: rawPickedProbability,
    marketProb: regularizationExcluded ? null : preRegimeMarketProbability,
    k: 0.4,
    maxDistancePp: 8,
  });
  const regularizedPickedProbability = regularized.regularizedProb ?? rawPickedProbability;
  const regularizedOverProbability = preRegimeSide === "over"
    ? regularizedPickedProbability
    : 1 - regularizedPickedProbability;

  const storedCalibration = obj(audit.total_regime_calibration);
  const prior = obj(storedCalibration.prior);
  const smoothedOverRate = num(prior.smoothedOverRate);
  const regimeWeight = num(storedCalibration.regimeWeight) ?? 0.35;
  const calibratedOverProbability =
    storedCalibration.applied === true && smoothedOverRate !== null
      ? Math.max(0.01, Math.min(0.99,
          (1 - regimeWeight) * regularizedOverProbability + regimeWeight * smoothedOverRate,
        ))
      : regularizedOverProbability;
  const side: TotalSide = calibratedOverProbability >= 0.5 ? "over" : "under";
  const meanSide: TotalSide = score.home + score.away >= line ? "over" : "under";
  const modelProbability = side === "over"
    ? calibratedOverProbability
    : 1 - calibratedOverProbability;
  const marketProbability = noVig === null ? null : side === "over" ? noVig.over : noVig.under;
  const edgePct = marketProbability === null
    ? null
    : Math.round((modelProbability - marketProbability) * 1_000) / 10;
  const odds = totalSideOdds(game, side);
  const qualityRaw = String(audit.data_quality_tier ?? "fallback");
  const quality = qualityRaw === "high" || qualityRaw === "medium" || qualityRaw === "low"
    ? qualityRaw
    : "fallback";
  const priorBlockReason = String(audit.ou_best_angle_block_reason ?? "");
  const neutralFallbackBlock = /key feature group/i.test(priorBlockReason);
  const hardBlockReason = odds === null || marketProbability === null
    ? "total requires real O/U odds (no fallback) for Best Angle"
    : regularizationExcluded
      ? "evaluation-only Total price has no target-excluded forecast corroboration"
      : neutralFallbackBlock
        ? "key feature group on neutral fallback / missing for both sides"
        : null;
  const gradeResult = computePlayGrade({
    modelProb: modelProbability,
    marketProb: marketProbability,
    americanOdds: odds,
    dataQualityTier: quality,
    provisional: audit.provisional === true,
    isHeld: false,
    minBestAngleEdgePct: 5,
    minBestAngleConfidencePct: 56,
    marketProbIsFallback: odds === null || marketProbability === null,
    bestAngleHardBlockReason: hardBlockReason,
  });
  const grade =
    (gradeResult.grade === "lean" || gradeResult.grade === "best_angle") &&
    (edgePct === null || Math.abs(edgePct) < 5)
      ? "market_aligned"
      : gradeResult.grade;
  const baseBestAngleEligible = grade === "best_angle" && hardBlockReason === null;

  return {
    side,
    meanSide,
    rawProbabilitySide: rawOverProbability >= 0.5 ? "over" : "under",
    regularizedProbabilitySide: regularizedOverProbability >= 0.5 ? "over" : "under",
    rawOverProbability,
    regularizedOverProbability,
    calibratedOverProbability,
    modelProbability,
    marketProbability,
    edgePct,
    grade,
    predictionType: grade === "market_aligned" ? "market_aligned" : gradeResult.predictionType,
    noBetReason: gradeResult.noBetReason,
    marketAligned: grade === "market_aligned" || gradeResult.marketAligned,
    bestAngleReason: gradeResult.bestAngleReason,
    bestAngleBlocked: gradeResult.bestAngleBlocked,
    bestAngleBlockReason: gradeResult.bestAngleBlockReason,
    baseBestAngleEligible,
    requiresMarketConfirmation: baseBestAngleEligible && regularized.capApplied,
  };
}

function fitScoreGapCalibration(games: Game[], chronologyUniverse: Game[]): ScoreGapCalibration {
  const training = games.flatMap((game) => {
    if (chronologicalLabel(chronologyUniverse, game) !== "train") return [];
    const score = candidatePosterior(game, "arithmetic_preserve_margin");
    const line = totalLine(game);
    if (!score || line === null) return [];
    const actualTotal = game.home + game.away;
    if (actualTotal === line) return [];
    return [{ x: score.home + score.away - line, y: actualTotal > line ? 1 : 0 }];
  });
  const intercept = 0;
  let slope = 0;
  const learningRate = 0.08;
  const l2 = 0.02;
  for (let iteration = 0; iteration < 4_000; iteration++) {
    let gradSlope = 0;
    for (const row of training) {
      const z = Math.max(-20, Math.min(20, intercept + slope * row.x));
      const p = 1 / (1 + Math.exp(-z));
      gradSlope += (p - row.y) * row.x;
    }
    const n = Math.max(1, training.length);
    slope -= learningRate * (gradSlope / n + l2 * slope);
  }
  const trainPushesExcluded = games.filter((game) => {
    if (chronologicalLabel(chronologyUniverse, game) !== "train") return false;
    const line = totalLine(game);
    return line !== null && game.home + game.away === line;
  }).length;
  return { intercept, slope, trainGames: training.length, trainPushesExcluded };
}

function scoreGapTotalDecision(
  game: Game,
  calibration: ScoreGapCalibration,
): CandidateTotalDecision | null {
  const row = game.total;
  const score = candidatePosterior(game, "arithmetic_preserve_margin");
  const line = totalLine(game);
  if (!row || !score || line === null) return null;
  const z = Math.max(-20, Math.min(20,
    calibration.intercept + calibration.slope * (score.home + score.away - line),
  ));
  const overProbability = 1 / (1 + Math.exp(-z));
  const side: TotalSide = overProbability >= 0.5 ? "over" : "under";
  const modelProbability = side === "over" ? overProbability : 1 - overProbability;
  const noVig = totalNoVigProbability(game);
  const marketProbability = noVig === null ? null : side === "over" ? noVig.over : noVig.under;
  const edgePct = marketProbability === null
    ? null
    : Math.round((modelProbability - marketProbability) * 1_000) / 10;
  const odds = totalSideOdds(game, side);
  const audit = v22(row);
  const exclusion = obj(audit.evaluation_only_price_exclusion);
  const quality = qualityTier(game);
  const priorBlockReason = String(audit.ou_best_angle_block_reason ?? "");
  const neutralFallbackBlock = /key feature group/i.test(priorBlockReason);
  const hardBlockReason = odds === null || marketProbability === null
    ? "total requires real O/U odds (no fallback) for Best Angle"
    : exclusion.total_probability_regularization_excluded === true
      ? "evaluation-only Total price has no target-excluded forecast corroboration"
      : neutralFallbackBlock
        ? "key feature group on neutral fallback / missing for both sides"
        : null;
  const gradeResult = computePlayGrade({
    modelProb: modelProbability,
    marketProb: marketProbability,
    americanOdds: odds,
    dataQualityTier: quality,
    provisional: audit.provisional === true,
    isHeld: false,
    minBestAngleEdgePct: 5,
    minBestAngleConfidencePct: 56,
    marketProbIsFallback: odds === null || marketProbability === null,
    bestAngleHardBlockReason: hardBlockReason,
  });
  const grade =
    (gradeResult.grade === "lean" || gradeResult.grade === "best_angle") &&
    (edgePct === null || Math.abs(edgePct) < 5)
      ? "market_aligned"
      : gradeResult.grade;
  return {
    side,
    meanSide: score.home + score.away >= line ? "over" : "under",
    rawProbabilitySide: side,
    regularizedProbabilitySide: side,
    rawOverProbability: overProbability,
    regularizedOverProbability: overProbability,
    calibratedOverProbability: overProbability,
    modelProbability,
    marketProbability,
    edgePct,
    grade,
    predictionType: grade === "market_aligned" ? "market_aligned" : gradeResult.predictionType,
    noBetReason: gradeResult.noBetReason,
    marketAligned: grade === "market_aligned" || gradeResult.marketAligned,
    bestAngleReason: gradeResult.bestAngleReason,
    bestAngleBlocked: gradeResult.bestAngleBlocked,
    bestAngleBlockReason: gradeResult.bestAngleBlockReason,
    baseBestAngleEligible: grade === "best_angle" && hardBlockReason === null,
    requiresMarketConfirmation: false,
  };
}

function gradeBoardSummary(
  games: Game[],
  decision: (game: Game) => CandidateTotalDecision | null,
  chronologyUniverse: Game[] = games,
): Record<string, unknown> {
  const decisions = games.flatMap((game) => {
    const value = decision(game);
    const line = totalLine(game);
    if (!value || line === null) return [];
    return [{ game, value, row: {
      gameId: game.gameId,
      date: game.date,
      release: release(game.total),
      outcome: totalOutcome(value.side, line, game),
      odds: totalSideOdds(game, value.side),
    } satisfies PickRow }];
  });
  const grades = new Map<string, PickRow[]>();
  for (const item of decisions) {
    grades.set(item.value.grade, [...(grades.get(item.value.grade) ?? []), item.row]);
  }
  const meanProbabilityDivergence = decisions.filter(
    (item) => item.value.side !== item.value.meanSide,
  ).length;
  return {
    decisions: decisions.length,
    exactNoVigPriceCoverage: decisions.filter((item) => item.value.marketProbability !== null).length,
    meanProbabilityDivergence,
    rawProbabilityMeanDivergence: decisions.filter(
      (item) => item.value.rawProbabilitySide !== item.value.meanSide,
    ).length,
    regularizedProbabilityMeanDivergence: decisions.filter(
      (item) => item.value.regularizedProbabilitySide !== item.value.meanSide,
    ).length,
    regimeCalibrationSideFlips: decisions.filter(
      (item) => item.value.side !== item.value.regularizedProbabilitySide,
    ).length,
    baseBestAngleEligible: decisions.filter((item) => item.value.baseBestAngleEligible).length,
    requiresMarketConfirmation: decisions.filter(
      (item) => item.value.requiresMarketConfirmation,
    ).length,
    overall: metric(decisions.map((item) => item.row)),
    byGrade: Object.fromEntries(
      [...grades.entries()].sort((a, b) => b[1].length - a[1].length).map(
        ([grade, rows]) => [grade, {
          all: metric(rows),
          chronology: summarizeChronology(chronologyUniverse, rows),
        }],
      ),
    ),
  };
}

function bestAngleBoardImpact(
  games: Game[],
  chronologyUniverse: Game[],
  decision: (game: Game) => CandidateTotalDecision | null = candidateTotalDecision,
): Record<string, unknown> {
  const currentFinal: PickRow[] = [];
  const currentBase: PickRow[] = [];
  const candidateBase: PickRow[] = [];
  const promotedVsCurrentBase: PickRow[] = [];
  const demotedVsCurrentBase: PickRow[] = [];
  let overlapWithCurrentBase = 0;
  let overlapWithCurrentFinal = 0;

  for (const game of games) {
    const row = game.total;
    const line = totalLine(game);
    const candidate = decision(game);
    if (!row || line === null || !candidate) continue;
    const candidatePick: PickRow = {
      gameId: game.gameId,
      date: game.date,
      release: release(row),
      outcome: totalOutcome(candidate.side, line, game),
      odds: totalSideOdds(game, candidate.side),
    };
    const currentPick: PickRow | null = storedTotalSide(game) === null ? null : {
      gameId: game.gameId,
      date: game.date,
      release: release(row),
      outcome: totalOutcome(storedTotalSide(game)!, line, game),
      odds: totalSideOdds(game, storedTotalSide(game)!),
    };
    const currentBaseEligible = v22(row).ou_best_angle_eligible === true;
    const currentFinalEligible = row.best_angle === true;
    if (currentBaseEligible && currentPick) currentBase.push(currentPick);
    if (currentFinalEligible && currentPick) currentFinal.push(currentPick);
    if (candidate.baseBestAngleEligible) candidateBase.push(candidatePick);
    if (candidate.baseBestAngleEligible && currentBaseEligible) overlapWithCurrentBase++;
    if (candidate.baseBestAngleEligible && currentFinalEligible) overlapWithCurrentFinal++;
    if (candidate.baseBestAngleEligible && !currentBaseEligible) promotedVsCurrentBase.push(candidatePick);
    if (!candidate.baseBestAngleEligible && currentBaseEligible && currentPick) {
      demotedVsCurrentBase.push(currentPick);
    }
  }

  const summarize = (rows: PickRow[]) => ({
    all: metric(rows),
    chronology: summarizeChronology(chronologyUniverse, rows),
  });
  return {
    note: "Candidate counts are pure-model base eligibility before writer-time market confirmation, public-split checks, and total quality gates.",
    currentFinal: summarize(currentFinal),
    currentBaseEligible: summarize(currentBase),
    candidateBaseEligible: summarize(candidateBase),
    overlapWithCurrentBase,
    overlapWithCurrentFinal,
    promotedVsCurrentBase: summarize(promotedVsCurrentBase),
    demotedVsCurrentBase: summarize(demotedVsCurrentBase),
  };
}

function changedSides(games: Game[], candidate: (g: Game) => Side | null): Record<string, number> {
  let flips = 0, corrections = 0, harms = 0;
  for (const game of games) {
    const shipped = storedMlSide(game);
    const next = candidate(game);
    if (!shipped || !next || shipped === next) continue;
    flips++;
    const oldResult = mlOutcome(game, shipped);
    const newResult = mlOutcome(game, next);
    if (oldResult === "loss" && newResult === "win") corrections++;
    if (oldResult === "win" && newResult === "loss") harms++;
  }
  return { flips, corrections, harms, netCorrections: corrections - harms };
}

function totalFlipAudit(
  games: Game[],
  baseline: (g: Game) => TotalSide | null,
  candidate: (g: Game) => TotalSide | null,
): Record<string, unknown> {
  type Counts = { flips: number; corrections: number; harms: number; netCorrections: number };
  const empty = (): Counts => ({ flips: 0, corrections: 0, harms: 0, netCorrections: 0 });
  const overall = empty();
  const groups = new Map<string, Counts>();
  const add = (key: string, correction: boolean, harm: boolean): void => {
    const value = groups.get(key) ?? empty();
    value.flips++;
    if (correction) value.corrections++;
    if (harm) value.harms++;
    value.netCorrections = value.corrections - value.harms;
    groups.set(key, value);
  };
  for (const game of games) {
    const before = baseline(game);
    const after = candidate(game);
    const line = totalLine(game);
    if (!before || !after || line === null || before === after) continue;
    const beforeResult = totalOutcome(before, line, game);
    const afterResult = totalOutcome(after, line, game);
    const correction = beforeResult === "loss" && afterResult === "win";
    const harm = beforeResult === "win" && afterResult === "loss";
    overall.flips++;
    if (correction) overall.corrections++;
    if (harm) overall.harms++;
    overall.netCorrections = overall.corrections - overall.harms;
    const audit = v22(game.total);
    const movement = String(obj(snapshot(game.total).line_movement).direction ?? "unknown");
    const starter = obj(obj(audit.feature_capture).starter);
    const homeEra = num(obj(starter.home).season_era);
    const awayEra = num(obj(starter.away).season_era);
    const avgEra = homeEra !== null && awayEra !== null ? (homeEra + awayEra) / 2 : null;
    const factors = obj(obj(audit.feature_capture).factors);
    const bullpenHome = num(obj(factors.home).bullpen_factor_opp);
    const bullpenAway = num(obj(factors.away).bullpen_factor_opp);
    const avgBullpen = bullpenHome !== null && bullpenAway !== null ? (bullpenHome + bullpenAway) / 2 : null;
    const categories = [
      `baseline_side:${before}`,
      `grade:${String(game.total?.play_grade ?? "missing")}`,
      `market_aligned:${String(game.total?.market_aligned ?? "missing")}`,
      `movement:${movement}`,
      `quality:${String(audit.data_quality_tier ?? "unknown")}`,
      `starter:${avgEra === null ? "missing" : avgEra <= 3.75 ? "good" : avgEra >= 4.75 ? "bad" : "neutral"}`,
      `bullpen:${avgBullpen === null ? "missing" : avgBullpen <= 0.95 ? "strong" : avgBullpen >= 1.05 ? "weak" : "neutral"}`,
    ];
    for (const category of categories) add(category, correction, harm);
  }
  return {
    overall,
    cohorts: Object.fromEntries([...groups.entries()].sort((a, b) => Math.abs(b[1].netCorrections) - Math.abs(a[1].netCorrections))),
  };
}

function arrayOfObjects(value: unknown): Record<string, unknown>[] {
  return Array.isArray(value) ? value.map(obj).filter((item) => Object.keys(item).length > 0) : [];
}

function qualityTier(game: Game): "high" | "medium" | "low" | "fallback" {
  const value = String(v22(game.total ?? game.ml).data_quality_tier ?? "fallback");
  return value === "high" || value === "medium" || value === "low" ? value : "fallback";
}

function predictionFromSnapshot(
  game: Game,
  candidate: boolean,
  scoreGapCalibration: ScoreGapCalibration | null = null,
): WriterPrediction | null {
  const sourceRow = game.total ?? game.ml;
  if (!sourceRow) return null;
  const sourceSnapshot = snapshot(sourceRow);
  const sourceV22 = v22(sourceRow);
  const framework = obj(sourceSnapshot.framework_grades_at_lock);
  const baselineScores = storedPosteriorScore(game);
  const baselineTotalSide = String(obj(sourceSnapshot.total_projection_reconciliation).reconciled_total_side);
  const mlProb = num(sourceV22.ml_model_prob);
  const baselineOuProb = num(sourceV22.ou_model_prob);
  const margin = num(sourceV22.posterior_home_diff);
  if (
    !baselineScores || mlProb === null || baselineOuProb === null || margin === null ||
    (baselineTotalSide !== "over" && baselineTotalSide !== "under")
  ) return null;

  let scores = baselineScores;
  let totalSide = baselineTotalSide as TotalSide;
  let ouProb = baselineOuProb;
  let sportSpecific = { ...sourceSnapshot };
  if (candidate) {
    const candidateScores = candidatePosterior(game, "arithmetic_preserve_margin");
    const independent = inningsWeightedIndependent(game, "arithmetic_preserve_margin");
    const decision = scoreGapCalibration === null
      ? candidateTotalDecision(game)
      : scoreGapTotalDecision(game, scoreGapCalibration);
    const line = totalLine(game);
    const noVig = totalNoVigProbability(game);
    if (!candidateScores || !independent || !decision || line === null) return null;
    const reconciliation = reconcileTotalProjection({
      rawProjectedAwayScore: candidateScores.away,
      rawProjectedHomeScore: candidateScores.home,
      rawProjectedTotal: candidateScores.home + candidateScores.away,
      marketTotal: line,
      rawProbabilityOver: decision.calibratedOverProbability,
      marketImpliedOver: noVig?.over ?? null,
      marketPressureSide: null,
      isLocked: false,
      lockedReconciliation: null,
    });
    const originalCalibration = obj(sourceV22.total_regime_calibration);
    const preRegimeSide: TotalSide = decision.regularizedOverProbability >= 0.5 ? "over" : "under";
    const rawPickedProbability = decision.rawProbabilitySide === "over"
      ? decision.rawOverProbability
      : 1 - decision.rawOverProbability;
    const regularizedPickedProbability = preRegimeSide === "over"
      ? decision.regularizedOverProbability
      : 1 - decision.regularizedOverProbability;
    const rawMarketProbability = noVig === null
      ? null
      : decision.rawProbabilitySide === "over" ? noVig.over : noVig.under;
    const regularizedMarketProbability = noVig === null
      ? null
      : preRegimeSide === "over" ? noVig.over : noVig.under;
    const rawEdge = rawMarketProbability === null
      ? null
      : Math.round((rawPickedProbability - rawMarketProbability) * 1_000) / 10;
    const regularizedEdge = regularizedMarketProbability === null
      ? null
      : Math.round((regularizedPickedProbability - regularizedMarketProbability) * 1_000) / 10;
    const candidateV22 = {
      ...sourceV22,
      independent_home_runs: independent.home,
      independent_away_runs: independent.away,
      independent_total: independent.home + independent.away,
      independent_home_diff: independent.home - independent.away,
      innings_weighted_total_preserve_margin_enabled: true,
      innings_weighted_total_preserve_margin_applied: true,
      innings_weighted_total_preserve_margin_legacy_total:
        num(sourceV22.independent_total),
      innings_weighted_total_preserve_margin_candidate_total:
        independent.home + independent.away,
      posterior_home_runs: candidateScores.home,
      posterior_away_runs: candidateScores.away,
      posterior_total: candidateScores.home + candidateScores.away,
      posterior_home_diff: candidateScores.home - candidateScores.away,
      ou_raw_model_prob: rawPickedProbability,
      ou_raw_edge_pct: rawEdge,
      ou_regularized_model_prob: regularizedPickedProbability,
      ou_regularized_edge_pct: regularizedEdge,
      ou_model_prob: decision.modelProbability,
      ou_market_prob: decision.marketProbability,
      ou_edge_pct: decision.edgePct,
      ou_play_grade: decision.grade,
      ou_prediction_type: decision.predictionType,
      ou_best_angle_eligible: decision.baseBestAngleEligible,
      ou_no_bet_reason: decision.noBetReason,
      ou_market_aligned: decision.marketAligned,
      ou_best_angle_reason: decision.bestAngleReason,
      ou_best_angle_blocked: decision.bestAngleBlocked,
      ou_best_angle_block_reason: decision.bestAngleBlockReason,
      ou_requires_market_confirmation: decision.requiresMarketConfirmation,
      total_regime_calibration: {
        ...originalCalibration,
        applied: scoreGapCalibration === null && originalCalibration.applied === true,
        reason: scoreGapCalibration === null
          ? originalCalibration.reason
          : "replaced_by_train_only_independent_score_gap_logistic_head",
        modelOverProbabilityBefore: decision.regularizedOverProbability,
        modelOverProbabilityAfter: decision.calibratedOverProbability,
      },
    };
    sportSpecific = {
      ...sportSpecific,
      v2_2_audit: candidateV22,
      ou_play_grade: decision.grade,
      ou_prediction_type: decision.predictionType,
      ou_best_angle_eligible: decision.baseBestAngleEligible,
      ou_no_bet_reason: decision.noBetReason,
      ou_market_aligned: decision.marketAligned,
      ou_best_angle_reason: decision.bestAngleReason,
      v2_best_angle_eligible:
        sourceSnapshot.ml_best_angle_eligible === true || decision.baseBestAngleEligible,
      total_projection_reconciliation: reconciliation,
    };
    scores = candidateScores;
    totalSide = reconciliation.reconciled_total_side;
    ouProb = decision.modelProbability;
  }

  const mlConfidence = computeConfidence({
    win_prob: mlProb,
    ou_prob: ouProb,
    run_diff_abs: Math.abs(margin),
    tier: qualityTier(game),
  });
  const line = totalLine(game);
  const ouConfidence = computeConfidence({
    win_prob: ouProb,
    ou_prob: ouProb,
    run_diff_abs: line === null ? 0 : Math.abs(scores.home + scores.away - line),
    tier: qualityTier(game),
  });
  const evidence = obj(sourceSnapshot.mlb_fullgame_market_evidence_v1);
  const computedAt = typeof evidence.model_cycle_at === "string"
    ? evidence.model_cycle_at
    : sourceRow.published_at;
  return {
    id: sourceRow.id,
    game_id: game.gameId,
    predicted_ml_winner: margin >= 0 ? "home" : "away",
    ml_confidence: Math.round(mlConfidence * 10) / 10,
    predicted_ou_side: totalSide,
    ou_confidence: Math.round(ouConfidence * 10) / 10,
    predicted_nrfi: null,
    nrfi_confidence: null,
    prediction_source: String(sourceSnapshot.model_used ?? "auto_v2.2_mlb_full_game_projection"),
    is_override: false,
    locked_at: sourceRow.locked_at,
    computed_at: computedAt,
    sport_specific: sportSpecific,
    predicted_home_score: scores.home,
    predicted_away_score: scores.away,
    ml_grade: typeof framework.ml_grade === "string" ? framework.ml_grade : null,
    ou_grade: typeof framework.ou_grade === "string" ? framework.ou_grade : null,
    nrfi_grade: null,
    ml_signal_type: typeof framework.ml_signal_type === "string" ? framework.ml_signal_type : null,
    ou_signal_type: typeof framework.ou_signal_type === "string" ? framework.ou_signal_type : null,
    nrfi_signal_type: null,
    ml_market_signal: typeof framework.ml_market_signal === "string" ? framework.ml_market_signal : null,
    ou_market_signal: typeof framework.ou_market_signal === "string" ? framework.ou_market_signal : null,
    nrfi_market_signal: null,
  };
}

async function loadWriterGames(games: Game[]): Promise<Map<number, WriterGame>> {
  const output = new Map<number, WriterGame>();
  const ids = games.map((game) => game.gameId);
  for (let start = 0; start < ids.length; start += 400) {
    const { data, error } = await supabase
      .from("games")
      .select("id,external_id,game_date,slate_status,home_team_id,away_team_id")
      .in("id", ids.slice(start, start + 400));
    if (error) throw new Error(`games read failed: ${error.message}`);
    for (const row of data ?? []) output.set(row.id, row as WriterGame);
  }
  return output;
}

async function loadTeamAbbreviations(writerGames: Map<number, WriterGame>): Promise<Map<number, string>> {
  const ids = [...new Set([...writerGames.values()].flatMap((game) => [game.home_team_id, game.away_team_id]))];
  const output = new Map<number, string>();
  for (let start = 0; start < ids.length; start += 400) {
    const { data, error } = await supabase
      .from("teams")
      .select("id,abbreviation")
      .in("id", ids.slice(start, start + 400));
    if (error) throw new Error(`teams read failed: ${error.message}`);
    for (const row of data ?? []) output.set(row.id, row.abbreviation ?? "?");
  }
  return output;
}

function writerEvidence(game: Game): {
  lines: WriterLine[];
  openers: WriterOpener[];
  signals: WriterSignal[];
  splits: WriterSplit[];
} {
  const snapshots = [snapshot(game.ml), snapshot(game.total)];
  const lines = arrayOfObjects(snapshots[0].lines_at_lock ?? snapshots[1].lines_at_lock) as WriterLine[];
  const signals = arrayOfObjects(snapshots[0].signal_rows_at_lock ?? snapshots[1].signal_rows_at_lock) as WriterSignal[];
  const splits = arrayOfObjects(
    snapshots[0].source_aware_split_rows_at_lock ?? snapshots[1].source_aware_split_rows_at_lock,
  ).map((row) => ({
    ...row,
    canonical_event_id: String(row.canonical_event_id ?? ""),
  })) as WriterSplit[];
  const seen = new Set<string>();
  const openers: WriterOpener[] = [];
  for (const snap of snapshots) {
    const evidence = obj(snap.mlb_fullgame_market_evidence_v1);
    for (const pair of arrayOfObjects(evidence.named_book_pairs)) {
      const opening = obj(pair.opening);
      const current = obj(pair.current);
      const identity = String(pair.identity ?? "");
      const marketType = identity.split(":")[0];
      const sportsbook = String(pair.sportsbook ?? pair.normalized_sportsbook ?? "");
      const lineValue = num(opening.line) ?? num(pair.line);
      const sides = [
        { side: String(current.positive_side ?? ""), odds: num(opening.positive_odds_american), at: opening.positive_observed_at },
        { side: String(current.negative_side ?? ""), odds: num(opening.negative_odds_american), at: opening.negative_observed_at },
      ];
      for (const value of sides) {
        if (!marketType || !sportsbook || !value.side || value.odds === null) continue;
        const key = `${marketType}:${sportsbook}:${lineValue}:${value.side}`;
        if (seen.has(key)) continue;
        seen.add(key);
        openers.push({
          game_id: game.gameId,
          market_type: marketType,
          side: value.side,
          sportsbook,
          odds_american: value.odds,
          line_value: lineValue,
          recorded_at: typeof value.at === "string" ? value.at : null,
        } as WriterOpener);
      }
    }
  }
  return { lines, openers, signals, splits };
}

type WriterRecord = ReturnType<typeof buildPredictionRecordsFromSlate>[number];

function recordMetric(gamesById: Map<number, Game>, records: WriterRecord[]): Metric {
  const rows = records.flatMap((record) => {
    const game = gamesById.get(record.game_id);
    if (!game || (record.side !== "over" && record.side !== "under")) return [];
    const line = record.line_value;
    if (line === null) return [];
    return [{
      gameId: game.gameId,
      date: game.date,
      release: "current_writer_replay",
      outcome: totalOutcome(record.side, line, game),
      odds: record.odds_american,
    } satisfies PickRow];
  });
  return metric(rows);
}

async function currentWriterReplay(games: Game[], chronologyUniverse: Game[]): Promise<Record<string, unknown>> {
  const writerGames = await loadWriterGames(games);
  const abbreviations = await loadTeamAbbreviations(writerGames);
  const gamesById = new Map(games.map((game) => [game.gameId, game]));
  const scoreGapCalibration = fitScoreGapCalibration(games, chronologyUniverse);
  const baselineRecords: WriterRecord[] = [];
  const structuralRecords: WriterRecord[] = [];
  const candidateRecords: WriterRecord[] = [];
  const omitted = { missingGame: 0, missingBaseline: 0, missingCandidate: 0, missingLines: 0 };
  const dates = [...new Set(games.map((game) => game.date))].sort();
  for (const date of dates) {
    const slate = games.filter((game) => game.date === date);
    const slateGames: WriterGame[] = [];
    const baselinePredictions = new Map<number, WriterPrediction>();
    const structuralPredictions = new Map<number, WriterPrediction>();
    const candidatePredictions = new Map<number, WriterPrediction>();
    const oddsByGameId = new Map<number, ReturnType<typeof buildGameOddsSnapshot>>();
    const linesByGameId = new Map<number, ReadonlyArray<WriterLine>>();
    const openersByGameId = new Map<number, ReadonlyArray<WriterOpener>>();
    const signalsByGameId = new Map<number, ReadonlyArray<WriterSignal>>();
    const splitsByGameId = new Map<number, ReadonlyArray<WriterSplit>>();
    for (const game of slate) {
      const writerGame = writerGames.get(game.gameId);
      const baseline = predictionFromSnapshot(game, false);
      const structural = predictionFromSnapshot(game, true);
      const candidate = predictionFromSnapshot(game, true, scoreGapCalibration);
      const evidence = writerEvidence(game);
      if (!writerGame) { omitted.missingGame++; continue; }
      if (!baseline) { omitted.missingBaseline++; continue; }
      if (!structural || !candidate) { omitted.missingCandidate++; continue; }
      if (evidence.lines.length === 0) { omitted.missingLines++; continue; }
      slateGames.push(writerGame);
      baselinePredictions.set(game.gameId, baseline);
      structuralPredictions.set(game.gameId, structural);
      candidatePredictions.set(game.gameId, candidate);
      const startMs = writerGame.game_date === null ? undefined : Date.parse(writerGame.game_date) - 60 * 60 * 1_000;
      oddsByGameId.set(game.gameId, buildGameOddsSnapshot(evidence.lines, {
        gameId: game.gameId,
        freshnessReferenceMs: startMs !== undefined && Number.isFinite(startMs) ? startMs : undefined,
      }));
      linesByGameId.set(game.gameId, evidence.lines);
      openersByGameId.set(game.gameId, evidence.openers);
      signalsByGameId.set(game.gameId, evidence.signals);
      splitsByGameId.set(game.gameId, evidence.splits);
    }
    const common = {
      sport: "mlb" as const,
      slateDate: date,
      launchDay: false,
      games: slateGames,
      abbrevByTeamId: abbreviations,
      signalsByGameId,
      oddsByGameId,
      openersByGameId,
      currentLinesByGameId: linesByGameId,
      sourceAwareSplitsByGameId: splitsByGameId,
    };
    baselineRecords.push(...buildPredictionRecordsFromSlate({ ...common, predictionByGameId: baselinePredictions }));
    structuralRecords.push(...buildPredictionRecordsFromSlate({ ...common, predictionByGameId: structuralPredictions }));
    candidateRecords.push(...buildPredictionRecordsFromSlate({ ...common, predictionByGameId: candidatePredictions }));
  }
  const total = (records: WriterRecord[]) => records.filter((record) => record.market === "total");
  const ml = (records: WriterRecord[]) => records.filter((record) => record.market === "moneyline");
  const actionable = (record: WriterRecord) =>
    !record.held && !record.no_bet && (record.play_grade === "lean" || record.play_grade === "best_angle");
  const baseTotals = total(baselineRecords);
  const structuralTotals = total(structuralRecords);
  const candidateTotals = total(candidateRecords);
  const baseMl = ml(baselineRecords);
  const candidateMl = ml(candidateRecords);
  const baseByKey = new Map(baselineRecords.map((record) => [`${record.game_id}:${record.market}`, record]));
  const candidateByKey = new Map(candidateRecords.map((record) => [`${record.game_id}:${record.market}`, record]));
  const deltas = { totalSideFlips: 0, totalCorrections: 0, totalHarms: 0, totalPromotions: 0, totalDemotions: 0, mlSideChanges: 0, mlGradeChanges: 0 };
  const promoted: WriterRecord[] = [];
  const demoted: WriterRecord[] = [];
  for (const [key, before] of baseByKey) {
    const after = candidateByKey.get(key);
    if (!after) continue;
    if (before.market === "moneyline") {
      if (before.side !== after.side) deltas.mlSideChanges++;
      if (before.play_grade !== after.play_grade || before.best_angle !== after.best_angle || before.no_bet !== after.no_bet) {
        deltas.mlGradeChanges++;
      }
      continue;
    }
    const game = gamesById.get(before.game_id);
    if (before.side !== after.side && game && before.line_value !== null && after.line_value !== null &&
      (before.side === "over" || before.side === "under") && (after.side === "over" || after.side === "under")) {
      deltas.totalSideFlips++;
      const oldOutcome = totalOutcome(before.side, before.line_value, game);
      const newOutcome = totalOutcome(after.side, after.line_value, game);
      if (oldOutcome === "loss" && newOutcome === "win") deltas.totalCorrections++;
      if (oldOutcome === "win" && newOutcome === "loss") deltas.totalHarms++;
    }
    if (!actionable(before) && actionable(after)) { deltas.totalPromotions++; promoted.push(after); }
    if (actionable(before) && !actionable(after)) { deltas.totalDemotions++; demoted.push(before); }
  }
  const byGrade = (records: WriterRecord[]) => Object.fromEntries(
    [...new Set(records.map((record) => record.play_grade ?? "ungraded"))].sort().map((grade) => [
      grade,
      recordMetric(gamesById, records.filter((record) => (record.play_grade ?? "ungraded") === grade)),
    ]),
  );
  const chronology = (records: WriterRecord[]) => Object.fromEntries(
    (["train", "validation", "holdout"] as const).map((part) => [part, recordMetric(
      gamesById,
      records.filter((record) => {
        const game = gamesById.get(record.game_id);
        return game !== undefined && chronologicalLabel(chronologyUniverse, game) === part;
      }),
    )]),
  );
  const compactCandidate = (records: WriterRecord[]) => ({
    totals: recordMetric(gamesById, records),
    actionableTotals: recordMetric(gamesById, records.filter(actionable)),
    bestAngleTotals: recordMetric(gamesById, records.filter((record) => record.best_angle)),
    chronology: chronology(records),
    board: {
      rows: records.length,
      actionable: records.filter(actionable).length,
      bestAngles: records.filter((record) => record.best_angle).length,
    },
  });
  const diagnosticRows = candidateTotals.flatMap((record) => {
    const game = gamesById.get(record.game_id);
    const score = game ? candidatePosterior(game, "arithmetic_preserve_margin") : null;
    if (!game || !score || record.line_value === null) return [];
    return [{ record, gap: score.home + score.away - record.line_value }];
  });
  const diagnostic = (filter: (row: typeof diagnosticRows[number]) => boolean) => {
    const records = diagnosticRows.filter(filter).map((row) => row.record);
    return { all: recordMetric(gamesById, records), chronology: chronology(records) };
  };
  return {
    contract: "current production writer replayed read-only over frozen lock evidence; current r91 writer applied equally to incumbent and train-only score-gap candidate",
    scoreGapCalibration: {
      ...scoreGapCalibration,
      intercept: round(scoreGapCalibration.intercept, 6),
      slope: round(scoreGapCalibration.slope, 6),
      trainingPolicy: "fit only on the first chronological block; validation and holdout are untouched",
    },
    eligibleGames: games.length,
    replayedGames: new Set(candidateTotals.map((record) => record.game_id)).size,
    omitted,
    structuralPoissonRegimeCandidate: {
      note: "innings-weighted score repair with the incumbent Poisson, market regularization, and totals-regime probability stack",
      ...compactCandidate(structuralTotals),
    },
    deltas: { ...deltas, netTotalCorrections: deltas.totalCorrections - deltas.totalHarms },
    incumbent: {
      totals: recordMetric(gamesById, baseTotals),
      totalsByGrade: byGrade(baseTotals),
      actionableTotals: recordMetric(gamesById, baseTotals.filter(actionable)),
      bestAngleTotals: recordMetric(gamesById, baseTotals.filter((record) => record.best_angle)),
      chronology: chronology(baseTotals),
    },
    candidate: {
      totals: recordMetric(gamesById, candidateTotals),
      totalsByGrade: byGrade(candidateTotals),
      actionableTotals: recordMetric(gamesById, candidateTotals.filter(actionable)),
      bestAngleTotals: recordMetric(gamesById, candidateTotals.filter((record) => record.best_angle)),
      chronology: chronology(candidateTotals),
    },
    boardImpact: {
      incumbentTotalRows: baseTotals.length,
      candidateTotalRows: candidateTotals.length,
      incumbentActionable: baseTotals.filter(actionable).length,
      candidateActionable: candidateTotals.filter(actionable).length,
      incumbentBestAngles: baseTotals.filter((record) => record.best_angle).length,
      candidateBestAngles: candidateTotals.filter((record) => record.best_angle).length,
      promoted: recordMetric(gamesById, promoted),
      demoted: recordMetric(gamesById, demoted),
    },
    moneylineIntegrity: {
      incumbentRows: baseMl.length,
      candidateRows: candidateMl.length,
      sideChanges: deltas.mlSideChanges,
      gradeOrActionChanges: deltas.mlGradeChanges,
    },
    candidateDiagnostics: {
      byAbsoluteScoreGap: {
        lt0_5: diagnostic((row) => Math.abs(row.gap) < 0.5),
        from0_5To1: diagnostic((row) => Math.abs(row.gap) >= 0.5 && Math.abs(row.gap) < 1),
        from1To1_5: diagnostic((row) => Math.abs(row.gap) >= 1 && Math.abs(row.gap) < 1.5),
        gte1_5: diagnostic((row) => Math.abs(row.gap) >= 1.5),
      },
      byScoreSide: {
        over: diagnostic((row) => row.gap >= 0),
        under: diagnostic((row) => row.gap < 0),
      },
      candidateActionable: diagnostic((row) => actionable(row.record)),
      candidateNonActionable: diagnostic((row) => !actionable(row.record)),
    },
  };
}

function markdown(report: Record<string, unknown>): string {
  const lines = [
    "# MLB foundational scoreboard",
    "",
    `Generated: ${String(report.generatedAt)}`,
    "",
    "This is a read-only replay over immutable locked snapshots. Historical releases are not relabeled as current-model performance.",
    "",
    "## Headline",
    "",
    "```json",
    JSON.stringify({
      games: report.games,
      scoreModels: report.scoreModels,
      moneyline: report.moneyline,
      runLineDerived: report.runLineDerived,
      totals: report.totals,
      currentWriterReplay: report.currentWriterReplay,
      competitor: report.competitor,
      coverage: report.coverage,
    }, null, 2),
    "```",
    "",
  ];
  return lines.join("\n");
}

async function main(): Promise<void> {
  const options = args();
  const rows = await loadRows(options.from, options.to);
  const games = gamesFromRows(rows);
  const chronologyWindows = Object.fromEntries(
    (["train", "validation", "holdout"] as const).map((part) => {
      const values = games.filter((game) => chronologicalLabel(games, game) === part);
      return [part, {
        games: values.length,
        from: values[0]?.date ?? null,
        to: values[values.length - 1]?.date ?? null,
      }];
    }),
  );

  const scoreModels = {
    storedPosterior: scoreRule(games, (game) => {
      const audit = v22(game.ml ?? game.total);
      const home = num(audit.posterior_home_runs);
      const away = num(audit.posterior_away_runs);
      return home !== null && away !== null ? { home, away } : null;
    }),
    storedIndependent: scoreRule(games, (game) => {
      const audit = v22(game.ml ?? game.total);
      const home = num(audit.independent_home_runs);
      const away = num(audit.independent_away_runs);
      return home !== null && away !== null ? { home, away } : null;
    }),
    arithmeticInningsIndependent: scoreRule(games, (game) => inningsWeightedIndependent(game, "arithmetic")),
    geometricInningsIndependent: scoreRule(games, (game) => inningsWeightedIndependent(game, "geometric")),
    arithmeticInningsPreserveMarginIndependent: scoreRule(games, (game) => inningsWeightedIndependent(game, "arithmetic_preserve_margin")),
    arithmeticInningsPosterior: scoreRule(games, (game) => candidatePosterior(game, "arithmetic")),
    geometricInningsPosterior: scoreRule(games, (game) => candidatePosterior(game, "geometric")),
    arithmeticInningsPreserveMarginPosterior: scoreRule(games, (game) => candidatePosterior(game, "arithmetic_preserve_margin")),
  };

  const mlRules = {
    shipped: picksByRule(games, storedMlSide, mlOutcome),
    storedPosteriorDirection: picksByRule(games, (g) => projectedMlSide(g, "posterior_home_diff"), mlOutcome),
    storedIndependentDirection: picksByRule(games, (g) => projectedMlSide(g, "independent_home_diff"), mlOutcome),
    marketFavorite: picksByRule(games, marketMlSide, mlOutcome),
    arithmeticInningsPosterior: picksByRule(games, (g) => candidateSide(g, "arithmetic"), mlOutcome),
    geometricInningsPosterior: picksByRule(games, (g) => candidateSide(g, "geometric"), mlOutcome),
    arithmeticInningsPreserveMarginPosterior: picksByRule(games, (g) => candidateSide(g, "arithmetic_preserve_margin"), mlOutcome),
  };

  const runLineRules: Record<string, PickRow[]> = {};
  for (const [name, sideFn] of Object.entries({
    shippedMlSide: storedMlSide,
    storedIndependentSide: (g: Game) => projectedMlSide(g, "independent_home_diff"),
    marketFavoriteSide: marketMlSide,
    arithmeticInningsPosteriorSide: (g: Game) => candidateSide(g, "arithmetic"),
    inningsWeightedRunLineProbabilitySide: candidateRunLineSide,
  })) {
    for (const shift of [0, 1, 2]) {
      runLineRules[`${name}${shift ? `Plus${shift}` : ""}`] = picksByRule(
        games,
        sideFn,
        (game, side) => {
          const line = lineForSelectedRunLine(game, side);
          return line === null ? "push" : handicapOutcome(side, line + shift, game);
        },
      ).filter((row) => {
        const game = games.find((g) => g.gameId === row.gameId)!;
        const side = sideFn(game);
        return side !== null && lineForSelectedRunLine(game, side) !== null;
      }).map((row) => ({ ...row, odds: null }));
    }
  }

  const totalRules = {
    shipped: totalsByRule(games, storedTotalSide),
    shippedPlus1: totalsByRule(games, storedTotalSide, 1),
    shippedPlus2: totalsByRule(games, storedTotalSide, 2),
    storedPosteriorDirection: totalsByRule(games, (g) => projectionTotalSide(g, "posterior_total")),
    storedIndependentDirection: totalsByRule(games, (g) => projectionTotalSide(g, "independent_total")),
    storedV22RawProbabilityDirection: totalsByRule(games, (g) => reconciliationTotalSide(g, "raw_probability_side")),
    storedReconciliationMeanDirection: totalsByRule(games, (g) => reconciliationTotalSide(g, "mean_direction_side")),
    storedReconciliationHolisticDirection: totalsByRule(games, (g) => reconciliationTotalSide(g, "holistic_side")),
    storedReconciledDirection: totalsByRule(games, (g) => reconciliationTotalSide(g, "reconciled_total_side")),
    totalMarketPriceSide: totalsByRule(games, totalMarketPriceSide),
    regularizedQuarterDirection: totalsByRule(games, regularizedQuarterTotalSide),
    regularizedQuarterPlus1: totalsByRule(games, regularizedQuarterTotalSide, 1),
    regularizedQuarterPlus2: totalsByRule(games, regularizedQuarterTotalSide, 2),
    arithmeticInningsPosterior: totalsByRule(games, (g) => candidateTotalSide(g, "arithmetic")),
    arithmeticInningsPosteriorPlus1: totalsByRule(games, (g) => candidateTotalSide(g, "arithmetic"), 1),
    arithmeticInningsPosteriorPlus2: totalsByRule(games, (g) => candidateTotalSide(g, "arithmetic"), 2),
    arithmeticInningsPreserveMarginPosterior: totalsByRule(games, (g) => candidateTotalSide(g, "arithmetic_preserve_margin")),
    arithmeticInningsPreserveMarginPosteriorPlus1: totalsByRule(games, (g) => candidateTotalSide(g, "arithmetic_preserve_margin"), 1),
    arithmeticInningsPreserveMarginPosteriorPlus2: totalsByRule(games, (g) => candidateTotalSide(g, "arithmetic_preserve_margin"), 2),
    inningsWeightedCandidateModelLayer: totalsByRule(games, (g) => candidateTotalDecision(g)?.side ?? null),
    inningsWeightedCandidateModelLayerPlus1: totalsByRule(games, (g) => candidateTotalDecision(g)?.side ?? null, 1),
    inningsWeightedCandidateModelLayerPlus2: totalsByRule(games, (g) => candidateTotalDecision(g)?.side ?? null, 2),
    inningsWeightedCandidateRawProbability: totalsByRule(games, (g) => candidateTotalDecision(g)?.rawProbabilitySide ?? null),
    inningsWeightedCandidateRegularizedProbability: totalsByRule(games, (g) => candidateTotalDecision(g)?.regularizedProbabilitySide ?? null),
    storedPosteriorPushNormalizedRawProbability: totalsByRule(
      games,
      (g) => pushNormalizedTotalDecision(g, storedPosteriorScore(g))?.rawSide ?? null,
    ),
    storedPosteriorPushNormalizedRegularizedProbability: totalsByRule(
      games,
      (g) => pushNormalizedTotalDecision(g, storedPosteriorScore(g))?.regularizedSide ?? null,
    ),
    storedPosteriorPushNormalizedCalibratedProbability: totalsByRule(
      games,
      (g) => pushNormalizedTotalDecision(g, storedPosteriorScore(g))?.calibratedSide ?? null,
    ),
    inningsWeightedCandidatePushNormalizedRawProbability: totalsByRule(
      games,
      (g) => pushNormalizedTotalDecision(g, candidatePosterior(g, "arithmetic_preserve_margin"))?.rawSide ?? null,
    ),
    inningsWeightedCandidatePushNormalizedRegularizedProbability: totalsByRule(
      games,
      (g) => pushNormalizedTotalDecision(g, candidatePosterior(g, "arithmetic_preserve_margin"))?.regularizedSide ?? null,
    ),
    inningsWeightedCandidatePushNormalizedCalibratedProbability: totalsByRule(
      games,
      (g) => pushNormalizedTotalDecision(g, candidatePosterior(g, "arithmetic_preserve_margin"))?.calibratedSide ?? null,
    ),
  };

  const pack = (rules: Record<string, PickRow[]>) => Object.fromEntries(Object.entries(rules).map(([name, values]) => [name, {
    all: metric(values),
    chronology: summarizeChronology(games, values),
    byRelease: byRelease(values),
  }]));

  const richGames = games.filter((game) => inningsWeightedIndependent(game, "arithmetic") !== null).length;
  const candidateGames = games.filter((game) => candidatePosterior(game, "arithmetic_preserve_margin") !== null).length;
  const candidateCohort = games.filter((game) => candidatePosterior(game, "arithmetic_preserve_margin") !== null);
  const pairedMoneylineRules = {
    shipped: picksByRule(candidateCohort, storedMlSide, mlOutcome),
    storedPosteriorDirection: picksByRule(candidateCohort, (g) => projectedMlSide(g, "posterior_home_diff"), mlOutcome),
    arithmeticInningsPreserveMarginPosterior: picksByRule(candidateCohort, (g) => candidateSide(g, "arithmetic_preserve_margin"), mlOutcome),
  };
  const pairedTotalRules = {
    shipped: totalsByRule(candidateCohort, storedTotalSide),
    storedPosteriorDirection: totalsByRule(candidateCohort, (g) => projectionTotalSide(g, "posterior_total")),
    arithmeticInningsPreserveMarginPosterior: totalsByRule(candidateCohort, (g) => candidateTotalSide(g, "arithmetic_preserve_margin")),
    inningsWeightedCandidateModelLayer: totalsByRule(candidateCohort, (g) => candidateTotalDecision(g)?.side ?? null),
    inningsWeightedCandidateRawProbability: totalsByRule(candidateCohort, (g) => candidateTotalDecision(g)?.rawProbabilitySide ?? null),
    inningsWeightedCandidateRegularizedProbability: totalsByRule(candidateCohort, (g) => candidateTotalDecision(g)?.regularizedProbabilitySide ?? null),
    storedPosteriorPushNormalizedRawProbability: totalsByRule(
      candidateCohort,
      (g) => pushNormalizedTotalDecision(g, storedPosteriorScore(g))?.rawSide ?? null,
    ),
    storedPosteriorPushNormalizedRegularizedProbability: totalsByRule(
      candidateCohort,
      (g) => pushNormalizedTotalDecision(g, storedPosteriorScore(g))?.regularizedSide ?? null,
    ),
    storedPosteriorPushNormalizedCalibratedProbability: totalsByRule(
      candidateCohort,
      (g) => pushNormalizedTotalDecision(g, storedPosteriorScore(g))?.calibratedSide ?? null,
    ),
    inningsWeightedCandidatePushNormalizedRawProbability: totalsByRule(
      candidateCohort,
      (g) => pushNormalizedTotalDecision(g, candidatePosterior(g, "arithmetic_preserve_margin"))?.rawSide ?? null,
    ),
    inningsWeightedCandidatePushNormalizedRegularizedProbability: totalsByRule(
      candidateCohort,
      (g) => pushNormalizedTotalDecision(g, candidatePosterior(g, "arithmetic_preserve_margin"))?.regularizedSide ?? null,
    ),
    inningsWeightedCandidatePushNormalizedCalibratedProbability: totalsByRule(
      candidateCohort,
      (g) => pushNormalizedTotalDecision(g, candidatePosterior(g, "arithmetic_preserve_margin"))?.calibratedSide ?? null,
    ),
  };
  const pairedRunLineRules: Record<string, PickRow[]> = {};
  for (const [name, sideFn] of Object.entries({
    shippedMlSide: storedMlSide,
    storedPosteriorSide: (g: Game) => projectedMlSide(g, "posterior_home_diff"),
    inningsWeightedPreserveMarginSide: (g: Game) => candidateSide(g, "arithmetic_preserve_margin"),
    inningsWeightedRunLineProbabilitySide: candidateRunLineSide,
  })) {
    for (const shift of [0, 1, 2]) {
      pairedRunLineRules[`${name}${shift ? `Plus${shift}` : ""}`] = picksByRule(
        candidateCohort,
        sideFn,
        (game, side) => {
          const line = lineForSelectedRunLine(game, side);
          return line === null ? "push" : handicapOutcome(side, line + shift, game);
        },
      ).filter((row) => {
        const game = candidateCohort.find((g) => g.gameId === row.gameId)!;
        const side = sideFn(game);
        return side !== null && lineForSelectedRunLine(game, side) !== null;
      }).map((row) => ({ ...row, odds: null }));
    }
  }
  const writerReplay = await currentWriterReplay(candidateCohort, games);
  const report = {
    generatedAt: new Date().toISOString(),
    window: { from: options.from, to: options.to },
    chronologyWindows,
    games: games.length,
    competitor: COMPETITOR,
    coverage: {
      lockedGames: games.length,
      richFeatureCaptureGames: richGames,
      counterfactualPosteriorGames: candidateGames,
      note: "Run lines are mathematically derived from locked ML side plus standard favorite -1.5 / underdog +1.5. They are accuracy-only; no frozen run-line prices exist in prediction_records.",
    },
    scoreModels,
    moneyline: pack(mlRules),
    pairedCandidateCohort: {
      games: candidateCohort.length,
      scoreModels: {
        storedPosterior: scoreRule(candidateCohort, (game) => {
          const audit = v22(game.ml ?? game.total);
          const home = num(audit.posterior_home_runs);
          const away = num(audit.posterior_away_runs);
          return home !== null && away !== null ? { home, away } : null;
        }, games),
        arithmeticInningsPreserveMarginPosterior: scoreRule(
          candidateCohort,
          (game) => candidatePosterior(game, "arithmetic_preserve_margin"),
          games,
        ),
      },
      moneyline: pack(pairedMoneylineRules),
      runLineDerived: pack(pairedRunLineRules),
      totals: pack(pairedTotalRules),
    },
    moneylineCandidateFlips: {
      arithmetic: changedSides(games, (g) => candidateSide(g, "arithmetic")),
      geometric: changedSides(games, (g) => candidateSide(g, "geometric")),
      arithmeticPreserveMargin: changedSides(games, (g) => candidateSide(g, "arithmetic_preserve_margin")),
    },
    moneylineDecisionContributions: {
      storedIndependentInsteadOfShipped: changedSides(games, (g) => projectedMlSide(g, "independent_home_diff")),
      storedPosteriorInsteadOfShipped: changedSides(games, (g) => projectedMlSide(g, "posterior_home_diff")),
      marketFavoriteInsteadOfShipped: changedSides(games, marketMlSide),
    },
    totalCandidateFlipAudit: {
      versusShipped: totalFlipAudit(candidateCohort, storedTotalSide, (g) => candidateTotalSide(g, "arithmetic_preserve_margin")),
      versusStoredPosterior: totalFlipAudit(candidateCohort, (g) => projectionTotalSide(g, "posterior_total"), (g) => candidateTotalSide(g, "arithmetic_preserve_margin")),
      modelLayerVersusShipped: totalFlipAudit(candidateCohort, storedTotalSide, (g) => candidateTotalDecision(g)?.side ?? null),
    },
    totalDecisionContributions: {
      storedV22RawProbabilityInsteadOfShipped: totalFlipAudit(
        games,
        storedTotalSide,
        (g) => reconciliationTotalSide(g, "raw_probability_side"),
      ),
      storedMeanDirectionInsteadOfShipped: totalFlipAudit(
        games,
        storedTotalSide,
        (g) => reconciliationTotalSide(g, "mean_direction_side"),
      ),
      storedHolisticDirectionInsteadOfShipped: totalFlipAudit(
        games,
        storedTotalSide,
        (g) => reconciliationTotalSide(g, "holistic_side"),
      ),
      candidateRegularizationVersusRawProbability: totalFlipAudit(
        candidateCohort,
        (g) => candidateTotalDecision(g)?.rawProbabilitySide ?? null,
        (g) => candidateTotalDecision(g)?.regularizedProbabilitySide ?? null,
      ),
      candidateRegimeCalibrationVersusRegularizedProbability: totalFlipAudit(
        candidateCohort,
        (g) => candidateTotalDecision(g)?.regularizedProbabilitySide ?? null,
        (g) => candidateTotalDecision(g)?.side ?? null,
      ),
      candidateMeanVersusModelLayer: totalFlipAudit(
        candidateCohort,
        (g) => candidateTotalDecision(g)?.side ?? null,
        (g) => candidateTotalDecision(g)?.meanSide ?? null,
      ),
    },
    candidateModelLayerBoard: gradeBoardSummary(candidateCohort, candidateTotalDecision, games),
    candidateBestAngleBoardImpact: bestAngleBoardImpact(candidateCohort, games),
    candidatePushNormalizedModelLayerBoard: gradeBoardSummary(
      candidateCohort,
      (game) => candidateTotalDecision(game, true),
      games,
    ),
    candidatePushNormalizedBestAngleBoardImpact: bestAngleBoardImpact(
      candidateCohort,
      games,
      (game) => candidateTotalDecision(game, true),
    ),
    currentWriterReplay: writerReplay,
    runLineDerived: pack(runLineRules),
    totals: pack(totalRules),
  };

  await mkdir(options.outDir, { recursive: true });
  const stem = `${options.outDir}/mlb-foundational-scoreboard-${options.from}-to-${options.to}`;
  await writeFile(`${stem}.json`, `${JSON.stringify(report, null, 2)}\n`, "utf8");
  await writeFile(`${stem}.md`, markdown(report), "utf8");
  console.log(JSON.stringify({
    output: [`${stem}.json`, `${stem}.md`],
    games: report.games,
    coverage: report.coverage,
    scoreModels: report.scoreModels,
    moneyline: Object.fromEntries(Object.entries(report.moneyline).map(([k, v]) => [k, v.all])),
    moneylineCandidateFlips: report.moneylineCandidateFlips,
    runLineDerived: Object.fromEntries(Object.entries(report.runLineDerived).map(([k, v]) => [k, v.all])),
    totals: Object.fromEntries(Object.entries(report.totals).map(([k, v]) => [k, v.all])),
    currentWriterReplay: report.currentWriterReplay,
  }, null, 2));
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
