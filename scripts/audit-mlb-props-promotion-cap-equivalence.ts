import { readFileSync, writeFileSync } from "node:fs";

type Observation = {
  date: string;
  gameId: string | number;
  playerId: string | number;
  line: number;
  overWon: number;
  marketOver: number;
  currentApproxOver: number;
  bestOverDecimal: number;
  bestUnderDecimal: number;
};

type Candidate = {
  market: string;
  tier: number;
  date: string;
  gameId: string | number;
  playerId: string | number;
  line: number;
  won: number;
  profit: number;
  probability: number;
  marketProbability: number;
  rawEdge: number;
  finalEdge: number;
  expectedValue: number;
};

const inputPath = process.argv[2];
const outputPath =
  process.argv[3] ?? "/tmp/mlb-props-promotion-cap-equivalence.json";
if (!inputPath) {
  throw new Error(
    "Usage: npx tsx scripts/audit-mlb-props-promotion-cap-equivalence.ts <observations.json> [output.json]",
  );
}

const observations = JSON.parse(readFileSync(inputPath, "utf8")) as Record<
  string,
  Observation[]
>;

const windows = {
  discovery: ["0000-00-00", "2026-06-21"],
  calibration: ["2026-06-22", "2026-06-30"],
  validation1: ["2026-07-01", "2026-07-07"],
  validation2: ["2026-07-08", "2026-07-12"],
  untouchedValidation: ["2026-07-16", "2026-07-23"],
} as const;

const policies = [
  {
    market: "batter_hits",
    tier: 3,
    line: null,
    minimumProbability: 0.56,
    minimumRawEdge: 0.1,
    minimumFinalEdge: 0.02,
    minimumExpectedValue: 0.01,
    calibratedModelWeight: 1,
  },
  {
    market: "batter_hits_runs_rbis",
    tier: 2,
    line: 1.5,
    minimumProbability: 0.56,
    minimumRawEdge: 0.08,
    minimumFinalEdge: 0.02,
    minimumExpectedValue: 0.01,
    calibratedModelWeight: 1,
  },
  {
    market: "batter_runs_scored",
    tier: 1,
    line: null,
    minimumProbability: 0.6,
    minimumRawEdge: 0.08,
    minimumFinalEdge: 0.02,
    minimumExpectedValue: 0.01,
    calibratedModelWeight: 0.3,
  },
] as const;

const candidates = policies.flatMap((policy) =>
  bestOfferPerPlayerGame(
    observations[`${policy.market}|two_way`] ?? [],
  ).flatMap((row): Candidate[] => {
    const probability = 1 - row.currentApproxOver;
    const marketProbability = 1 - row.marketOver;
    const rawEdge = probability - marketProbability;
    const finalProbability =
      probability * policy.calibratedModelWeight
      + marketProbability * (1 - policy.calibratedModelWeight);
    const finalEdge = finalProbability - marketProbability;
    const expectedValue = finalProbability * row.bestUnderDecimal - 1;
    if (
      (policy.line !== null && row.line !== policy.line)
      || probability < policy.minimumProbability
      || rawEdge < policy.minimumRawEdge
      || finalEdge < policy.minimumFinalEdge
      || expectedValue < policy.minimumExpectedValue
    ) return [];
    return [{
      market: policy.market,
      tier: policy.tier,
      date: row.date,
      gameId: row.gameId,
      playerId: row.playerId,
      line: row.line,
      won: 1 - row.overWon,
      profit: row.overWon ? -1 : row.bestUnderDecimal - 1,
      probability,
      marketProbability,
      rawEdge,
      finalEdge,
      expectedValue,
    }];
  }),
);

const variants = {
  uncapped: candidates,
  strongestMarketsUncapped: candidates.filter((row) =>
    row.market === "batter_hits"
    || row.market === "batter_hits_runs_rbis"),
  onePerPlayer: selectBest(candidates, (row) =>
    `${row.date}|${row.gameId}|${row.playerId}`),
  onePerGame: selectBest(candidates, (row) =>
    `${row.date}|${row.gameId}`),
  onePerPlayerThenGame: selectBest(
    selectBest(candidates, (row) =>
      `${row.date}|${row.gameId}|${row.playerId}`),
    (row) => `${row.date}|${row.gameId}`,
  ),
};

const report = {
  generatedAt: new Date().toISOString(),
  input: inputPath,
  methodology: {
    objective:
      "Measure whether count/concentration overlays improve the exact market-specific Under promotion policies.",
    noFixedDailyMinimumOrMaximum: true,
    candidatePolicySelectionThrough: "2026-06-21",
    untouchedValidation: windows.untouchedValidation,
    caveat:
      "Historical observations do not contain the complete contemporaneous board, so the runtime's existing-actionable player/cluster exclusions cannot be replayed exactly from this file.",
  },
  policies,
  variants: Object.fromEntries(
    Object.entries(variants).map(([name, rows]) => [
      name,
      summarizeVariant(rows),
    ]),
  ),
};

