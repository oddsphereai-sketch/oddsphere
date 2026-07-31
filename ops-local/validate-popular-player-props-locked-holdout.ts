import { readFileSync } from "node:fs";
import { supabase } from "../lib/db/supabase";

// Read-only audit rows span several persisted JSON contracts; validation below
// normalizes every field before it enters the typed evaluation record.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Raw = Record<string, any>;
type Side = "over" | "under";
type EvaluationRow = {
  id: number;
  date: string;
  gameId: string;
  playerId: string;
  market: string;
  line: number;
  overWon: number;
  marketOver: number;
  modelOver: number;
  currentOver: number;
  release: string;
  home: number;
  priorValues: number[];
};

const observations = JSON.parse(readFileSync(
  "/private/tmp/all-player-props-observations.json", "utf8",
));
const mappings = JSON.parse(readFileSync(
  "/private/tmp/oddsphere-mlb-all-props-research/bdl-to-mlbstats.json", "utf8",
));
const hitterLogs = JSON.parse(readFileSync(
  "/private/tmp/oddsphere-mlb-all-props-research/mlb-hitter-logs.json", "utf8",
));

const configs: Record<string, { channel: string; stat: string; window: number; priorStrength: number }> = {
  batter_hits: { channel: "two_way", stat: "hits", window: 20, priorStrength: 20 },
  batter_home_runs: { channel: "milestone", stat: "home_runs", window: 20, priorStrength: 20 },
  batter_hits_runs_rbis: { channel: "two_way", stat: "hits_runs_rbis", window: 20, priorStrength: 20 },
  batter_total_bases: { channel: "two_way", stat: "total_bases", window: 5, priorStrength: 20 },
};

async function main() {
  const locked = await loadLockedRows();
  const report = Object.fromEntries(Object.entries(configs).map(([market, config]) => {
    const training = buildTrainingRows(market, config);
    const linePriors = buildLinePriors(training);
    const independent = (row: EvaluationRow) => survival(row, config, linePriors);
    const stack = fitMarketOffset(training, independent);
    const holdout = buildHoldoutRows(locked.filter((row) => row.market_key === market), config);
    const challenger = (row: EvaluationRow) => stackPredict(row, independent(row), stack);
    const releases = [...new Set(holdout.map((row) => row.release))].sort();
    return [market, {
      frozenBeforeHoldout: {
        trainingThrough: "2026-07-23",
        variant: `survival_w${config.window}_s${config.priorStrength}`,
        stackLambda: 50,
        stack,
        trainingRows: training.length,
      },
      holdout: compare(holdout, challenger),
      holdoutByRelease: Object.fromEntries(releases.map((release) => [
        release,
        compare(holdout.filter((row) => row.release === release), challenger),
      ])),
    }];
  }));
  console.log(JSON.stringify({
    generatedAt: new Date().toISOString(),
    methodology: {
      holdout: "Exact stored T60 production locks settled from 2026-07-24 onward.",
      eligibility: "Public-display-enabled rows only; win/loss outcomes; probabilities transformed back to a common Over event before scoring.",
      challenger: "Frozen prior-only threshold survival plus a fixed market-offset ridge stack fit through 2026-07-23.",
      releasePolicy: "Aggregate is accompanied by immutable release-separated metrics and is not described as one current-model era.",
      writesToProduction: false,
    },
    sourceRows: locked.length,
    report,
  }, null, 2));
}

async function loadLockedRows(): Promise<Raw[]> {
  const rows: Raw[] = [];
  for (let from = 0; ; from += 1000) {
    const { data, error } = await supabase
      .from("mlb_prop_tracking_entries")
      .select([
        "id", "slate_date", "external_game_id", "mlb_player_id", "market_key", "side", "line",
        "locked_market_probability", "locked_model_probability", "locked_final_probability",
        "result_status", "metadata_json",
      ].join(","))
      .in("market_key", Object.keys(configs))
      .gte("slate_date", "2026-07-24")
      .in("result_status", ["win", "loss"])
      .order("id", { ascending: true })
      .range(from, from + 999);
    if (error) throw new Error(error.message);
    rows.push(...(data ?? []));
    if ((data ?? []).length < 1000) break;
  }
  return rows.filter((row) => row.metadata_json?.publicDisplayEnabledAtLock === true);
}

