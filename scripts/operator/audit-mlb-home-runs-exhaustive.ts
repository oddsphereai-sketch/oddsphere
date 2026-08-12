/**
 * READ ONLY. Home-run-specific probability and actionable-policy audit.
 * Uses one best-price player/game/line observation and exact frozen context.
 */
import { readFileSync, writeFileSync } from "node:fs";
import { supabase } from "../../lib/db/supabase";
import type { MlbHistoricalStatRow } from "../../lib/mlb/props/providers";

type Raw = {
  slate_date: string; external_game_id: string; mlb_player_id: number; side: "over" | "under";
  line: number; locked_american_odds: number; locked_market_probability: number;
  locked_final_probability: number; result_status: "win" | "loss"; result_value: number;
  tracking_cohort: string; metadata_json: Record<string, unknown> | null;
};
type Context = Record<string, unknown>;
type Row = {
  key: string; date: string; game: string; player: number; line: number; outcome: number;
  market: number; current: number; odds: number | null; active: boolean; context: Context;
  recent5: number; recent10: number; recent20: number; season: number; hrPerPa20: number;
};
type Policy = {
  probability: number; edge: number; ev: number; minimumOdds: number; maximumOdds: number;
  xwoba: number; slugging: number; recent20: number; lineupMax: number; parkHr: number; temperature: number;
};
type RidgeModel = {
  offset: "market" | "current";
  lambda: number;
  means: number[];
  scales: number[];
  weights: number[];
};
type RankPolicy = {
  topPerDate: number;
  minimumProbability: number;
  minimumEdge: number;
  minimumExpectedValue: number;
  minimumOdds: number;
  maximumOdds: number;
};

const CONTEXT = "/private/tmp/oddsphere-mlb-props-locked-feature-context.json";
const LOGS = "/private/tmp/oddsphere-all-market-feature-log-cache.json";
const REPORT = "/private/tmp/oddsphere-mlb-home-runs-exhaustive.json";

async function loadRaw(): Promise<Raw[]> {
  const out: Raw[] = [];
  for (let from = 0; ; from += 1000) {
    const { data, error } = await supabase.from("mlb_prop_tracking_entries")
      .select("slate_date,external_game_id,mlb_player_id,side,line,locked_american_odds,locked_market_probability,locked_final_probability,result_status,result_value,tracking_cohort,metadata_json")
      .eq("market_key", "batter_home_runs").in("result_status", ["win", "loss"])
      .order("id", { ascending: true }).range(from, from + 999);
    if (error) throw error;
    out.push(...((data ?? []) as unknown as Raw[]));
    if ((data ?? []).length < 1000) return out;
  }
}

function buildRows(raw: Raw[], contexts: Record<string, Context>, logs: Record<string, MlbHistoricalStatRow[]>): Row[] {
  const groups = new Map<string, Raw[]>();
  for (const row of raw) {
    if (row.metadata_json?.publicDisplayEnabledAtLock !== true) continue;
    const key = `${row.slate_date}|${row.external_game_id}|${row.mlb_player_id}|batter_home_runs|${Number(row.line)}`;
    groups.set(key, [...(groups.get(key) ?? []), row]);
  }
  const out: Row[] = [];
  for (const [key, group] of groups) {
    const first = group[0]!;
    const over = group.filter((row) => row.side === "over");
    if (!over.length) continue;
    const prior = (logs[`batter|${first.mlb_player_id}`] ?? []).filter((row) => row.gameDate < first.slate_date)
      .sort((a, b) => b.gameDate.localeCompare(a.gameDate));
    if (prior.length < 10) continue;
    const hrs = prior.map((row) => num(row.stats.home_runs)).filter((value): value is number => value !== null);
    const pas = prior.map((row) => num(row.stats.plate_appearances)).filter((value): value is number => value !== null);
    const values = (n: number) => hrs.slice(0, n);
    out.push({
      key, date: first.slate_date, game: first.external_game_id, player: first.mlb_player_id,
      line: first.line, outcome: Number(first.result_value > first.line),
      market: mean(over.map((row) => row.side === "over" ? row.locked_market_probability : 1 - row.locked_market_probability)),
      current: mean(over.map((row) => row.side === "over" ? row.locked_final_probability : 1 - row.locked_final_probability)),
      odds: bestOdds(over.map((row) => row.locked_american_odds)),
      active: over.some((row) => row.tracking_cohort === "actionable"), context: contexts[key] ?? {},
      recent5: survival(values(5), first.line), recent10: survival(values(10), first.line),
      recent20: survival(values(20), first.line), season: survival(hrs.slice(0, 80), first.line),
      hrPerPa20: sum(values(20)) / Math.max(1, sum(pas.slice(0, 20))),
    });
  }
  return out.sort((a, b) => a.date.localeCompare(b.date) || a.key.localeCompare(b.key));
}

