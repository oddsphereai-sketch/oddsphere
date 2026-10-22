/**
 * Read-only release-pure comparison of two point-in-time feature datasets
 * scored through the same frozen NBA props artifact, price archive, and grade
 * policy. It performs no provider, database, member, lock, or tracking writes.
 */

import { readFile } from "node:fs/promises";
import path from "node:path";
import type { NbaPlayerPropPriceObservation } from "../../../lib/services/nba/nbaPlayerPropsContract";
import {
  buildNbaPlayerPropsForwardDecisions,
  type NbaPlayerPropsForwardDecision,
} from "../../../lib/services/nba/nbaPlayerPropsFrozenRuntime";
import type { NbaPlayerPropFeatureRow } from "../../../lib/services/nba/nbaPlayerPropsPointInTimeFeatures";

type Dataset = {
  mode: "offline_research_only";
  actionable: false;
  projectionFeatureRows: NbaPlayerPropFeatureRow[];
  openingObservations: NbaPlayerPropPriceObservation[];
  immutableInputsSha256: string;
};

type Market = NbaPlayerPropsForwardDecision["market"];
type Settled = NbaPlayerPropsForwardDecision & { won: boolean; profit: number };

function value(name: string): string | undefined {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : undefined;
}

function target(row: NbaPlayerPropFeatureRow, market: Market): number | null {
  if (market === "points") return row.target_points;
  if (market === "rebounds") return row.target_rebounds;
  if (market === "assists") return row.target_assists;
  if (market === "threes") return row.target_threes;
  if (market === "points_rebounds_assists") return row.target_points_rebounds_assists;
  if (market === "points_rebounds") return row.target_points_rebounds;
  if (market === "points_assists") return row.target_points_assists;
  return row.target_rebounds_assists;
}

function profit(won: boolean, americanPrice: number): number {
  if (!won) return -1;
  return americanPrice > 0 ? americanPrice / 100 : 100 / -americanPrice;
}

function settle(decisions: readonly NbaPlayerPropsForwardDecision[], rows: readonly NbaPlayerPropFeatureRow[]): Settled[] {
  const byPlayerGame = new Map(rows.map((row) => [`${row.game_id}|${row.player_id}`, row]));
  return decisions.flatMap((decision) => {
    const row = byPlayerGame.get(`${decision.gameId}|${decision.playerId}`);
    const actual = row ? target(row, decision.market) : null;
    if (actual === null || actual === decision.line) return [];
    const won = decision.side === (actual > decision.line ? "over" : "under");
    return [{ ...decision, won, profit: profit(won, decision.americanPrice) }];
  });
}

function summary(rows: readonly Settled[]) {
  const actionables = rows.filter((row) => row.grade === "Lean" || row.grade === "Best Angle");
  const metrics = (values: readonly Settled[]) => ({
    rows: values.length,
    wins: values.filter((row) => row.won).length,
    accuracy: values.length > 0 ? values.filter((row) => row.won).length / values.length : null,
    units: values.reduce((sum, row) => sum + row.profit, 0),
    roi: values.length > 0 ? values.reduce((sum, row) => sum + row.profit, 0) / values.length : null,
  });
  return {
    overall: metrics(rows),
    actionable: metrics(actionables),
    gradeCounts: Object.fromEntries(["No Play", "Watchlist", "Lean", "Best Angle"].map((grade) => [
      grade,
      rows.filter((row) => row.grade === grade).length,
    ])),
    byMarket: Object.fromEntries([...new Set(rows.map((row) => row.market))].sort().map((market) => [
      market,
      metrics(rows.filter((row) => row.market === market)),
    ])),
  };
}

function identity(row: NbaPlayerPropsForwardDecision): string {
  return `${row.gameId}|${row.playerId}|${row.market}`;
}

async function main(): Promise<void> {
  const baselineValue = value("--baseline");
  const candidateValue = value("--candidate");
  if (!baselineValue || !candidateValue) throw new Error("--baseline and --candidate are required.");
  const [baseline, candidate] = await Promise.all([
    readFile(path.resolve(baselineValue), "utf8").then((raw) => JSON.parse(raw) as Dataset),
    readFile(path.resolve(candidateValue), "utf8").then((raw) => JSON.parse(raw) as Dataset),
  ]);
  for (const [label, dataset] of [["baseline", baseline], ["candidate", candidate]] as const) {
    if (dataset.mode !== "offline_research_only" || dataset.actionable !== false) {
      throw new Error(`${label} input is not a read-only research dataset.`);
    }
  }
  const baselineDecisions = buildNbaPlayerPropsForwardDecisions({
    features: baseline.projectionFeatureRows,
    observations: baseline.openingObservations,
  });
  const candidateDecisions = buildNbaPlayerPropsForwardDecisions({
    features: candidate.projectionFeatureRows,
    observations: candidate.openingObservations,
  });
  const baselineById = new Map(baselineDecisions.map((row) => [identity(row), row]));
  const candidateById = new Map(candidateDecisions.map((row) => [identity(row), row]));
  const commonIds = [...baselineById.keys()].filter((id) => candidateById.has(id));
  const baselineCommon = settle(commonIds.map((id) => baselineById.get(id)!), baseline.projectionFeatureRows);
  const candidateCommon = settle(commonIds.map((id) => candidateById.get(id)!), candidate.projectionFeatureRows);
  const baselineSettledById = new Map(baselineCommon.map((row) => [identity(row), row]));
  const candidateSettledById = new Map(candidateCommon.map((row) => [identity(row), row]));
  const comparable = [...baselineSettledById.keys()].filter((id) => candidateSettledById.has(id));
  const rank = (grade: NbaPlayerPropsForwardDecision["grade"]) =>
    grade === "Best Angle" ? 3 : grade === "Lean" ? 2 : grade === "Watchlist" ? 1 : 0;
  const changes = comparable.map((id) => ({
    baseline: baselineSettledById.get(id)!,
    candidate: candidateSettledById.get(id)!,
  }));
  process.stdout.write(`${JSON.stringify({
    release: "nba_player_props_active_runtime_input_diff_2026_10_22_r1",
    mode: "read_only",
    publicWrites: false,
    providerRequests: 0,
    baselineImmutableInputsSha256: baseline.immutableInputsSha256,
    candidateImmutableInputsSha256: candidate.immutableInputsSha256,
    baselineDecisions: baselineDecisions.length,
    candidateDecisions: candidateDecisions.length,
    commonSettledRows: comparable.length,
    baseline: summary(comparable.map((id) => baselineSettledById.get(id)!)),
    candidate: summary(comparable.map((id) => candidateSettledById.get(id)!)),
    changes: {
      projection: changes.filter(({ baseline: left, candidate: right }) => left.finalProjection !== right.finalProjection).length,
      side: changes.filter(({ baseline: left, candidate: right }) => left.side !== right.side).length,
      promotion: changes.filter(({ baseline: left, candidate: right }) => rank(right.grade) > rank(left.grade)).length,
      demotion: changes.filter(({ baseline: left, candidate: right }) => rank(right.grade) < rank(left.grade)).length,
      candidateZeroIndependent: candidateDecisions.filter((row) => row.independentProjection === 0).length,
      candidateZeroFinal: candidateDecisions.filter((row) => row.finalProjection === 0).length,
    },
  }, null, 2)}\n`);
}

void main();
