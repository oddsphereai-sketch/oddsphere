#!/usr/bin/env tsx

/** Zero-write comparison of the active and movement-aware rebound-family runtimes. */
import { readFileSync } from "node:fs";

import { loadEnvConfig } from "@next/env";
import { createClient } from "@supabase/supabase-js";
import { readNbaPlayerPropsCurrentState } from "../../../lib/services/nba/nbaPlayerPropsCurrentState";
import {
  buildNbaPlayerPropsForwardDecisionsFromArtifactForAudit,
  type NbaPlayerPropsForwardDecision,
  type NbaPlayerPropsFrozenArtifact,
} from "../../../lib/services/nba/nbaPlayerPropsFrozenRuntime";
import { readNbaPlayerPropsMarketHistory } from "../../../lib/services/nba/nbaPlayerPropsPrivateStore";
import { readNbaPlayerPropsPrivateTracking } from "../../../lib/services/nba/nbaPlayerPropsPrivateTrackingStore";
import {
  buildNbaPlayerPropsPointInTimeFeatures,
  type NbaPlayerPropCandidate,
  type NbaPlayerPropFeatureRow,
} from "../../../lib/services/nba/nbaPlayerPropsPointInTimeFeatures";

loadEnvConfig(argument("env-dir") ?? process.cwd());

const MARKETS = ["rebounds", "points_rebounds", "rebounds_assists", "points_rebounds_assists"] as const;
type Market = (typeof MARKETS)[number];

