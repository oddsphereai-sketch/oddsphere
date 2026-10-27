/** SELECT-free, read-only replay of the Receptions direction-authority release. */
import { readFile } from "node:fs/promises";

import {
  gradeNflPlayerPropsCrossMarketCandidate,
  nflPlayerPropsCoherentPosteriorDistribution,
  nflPlayerPropsDiscreteMarketArbitration,
  nflPlayerPropsExpectedValue,
  nflPlayerPropsProductionMarketLane,
  nflPlayerPropsRawMarketDivergenceImplausible,
  nflPlayerPropsRuntimeMarketPolicy,
  nflPlayerPropsRuntimePolicy,
  type NflPlayerPropsGrade,
} from "../../lib/services/football/nflPlayerPropsRuntime";
import {
  summarizePrivatePlayerPropTracking,
  type PrivatePlayerPropSettledRow,
} from "../../lib/services/playerPropsPrivateDiagnostics";

type Side = "over" | "under";
type HistoryRow = {
  gameId: string;
  playerName: string;
  market: string;
  line: number;
  side: Side;
  sportsbook: string;
  americanPrice: number;
  canonicalMainLine: boolean;
  projection: number | null;
  independentProjection: number | null;
  rawModelProbability: number | null;
  marketProbability: number | null;
  finalProbability: number | null;
  grade: string;
  marketMovement: "support" | "adverse" | "neutral" | null;
  decisionRelease: string;
  lockedAt: string;
  actual?: number;
  healthHolds: string[];
  participationProbability: number;
};
type History = { history: { rows: HistoryRow[] } };
type Forecast = {
  gameId: string;
  playerName: string;
  market: string;
  line: number;
  actual: number;
  decisionRelease: string;
};
type Report = { forecasts: Forecast[] };

const weeks = [6, 7];
const decisionRelease = "nfl_player_props_decision_2026_10_15_r32_independent_rushing_yards";

async function main(): Promise<void> {
  const report = JSON.parse(await readFile("/private/tmp/nfl-props-week8.json", "utf8")) as Report;
  const actuals = new Map(report.forecasts.map((row) => [scopeKey(row), row.actual]));
  const byWeek = new Map<number, HistoryRow[]>();
  for (const week of weeks) {
    const value = JSON.parse(await readFile(`/private/tmp/nfl-props-week${week}-private-history.json`, "utf8")) as History;
    byWeek.set(week, value.history.rows.filter((row) => row.market === "receptions"
      && row.decisionRelease === decisionRelease && actuals.has(scopeKey(row))));
  }

  const output = Object.fromEntries([...weeks, 0].map((week) => {
    const source = week === 0 ? weeks.flatMap((value) => byWeek.get(value) ?? []) : byWeek.get(week) ?? [];
    const incumbent = toSettled(source, actuals, false);
    const candidate = toSettled(source, actuals, true);
    const incumbentReport = summarizePrivatePlayerPropTracking(incumbent);
    const candidateReport = summarizePrivatePlayerPropTracking(candidate);
    const incumbentMain = incumbentReport.forecasts.filter((row) => row.canonicalMainLine);
    const candidateMain = candidateReport.forecasts.filter((row) => row.canonicalMainLine);
    const incumbentActionableScopes = new Set(incumbentMain.filter((row) => actionable(row.grade)).map((row) => row.scopeKey));
    const transferredActionables = candidateMain.filter((row) => incumbentActionableScopes.has(row.scopeKey));
    return [week === 0 ? "combined" : `week${week}`, {
      incumbent: compact(incumbentMain),
      candidate: compact(candidateMain),
      candidateAtIncumbentActionableScopes: record(transferredActionables),
      candidateCalibrationGrid: calibrationGrid(candidateMain),
      candidateMovementGrid: movementGrid(source, candidateMain),
      promotions: changed(incumbentMain, candidateMain, false, true),
      demotions: changed(incumbentMain, candidateMain, true, false),
    }];
  }));

  console.log(JSON.stringify({
    auditRelease: "nfl_player_props_receptions_direction_authority_audit_2026_10_27_r1",
    readOnly: true,
    providerCalls: 0,
    databaseReads: 0,
    writes: 0,
    decisionRelease,
    output,
  }, null, 2));
}

