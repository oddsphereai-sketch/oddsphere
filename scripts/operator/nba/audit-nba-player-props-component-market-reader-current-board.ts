#!/usr/bin/env tsx

/** Zero-write current-board comparison for the component market-reader candidate. */
import { readFileSync } from "node:fs";

import { loadEnvConfig } from "@next/env";
import { createClient } from "@supabase/supabase-js";

import { readNbaPlayerPropsCurrentState } from "../../../lib/services/nba/nbaPlayerPropsCurrentState";
import {
  buildNbaPlayerPropsForwardDecisionsFromArtifactForAudit,
  type NbaPlayerPropsFrozenArtifact,
} from "../../../lib/services/nba/nbaPlayerPropsFrozenRuntime";
import { readNbaPlayerPropsMarketHistory, readNbaPlayerPropsPrivateSnapshot } from "../../../lib/services/nba/nbaPlayerPropsPrivateStore";
import { buildNbaPlayerPropsPointInTimeFeatures, type NbaPlayerPropCandidate } from "../../../lib/services/nba/nbaPlayerPropsPointInTimeFeatures";
import { selectNbaPlayerPropsSnapshotCurrentObservations } from "./nba-player-props-snapshot-cycle";

loadEnvConfig(argument("env-dir") ?? process.cwd());

async function main(): Promise<void> {
  const slateDate = requiredArgument("date");
  const season = Number(argument("season") ?? slateDate.slice(0, 4));
  const baselineArtifact = readArtifact(
    argument("baseline-artifact") ?? "lib/services/nba/fixtures/nbaPlayerPropsFrozenRuntimeArtifact.json",
  );
  const candidateArtifact = readArtifact(requiredArgument("candidate-artifact"));
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
  const currentObservations = selectNbaPlayerPropsSnapshotCurrentObservations(market.observations, snapshot.generatedAt);
  const before = buildNbaPlayerPropsForwardDecisionsFromArtifactForAudit({
    artifact: baselineArtifact,
    features,
    observations: market.observations,
    currentObservations,
    evaluatedAt: snapshot.generatedAt,
  });
  const after = buildNbaPlayerPropsForwardDecisionsFromArtifactForAudit({
    artifact: candidateArtifact,
    features,
    observations: market.observations,
    currentObservations,
    evaluatedAt: snapshot.generatedAt,
  });
  const beforeByScope = new Map(before.map((row) => [row.scopeKey, row]));
  const common = after.flatMap((row) => {
    const baseline = beforeByScope.get(row.scopeKey);
    return baseline ? [{ baseline, candidate: row }] : [];
  });
  const changed = common.filter(({ baseline, candidate }) =>
    baseline.side !== candidate.side
    || baseline.grade !== candidate.grade
    || baseline.finalProjection !== candidate.finalProjection);
  process.stdout.write(`${JSON.stringify({
    release: "nba_player_props_component_market_reader_current_board_audit_2026_10_26_r1",
    mode: "select_only",
    slateDate,
    generatedAt: snapshot.generatedAt,
    inputs: {
      snapshotDecisions: snapshot.decisions.length,
      marketObservations: market.observations.length,
      currentObservations: currentObservations.length,
      features: features.length,
    },
    baseline: summarize(before),
    candidate: summarize(after),
    impact: {
      commonRows: common.length,
      changedRows: changed.length,
      changedSides: changed.filter(({ baseline, candidate }) => baseline.side !== candidate.side).length,
      actionablePromotions: changed.filter(({ baseline, candidate }) => rank(candidate.grade) >= 2 && rank(baseline.grade) < 2).length,
      actionableDemotions: changed.filter(({ baseline, candidate }) => rank(baseline.grade) >= 2 && rank(candidate.grade) < 2).length,
      sideProjectionDisagreements: after.filter((row) => row.side !== side(row.finalProjection, row.line)).length,
      nonFiniteOrNonpositive: after.filter((row) => !Number.isFinite(row.finalProjection) || row.finalProjection <= 0).length,
    },
    changed: changed.map(({ baseline, candidate }) => ({
      player: candidate.playerName,
      market: candidate.market,
      line: candidate.line,
      before: { side: baseline.side, projection: baseline.finalProjection, grade: baseline.grade },
      after: { side: candidate.side, projection: candidate.finalProjection, grade: candidate.grade },
    })),
  }, null, 2)}\n`);
}

function summarize(rows: readonly { market: string; side: string; grade: string }[]) {
  return {
    rows: rows.length,
    markets: counts(rows.map((row) => row.market)),
    sides: counts(rows.map((row) => row.side)),
    grades: counts(rows.map((row) => row.grade)),
  };
}
function counts(values: readonly string[]): Record<string, number> {
  return values.reduce<Record<string, number>>((result, value) => {
    result[value] = (result[value] ?? 0) + 1;
    return result;
  }, {});
}
function side(value: number, line: number): "over" | "under" { return value > line ? "over" : "under"; }
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
