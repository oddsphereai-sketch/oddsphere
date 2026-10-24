/** Read-only integrity audit for the stored private NBA player-props slate. */
import { supabase } from "../../../lib/db/supabase";
import {
  buildNbaPlayerPropsForwardDecisions,
  nbaPlayerPropsFrozenRuntimeArtifact,
} from "../../../lib/services/nba/nbaPlayerPropsFrozenRuntime";
import { projectNbaPlayerPropsIndependent } from "../../../lib/services/nba/nbaPlayerPropsIndependentModel";
import { readNbaPlayerPropsCurrentState } from "../../../lib/services/nba/nbaPlayerPropsCurrentState";
import {
  readNbaPlayerPropsMarketHistory,
  readNbaPlayerPropsPrivateSnapshot,
} from "../../../lib/services/nba/nbaPlayerPropsPrivateStore";
import {
  buildNbaPlayerPropsPointInTimeFeatures,
  type NbaPlayerPropCandidate,
} from "../../../lib/services/nba/nbaPlayerPropsPointInTimeFeatures";
import { selectNbaPlayerPropsSnapshotCurrentObservations } from "./nba-player-props-snapshot-cycle";

function value(name: string): string | undefined {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : undefined;
}

async function main(): Promise<void> {
  const slateDate = value("--date");
  const season = Number(value("--season"));
  if (!slateDate || !/^\d{4}-\d{2}-\d{2}$/.test(slateDate)) throw new Error("--date is required.");
  if (!Number.isInteger(season)) throw new Error("--season is required.");
  const [prior, current, market, snapshot] = await Promise.all([
    readNbaPlayerPropsCurrentState({ client: supabase, season: season - 1 }),
    readNbaPlayerPropsCurrentState({ client: supabase, season }),
    readNbaPlayerPropsMarketHistory({ client: supabase, slateDate }),
    readNbaPlayerPropsPrivateSnapshot({ client: supabase, slateDate }),
  ]);
  if (!prior || !current || !market || !snapshot) throw new Error("Stored private NBA props inputs are incomplete.");
  const players = new Map([...prior.players, ...current.players].map((row) => [row.playerId, row]));
  const playerId = (identity: string | undefined): number | null => {
    const parsed = Number(identity?.match(/(\d+)$/)?.[1]);
    return Number.isInteger(parsed) ? parsed : null;
  };
  const upcomingGames = snapshot.games.flatMap((game) => {
    const gameId = Number(game.gameId.replace(/^.*:/, ""));
    const homeDecision = snapshot.decisions.find((row) => row.gameId === game.gameId && row.team === game.homeTeam);
    const awayDecision = snapshot.decisions.find((row) => row.gameId === game.gameId && row.team === game.awayTeam);
    const homeTeamId = players.get(playerId(homeDecision?.playerId) ?? -1)?.latestTeamId;
    const awayTeamId = players.get(playerId(awayDecision?.playerId) ?? -1)?.latestTeamId;
    if (!Number.isInteger(gameId) || !homeTeamId || !awayTeamId) return [];
    return [{
      gameId,
      season,
      startTime: game.scheduledStart,
      homeTeamId,
      awayTeamId,
      homeTeam: game.homeTeam,
      awayTeam: game.awayTeam,
    }];
  });
  const gameById = new Map(upcomingGames.map((game) => [game.gameId, game]));
  const candidateKeys = new Set<string>();
  const candidates: NbaPlayerPropCandidate[] = [];
  for (const decision of snapshot.decisions) {
    const gameId = Number(decision.gameId.replace(/^.*:/, ""));
    const id = playerId(decision.playerId);
    const game = gameById.get(gameId);
    if (!game || id === null || candidateKeys.has(`${gameId}|${id}`)) continue;
    candidateKeys.add(`${gameId}|${id}`);
    candidates.push({
      gameId,
      playerId: id,
      playerName: decision.playerName,
      teamId: decision.team === game.homeTeam ? game.homeTeamId : game.awayTeamId,
    });
  }
  const features = buildNbaPlayerPropsPointInTimeFeatures({
    games: [...prior.games, ...current.games],
    upcomingGames,
    boxes: [...prior.boxes, ...current.boxes],
    advanced: [...prior.advanced, ...current.advanced],
    candidates,
    emitGameIds: new Set(upcomingGames.map((game) => game.gameId)),
  });
  const observations = market.observations;
  const currentObservations = selectNbaPlayerPropsSnapshotCurrentObservations(observations, snapshot.generatedAt);
  const decisions = buildNbaPlayerPropsForwardDecisions({
    features,
    observations,
    currentObservations,
    evaluatedAt: snapshot.generatedAt,
  });
  const artifact = nbaPlayerPropsFrozenRuntimeArtifact();
  const affectedPlayers = features
    .filter((row) => (row.days_rest ?? 0) >= 7 || (row.minutes_mean_10 ?? 0) < 12)
    .map((row) => ({
      player: row.player_name,
      minutes3: row.minutes_mean_3,
      minutes10: row.minutes_mean_10,
      seasonMinutes: row.minutes_mean_season,
      daysRest: row.days_rest,
      participation: row.participation_rate_10,
    }));
  process.stdout.write(`${JSON.stringify({
    release: "nba_player_props_current_input_integrity_audit_2026_10_22_r1",
    mode: "read_only",
    slateDate,
    games: upcomingGames.length,
    candidates: candidates.length,
    features: features.length,
    decisions: decisions.length,
    zeroIndependentProjections: decisions.filter((row) => row.independentProjection === 0).length,
    zeroFinalProjections: decisions.filter((row) => row.finalProjection === 0).length,
    zeroProjectionRows: decisions.filter((row) => row.independentProjection === 0 || row.finalProjection === 0)
      .map((row) => {
        const feature = features.find((item) => item.game_id === row.gameId && item.player_id === row.playerId);
        const ridgeProjection = feature
          ? projectNbaPlayerPropsIndependent(feature, artifact.ridgeModel).combinations[row.market]
          : null;
        return {
          player: row.playerName,
          market: row.market,
          line: row.line,
          independentProjection: row.independentProjection,
          finalProjection: row.finalProjection,
          ridgeProjection,
          minutes3: feature?.minutes_mean_3 ?? null,
          minutes10: feature?.minutes_mean_10 ?? null,
          reboundsPerMinute10: feature?.rebounds_per_minute_10 ?? null,
          reboundChancesPerMinute5: feature?.rebound_chances_per_minute_5 ?? null,
          minutesSd10: feature?.minutes_sd_10 ?? null,
          daysRest: feature?.days_rest ?? null,
        };
      }),
    affectedPlayers,
    caldwellPope: decisions.filter((row) => row.playerName?.includes("Caldwell-Pope")).map((row) => ({
      market: row.market,
      line: row.line,
      independentProjection: row.independentProjection,
      finalProjection: row.finalProjection,
      side: row.side,
      grade: row.grade,
    })),
  }, null, 2)}\n`);
}

void main();