function movementGrid(
  source: HistoryRow[],
  rows: ReturnType<typeof summarizePrivatePlayerPropTracking>["forecasts"],
) {
  const candidates = rows.filter((row) => row.result !== "push" && actionable(row.grade));
  const movement = (row: (typeof rows)[number]) => source.find((value) => scopeKey(value) === scopeKey(row)
    && value.side === row.prediction
    && normalize(value.sportsbook) === normalize(row.bestAvailableSportsbook ?? ""))?.marketMovement ?? "neutral";
  return Object.fromEntries(["support", "neutral", "adverse"].map((state) => {
    const selected = candidates.filter((row) => movement(row) === state);
    return [state, { ...record(selected), directions: counts(selected.map((row) => row.prediction)) }];
  }));
}

function calibrationGrid(rows: ReturnType<typeof summarizePrivatePlayerPropTracking>["forecasts"]) {
  const base = rows.filter((row) => row.result !== "push" && actionable(row.grade));
  const rules = [
    { minimumProbability: 0.55, minimumEdge: 0, minimumEv: 0 },
    { minimumProbability: 0.575, minimumEdge: 0, minimumEv: 0 },
    { minimumProbability: 0.6, minimumEdge: 0, minimumEv: 0 },
    { minimumProbability: 0.625, minimumEdge: 0, minimumEv: 0 },
    { minimumProbability: 0.55, minimumEdge: 0.02, minimumEv: 0.02 },
    { minimumProbability: 0.575, minimumEdge: 0.02, minimumEv: 0.02 },
    { minimumProbability: 0.6, minimumEdge: 0.02, minimumEv: 0.02 },
    { minimumProbability: 0.55, minimumEdge: 0.03, minimumEv: 0.03 },
    { minimumProbability: 0.575, minimumEdge: 0.03, minimumEv: 0.03 },
  ];
  const probabilityRules = rules.map((rule) => {
    const selected = base.filter((row) => row.finalProbability !== null && row.marketProbability !== null
      && row.bestAvailableAmericanPrice !== null
      && row.finalProbability >= rule.minimumProbability
      && row.finalProbability - row.marketProbability >= rule.minimumEdge
      && nflPlayerPropsExpectedValue(row.finalProbability, row.bestAvailableAmericanPrice) >= rule.minimumEv);
    return { ...rule, ...record(selected), directions: counts(selected.map((row) => row.prediction)) };
  });
  const independentRules = [0.52, 0.55, 0.575, 0.6, 0.625, 0.65].flatMap((minimumIndependentProbability) =>
    [0, 0.02, 0.03].map((minimumEv) => {
      const selected = base.filter((row) => row.rawProbability !== null
        && row.bestAvailableAmericanPrice !== null
        && row.rawProbability >= minimumIndependentProbability
        && nflPlayerPropsExpectedValue(row.finalProbability ?? row.rawProbability, row.bestAvailableAmericanPrice) >= minimumEv);
      return { minimumIndependentProbability, minimumEv, ...record(selected),
        directions: counts(selected.map((row) => row.prediction)) };
    }));
  return { probabilityRules, independentRules };
}