async function main(): Promise<void> {
  const slateDate = requiredArgument("date");
  const season = Number(argument("season") ?? slateDate.slice(0, 4));
  const candidate = readArtifact(requiredArgument("candidate-artifact"));
  const baseline = structuredClone(candidate) as unknown as Record<string, unknown>;
  baseline.release = "nba_player_props_frozen_runtime_artifact_2026_10_22_r6_rebound_grade_recalibration";
  baseline.exactPriceArbitrationMinimumDistance = {
    ...(baseline.exactPriceArbitrationMinimumDistance as Record<string, number | null>),
    rebounds: 0.05,
    rebounds_assists: 0,
    points_rebounds_assists: null,
  };
  baseline.exactPriceArbitrationMovementPolicy = Object.fromEntries(
    Object.keys(baseline.exactPriceArbitrationMinimumDistance as Record<string, unknown>).map((market) => [market, "none"]),
  );
  const client = createClient(required("NEXT_PUBLIC_SUPABASE_URL"), required("SUPABASE_SERVICE_ROLE_KEY"), {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const [tracking, market, current, prior] = await Promise.all([
    readNbaPlayerPropsPrivateTracking({ client, season, slateDate }),
    readNbaPlayerPropsMarketHistory({ client, slateDate }),
    readNbaPlayerPropsCurrentState({ client, season }),
    readNbaPlayerPropsCurrentState({ client, season: season - 1 }),
  ]);
  if (!tracking || !market || !current || !prior) throw new Error("Required immutable audit inputs are missing.");
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
  const featureByScope = new Map(features.map((row) => [`${row.game_id}|${row.player_id}`, row]));
  const before = buildNbaPlayerPropsForwardDecisionsFromArtifactForAudit({
    artifact: baseline as unknown as NbaPlayerPropsFrozenArtifact,
    features,
    observations,
    evaluatedAt,
  });
  const after = buildNbaPlayerPropsForwardDecisionsFromArtifactForAudit({
    artifact: candidate,
    features,
    observations,
    evaluatedAt,
  });
  const beforeByScope = new Map(before.map((row) => [row.scopeKey, row]));
  const changed = after.flatMap((row) => {
    const priorDecision = beforeByScope.get(row.scopeKey);
    if (!priorDecision || !MARKETS.includes(row.market as Market)) return [];
    const feature = featureByScope.get(`${row.gameId}|${row.playerId}`);
    const actual = feature ? actualFor(row.market as Market, feature) : null;
    if (actual === null || (priorDecision.side === row.side && priorDecision.grade === row.grade
      && priorDecision.finalProjection === row.finalProjection)) return [];
    return [{
      player: row.playerName,
      market: row.market,
      line: row.line,
      actual,
      before: pick(priorDecision, actual),
      after: pick(row, actual),
    }];
  });
  process.stdout.write(`${JSON.stringify({
    release: "nba_player_props_rebound_market_reader_runtime_audit_2026_10_23_r1",
    mode: "select_only",
    slateDate,
    inputs: { trackingRows: tracking.rows.length, observations: observations.length, features: features.length },
    before: summarize(before, featureByScope),
    after: summarize(after, featureByScope),
    boardImpact: {
      before: grades(before),
      after: grades(after),
      actionablePromotions: changed.filter(({ before: left, after: right }) => rank(right.grade) >= 2 && rank(left.grade) < 2).length,
      actionableDemotions: changed.filter(({ before: left, after: right }) => rank(left.grade) >= 2 && rank(right.grade) < 2).length,
      allPromotions: changed.filter(({ before: left, after: right }) => rank(right.grade) > rank(left.grade)).length,
      allDemotions: changed.filter(({ before: left, after: right }) => rank(right.grade) < rank(left.grade)).length,
    },
    changed,
  }, null, 2)}\n`);
}

function summarize(decisions: readonly NbaPlayerPropsForwardDecision[], features: ReadonlyMap<string, NbaPlayerPropFeatureRow>) {
  return Object.fromEntries(MARKETS.map((market) => {
    const rows = decisions.flatMap((row) => {
      if (row.market !== market) return [];
      const feature = features.get(`${row.gameId}|${row.playerId}`);
      const actual = feature ? actualFor(market, feature) : null;
      return actual === null ? [] : [{ row, actual }];
    });
    const independentWins = rows.filter(({ row, actual }) => side(row.independentProjection, row.line) === side(actual, row.line)).length;
    const finalWins = rows.filter(({ row, actual }) => row.side === side(actual, row.line)).length;
    const flips = rows.filter(({ row }) => row.independentSide !== row.side);
    return [market, {
      rows: rows.length,
      independentRecord: `${independentWins}-${rows.length - independentWins}`,
      finalRecord: `${finalWins}-${rows.length - finalWins}`,
      independentMae: mean(rows.map(({ row, actual }) => Math.abs(row.independentProjection - actual))),
      finalMae: mean(rows.map(({ row, actual }) => Math.abs(row.finalProjection - actual))),
      flips: flips.length,
      corrected: flips.filter(({ row, actual }) => row.side === side(actual, row.line)).length,
      harmed: flips.filter(({ row, actual }) => row.independentSide === side(actual, row.line)).length,
    }];
  }));
}

function grades(rows: readonly NbaPlayerPropsForwardDecision[]) {
  return rows.filter((row) => MARKETS.includes(row.market as Market)).reduce<Record<string, number>>((counts, row) => {
    counts[row.grade] = (counts[row.grade] ?? 0) + 1;
    return counts;
  }, {});
}

function pick(row: NbaPlayerPropsForwardDecision, actual: number) {
  return { projection: row.finalProjection, side: row.side, grade: row.grade, result: row.side === side(actual, row.line) ? "win" : "loss" };
}

function actualFor(market: Market, row: NbaPlayerPropFeatureRow): number | null {
  if (market === "rebounds") return row.target_rebounds;
  if (market === "points_rebounds") return sum(row.target_points, row.target_rebounds);
  if (market === "rebounds_assists") return sum(row.target_rebounds, row.target_assists);
  return sum(row.target_points, row.target_rebounds, row.target_assists);
}
function sum(...values: readonly (number | null)[]): number | null {
  return values.some((entry) => entry === null) ? null : values.reduce<number>((total, entry) => total + (entry ?? 0), 0);
}
function side(value: number, line: number): "over" | "under" { return value > line ? "over" : "under"; }
function mean(values: readonly number[]): number | null {
  return values.length ? Math.round(values.reduce((left, right) => left + right, 0) / values.length * 1000) / 1000 : null;
}
function rank(grade: string): number { return grade === "Best Angle" ? 3 : grade === "Lean" ? 2 : grade === "Watchlist" ? 1 : 0; }
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