function buildTrainingRows(market: string, config: typeof configs[string]): EvaluationRow[] {
  const raw = observations[`${market}|${config.channel}`] ?? [];
  return raw.flatMap((row: Raw): EvaluationRow[] => {
    const bdlId = String(row.playerId).replace("balldontlie-player-", "");
    const mlbId = mappings[bdlId]?.mlbStatsPlayerId;
    const logs = mlbId ? hitterLogs[mlbId] ?? [] : [];
    const target = logs.find((log: Raw) => log.gameDate === row.date);
    const priorValues = logs
      .filter((log: Raw) => log.gameDate < row.date && Number.isFinite(Number(log.stats?.[config.stat])))
      .sort((left: Raw, right: Raw) => right.gameDate.localeCompare(left.gameDate))
      .map((log: Raw) => Number(log.stats[config.stat]));
    if (!target || priorValues.length < 10) return [];
    return [{
      id: 0,
      date: row.date,
      gameId: row.gameId,
      playerId: String(mlbId).replace("mlbstats-player-", ""),
      market,
      line: Number(row.line),
      overWon: Number(row.overWon),
      marketOver: clamp(Number(row.marketOver)),
      modelOver: clamp(Number(row.currentApproxOver)),
      currentOver: clamp(Number(row.currentApproxOver)),
      release: "historical_development",
      home: target.stats?.home_away === "home" ? 1 : 0,
      priorValues,
    }];
  });
}

function buildHoldoutRows(rows: Raw[], config: typeof configs[string]): EvaluationRow[] {
  return rows.flatMap((row): EvaluationRow[] => {
    const playerId = String(row.mlb_player_id);
    const logs = hitterLogs[`mlbstats-player-${playerId}`] ?? [];
    const target = logs.find((log: Raw) => log.gameDate === row.slate_date);
    const priorValues = logs
      .filter((log: Raw) => log.gameDate < row.slate_date && Number.isFinite(Number(log.stats?.[config.stat])))
      .sort((left: Raw, right: Raw) => right.gameDate.localeCompare(left.gameDate))
      .map((log: Raw) => Number(log.stats[config.stat]));
    const side = row.side as Side;
    const won = row.result_status === "win" ? 1 : 0;
    const market = clamp(Number(row.locked_market_probability));
    const model = clamp(Number(row.locked_model_probability));
    const current = clamp(Number(row.locked_final_probability));
    if (!target || priorValues.length < 10 || (side !== "over" && side !== "under")) return [];
    return [{
      id: Number(row.id),
      date: String(row.slate_date),
      gameId: String(row.external_game_id),
      playerId,
      market: String(row.market_key),
      line: Number(row.line),
      overWon: side === "over" ? won : 1 - won,
      marketOver: side === "over" ? market : 1 - market,
      modelOver: side === "over" ? model : 1 - model,
      currentOver: side === "over" ? current : 1 - current,
      release: String(row.metadata_json?.modelReleaseId ?? "missing"),
      home: target.stats?.home_away === "home" ? 1 : 0,
      priorValues,
    }];
  });
}

function compare(rows: EvaluationRow[], challenger: (row: EvaluationRow) => number) {
  return {
    rows: rows.length,
    dates: [...new Set(rows.map((row) => row.date))].sort(),
    market: metrics(rows, (row) => row.marketOver),
    independentModel: metrics(rows, (row) => row.modelOver),
    currentFinal: metrics(rows, (row) => row.currentOver),
    challenger: metrics(rows, challenger),
    challengerVsMarketBrierDelta: pairedBrierBootstrap(rows, challenger),
  };
}

