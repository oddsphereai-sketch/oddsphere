#!/usr/bin/env tsx

/** Zero-write same-input comparison against the current unlocked member snapshot. */
import { loadEnvConfig } from "@next/env";
import { createClient } from "@supabase/supabase-js";

import { readNbaPlayerPropsCurrentState } from "../../../lib/services/nba/nbaPlayerPropsCurrentState";
import { buildNbaPlayerPropsForwardDecisions } from "../../../lib/services/nba/nbaPlayerPropsFrozenRuntime";
import { readNbaPlayerPropsMarketHistory, readNbaPlayerPropsPrivateSnapshot } from "../../../lib/services/nba/nbaPlayerPropsPrivateStore";
import {
  buildNbaPlayerPropsPointInTimeFeatures,
  type NbaPlayerPropCandidate,
} from "../../../lib/services/nba/nbaPlayerPropsPointInTimeFeatures";
import { selectNbaPlayerPropsSnapshotCurrentObservations } from "./nba-player-props-snapshot-cycle";

loadEnvConfig(argument("env-dir") ?? process.cwd());

const MARKETS = new Set(["rebounds", "points_rebounds", "rebounds_assists", "points_rebounds_assists"]);

async function main(): Promise<void> {
  const slateDate = requiredArgument("date");
  const season = Number(argument("season") ?? slateDate.slice(0, 4));
  const client = createClient(required("NEXT_PUBLIC_SUPABASE_URL"), required("SUPABASE_SERVICE_ROLE_KEY"), {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const [snapshot, market, current, prior] = await Promise.all([
    readNbaPlayerPropsPrivateSnapshot({ client, slateDate }),
    readNbaPlayerPropsMarketHistory({ client, slateDate }),
    readNbaPlayerPropsCurrentState({ client, season }),
    readNbaPlayerPropsCurrentState({ client, season: season - 1 }),
  ]);
  if (!snapshot || !market || !current || !prior) throw new Error("Current candidate, market, or player state is missing.");
  const gameIds = new Set(snapshot.games.map((game) => numericId(game.gameId)));
  const playerTeams = new Map([...prior.players, ...current.players].map((player) => [player.playerId, player.latestTeamId]));
  const candidates: NbaPlayerPropCandidate[] = [];
  const seen = new Set<string>();
  for (const row of snapshot.decisions) {
    const gameId = numericId(row.gameId);
    const playerId = numericId(row.playerId);
    const key = `${gameId}|${playerId}`;
    const teamId = playerTeams.get(playerId);
    if (!teamId || seen.has(key)) continue;
    seen.add(key);
    candidates.push({ gameId, playerId, playerName: row.playerName, teamId });
  }
  const upcomingGames = snapshot.games.flatMap((game) => {
    const gameDecisions = snapshot.decisions.filter((row) => row.gameId === game.gameId);
    const homePlayer = gameDecisions.find((row) => row.team === game.homeTeam);
    const awayPlayer = gameDecisions.find((row) => row.team === game.awayTeam);
    const homeTeamId = homePlayer ? playerTeams.get(numericId(homePlayer.playerId)) : null;
    const awayTeamId = awayPlayer ? playerTeams.get(numericId(awayPlayer.playerId)) : null;
    if (!homeTeamId || !awayTeamId) return [];
    return [{
      gameId: numericId(game.gameId),
      season,
      startTime: game.scheduledStart,
      homeTeamId,
      awayTeamId,
      homeTeam: game.homeTeam,
      awayTeam: game.awayTeam,
    }];
  });
  const features = buildNbaPlayerPropsPointInTimeFeatures({
    games: [...prior.games, ...current.games],
    upcomingGames,
    boxes: [...prior.boxes, ...current.boxes],
    advanced: [...prior.advanced, ...current.advanced],
    candidates,
    emitGameIds: gameIds,
  });
  const observations = market.observations;
  const currentObservations = selectNbaPlayerPropsSnapshotCurrentObservations(observations, snapshot.generatedAt);
  const candidateRows = buildNbaPlayerPropsForwardDecisions({
    features,
    observations,
    currentObservations,
    evaluatedAt: snapshot.generatedAt,
  });
  const before = snapshot.decisions.filter((row) => MARKETS.has(row.market));
  const after = candidateRows.filter((row) => MARKETS.has(row.market));
  const beforeByScope = new Map(before.map((row) => [`${row.gameId}|${row.playerId}|${row.market}`, row]));
  const afterByScope = new Map(after.map((row) => [`nba-bdl:${row.gameId}|nba-bdl-player:${row.playerId}|${row.market}`, row]));
  const commonBefore = before.filter((row) => afterByScope.has(`${row.gameId}|${row.playerId}|${row.market}`));
  const commonAfter = after.filter((row) => beforeByScope.has(`nba-bdl:${row.gameId}|nba-bdl-player:${row.playerId}|${row.market}`));
  const changed = after.flatMap((row) => {
    const priorRow = beforeByScope.get(`nba-bdl:${row.gameId}|nba-bdl-player:${row.playerId}|${row.market}`);
    if (!priorRow || (priorRow.side === row.side && priorRow.grade === row.grade && priorRow.projection === row.finalProjection)) return [];
    return [{
      player: row.playerName,
      market: row.market,
      line: row.line,
      before: { side: priorRow.side, projection: priorRow.projection, grade: priorRow.grade },
      after: { side: row.side, projection: row.finalProjection, grade: row.grade },
    }];
  });
  process.stdout.write(`${JSON.stringify({
    release: "nba_player_props_current_rebound_market_reader_audit_2026_10_23_r1",
    mode: "select_only",
    slateDate,
    generatedAt: snapshot.generatedAt,
    inputs: {
      snapshotDecisions: snapshot.decisions.length,
      snapshotDecisionReleases: countValues(snapshot.decisions.map((row) => row.decisionRelease ?? "missing")),
      snapshotModelReleases: countValues(snapshot.decisions.map((row) => row.modelRelease ?? "missing")),
      marketObservations: observations.length,
      features: features.length,
    },
    before: summarize(commonBefore),
    after: summarize(commonAfter.map((row) => ({ ...row, projection: row.finalProjection }))),
    impact: {
      commonRows: commonBefore.length,
      newlyCoveredCandidateRows: after.length - commonAfter.length,
      changedSides: changed.filter((row) => row.before.side !== row.after.side).length,
      actionablePromotions: changed.filter((row) => rank(row.after.grade) >= 2 && rank(row.before.grade) < 2).length,
      actionableDemotions: changed.filter((row) => rank(row.before.grade) >= 2 && rank(row.after.grade) < 2).length,
    },
    changed,
  }, null, 2)}\n`);
}

function summarize(rows: readonly { market: string; side: string; grade: string }[]) {
  return {
    rows: rows.length,
    sides: rows.reduce<Record<string, number>>((counts, row) => {
      counts[row.side] = (counts[row.side] ?? 0) + 1;
      return counts;
    }, {}),
    grades: rows.reduce<Record<string, number>>((counts, row) => {
      counts[row.grade] = (counts[row.grade] ?? 0) + 1;
      return counts;
    }, {}),
    byMarket: Object.fromEntries([...MARKETS].map((market) => [market, rows.filter((row) => row.market === market).reduce<Record<string, number>>((counts, row) => {
      counts[row.side] = (counts[row.side] ?? 0) + 1;
      return counts;
    }, {})])),
  };
}

function rank(grade: string): number { return grade === "Best Angle" ? 3 : grade === "Lean" ? 2 : grade === "Watchlist" ? 1 : 0; }
function countValues(values: readonly string[]): Record<string, number> {
  return values.reduce<Record<string, number>>((counts, value) => {
    counts[value] = (counts[value] ?? 0) + 1;
    return counts;
  }, {});
}
function numericId(input: string): number { return Number(String(input).replace(/^.*:/, "")); }
function argument(name: string): string | null {
  const index = process.argv.indexOf(`--${name}`);
  return index >= 0 ? process.argv[index + 1] ?? null : null;
}
function requiredArgument(name: string): string { const found = argument(name); if (!found) throw new Error(`--${name} is required.`); return found; }
function required(name: string): string { const found = process.env[name]; if (!found) throw new Error(`${name} is required.`); return found; }

void main().catch((error: unknown) => {
  process.stderr.write(`${error instanceof Error ? error.stack ?? error.message : String(error)}\n`);
  process.exitCode = 1;
});