function policyGrid(): Policy[] {
  const out: Policy[] = [];
  for (const probability of [0.12, 0.14, 0.16])
    for (const edge of [-0.02, 0, 0.02])
      for (const ev of [0, 0.05, 0.1])
        for (const xwoba of [0, 0.31, 0.35])
          for (const slugging of [0, 0.4, 0.5])
            for (const recent20 of [0, 0.05, 0.1])
              for (const lineupMax of [3, 6, 9])
                for (const parkHr of [-1, 0, 0.04])
                  for (const temperature of [0, 70, 80]) out.push({
                    probability, edge, ev, minimumOdds: 200, maximumOdds: 650,
                    xwoba, slugging, recent20, lineupMax, parkHr, temperature,
                  });
  return out;
}

function selected(row: Row, policy: Policy) {
  if (row.odds === null) return false;
  const xwoba = numeric(row.context.pitchMatchupXwoba);
  const slugging = numeric(row.context.pitchMatchupSlugging);
  const lineup = numeric(row.context.battingOrder);
  const park = numeric(row.context.parkHomeRunFactor);
  const temperature = numeric(row.context.temperatureF);
  const ev = row.current * decimal(row.odds) - 1;
  return row.current >= policy.probability && row.current - row.market >= policy.edge && ev >= policy.ev
    && row.odds >= policy.minimumOdds && row.odds <= policy.maximumOdds
    && (policy.xwoba === 0 || (xwoba !== null && xwoba >= policy.xwoba))
    && (policy.slugging === 0 || (slugging !== null && slugging >= policy.slugging))
    && row.recent20 >= policy.recent20
    && (lineup !== null && lineup <= policy.lineupMax)
    && (policy.parkHr === -1 || (park !== null && park >= policy.parkHr))
    && (policy.temperature === 0 || row.context.roofStatus === "dome" || (temperature !== null && temperature >= policy.temperature));
}

function ridgeFeatures(row: Row): number[] {
  const context = row.context;
  const value = (key: string, fallback: number) => numeric(context[key]) ?? fallback;
  const xwoba = value("pitchMatchupXwoba", 0.32);
  const slugging = value("pitchMatchupSlugging", 0.41);
  const whiff = value("pitchMatchupWhiffPercent", 25);
  const directPa = Math.expm1(Math.max(0, value("matchupPlateAppearancesLog", 0)));
  const directReliability = directPa / (directPa + 20);
  return [
    1,
    row.recent5,
    row.recent10,
    row.recent20,
    row.season,
    row.hrPerPa20,
    value("battingOrder", 5),
    xwoba,
    slugging,
    whiff,
    value("parkHomeRunFactor", 0),
    value("parkRunFactor", 0),
    value("temperatureF", 75),
    value("windSpeedMph", 8),
    context.homeAway === "home" ? 1 : 0,
    directReliability * value("matchupHomeRunRate", 0.03),
    Number(numeric(context.pitchMatchupXwoba) === null),
    Number(numeric(context.parkHomeRunFactor) === null),
    Number(numeric(context.battingOrder) === null),
  ];
}

function fitRidge(rows: Row[], offset: RidgeModel["offset"], lambda: number): RidgeModel {
  const matrix = rows.map(ridgeFeatures);
  const width = matrix[0]?.length ?? 0;
  const means = Array.from({ length: width }, (_, column) => column === 0 ? 0 : mean(matrix.map((values) => values[column]!)));
  const scales = Array.from({ length: width }, (_, column) => {
    if (column === 0) return 1;
    const variance = mean(matrix.map((values) => (values[column]! - means[column]!) ** 2));
    return Math.max(1e-6, Math.sqrt(variance));
  });
  const design = matrix.map((values) => values.map((value, column) => column === 0 ? 1 : (value - means[column]!) / scales[column]!));
  const weights = Array(width).fill(0) as number[];
  const learningRate = 0.08;
  for (let iteration = 0; iteration < 8_000; iteration++) {
    const gradient = Array(width).fill(0) as number[];
    for (let index = 0; index < rows.length; index++) {
      const row = rows[index]!;
      const base = logit(offset === "market" ? row.market : row.current);
      const predicted = sigmoid(base + dot(weights, design[index]!));
      for (let column = 0; column < width; column++) gradient[column] += (predicted - row.outcome) * design[index]![column]!;
    }
    for (let column = 0; column < width; column++) {
      const penalty = column === 0 ? 0 : lambda * weights[column]!;
      weights[column] -= learningRate * (gradient[column]! + penalty) / Math.max(1, rows.length);
    }
  }
  return { offset, lambda, means, scales, weights };
}

