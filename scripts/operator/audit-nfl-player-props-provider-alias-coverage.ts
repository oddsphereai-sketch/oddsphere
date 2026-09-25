import { loadEnvConfig } from "@next/env";
import { createClient } from "@supabase/supabase-js";
import { collectNflPlayerPropsObservations } from "../../lib/services/football/nflPlayerPropsCollector";
import { readNflForwardEvidence } from "../../lib/services/football/nflForwardEvidenceStore";
import { buildNflPlayerPropsInferenceContextFromForwardEvidence } from "../../lib/services/football/nflPlayerPropsInferenceContext";
import { buildNflPlayerPropsExactBoard } from "../../lib/services/football/nflPlayerPropsMarketBoard";
import { readNflPlayerPropsCurrentSeasonState } from "../../lib/services/football/nflPlayerPropsCurrentSeasonState";
import {
  buildNflPlayerPropsRuntimeBoard,
  buildNflPlayerPropsRuntimeFeatureRows,
  type NflPlayerPropsRuntimeBoard,
  type NflPlayerPropsRuntimeDecision,
} from "../../lib/services/football/nflPlayerPropsRuntime";
import {
  reconcileNflPlayerPropsProductionSnapshot,
  type NflPlayerPropsProductionSnapshot,
} from "../../lib/services/football/nflPlayerPropsProductionContract";
import { readNflPlayerPropsSnapshot } from "../../lib/services/football/nflPlayerPropsSnapshotStore";
import type { NflPlayerPropsObservationSnapshot } from "../../lib/services/football/nflPlayerPropsContract";
import {
  nflPlayerPropsOverUnderMarketKey,
  nflPlayerPropsTouchdownPlayerKey,
  selectNflPlayerPropsOverForecasts,
  selectNflPlayerPropsTouchdownScorers,
} from "../../lib/services/football/nflPlayerPropsPrediction";

loadEnvConfig(process.cwd());

const ALIASES = new Set([
  "player_total_receptions",
  "player_total_rush_attempts",
  "player_rushing_+_receiving_yards",
]);

async function main(): Promise<void> {
  const season = 2026;
  const week = 2;
  const now = new Date().toISOString();
  const client = createClient(requiredEnv("NEXT_PUBLIC_SUPABASE_URL"), requiredEnv("SUPABASE_SERVICE_ROLE_KEY"), {
    auth: { persistSession: false },
  });
  const collection = await collectNflPlayerPropsObservations({
    season,
    week,
    phase: "regular",
    includeOpenings: true,
    ballDontLieApiKey: requiredEnv("BALLDONTLIE_API_KEY"),
    sharpApiKey: process.env.SHARPAPI_KEY,
  });
  const evidence = await readNflForwardEvidence({ client, season, week });
  const context = buildNflPlayerPropsInferenceContextFromForwardEvidence({
    snapshot: collection.snapshot,
    evidence,
    capturedAt: now,
  });
  const eligibleGameIds = new Set(context.games.map((game) => game.canonicalGameId));
  const candidateInput = eligibleSnapshot(collection.snapshot, eligibleGameIds);
  const baselineInput = {
    ...candidateInput,
    observations: candidateInput.observations.filter((row) => !ALIASES.has(row.providerMarket.toLowerCase())),
  };
  const currentSeasonState = await readNflPlayerPropsCurrentSeasonState({ client, season });
  const previous = await readNflPlayerPropsSnapshot({ client, season, week });
  const baseline = buildSnapshot(baselineInput, context, currentSeasonState, previous, season, week, now);
  const candidate = buildSnapshot(candidateInput, context, currentSeasonState, previous, season, week, now);
  const baselineRows = new Map(baseline.memberDecisions.map((row) => [decisionKey(row), row]));
  const candidateRows = new Map(candidate.memberDecisions.map((row) => [decisionKey(row), row]));
  const additions = [...candidateRows].filter(([key]) => !baselineRows.has(key)).map(([, row]) => compact(row));
  const removals = [...baselineRows].filter(([key]) => !candidateRows.has(key)).map(([, row]) => compact(row));
  const changed = [...candidateRows].flatMap(([key, row]) => {
    const before = baselineRows.get(key);
    if (!before || sameDecision(before, row)) return [];
    return [{ key, before: compact(before), after: compact(row) }];
  });
  const actionable = (snapshot: NflPlayerPropsProductionSnapshot) => snapshot.memberDecisions
    .filter((row) => row.grade === "Best Angle" || row.grade === "Lean")
    .map((row) => decisionKey(row));
  const baselineActions = new Set(actionable(baseline));
  const candidateActions = new Set(actionable(candidate));
  console.log(JSON.stringify({
    readOnly: true,
    season,
    week,
    evaluatedAt: now,
    aliasObservationRows: candidateInput.observations.filter((row) => ALIASES.has(row.providerMarket.toLowerCase())).length,
    providerRequests: collection.snapshot.providerRequests,
    baseline: summarize(baseline),
    candidate: summarize(candidate),
    candidateActionSides: countActionSides(candidate.memberDecisions),
    actionableScopesHiddenByRankedSibling: hiddenActionableScopes(candidate.memberDecisions),
    addedRows: additions.length,
    removedRows: removals.length,
    changedRows: changed.length,
    actionablePromotions: [...candidateActions].filter((key) => !baselineActions.has(key)),
    actionableDemotions: [...baselineActions].filter((key) => !candidateActions.has(key)),
    additions,
    removals,
    changed,
  }, null, 2));
}