function toSettled(
  rows: HistoryRow[],
  actuals: Map<string, number>,
  candidate: boolean,
): PrivatePlayerPropSettledRow[] {
  const booksByScope = new Map<string, Set<string>>();
  for (const row of rows) {
    const key = scopeKey(row);
    const books = booksByScope.get(key) ?? new Set<string>();
    books.add(normalize(row.sportsbook));
    booksByScope.set(key, books);
  }
  return rows.flatMap((row): PrivatePlayerPropSettledRow[] => {
    const actual = actuals.get(scopeKey(row));
    if (actual === undefined || row.rawModelProbability === null || row.marketProbability === null
      || row.finalProbability === null || row.independentProjection === null) return [];
    const independentBooks = Math.max(0, (booksByScope.get(scopeKey(row))?.size ?? 1) - 1);
    if (!candidate) return [{ ...row, sport: "nfl", publishedPrediction: null, actual }];
    const rawOver = overProbability(row.side, row.rawModelProbability);
    const marketOver = overProbability(row.side, row.marketProbability);
    const incumbentOver = overProbability(row.side, row.finalProbability);
    const finalOver = nflPlayerPropsDiscreteMarketArbitration({
      propMarket: "receptions",
      rawOverProbability: rawOver,
      marketOverProbability: marketOver,
      independentBooks,
      incumbentFinalOverProbability: incumbentOver,
    });
    if (!(finalOver > 0 && finalOver < 1)) return [];
    const finalProbability = row.side === "over" ? finalOver : 1 - finalOver;
    const marketProbability = row.marketProbability;
    const probabilityEdge = finalProbability - marketProbability;
    const expectedValue = nflPlayerPropsExpectedValue(finalProbability, row.americanPrice);
    const runtime = nflPlayerPropsRuntimePolicy();
    const lane = nflPlayerPropsProductionMarketLane("receptions");
    const policy = nflPlayerPropsRuntimeMarketPolicy("receptions");
    if (!lane || !policy) return [];
    const commonHolds = row.healthHolds.filter((reason) => ![
      "independent_same_line_confirmation_missing", "model_market_divergence_implausible",
    ].includes(reason));
    const movement = row.marketMovement ?? "neutral";
    const baseGrade = gradeNflPlayerPropsCrossMarketCandidate({
      commonHolds,
      independentBooks,
      divergenceImplausible: nflPlayerPropsRawMarketDivergenceImplausible(
        row.rawModelProbability, row.marketProbability,
      ),
      eligibleSide: lane.eligibleSides.includes(row.side),
      marketResidualQualified: policy.qualified || runtime.releaseEvidence.ownerApprovedForwardException === true,
      bestAngleEnabled: lane.bestAngle,
      leanEnabled: lane.lean,
      watchlistEnabled: lane.watchlist,
      expectedValue,
      probabilityEdge,
      participationProbability: row.participationProbability,
      movement,
      leanThresholds: movement === "support"
        ? runtime.volumeAndYardage.movementSupportedLean
        : lane.leanThresholds ?? runtime.volumeAndYardage.lean,
      bestAngleThresholds: movement === "support"
        ? runtime.volumeAndYardage.movementSupportedBestAngle
        : runtime.volumeAndYardage.bestAngle,
    });
    const forecastSide: Side = finalOver >= 0.5 ? "over" : "under";
    const grade: NflPlayerPropsGrade = actionable(baseGrade) && row.side !== forecastSide
      ? "Watchlist" : baseGrade;
    const posterior = nflPlayerPropsCoherentPosteriorDistribution({
      market: "receptions",
      line: row.line,
      calibratedOverProbability: finalOver,
      independentProjection: row.independentProjection,
    });
    return [{
      ...row,
      sport: "nfl",
      projection: posterior.projection,
      finalProbability,
      grade,
      publishedPrediction: forecastSide,
      actual,
    }];
  });
}

function compact(rows: ReturnType<typeof summarizePrivatePlayerPropTracking>["forecasts"]) {
  const settled = rows.filter((row) => row.result !== "push");
  const actions = settled.filter((row) => actionable(row.grade));
  return {
    predictions: record(settled),
    actionables: record(actions),
    actionableGrades: counts(actions.map((row) => row.grade)),
    actionableDirections: counts(actions.map((row) => row.prediction)),
  };
}

function changed(
  incumbent: ReturnType<typeof summarizePrivatePlayerPropTracking>["forecasts"],
  candidate: ReturnType<typeof summarizePrivatePlayerPropTracking>["forecasts"],
  incumbentActionable: boolean,
  candidateActionable: boolean,
) {
  const incumbentByKey = new Map(incumbent.map((row) => [row.scopeKey, row]));
  return candidate.filter((row) => {
    const previous = incumbentByKey.get(row.scopeKey);
    return previous && actionable(previous.grade) === incumbentActionable
      && actionable(row.grade) === candidateActionable;
  }).map((row) => ({
    player: row.playerName,
    gameId: row.gameId,
    line: row.line,
    prediction: row.prediction,
    grade: row.grade,
    result: row.result,
  }));
}

function record(rows: ReturnType<typeof summarizePrivatePlayerPropTracking>["forecasts"]) {
  const wins = rows.filter((row) => row.result === "win").length;
  const losses = rows.filter((row) => row.result === "loss").length;
  return { records: rows.length, wins, losses, hitRate: wins + losses ? wins / (wins + losses) : null };
}

function counts(values: string[]): Record<string, number> {
  return Object.fromEntries([...new Set(values)].sort().map((value) => [value, values.filter((item) => item === value).length]));
}

function overProbability(side: Side, value: number): number {
  return side === "over" ? value : 1 - value;
}

function scopeKey(row: Pick<HistoryRow | Forecast, "gameId" | "playerName" | "market" | "line">): string {
  return [row.gameId, normalize(row.playerName), row.market, row.line].join("|");
}

function normalize(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]/g, "");
}

function actionable(grade: string): boolean {
  return grade === "Best Angle" || grade === "Lean" || grade === "BEST_ANGLE" || grade === "LEAN";
}

void main();