function ridgePredict(model: RidgeModel, row: Row): number {
  const design = ridgeFeatures(row).map((value, column) => column === 0 ? 1 : (value - model.means[column]!) / model.scales[column]!);
  const base = logit(model.offset === "market" ? row.market : row.current);
  return clamp(sigmoid(base + dot(model.weights, design)));
}

function chooseRidge(tune: Row[], confirm: Row[]) {
  const candidates = (["market", "current"] as const).flatMap((offset) =>
    [0.1, 0.5, 1, 2, 5, 10, 20, 50, 100].map((lambda) => {
      const model = fitRidge(tune, offset, lambda);
      return { model, confirm: probabilityMetric(confirm, (row) => ridgePredict(model, row)) };
    }));
  return candidates.sort((a, b) => a.confirm.brier - b.confirm.brier || a.confirm.logLoss - b.confirm.logLoss)[0]!;
}

function rankSelections(rows: Row[], predict: (row: Row) => number, policy: RankPolicy): Row[] {
  const eligible = rows.filter((row) => {
    if (row.odds === null || row.odds < policy.minimumOdds || row.odds > policy.maximumOdds) return false;
    const probability = predict(row);
    return probability >= policy.minimumProbability
      && probability - row.market >= policy.minimumEdge
      && probability * decimal(row.odds) - 1 >= policy.minimumExpectedValue;
  });
  return [...new Set(eligible.map((row) => row.date))].flatMap((date) => eligible
    .filter((row) => row.date === date)
    .sort((a, b) => {
      const evA = predict(a) * decimal(a.odds!) - 1;
      const evB = predict(b) * decimal(b.odds!) - 1;
      return evB - evA || predict(b) - predict(a);
    })
    .slice(0, policy.topPerDate));
}

function rankedMetrics(rows: Row[], predict: (row: Row) => number, policy: RankPolicy) {
  return actionMetricsForRows(rankSelections(rows, predict, policy));
}

function chooseRankPolicy(confirm: Row[], model: RidgeModel) {
  const predict = (row: Row) => ridgePredict(model, row);
  const policies: RankPolicy[] = [];
  for (const topPerDate of [1, 2, 3, 5])
    for (const minimumProbability of [0.08, 0.1, 0.12, 0.14, 0.16])
      for (const minimumEdge of [-0.04, -0.02, 0, 0.02, 0.04])
        for (const minimumExpectedValue of [-0.05, 0, 0.05, 0.1])
          policies.push({ topPerDate, minimumProbability, minimumEdge, minimumExpectedValue, minimumOdds: 200, maximumOdds: 650 });
  return policies.map((policy) => ({
    policy,
    confirm: rankedMetrics(confirm, predict, policy),
  })).filter((candidate) => candidate.confirm.decisions >= 8)
    .sort((a, b) => {
      const aRateLift = (a.confirm.hitRate ?? 0) - a.confirm.averageBreakEvenProbability;
      const bRateLift = (b.confirm.hitRate ?? 0) - b.confirm.averageBreakEvenProbability;
      return bRateLift - aRateLift || (b.confirm.roi ?? -1) - (a.confirm.roi ?? -1) || b.confirm.decisions - a.confirm.decisions;
    })[0] ?? null;
}

function actionMetrics(rows: Row[], policy?: Policy, active = false) {
  const picks = rows.filter((row) => active ? row.active : policy ? selected(row, policy) : false);
  return actionMetricsForRows(picks);
}

function actionMetricsForRows(picks: Row[]) {
  const wins = picks.filter((row) => row.outcome === 1).length;
  const units = picks.reduce((total, row) => total + (row.outcome ? profit(row.odds!) : -1), 0);
  return { decisions: picks.length, record: `${wins}-${picks.length - wins}`, hitRate: picks.length ? round(wins / picks.length) : null,
    units: round(units), roi: picks.length ? round(units / picks.length) : null,
    dates: new Set(picks.map((row) => row.date)).size,
    averageBreakEvenProbability: picks.length ? round(mean(picks.map((row) => 1 / decimal(row.odds!)))) : 0 };
}

