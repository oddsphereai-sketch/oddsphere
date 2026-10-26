#!/usr/bin/env tsx

/** Select-only, release-separated replay of an NBA props artifact over stored locks. */
import { readFileSync } from "node:fs";

import { loadEnvConfig } from "@next/env";
import { createClient } from "@supabase/supabase-js";

import { readNbaPlayerPropsCurrentState } from "../../../lib/services/nba/nbaPlayerPropsCurrentState";
import {
  buildNbaPlayerPropsForwardDecisionsFromArtifactForAudit,
  type NbaPlayerPropsForwardDecision,
  type NbaPlayerPropsFrozenArtifact,
} from "../../../lib/services/nba/nbaPlayerPropsFrozenRuntime";
import {
  readNbaPlayerPropsMarketHistory,
} from "../../../lib/services/nba/nbaPlayerPropsPrivateStore";
import { readNbaPlayerPropsPrivateTracking } from "../../../lib/services/nba/nbaPlayerPropsPrivateTrackingStore";
import {
  buildNbaPlayerPropsPointInTimeFeatures,
  type NbaPlayerPropCandidate,
  type NbaPlayerPropFeatureRow,
} from "../../../lib/services/nba/nbaPlayerPropsPointInTimeFeatures";

loadEnvConfig(argument("env-dir") ?? process.cwd());

const MARKETS = [
  "points",
  "rebounds",
  "assists",
  "threes",
  "points_rebounds_assists",
  "points_rebounds",
  "points_assists",
  "rebounds_assists",
] as const;
type Market = (typeof MARKETS)[number];

type Compared = Readonly<{
  market: Market;
  actual: number;
  feature: NbaPlayerPropFeatureRow;
  baseline: NbaPlayerPropsForwardDecision;
  candidate: NbaPlayerPropsForwardDecision;
}>;

