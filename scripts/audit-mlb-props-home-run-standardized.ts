import { readFileSync, writeFileSync } from "node:fs";
import {
  scoreHomeRunRelativeQualityCandidate,
} from "../lib/mlb/props/actionabilityPolicy";

type Observation = {
  date: string;
  gameId: string | number;
  playerId: string | number;
  line: number;
  overWon: number;
  priorGames: number;
  projection: number;
  recentSurvival: number;
  marketOver: number;
  bestOverDecimal: number;
};

type Scored = Observation & {
  id: string;
  americanOdds: number;
  expectedValue: number;
  profit: number;
};

type Policy = {
  minimumProjection: number;
  minimumRecentSurvival: number;
  minimumMarketProbability: number;
  minimumExpectedValue: number;
  minimumStandardizedExpectedValue: number;
  minimumAmericanOdds: number;
  maximumAmericanOdds: number;
};

const inputPath = process.argv[2];
const outputPath =
  process.argv[3] ?? "/tmp/mlb-props-home-run-standardized-audit.json";
if (!inputPath) {
  throw new Error(
    "Usage: npx tsx scripts/audit-mlb-props-home-run-standardized.ts <observations.json> [output.json]",
  );
}

const source = JSON.parse(readFileSync(inputPath, "utf8")) as Record<
  string,
  Observation[]
>;
const rows = bestOfferPerPlayerGame(
  source["batter_home_runs|milestone"] ?? [],
).flatMap(score);
const developmentWindows = {
  discovery: ["0000-00-00", "2026-06-21"],
  calibration: ["2026-06-22", "2026-06-30"],
  validation1: ["2026-07-01", "2026-07-07"],
  validation2: ["2026-07-08", "2026-07-12"],
} as const;
const untouchedWindow = ["2026-07-16", "2026-07-23"] as const;

const candidates: Array<{
  policy: Policy;
  development: ReturnType<typeof summarize>;
  windows: Record<string, ReturnType<typeof summarize>>;
  score: number;
}> = [];

for (const minimumProjection of [0.08, 0.1, 0.12, 0.14]) {
  for (const minimumRecentSurvival of [0.15, 0.18, 0.2, 0.22]) {
    for (const minimumMarketProbability of [0.08, 0.1, 0.12]) {
      for (const minimumExpectedValue of [0.04, 0.08, 0.12]) {
        for (const minimumStandardizedExpectedValue of [0.5, 0.75, 1, 1.25, 1.5]) {
          for (const maximumAmericanOdds of [500, 650, 800]) {
            const policy: Policy = {
              minimumProjection,
              minimumRecentSurvival,
              minimumMarketProbability,
              minimumExpectedValue,
              minimumStandardizedExpectedValue,
              minimumAmericanOdds: 200,
              maximumAmericanOdds,
            };
            const windowResults = Object.fromEntries(
              Object.entries(developmentWindows).map(
                ([name, [from, through]]) => [
                  name,
                  summarize(select(rows, policy, from, through)),
                ],
              ),
            );
            const parts = Object.values(windowResults);
            if (
              parts.some((part) =>
                part.count < 8 || part.roi === null || part.roi <= 0)
            ) continue;
            const developmentRows = Object.values(developmentWindows).flatMap(
              ([from, through]) => select(rows, policy, from, through),
            );
            const development = summarize(developmentRows);
            if (development.count < 50 || development.roi === null) continue;
            const rois = parts.map((part) => part.roi ?? -1);
            candidates.push({
              policy,
              development,
              windows: windowResults,
              score:
                Math.min(...rois)
                - standardDeviation(rois) * 0.2
                + Math.log1p(development.count) / 100,
            });
          }
        }
      }
    }
  }
}

candidates.sort((a, b) =>
  b.score - a.score
  || b.development.count - a.development.count);
const selected = candidates[0] ?? null;
const lowerThresholdDiagnostic = candidates.find(({ policy }) =>
  policy.minimumProjection === 0.08
  && policy.minimumRecentSurvival === 0.15
  && policy.minimumMarketProbability === 0.08
  && policy.minimumExpectedValue === 0.08
  && policy.minimumStandardizedExpectedValue === 0.75
  && policy.maximumAmericanOdds === 650) ?? null;
const untouchedRows = selected
  ? select(rows, selected.policy, untouchedWindow[0], untouchedWindow[1])
  : [];
const allSelected = selected
  ? [
    ...Object.values(developmentWindows).flatMap(([from, through]) =>
      select(rows, selected.policy, from, through)),
    ...untouchedRows,
  ]
  : [];

const report = {
  generatedAt: new Date().toISOString(),
  input: inputPath,
  methodology: {
    noFixedCountOrRelativeFraction: true,
    rule:
      "Promote every eligible row whose expected value clears an absolute threshold and a fixed within-slate z-score threshold.",
    policySelectionUsedThrough: "2026-07-12",
    untouchedValidation: untouchedWindow,
    candidateGridSize: 4 * 4 * 3 * 3 * 5 * 3,
    note:
      "The z-score normalizes slate-wide price scale but does not select a required count or percentage.",
  },
  observations: rows.length,
  eligiblePolicies: candidates.length,
  lowerThresholdDiagnostic: lowerThresholdDiagnostic && {
    ...lowerThresholdDiagnostic,
    untouchedValidation: summarize(select(
      rows,
      lowerThresholdDiagnostic.policy,
      untouchedWindow[0],
      untouchedWindow[1],
    )),
  },
  selected: selected && {
    ...selected,
    untouchedValidation: summarize(untouchedRows),
    combined: summarize(allSelected),
    dailyVolume: summarizeDailyVolume(allSelected),
    dateClusterBootstrap: clusterBootstrap(allSelected),
    zThresholdSensitivity: [0.5, 0.75, 1, 1.25].map(
      (minimumStandardizedExpectedValue) => {
        const policy = {
          ...selected.policy,
          minimumStandardizedExpectedValue,
        };
        return {
          minimumStandardizedExpectedValue,
          development: summarize(
            Object.values(developmentWindows).flatMap(([from, through]) =>
              select(rows, policy, from, through)),
          ),
          untouchedValidation: summarize(
            select(rows, policy, untouchedWindow[0], untouchedWindow[1]),
          ),
        };
      },
    ),
  },
};