function choosePolicy(tune: Row[], confirm: Row[]) {
  return policyGrid().map((policy) => ({ policy, tune: actionMetrics(tune, policy), confirm: actionMetrics(confirm, policy) }))
    .filter((item) => item.tune.decisions >= 5 && item.confirm.decisions >= 5
      && (item.tune.hitRate ?? 0) > 0.1 && (item.confirm.hitRate ?? 0) > 0.1
      && (item.tune.roi ?? -1) > 0 && (item.confirm.roi ?? -1) > 0)
    .sort((a, b) => (b.confirm.hitRate ?? 0) - (a.confirm.hitRate ?? 0)
      || (b.confirm.roi ?? 0) - (a.confirm.roi ?? 0)
      || b.confirm.decisions - a.confirm.decisions)[0] ?? null;
}

function bins(rows: Row[], key: (row: Row) => number | null, cuts: number[]) {
  return cuts.map((minimum, index) => {
    const maximum = cuts[index + 1] ?? Infinity;
    const selected = rows.filter((row) => { const value = key(row); return value !== null && value >= minimum && value < maximum; });
    return { range: [minimum, maximum === Infinity ? null : maximum], rows: selected.length, overRate: selected.length ? round(mean(selected.map((row) => row.outcome))) : null };
  });
}

async function main() {
  const raw = await loadRaw();
  const contexts = JSON.parse(readFileSync(CONTEXT, "utf8")) as Record<string, Context>;
  const logs = JSON.parse(readFileSync(LOGS, "utf8")) as Record<string, MlbHistoricalStatRow[]>;
  const rows = buildRows(raw, contexts, logs);
  const discovery = rows.filter((row) => row.date <= "2026-07-23");
  const tune = rows.filter((row) => row.date >= "2026-07-24" && row.date <= "2026-07-27");
  const confirm = rows.filter((row) => row.date >= "2026-07-28" && row.date <= "2026-07-31");
  const holdout = rows.filter((row) => row.date >= "2026-08-01");
  const winner = choosePolicy(tune, confirm);
  const ridgeSelection = chooseRidge(discovery, tune);
  const validationRidgeModel = fitRidge([...discovery, ...tune], ridgeSelection.model.offset, ridgeSelection.model.lambda);
  const rankPolicy = chooseRankPolicy(confirm, validationRidgeModel);
  const holdoutRidgeModel = fitRidge([...discovery, ...tune, ...confirm], validationRidgeModel.offset, validationRidgeModel.lambda);
  const holdoutPredict = (row: Row) => ridgePredict(holdoutRidgeModel, row);
  const report = {
    generatedAt: new Date().toISOString(), writesToProduction: false,
    coverage: { raw: raw.length, observations: rows.length, dates: [...new Set(rows.map((row) => row.date))], discovery: discovery.length, tune: tune.length, confirm: confirm.length, holdout: holdout.length },
    probability: { validation: scores([...tune, ...confirm]), holdout: scores(holdout) },
    currentActionable: { validation: actionMetrics([...tune, ...confirm], undefined, true), holdout: actionMetrics(holdout, undefined, true) },
    featureDiagnostics: {
      pitchMatchupXwoba: bins(holdout, (row) => numeric(row.context.pitchMatchupXwoba), [0, 0.28, 0.32, 0.36, 0.4]),
      pitchMatchupSlugging: bins(holdout, (row) => numeric(row.context.pitchMatchupSlugging), [0, 0.35, 0.45, 0.55, 0.7]),
      parkHomeRunFactor: bins(holdout, (row) => numeric(row.context.parkHomeRunFactor), [-0.2, -0.04, 0, 0.04, 0.2]),
      temperature: bins(holdout, (row) => numeric(row.context.temperatureF), [0, 65, 75, 85]),
      recent20: bins(holdout, (row) => row.recent20, [0, 0.05, 0.1, 0.15, 0.25]),
      battingOrder: bins(holdout, (row) => numeric(row.context.battingOrder), [1, 4, 7]),
    },
    selectedPolicy: winner ? { ...winner, holdout: actionMetrics(holdout, winner.policy), bootstrap: bootstrap(holdout.filter((row) => selected(row, winner.policy)), 5_000) } : null,
    regularizedContextModel: {
      selectedOffset: validationRidgeModel.offset,
      selectedLambda: validationRidgeModel.lambda,
      tune: ridgeSelection.confirm,
      confirmation: probabilityMetric(confirm, (row) => ridgePredict(validationRidgeModel, row)),
      holdout: probabilityMetric(holdout, holdoutPredict),
      marketHoldout: probabilityMetric(holdout, (row) => row.market),
      currentHoldout: probabilityMetric(holdout, (row) => row.current),
      coefficientDiagnostics: coefficientDiagnostics(holdoutRidgeModel),
      rankPolicy: rankPolicy ? {
        ...rankPolicy,
        holdout: rankedMetrics(holdout, holdoutPredict, rankPolicy.policy),
        bootstrap: bootstrap(rankSelections(holdout, holdoutPredict, rankPolicy.policy), 5_000),
      } : null,
    },
    reportPath: REPORT,
  };
  writeFileSync(REPORT, JSON.stringify(report, null, 2));
  console.log(JSON.stringify({ coverage: report.coverage, currentActionable: report.currentActionable, regularizedContextModel: report.regularizedContextModel }, null, 2));
}