function eligibleSnapshot(snapshot: NflPlayerPropsObservationSnapshot, eligibleGameIds: Set<string>): NflPlayerPropsObservationSnapshot {
  return {
    ...snapshot,
    games: snapshot.games.filter((game) => eligibleGameIds.has(game.providerGameId)),
    observations: snapshot.observations.filter((row) => row.canonicalGameId !== null && eligibleGameIds.has(row.canonicalGameId)),
  };
}

function buildSnapshot(
  snapshot: NflPlayerPropsObservationSnapshot,
  context: Parameters<typeof buildNflPlayerPropsRuntimeFeatureRows>[0]["context"],
  currentSeasonState: Parameters<typeof buildNflPlayerPropsRuntimeFeatureRows>[0]["currentSeasonState"],
  previous: NflPlayerPropsProductionSnapshot | null,
  season: number,
  week: number,
  evaluatedAt: string,
): NflPlayerPropsProductionSnapshot {
  const offers = buildNflPlayerPropsExactBoard({ snapshots: [snapshot], evaluatedAt });
  const features = buildNflPlayerPropsRuntimeFeatureRows({ snapshot, context, currentSeasonState });
  const board: NflPlayerPropsRuntimeBoard = buildNflPlayerPropsRuntimeBoard({ offers, features, evaluatedAt });
  return reconcileNflPlayerPropsProductionSnapshot({ season, week, evaluatedAt, nextBoard: board, previous });
}

function summarize(snapshot: NflPlayerPropsProductionSnapshot) {
  return {
    rows: snapshot.memberDecisions.length,
    games: new Set(snapshot.memberDecisions.map((row) => row.gameId)).size,
    counts: snapshot.board.counts,
  };
}

function countActionSides(rows: NflPlayerPropsRuntimeDecision[]): Record<string, number> {
  const result: Record<string, number> = {};
  for (const row of rows) {
    if (row.grade !== "Best Angle" && row.grade !== "Lean") continue;
    result[row.side] = (result[row.side] ?? 0) + 1;
  }
  return result;
}

function hiddenActionableScopes(rows: NflPlayerPropsRuntimeDecision[]): number {
  const touchdownScorers = selectNflPlayerPropsTouchdownScorers(rows);
  const projectionForecasts = selectNflPlayerPropsOverForecasts(rows);
  const groups = new Map<string, NflPlayerPropsRuntimeDecision[]>();
  for (const row of rows) {
    const key = [row.gameId, normalize(row.playerName), row.market, row.line].join("|");
    groups.set(key, [...(groups.get(key) ?? []), row]);
  }
  let hidden = 0;
  for (const marketRows of groups.values()) {
    const first = marketRows[0]!;
    const forecastSide = first.market === "anytime_td"
      ? (touchdownScorers.has(nflPlayerPropsTouchdownPlayerKey(first)) ? "yes" : null)
      : (projectionForecasts.has(nflPlayerPropsOverUnderMarketKey(first)) ? "over" : "under");
    const selected = forecastSide ? marketRows.find((row) => row.side === forecastSide) : null;
    const hasAction = marketRows.some((row) => row.grade === "Best Angle" || row.grade === "Lean");
    if (hasAction && (!selected || (selected.grade !== "Best Angle" && selected.grade !== "Lean"))) hidden += 1;
  }
  return hidden;
}

function compact(row: NflPlayerPropsRuntimeDecision) {
  return {
    gameId: row.gameId,
    playerName: row.playerName,
    market: row.market,
    line: row.line,
    side: row.side,
    sportsbook: row.sportsbook,
    price: row.americanPrice,
    grade: row.grade,
    probability: row.finalProbability,
    expectedValue: row.expectedValue,
    state: row.state,
  };
}

function sameDecision(left: NflPlayerPropsRuntimeDecision, right: NflPlayerPropsRuntimeDecision): boolean {
  return JSON.stringify(compact(left)) === JSON.stringify(compact(right));
}

function decisionKey(row: NflPlayerPropsRuntimeDecision): string {
  return [row.gameId, normalize(row.playerName), row.market, row.line, row.side].join("|");
}

function normalize(value: string): string { return value.toLowerCase().replace(/[^a-z0-9]/g, ""); }
function requiredEnv(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`${name} is required.`);
  return value;
}

void main().catch((error) => { console.error(error); process.exitCode = 1; });