writeFileSync(outputPath, `${JSON.stringify(report, null, 2)}\n`);
console.log(JSON.stringify(report, null, 2));

function select(
  sourceRows: Scored[],
  policy: Policy,
  from: string,
  through: string,
): Scored[] {
  const inWindow = sourceRows.filter((row) =>
    row.date >= from
    && row.date <= through
    && row.projection >= policy.minimumProjection
    && row.recentSurvival >= policy.minimumRecentSurvival
    && row.marketOver >= policy.minimumMarketProbability
    && row.americanOdds >= policy.minimumAmericanOdds
    && row.americanOdds <= policy.maximumAmericanOdds);
  return [...groupRows(inWindow, (row) => row.date).values()].flatMap(
    (daily) => {
      const mean = average(daily.map((row) => row.expectedValue));
      const deviation = standardDeviation(
        daily.map((row) => row.expectedValue),
      );
      if (deviation <= 0) return [];
      return daily.filter((row) =>
        row.expectedValue >= policy.minimumExpectedValue
        && (row.expectedValue - mean) / deviation
          >= policy.minimumStandardizedExpectedValue);
    },
  );
}

function score(row: Observation): Scored[] {
  if (
    row.line !== 0.5
    || row.priorGames < 10
    || ![
      row.projection,
      row.recentSurvival,
      row.marketOver,
      row.bestOverDecimal,
      row.overWon,
    ].every(Number.isFinite)
  ) return [];
  const americanOdds = decimalToAmerican(row.bestOverDecimal);
  const result = scoreHomeRunRelativeQualityCandidate({
    projection: row.projection,
    recentSurvival: row.recentSurvival,
    marketProbability: row.marketOver,
    americanOdds,
    line: row.line,
  });
  return [{
    ...row,
    id: `${row.date}|${row.gameId}|${row.playerId}|${row.line}`,
    americanOdds,
    expectedValue: result.expectedValue,
    profit: row.overWon ? row.bestOverDecimal - 1 : -1,
  }];
}

function bestOfferPerPlayerGame(sourceRows: Observation[]): Observation[] {
  const best = new Map<string, Observation>();
  for (const row of sourceRows) {
    const key = `${row.date}|${row.gameId}|${row.playerId}|${row.line}`;
    const current = best.get(key);
    if (!current || row.bestOverDecimal > current.bestOverDecimal) {
      best.set(key, row);
    }
  }
  return [...best.values()];
}

function summarize(sourceRows: Scored[]) {
  const wins = sourceRows.reduce((sum, row) => sum + row.overWon, 0);
  const units = sourceRows.reduce((sum, row) => sum + row.profit, 0);
  return {
    count: sourceRows.length,
    wins,
    losses: sourceRows.length - wins,
    units: round(units),
    roi: sourceRows.length ? round(units / sourceRows.length) : null,
  };
}

function summarizeDailyVolume(sourceRows: Scored[]) {
  const counts = [...groupRows(sourceRows, (row) => row.date).values()]
    .map((group) => group.length)
    .sort((a, b) => a - b);
  return counts.length ? {
    activeDates: counts.length,
    minimum: counts[0],
    maximum: counts.at(-1),
    mean: round(average(counts)),
    median: counts[Math.floor(counts.length / 2)],
  } : {
    activeDates: 0,
    minimum: 0,
    maximum: 0,
    mean: 0,
    median: 0,
  };
}

function clusterBootstrap(sourceRows: Scored[]) {
  const groups = [...groupRows(sourceRows, (row) => row.date).values()];
  if (!groups.length) return null;
  const random = seededRandom(20260728);
  const rois: number[] = [];
  for (let iteration = 0; iteration < 20_000; iteration += 1) {
    let count = 0;
    let units = 0;
    for (let index = 0; index < groups.length; index += 1) {
      const sample = groups[Math.floor(random() * groups.length)] ?? [];
      count += sample.length;
      units += sample.reduce((sum, row) => sum + row.profit, 0);
    }
    rois.push(units / count);
  }
  rois.sort((a, b) => a - b);
  return {
    roi95: [
      round(rois[Math.floor(rois.length * 0.025)] ?? 0),
      round(rois[Math.floor(rois.length * 0.975)] ?? 0),
    ],
    positiveProbability:
      round(rois.filter((roi) => roi > 0).length / rois.length),
    dateClusters: groups.length,
  };
}

function groupRows<T>(
  sourceRows: T[],
  key: (row: T) => string,
): Map<string, T[]> {
  const grouped = new Map<string, T[]>();
  for (const row of sourceRows) {
    const groupKey = key(row);
    grouped.set(groupKey, [...(grouped.get(groupKey) ?? []), row]);
  }
  return grouped;
}

function average(values: number[]): number {
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

function standardDeviation(values: number[]): number {
  const mean = average(values);
  return Math.sqrt(average(values.map((value) => (value - mean) ** 2)));
}

function decimalToAmerican(decimal: number): number {
  return decimal >= 2
    ? Math.round((decimal - 1) * 100)
    : Math.round(-100 / (decimal - 1));
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
