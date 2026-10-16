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
import { overProbabilityPoisson, poissonPmf } from "../../lib/automodel/runDistribution";
import { regularizeProbability } from "../../lib/automodel/mlbProbabilityRegularization";
import { computePlayGrade } from "../../lib/automodel/playGrade";

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
      .select("id,game_id,slate_date,market,side,line_value,odds_american,model_probability,market_probability,play_grade,best_angle,market_aligned,snapshot_json,prediction_grades(result,actual_home_score,actual_away_score)")
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
    baseBestAngleEligible,
    requiresMarketConfirmation: baseBestAngleEligible && regularized.capApplied,
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
  }, null, 2));
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