function pairedBrierBootstrap(rows: EvaluationRow[], challenger: (row: EvaluationRow) => number) {
  if (!rows.length) return null;
  const groups = new Map<string, EvaluationRow[]>();
  for (const row of rows) {
    const key = `${row.date}|${row.gameId}`;
    const group = groups.get(key) ?? [];
    group.push(row);
    groups.set(key, group);
  }
  const clusters = [...groups.values()];
  const clusterDeltas = clusters.map((cluster) => mean(cluster.map((row) =>
    (challenger(row) - row.overWon) ** 2 - (row.marketOver - row.overWon) ** 2)));
  const observed = mean(rows.map((row) =>
    (challenger(row) - row.overWon) ** 2 - (row.marketOver - row.overWon) ** 2));
  if (clusters.length < 8) return { clusters: clusters.length, observed: round(observed), interval95: null, probabilityBetter: null };
  let state = 0x6d2b79f5;
  const random = () => {
    state += 0x6d2b79f5;
    let value = state;
    value = Math.imul(value ^ (value >>> 15), value | 1);
    value ^= value + Math.imul(value ^ (value >>> 7), value | 61);
    return ((value ^ (value >>> 14)) >>> 0) / 4294967296;
  };
  const draws: number[] = [];
  for (let draw = 0; draw < 20_000; draw++) {
    let total = 0;
    for (let index = 0; index < clusters.length; index++) {
      total += clusterDeltas[Math.floor(random() * clusters.length)]!;
    }
    draws.push(total / clusters.length);
  }
  draws.sort((left, right) => left - right);
  return {
    clusters: clusters.length,
    observed: round(observed),
    interval95: [round(draws[499]!), round(draws[19_499]!)],
    probabilityBetter: round(draws.filter((value) => value < 0).length / draws.length),
  };
}

function buildLinePriors(rows: EvaluationRow[]) {
  const groups = new Map<number, { wins: number; rows: number }>();
  for (const row of rows) {
    const group = groups.get(row.line) ?? { wins: 0, rows: 0 };
    group.wins += row.overWon;
    group.rows++;
    groups.set(row.line, group);
  }
  return new Map([...groups].map(([line, group]) => [line, (group.wins + 2) / (group.rows + 4)]));
}

function survival(row: EvaluationRow, config: typeof configs[string], linePriors: Map<number, number>) {
  const history = row.priorValues.slice(0, config.window);
  const successes = history.filter((value) => value > row.line).length;
  const prior = linePriors.get(row.line) ?? 0.5;
  return clamp((successes + prior * config.priorStrength) / (history.length + config.priorStrength));
}

function fitMarketOffset(rows: EvaluationRow[], independent: (row: EvaluationRow) => number) {
  const coefficients = [0, 0, 0, 0];
  const lambda = 50;
  for (let iteration = 0; iteration < 1500; iteration++) {
    const gradient = [0, 0, 0, 0];
    for (const row of rows) {
      const x = features(row, independent(row));
      const probability = sigmoid(logit(row.marketOver) + dot(coefficients, x));
      const error = probability - row.overWon;
      for (let index = 0; index < coefficients.length; index++) gradient[index]! += error * x[index]!;
    }
    for (let index = 0; index < coefficients.length; index++) {
      gradient[index]! += lambda * coefficients[index]!;
      coefficients[index]! -= 0.2 * gradient[index]! / rows.length;
    }
  }
  return coefficients.map(round);
}

function stackPredict(row: EvaluationRow, independent: number, coefficients: number[]) {
  return clamp(sigmoid(logit(row.marketOver) + dot(coefficients, features(row, independent))));
}

function features(row: EvaluationRow, independent: number) {
  return [1, logit(independent) - logit(row.marketOver), row.line, row.home];
}

function metrics(rows: EvaluationRow[], predict: (row: EvaluationRow) => number) {
  if (!rows.length) return null;
  const probabilities = rows.map((row) => clamp(predict(row)));
  return {
    brier: round(mean(rows.map((row, index) => (probabilities[index]! - row.overWon) ** 2))),
    logLoss: round(mean(rows.map((row, index) => -(
      row.overWon * Math.log(probabilities[index]!) + (1 - row.overWon) * Math.log(1 - probabilities[index]!)
    )))),
    calibrationGap: round(mean(rows.map((row, index) => probabilities[index]! - row.overWon))),
  };
}

function logit(value: number) {
  const bounded = clamp(value);
  return Math.log(bounded / (1 - bounded));
}
function sigmoid(value: number) { return 1 / (1 + Math.exp(-value)); }
function dot(left: number[], right: number[]) { return left.reduce((sum, value, index) => sum + value * right[index]!, 0); }
function mean(values: number[]) { return values.reduce((sum, value) => sum + value, 0) / values.length; }
function clamp(value: number) { return Math.min(0.999, Math.max(0.001, value)); }
function round(value: number) { return Math.round(value * 1_000_000) / 1_000_000; }

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