writeFileSync(outputPath, `${JSON.stringify(report, null, 2)}\n`);
console.log(JSON.stringify(report, null, 2));

function summarizeVariant(rows: Candidate[]) {
  const future = rows.filter((row) => row.date >= windows.calibration[0]);
  const windowResults = Object.fromEntries(
    Object.entries(windows).map(([name, [from, through]]) => [
      name,
      summarize(rows.filter((row) => row.date >= from && row.date <= through)),
    ]),
  );
  return {
    combined: summarize(rows),
    future: summarize(future),
    futurePositiveWindows: Object.entries(windowResults)
      .filter(([name]) => name !== "discovery")
      .filter(([, value]) =>
        value.count > 0 && value.roi !== null && value.roi > 0).length,
    windows: windowResults,
    futureByMarket: summarizeByMarket(future),
    futureDailyVolume: summarizeDailyVolume(future),
    futureDateClusterBootstrap: clusterBootstrap(future),
  };
}

function selectBest(
  rows: Candidate[],
  key: (row: Candidate) => string,
): Candidate[] {
  return [...groupRows(rows, key).values()].flatMap((group) => {
    const [best] = [...group].sort(compareCandidates);
    return best ? [best] : [];
  });
}

function compareCandidates(a: Candidate, b: Candidate): number {
  return b.tier - a.tier
    || b.expectedValue - a.expectedValue
    || b.finalEdge - a.finalEdge
    || String(a.playerId).localeCompare(String(b.playerId));
}

function bestOfferPerPlayerGame(rows: Observation[]): Observation[] {
  return [...groupRows(rows, (row) =>
    `${row.date}|${row.gameId}|${row.playerId}|${row.line}`).values()]
    .flatMap((offers) => {
      const [best] = [...offers].sort((a, b) =>
        (b.bestOverDecimal + b.bestUnderDecimal)
        - (a.bestOverDecimal + a.bestUnderDecimal));
      return best ? [best] : [];
    });
}

function summarize(rows: Candidate[]) {
  const wins = rows.reduce((sum, row) => sum + row.won, 0);
  const units = rows.reduce((sum, row) => sum + row.profit, 0);
  return {
    count: rows.length,
    wins,
    losses: rows.length - wins,
    accuracy: rows.length ? round(wins / rows.length) : null,
    units: round(units),
    roi: rows.length ? round(units / rows.length) : null,
  };
}

function summarizeByMarket(rows: Candidate[]) {
  return Object.fromEntries(
    [...groupRows(rows, (row) => row.market).entries()].map(
      ([market, values]) => [market, summarize(values)],
    ),
  );
}

function summarizeDailyVolume(rows: Candidate[]) {
  const counts = [...groupRows(rows, (row) => row.date).values()]
    .map((group) => group.length)
    .sort((a, b) => a - b);
  if (!counts.length) {
    return { activeDates: 0, minimum: 0, maximum: 0, mean: 0, median: 0 };
  }
  return {
    activeDates: counts.length,
    minimum: counts[0],
    maximum: counts.at(-1),
    mean: round(counts.reduce((sum, count) => sum + count, 0) / counts.length),
    median: counts[Math.floor(counts.length / 2)],
  };
}

function clusterBootstrap(rows: Candidate[]) {
  const groups = [...groupRows(rows, (row) => row.date).values()];
  if (!groups.length) {
    return { roi95: [null, null], positiveProbability: null, dateClusters: 0 };
  }
  const random = seededRandom(20260728);
  const values: number[] = [];
  for (let iteration = 0; iteration < 20_000; iteration += 1) {
    let count = 0;
    let units = 0;
    for (let index = 0; index < groups.length; index += 1) {
      const sample = groups[Math.floor(random() * groups.length)] ?? [];
      count += sample.length;
      units += sample.reduce((sum, row) => sum + row.profit, 0);
    }
    values.push(units / count);
  }
  values.sort((a, b) => a - b);
  return {
    roi95: [
      round(values[Math.floor(values.length * 0.025)] ?? 0),
      round(values[Math.floor(values.length * 0.975)] ?? 0),
    ],
    positiveProbability:
      round(values.filter((value) => value > 0).length / values.length),
    dateClusters: groups.length,
  };
}

function groupRows<T>(
  rows: T[],
  key: (row: T) => string,
): Map<string, T[]> {
  const grouped = new Map<string, T[]>();
  for (const row of rows) {
    const groupKey = key(row);
    grouped.set(groupKey, [...(grouped.get(groupKey) ?? []), row]);
  }
  return grouped;
}

function seededRandom(seed: number): () => number {
  let value = seed >>> 0;
  return () => {
    value += 0x6d2b79f5;
    let result = value;
    result = Math.imul(result ^ (result >>> 15), result | 1);
    result ^= result + Math.imul(result ^ (result >>> 7), result | 61);
    return ((result ^ (result >>> 14)) >>> 0) / 4294967296;
  };
}

function round(value: number): number {
  return Math.round(value * 10_000) / 10_000;
}