function scores(rows: Row[]) { return { market: metric(rows, (row) => row.market), current: metric(rows, (row) => row.current) }; }
function metric(rows: Row[], probability: (row: Row) => number) { return probabilityMetric(rows, probability); }
function probabilityMetric(rows: Row[], probability: (row: Row) => number) { return { brier: round(mean(rows.map((row) => (probability(row) - row.outcome) ** 2))), logLoss: round(mean(rows.map((row) => { const p = clamp(probability(row)); return -(row.outcome * Math.log(p) + (1 - row.outcome) * Math.log(1 - p)); }))), calibrationGap: round(mean(rows.map(probability)) - mean(rows.map((row) => row.outcome))) }; }
function coefficientDiagnostics(model: RidgeModel) {
  const names = ["intercept", "recent5", "recent10", "recent20", "season", "hrPerPa20", "battingOrder", "pitchMatchupXwoba", "pitchMatchupSlugging", "pitchMatchupWhiff", "parkHomeRunFactor", "parkRunFactor", "temperature", "wind", "home", "directMatchupHr", "missingPitchMatchup", "missingPark", "missingLineup"];
  return names.map((name, index) => ({ name, standardizedCoefficient: round(model.weights[index] ?? 0) }))
    .sort((a, b) => Math.abs(b.standardizedCoefficient) - Math.abs(a.standardizedCoefficient));
}
function bootstrap(rows: Row[], iterations: number) { const dates = [...new Set(rows.map((row) => row.date))]; let seed = 123456789, hit = 0, profitable = 0; const random = () => ((seed = (1664525 * seed + 1013904223) >>> 0) / 4294967296); for (let i = 0; i < iterations; i++) { const sample = Array.from({ length: dates.length }, () => { const d = dates[Math.floor(random() * dates.length)]!; return rows.filter((row) => row.date === d); }).flat(); if (sample.length && mean(sample.map((row) => row.outcome)) > 0.1) hit++; if (sample.reduce((s, row) => s + (row.outcome ? profit(row.odds!) : -1), 0) > 0) profitable++; } return { iterations, hitRateAbove10PercentProbability: round(hit / iterations), profitableProbability: round(profitable / iterations) }; }
function numeric(value: unknown) { const parsed = Number(value); return value !== null && value !== "" && Number.isFinite(parsed) ? parsed : null; }
function num(value: unknown) { return numeric(value); }
function bestOdds(values: number[]) { return values.length ? Math.max(...values) : null; }
function survival(values: number[], line: number) { return values.length ? values.filter((value) => value > line).length / values.length : 0; }
function mean(values: number[]) { return values.length ? sum(values) / values.length : 0; }
function sum(values: number[]) { return values.reduce((a, b) => a + b, 0); }
function decimal(odds: number) { return odds > 0 ? 1 + odds / 100 : 1 + 100 / Math.abs(odds); }
function profit(odds: number) { return odds > 0 ? odds / 100 : 100 / Math.abs(odds); }
function clamp(value: number) { return Math.max(0.001, Math.min(0.999, value)); }
function logit(value: number) { const probability = clamp(value); return Math.log(probability / (1 - probability)); }
function sigmoid(value: number) { return value >= 0 ? 1 / (1 + Math.exp(-value)) : Math.exp(value) / (1 + Math.exp(value)); }
function dot(left: number[], right: number[]) { return left.reduce((total, value, index) => total + value * right[index]!, 0); }
function round(value: number) { return Number(value.toFixed(6)); }

main().catch((error) => { console.error(error instanceof Error ? error.stack ?? error.message : String(error)); process.exitCode = 1; });