async function main(): Promise<void> {
  const season = Number(argument("season") ?? "2026");
  const dates = requiredArgument("dates").split(",").map((date) => date.trim()).filter(Boolean);
  const rawCandidateArtifact = readArtifact(requiredArgument("candidate-artifact"));
  const candidateArtifact: NbaPlayerPropsFrozenArtifact = {
    ...rawCandidateArtifact,
    ...(process.argv.includes("--generic-rebound-minutes")
      ? { robustMinuteModel: rawCandidateArtifact.minuteModel }
      : {}),
    underlyingByMarket: {
      ...rawCandidateArtifact.underlyingByMarket,
      ...(process.argv.includes("--ra-robust-components")
        ? { rebounds_assists: "robust_component_counts" as const }
        : {}),
    },
  };
  const baselineArtifact = readArtifact(
    argument("baseline-artifact") ?? "lib/services/nba/fixtures/nbaPlayerPropsFrozenRuntimeArtifact.json",
  );
  const client = createClient(required("NEXT_PUBLIC_SUPABASE_URL"), required("SUPABASE_SERVICE_ROLE_KEY"), {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const [current, prior] = await Promise.all([
    readNbaPlayerPropsCurrentState({ client, season }),
    readNbaPlayerPropsCurrentState({ client, season: season - 1 }),
  ]);
  if (!current || !prior) throw new Error("Current or prior NBA player state is missing.");

  const compared: Compared[] = [];
  const dateInventory = [];
  for (const slateDate of dates) {
    const [tracking, market] = await Promise.all([
      readNbaPlayerPropsPrivateTracking({ client, season, slateDate }),
      readNbaPlayerPropsMarketHistory({ client, slateDate }),
    ]);
    if (!tracking || !market) {
      dateInventory.push({ slateDate, status: "missing_tracking_or_market" });
      continue;
    }
    const gameIds = new Set(tracking.rows.map((row) => numericId(row.gameId)));
    const targetBoxes = new Map(current.boxes.map((box) => [`${box.gameId}|${box.playerId}`, box]));
    const candidates: NbaPlayerPropCandidate[] = [];
    const seen = new Set<string>();
    for (const row of tracking.rows) {
      const gameId = numericId(row.gameId);
      const playerId = numericId(row.playerId);
      const key = `${gameId}|${playerId}`;
      const box = targetBoxes.get(key);
      if (!box || seen.has(key)) continue;
      seen.add(key);
      candidates.push({ gameId, playerId, playerName: row.playerName, teamId: box.teamId });
    }
    const features = buildNbaPlayerPropsPointInTimeFeatures({
      games: [...prior.games, ...current.games],
      upcomingGames: current.games.filter((game) => gameIds.has(game.gameId)),
      boxes: [...prior.boxes, ...current.boxes],
      advanced: [...prior.advanced, ...current.advanced],
      candidates,
      emitGameIds: gameIds,
    });
    const lockByGame = new Map<number, number>();
    for (const row of tracking.rows) {
      const gameId = numericId(row.gameId);
      lockByGame.set(gameId, Math.max(lockByGame.get(gameId) ?? 0, Date.parse(row.lockedAt)));
    }
    const observations = market.observations.filter((row) => {
      const gameId = row.canonicalGameId ? numericId(row.canonicalGameId) : null;
      const lock = gameId === null ? null : lockByGame.get(gameId);
      return lock !== undefined && lock !== null && Date.parse(row.observedAt) <= lock;
    });
    const evaluatedAt = new Date(Math.max(...tracking.rows.map((row) => Date.parse(row.lockedAt)))).toISOString();
    const currentObservations = selectPrelockCurrentObservations(observations);
    const baseline = buildNbaPlayerPropsForwardDecisionsFromArtifactForAudit({
      artifact: baselineArtifact,
      features,
      observations,
      currentObservations,
      evaluatedAt,
    });
    const candidate = buildNbaPlayerPropsForwardDecisionsFromArtifactForAudit({
      artifact: candidateArtifact,
      features,
      observations,
      currentObservations,
      evaluatedAt,
    });
    const featureByScope = new Map(features.map((row) => [`${row.game_id}|${row.player_id}`, row]));
    const baselineByScope = new Map(baseline.map((row) => [row.scopeKey, row]));
    const candidateByScope = new Map(candidate.map((row) => {
      const feature = featureByScope.get(`${row.gameId}|${row.playerId}`);
      const selected = process.argv.includes("--low-tenure-only")
        && (feature?.same_team_games_10 ?? 10) >= 3
        ? baselineByScope.get(row.scopeKey) ?? row
        : row;
      return [row.scopeKey, selected];
    }));
    for (const before of baseline) {
      const after = candidateByScope.get(before.scopeKey);
      const feature = featureByScope.get(`${before.gameId}|${before.playerId}`);
      const actual = feature ? actualFor(before.market as Market, feature) : null;
      if (!after || !feature || actual === null || actual === before.line) continue;
      compared.push({ market: before.market as Market, actual, feature, baseline: before, candidate: after });
    }
    dateInventory.push({
      slateDate,
      status: "replayed",
      trackingRows: tracking.rows.length,
      observations: observations.length,
      features: features.length,
      baselineDecisions: baseline.length,
      candidateDecisions: candidate.length,
      compared: baseline.filter((row) => candidateByScope.has(row.scopeKey)).length,
    });
  }

  process.stdout.write(`${JSON.stringify({
    release: "nba_player_props_component_market_reader_runtime_audit_2026_10_26_r1",
    mode: "select_only",
    baselineArtifact: baselineArtifact.release,
    candidateArtifact: candidateArtifact.release,
    dates: dateInventory,
    overall: summarize(compared),
    byMarket: Object.fromEntries(MARKETS.map((market) => [market, summarize(compared.filter((row) => row.market === market))])),
    reboundFamilySegments: segmentSummary(compared.filter((row) =>
      row.market === "rebounds" || row.market === "rebounds_assists")),
    reboundSegments: segmentSummary(compared.filter((row) => row.market === "rebounds")),
    reboundsAssistsSegments: segmentSummary(compared.filter((row) => row.market === "rebounds_assists")),
    gradeImpact: gradeImpact(compared),
    coherence: {
      candidateSideProjectionDisagreements: compared.filter(({ candidate }) =>
        candidate.side !== side(candidate.finalProjection, candidate.line)).length,
    },
    integrity: {
      databaseWrites: 0,
      memberWrites: 0,
      lockedRowsMutated: 0,
      targetBookExcludedRuntime: true,
    },
  }, null, 2)}\n`);
}

function segmentSummary(rows: readonly Compared[]) {
  const definitions: Record<string, (row: Compared) => boolean> = {
    changed_team: (row) => row.feature.changed_team_since_last_game === 1,
    stable_team: (row) => row.feature.changed_team_since_last_game !== 1,
    under_5_prior_games: (row) => row.feature.player_games_prior < 5,
    games_5_to_9: (row) => row.feature.player_games_prior >= 5 && row.feature.player_games_prior < 10,
    games_10_plus: (row) => row.feature.player_games_prior >= 10,
    current_team_tenure_0_to_2: (row) => row.feature.same_team_games_10 < 3,
    current_team_tenure_3_to_5: (row) => row.feature.same_team_games_10 >= 3 && row.feature.same_team_games_10 < 6,
    current_team_tenure_6_to_9: (row) => row.feature.same_team_games_10 >= 6 && row.feature.same_team_games_10 < 10,
    current_team_tenure_10: (row) => row.feature.same_team_games_10 >= 10,
    volatile_minutes: (row) => (row.feature.minutes_sd_10 ?? Infinity) > 5,
    stable_minutes: (row) => (row.feature.minutes_sd_10 ?? Infinity) <= 5,
    projected_low_minutes: (row) => (row.feature.minutes_mean_5 ?? 0) < 24,
    projected_rotation_minutes: (row) => (row.feature.minutes_mean_5 ?? 0) >= 24 && (row.feature.minutes_mean_5 ?? 0) < 32,
    projected_high_minutes: (row) => (row.feature.minutes_mean_5 ?? 0) >= 32,
    back_to_back: (row) => row.feature.team_back_to_back === 1,
    rested: (row) => row.feature.team_back_to_back !== 1,
    line_5_or_lower: (row) => row.baseline.line <= 5,
    line_5_5_to_8_5: (row) => row.baseline.line > 5 && row.baseline.line <= 8.5,
    line_above_8_5: (row) => row.baseline.line > 8.5,
    selected_over: (row) => row.candidate.side === "over",
    selected_under: (row) => row.candidate.side === "under",
    low_line_over: (row) => row.baseline.line <= 5 && row.candidate.side === "over",
    low_line_under: (row) => row.baseline.line <= 5 && row.candidate.side === "under",
    rested_over: (row) => row.feature.team_back_to_back !== 1 && row.candidate.side === "over",
    rested_under: (row) => row.feature.team_back_to_back !== 1 && row.candidate.side === "under",
    rotation_minutes_over: (row) => (row.feature.minutes_mean_5 ?? 0) >= 24
      && (row.feature.minutes_mean_5 ?? 0) < 32 && row.candidate.side === "over",
    rotation_minutes_under: (row) => (row.feature.minutes_mean_5 ?? 0) >= 24
      && (row.feature.minutes_mean_5 ?? 0) < 32 && row.candidate.side === "under",
    rotation_over_low_line: (row) => (row.feature.minutes_mean_5 ?? 0) >= 24
      && (row.feature.minutes_mean_5 ?? 0) < 32 && row.candidate.side === "over" && row.baseline.line <= 5,
    rotation_over_higher_line: (row) => (row.feature.minutes_mean_5 ?? 0) >= 24
      && (row.feature.minutes_mean_5 ?? 0) < 32 && row.candidate.side === "over" && row.baseline.line > 5,
    rested_over_low_line: (row) => row.feature.team_back_to_back !== 1
      && row.candidate.side === "over" && row.baseline.line <= 5,
    rested_over_higher_line: (row) => row.feature.team_back_to_back !== 1
      && row.candidate.side === "over" && row.baseline.line > 5,
  };
  return Object.fromEntries(Object.entries(definitions).map(([name, include]) => {
    const selected = rows.filter(include);
    return [name, {
      ...summarize(selected),
      meanActualMinusIndependent: mean(selected.map(({ actual, baseline }) => actual - baseline.independentProjection)),
      meanActualMinusFinal: mean(selected.map(({ actual, candidate }) => actual - candidate.finalProjection)),
    }];
  }));
}

function summarize(rows: readonly Compared[]) {
  const baselineWins = rows.filter(({ baseline, actual }) => baseline.side === side(actual, baseline.line)).length;
  const candidateWins = rows.filter(({ candidate, actual }) => candidate.side === side(actual, candidate.line)).length;
  const independentWins = rows.filter(({ baseline, actual }) => baseline.independentSide === side(actual, baseline.line)).length;
  const changes = rows.filter(({ baseline, candidate }) => baseline.side !== candidate.side);
  return {
    rows: rows.length,
    independent: record(independentWins, rows.length),
    baseline: record(baselineWins, rows.length),
    candidate: record(candidateWins, rows.length),
    baselineMae: mean(rows.map(({ baseline, actual }) => Math.abs(baseline.finalProjection - actual))),
    candidateMae: mean(rows.map(({ candidate, actual }) => Math.abs(candidate.finalProjection - actual))),
    sideChanges: changes.length,
    corrected: changes.filter(({ candidate, actual }) => candidate.side === side(actual, candidate.line)).length,
    harmed: changes.filter(({ baseline, actual }) => baseline.side === side(actual, baseline.line)).length,
    candidateOvers: rows.filter(({ candidate }) => candidate.side === "over").length,
    candidateUnders: rows.filter(({ candidate }) => candidate.side === "under").length,
  };
}

function gradeImpact(rows: readonly Compared[]) {
  const changed = rows.filter(({ baseline, candidate }) => baseline.grade !== candidate.grade);
  return {
    baseline: counts(rows.map(({ baseline }) => baseline.grade)),
    candidate: counts(rows.map(({ candidate }) => candidate.grade)),
    actionablePromotions: changed.filter(({ baseline, candidate }) => rank(candidate.grade) >= 2 && rank(baseline.grade) < 2).length,
    actionableDemotions: changed.filter(({ baseline, candidate }) => rank(baseline.grade) >= 2 && rank(candidate.grade) < 2).length,
    allPromotions: changed.filter(({ baseline, candidate }) => rank(candidate.grade) > rank(baseline.grade)).length,
    allDemotions: changed.filter(({ baseline, candidate }) => rank(candidate.grade) < rank(baseline.grade)).length,
  };
}

function actualFor(market: Market, row: NbaPlayerPropFeatureRow): number | null {
  if (market === "points") return row.target_points;
  if (market === "rebounds") return row.target_rebounds;
  if (market === "assists") return row.target_assists;
  if (market === "threes") return row.target_threes;
  if (market === "points_rebounds") return sum(row.target_points, row.target_rebounds);
  if (market === "points_assists") return sum(row.target_points, row.target_assists);
  if (market === "rebounds_assists") return sum(row.target_rebounds, row.target_assists);
  return sum(row.target_points, row.target_rebounds, row.target_assists);
}

function sum(...values: readonly (number | null)[]): number | null {
  return values.some((entry) => entry === null) ? null : values.reduce<number>((total, entry) => total + (entry ?? 0), 0);
}
function side(value: number, line: number): "over" | "under" { return value > line ? "over" : "under"; }
function rank(grade: string): number { return grade === "Best Angle" ? 3 : grade === "Lean" ? 2 : grade === "Watchlist" ? 1 : 0; }
function record(wins: number, rows: number) { return { wins, losses: rows - wins, hitRate: rows ? wins / rows : null }; }
function mean(values: readonly number[]): number | null {
  return values.length ? values.reduce((left, right) => left + right, 0) / values.length : null;
}
function counts(values: readonly string[]): Record<string, number> {
  return values.reduce<Record<string, number>>((result, value) => {
    result[value] = (result[value] ?? 0) + 1;
    return result;
  }, {});
}
function selectPrelockCurrentObservations(
  rows: readonly import("../../../lib/services/nba/nbaPlayerPropsContract").NbaPlayerPropPriceObservation[],
) {
  const scopes = new Map<string, typeof rows>();
  for (const row of rows.filter((entry) => !entry.isOpening && !entry.isLive)) {
    const player = row.canonicalPlayerId ?? row.providerPlayerId ?? row.playerName ?? "";
    const key = `${row.canonicalGameId}|${player}|${row.market}`;
    scopes.set(key, [...(scopes.get(key) ?? []), row]);
  }
  return [...scopes.values()].flatMap((scopeRows) => {
    const cycles = [...new Set(scopeRows.map((row) => row.fetchedAt))]
      .sort((left, right) => Date.parse(right) - Date.parse(left));
    for (const cycle of cycles) {
      const cycleRows = scopeRows.filter((row) => row.fetchedAt === cycle);
      const pairKeys = new Map<string, Set<string>>();
      for (const row of cycleRows) {
        const key = `${normalize(row.sportsbook)}|${row.line}|${row.observedAt}`;
        pairKeys.set(key, new Set([...(pairKeys.get(key) ?? []), row.side]));
      }
      if ([...pairKeys.values()].some((sides) => sides.has("over") && sides.has("under"))) return cycleRows;
    }
    return [];
  });
}
function normalize(value: string): string { return value.toLowerCase().replace(/[^a-z0-9]/g, ""); }
function numericId(input: string): number { return Number(String(input).replace(/^.*:/, "")); }
function readArtifact(file: string): NbaPlayerPropsFrozenArtifact {
  return JSON.parse(readFileSync(file, "utf8")) as NbaPlayerPropsFrozenArtifact;
}
function argument(name: string): string | null {
  const index = process.argv.indexOf(`--${name}`);
  return index >= 0 ? process.argv[index + 1] ?? null : null;
}
function requiredArgument(name: string): string {
  const found = argument(name);
  if (!found) throw new Error(`--${name} is required.`);
  return found;
}
function required(name: string): string {
  const found = process.env[name];
  if (!found) throw new Error(`${name} is required.`);
  return found;
}

void main().catch((error: unknown) => {
  process.stderr.write(`${error instanceof Error ? error.stack ?? error.message : String(error)}\n`);
  process.exitCode = 1;
});
