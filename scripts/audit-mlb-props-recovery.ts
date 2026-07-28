import { readFileSync, writeFileSync } from "node:fs";
import {
  HOME_RUN_STANDARDIZED_QUALITY_POLICY,
  MLB_PROPS_RECOVERY_POLICY_VERSION,
  projectAuditableCountOverProbability,
  qualifiesHitsUnderPriceEdge,
  scoreHomeRunRelativeQualityCandidate,
  selectStandardizedQualityCandidateIds,
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
  bestUnderDecimal: number;
};

type Decision = Observation & {
  side: "over" | "under";
  probability: number;
  expectedValue: number;
  americanOdds: number;
  profit: number;
};

const inputPath = process.argv[2];
const outputPath = process.argv[3] ?? "/tmp/mlb-props-recovery-audit.json";
if (!inputPath) {
  throw new Error(
    "Usage: npx tsx scripts/audit-mlb-props-recovery.ts <observations.json> [output.json]",
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

const homeRunRows = bestOfferPerPlayerGame(
  observations["batter_home_runs|milestone"] ?? [],
  "over",
).filter(validHomeRunObservation);
const hitsRows = bestOfferPerPlayerGame(
  observations["batter_hits|two_way"] ?? [],
  "under",
).filter(validHitsObservation);

const recoveredHomeRuns = selectHomeRuns(homeRunRows);
const priorHomeRuns = selectPriorRankedHomeRuns(homeRunRows);
const recoveredHomeRunKeys = new Set(recoveredHomeRuns.map(decisionKey));
const priorHomeRunKeys = new Set(priorHomeRuns.map(decisionKey));
const homeRunWindowResults = Object.fromEntries(
  Object.entries(windows).map(([name, [from, through]]) => [
    name,
    summarize(recoveredHomeRuns.filter((row) => row.date >= from && row.date <= through)),
  ]),
);

const recoveredHits = selectHitsUnder(hitsRows);
const priorHits = selectPriorHitsUnder(hitsRows);
const priorHitKeys = new Set(priorHits.map(decisionKey));
const pairedHits = [
  ...priorHits,
  ...recoveredHits.filter((row) => !priorHitKeys.has(decisionKey(row))),
];
const hitWindowResults = Object.fromEntries(
  Object.entries(windows).map(([name, [from, through]]) => [
    name,
    summarize(recoveredHits.filter((row) => row.date >= from && row.date <= through)),
  ]),
);

const report = {
  generatedAt: new Date().toISOString(),
  policyVersion: MLB_PROPS_RECOVERY_POLICY_VERSION,
  input: inputPath,
  chronology: {
    ruleSelectionUsedThrough: "2026-07-12",
    gap: ["2026-07-13", "2026-07-15"],
    untouchedValidation: windows.untouchedValidation,
  },
  homeRuns: {
    qualifiedForRuntime: true,
    observations: homeRunRows.length,
    policy: HOME_RUN_STANDARDIZED_QUALITY_POLICY,
    windows: homeRunWindowResults,
    combined: summarize(recoveredHomeRuns),
    dailyVolume: summarizeDailyVolume(recoveredHomeRuns),
    dateClusterBootstrap: clusterBootstrap(recoveredHomeRuns),
    standardizedThresholdSensitivity: [0.75, 1, 1.25, 1.5].map((standardizedThreshold) => ({
      standardizedThreshold,
      windows: Object.fromEntries(
        Object.entries(windows).map(([name, [from, through]]) => [
          name,
          summarize(selectHomeRuns(
            homeRunRows.filter((row) => row.date >= from && row.date <= through),
            standardizedThreshold,
          )),
        ]),
      ),
    })),
    priorVsRecovered: {
      priorRankedSleeve: summarize(priorHomeRuns),
      recoveredStandardizedQuality: summarize(recoveredHomeRuns),
      retained: recoveredHomeRuns.filter((row) =>
        priorHomeRunKeys.has(decisionKey(row))).length,
      promoted: recoveredHomeRuns.filter((row) =>
        !priorHomeRunKeys.has(decisionKey(row))).length,
      demoted: priorHomeRuns.filter((row) =>
        !recoveredHomeRunKeys.has(decisionKey(row))).length,
      netActions: recoveredHomeRuns.length - priorHomeRuns.length,
    },
  },
  hitsUnder: {
    observations: hitsRows.length,
    windows: hitWindowResults,
    combined: summarize(recoveredHits),
    dateClusterBootstrap: clusterBootstrap(recoveredHits),
    priorVsPairedPolicy: {
      prior: summarize(priorHits),
      recoveredBestAngles: summarize(recoveredHits),
      pairedActionableUnion: summarize(pairedHits),
      retained: priorHits.length,
      promoted: recoveredHits.filter((row) => !priorHitKeys.has(decisionKey(row))).length,
      demoted: 0,
      netActions: pairedHits.length - priorHits.length,
    },
  },
};

writeFileSync(outputPath, `${JSON.stringify(report, null, 2)}\n`);
console.log(JSON.stringify(report, null, 2));

function selectHomeRuns(
  source: Observation[],
  standardizedThreshold: number =
    HOME_RUN_STANDARDIZED_QUALITY_POLICY.minimumStandardizedExpectedValue,
): Decision[] {
  const eligible = source.flatMap((row) => {
    const americanOdds = decimalToAmerican(row.bestOverDecimal);
    const score = scoreHomeRunRelativeQualityCandidate({
      projection: row.projection,
      recentSurvival: row.recentSurvival,
      marketProbability: row.marketOver,
      americanOdds,
      line: row.line,
    });
    if (!score.eligible) return [];
    return [{
      ...row,
      side: "over" as const,
      probability: score.finalProbability,
      expectedValue: score.expectedValue,
      americanOdds,
      profit: row.overWon ? row.bestOverDecimal - 1 : -1,
    }];
  });
  return groupByDate(eligible).flatMap((daily) => {
    const selectedIds = selectStandardizedQualityCandidateIds(
      daily.map((row) => ({
        id: decisionKey(row),
        expectedValue: row.expectedValue,
      })),
      standardizedThreshold,
    );
    return daily.filter((row) => selectedIds.has(decisionKey(row)));
  });
}

function selectPriorRankedHomeRuns(source: Observation[]): Decision[] {
  const eligible = source.flatMap((row) => {
    const modelProbability = projectAuditableCountOverProbability({
      projection: row.projection,
      line: row.line,
    });
    const probability = row.marketOver + 0.1 * (modelProbability - row.marketOver);
    const expectedValue = probability * row.bestOverDecimal - 1;
    const americanOdds = decimalToAmerican(row.bestOverDecimal);
    if (
      row.projection < 0.08
      || row.recentSurvival < 0.18
      || row.marketOver < 0.1
      || expectedValue < 0
      || americanOdds < 200
      || americanOdds > 650
    ) return [];
    return [{
      ...row,
      side: "over" as const,
      probability,
      expectedValue,
      americanOdds,
      profit: row.overWon ? row.bestOverDecimal - 1 : -1,
    }];
  });
  return groupByDate(eligible).flatMap((daily) =>
    [...daily].sort((a, b) => b.expectedValue - a.expectedValue).slice(0, 5));
}

function selectHitsUnder(source: Observation[]): Decision[] {
  return source.flatMap((row) => {
    const probability = 1 - row.marketOver;
    const americanOdds = decimalToAmerican(row.bestUnderDecimal);
    if (!qualifiesHitsUnderPriceEdge({
      marketProbability: probability,
      americanOdds,
    })) return [];
    return [{
      ...row,
      side: "under" as const,
      probability,
      expectedValue: probability * row.bestUnderDecimal - 1,
      americanOdds,
      profit: row.overWon ? -1 : row.bestUnderDecimal - 1,
    }];
  });
}

function selectPriorHitsUnder(source: Observation[]): Decision[] {
  const eligible = source.flatMap((row) => {
    const marketProbability = 1 - row.marketOver;
    const modelProbability = 1 - projectAuditableCountOverProbability({
      projection: row.projection,
      line: row.line,
    });
    const probability = marketProbability + 0.3 * (modelProbability - marketProbability);
    const expectedValue = probability * row.bestUnderDecimal - 1;
    if (
      modelProbability < 0.56
      || modelProbability - marketProbability < 0.1
      || probability - marketProbability < 0.02
      || expectedValue < 0.01
    ) return [];
    return [{
      ...row,
      side: "under" as const,
      probability,
      expectedValue,
      americanOdds: decimalToAmerican(row.bestUnderDecimal),
      profit: row.overWon ? -1 : row.bestUnderDecimal - 1,
    }];
  });
  return groupByDateAndGame(eligible).flatMap((game) =>
    [...game].sort((a, b) => b.expectedValue - a.expectedValue).slice(0, 1));
}

function summarize(rows: Decision[]) {
  const units = rows.reduce((sum, row) => sum + row.profit, 0);
  const days = new Set(rows.map((row) => row.date)).size;
  const outcomes = rows.map((row) => row.profit > 0 ? 1 : 0);
  const brier = rows.length
    ? rows.reduce((sum, row) => {
      const outcome = row.profit > 0 ? 1 : 0;
      return sum + (row.probability - outcome) ** 2;
    }, 0) / rows.length
    : null;
  const logLoss = rows.length
    ? rows.reduce((sum, row) => {
      const probability = Math.min(1 - 1e-9, Math.max(1e-9, row.probability));
      const outcome = row.profit > 0 ? 1 : 0;
      return sum - (
        outcome * Math.log(probability)
        + (1 - outcome) * Math.log(1 - probability)
      );
    }, 0) / rows.length
    : null;
  const meanProbability = rows.length
    ? rows.reduce((sum, row) => sum + row.probability, 0) / rows.length
    : null;
  const observedRate = rows.length
    ? outcomes.reduce<number>((sum, outcome) => sum + outcome, 0) / rows.length
    : null;
  return {
    count: rows.length,
    wins: outcomes.filter(Boolean).length,
    units: round(units),
    roi: rows.length ? round(units / rows.length) : null,
    brier: brier === null ? null : round(brier),
    logLoss: logLoss === null ? null : round(logLoss),
    meanProbability: meanProbability === null ? null : round(meanProbability),
    observedRate: observedRate === null ? null : round(observedRate),
    calibrationGap: meanProbability === null || observedRate === null
      ? null
      : round(meanProbability - observedRate),
    activeDays: days,
    averagePerActiveDay: days ? round(rows.length / days) : null,
  };
}

function validHomeRunObservation(row: Observation): boolean {
  return row.line === 0.5
    && row.priorGames >= 10
    && [row.projection, row.recentSurvival, row.marketOver, row.bestOverDecimal]
      .every(Number.isFinite);
}

function validHitsObservation(row: Observation): boolean {
  return [row.marketOver, row.bestUnderDecimal, row.overWon].every(Number.isFinite);
}

function bestOfferPerPlayerGame(
  source: Observation[],
  side: "over" | "under",
): Observation[] {
  const best = new Map<string, Observation>();
  for (const row of source) {
    const key = `${row.date}|${row.gameId}|${row.playerId}|${row.line}`;
    const existing = best.get(key);
    const priceKey = side === "over" ? "bestOverDecimal" : "bestUnderDecimal";
    if (!existing || row[priceKey] > existing[priceKey]) best.set(key, row);
  }
  return [...best.values()];
}

function groupByDate(rows: Decision[]): Decision[][] {
  const grouped = new Map<string, Decision[]>();
  for (const row of rows) {
    const group = grouped.get(row.date) ?? [];
    group.push(row);
    grouped.set(row.date, group);
  }
  return [...grouped.values()];
}

function summarizeDailyVolume(rows: Decision[]) {
  const counts = groupByDate(rows).map((daily) => daily.length);
  return {
    activeDates: counts.length,
    minimum: counts.length ? Math.min(...counts) : null,
    maximum: counts.length ? Math.max(...counts) : null,
    average: counts.length
      ? round(counts.reduce((sum, count) => sum + count, 0) / counts.length)
      : null,
  };
}

function groupByDateAndGame(rows: Decision[]): Decision[][] {
  const grouped = new Map<string, Decision[]>();
  for (const row of rows) {
    const key = `${row.date}|${row.gameId}`;
    const group = grouped.get(key) ?? [];
    group.push(row);
    grouped.set(key, group);
  }
  return [...grouped.values()];
}

function decisionKey(row: Decision): string {
  return `${row.date}|${row.gameId}|${row.playerId}|${row.side}|${row.line}`;
}

function decimalToAmerican(decimal: number): number {
  return decimal >= 2
    ? Math.round((decimal - 1) * 100)
    : Math.round(-100 / (decimal - 1));
}

function clusterBootstrap(rows: Decision[]) {
  const groups = groupByDate(rows);
  if (!groups.length) return null;
  const random = seededRandom(20260728);
  const rois: number[] = [];
  for (let iteration = 0; iteration < 20_000; iteration++) {
    let count = 0;
    let units = 0;
    for (let index = 0; index < groups.length; index++) {
      const sample = groups[Math.floor(random() * groups.length)];
      count += sample.length;
      units += sample.reduce((sum, row) => sum + row.profit, 0);
    }
    rois.push(units / count);
  }
  rois.sort((a, b) => a - b);
  return {
    roi95: [
      round(rois[Math.floor(rois.length * 0.025)]),
      round(rois[Math.floor(rois.length * 0.975)]),
    ],
    positiveProbability: round(
      rois.filter((roi) => roi > 0).length / rois.length,
    ),
    dateClusters: groups.length,
  };
}

function seededRandom(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (1664525 * state + 1013904223) >>> 0;
    return state / 4294967296;
  };
}

function round(value: number): number {
  return Math.round(value * 1_000_000) / 1_000_000;
}
