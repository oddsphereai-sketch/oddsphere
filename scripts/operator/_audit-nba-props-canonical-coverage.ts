import { supabase } from "../../lib/db/supabase";
import {
  buildNbaPlayerPropsForwardDecisionsFromArtifactForAudit,
  nbaPlayerPropsFrozenRuntimeArtifact,
} from "../../lib/services/nba/nbaPlayerPropsFrozenRuntime";
import { collectNbaPlayerPropsLiveMarket } from "../../lib/services/nba/nbaPlayerPropsLiveCollector";
import { nbaPlayerPropsSlateDate } from "../../lib/services/nba/nbaPlayerPropsLifecycle";
import {
  selectNbaPlayerPropsCurrentCanonicalOfferSets,
  selectNbaPlayerPropsLegacyCurrentCanonicalOfferSetsForAudit,
} from "../../lib/services/nba/nbaPlayerPropsMarketEvidence";
import {
  mergeNbaPlayerPropsMarketHistory,
  readNbaPlayerPropsMarketHistory,
  readNbaPlayerPropsPrivateSnapshot,
} from "../../lib/services/nba/nbaPlayerPropsPrivateStore";
import { readNbaPlayerPropsCurrentState } from "../../lib/services/nba/nbaPlayerPropsCurrentState";
import {
  buildNbaPlayerPropsPointInTimeFeatures,
  type NbaPlayerPropCandidate,
} from "../../lib/services/nba/nbaPlayerPropsPointInTimeFeatures";

async function main(): Promise<void> {
  const now = new Date();
  const evaluatedAt = now.toISOString();
  const slateDate = nbaPlayerPropsSlateDate(now);
  const season = now.getUTCMonth() >= 9 ? now.getUTCFullYear() : now.getUTCFullYear() - 1;
  const currentState = await readNbaPlayerPropsCurrentState({ client: supabase, season });
  const priorState = await readNbaPlayerPropsCurrentState({ client: supabase, season: season - 1 });
  if (!priorState) throw new Error("Prior NBA player state missing.");
  const players = new Map([...priorState.players, ...(currentState?.players ?? [])].map((row) => [row.playerId, row]));
  const canonicalPlayersByName = Object.fromEntries([...players.values()].flatMap((player) => player.playerName
    ? [[normalize(player.playerName), `nba-bdl-player:${player.playerId}`] as const]
    : []));
  const live = await collectNbaPlayerPropsLiveMarket({
    slateDate,
    ballDontLieApiKey: required("BALLDONTLIE_API_KEY"),
    theOddsApiKey: process.env.THE_ODDS_API_KEY?.trim() || null,
    includeOpenings: false,
    canonicalPlayersByName,
    knownPlayerIdentitiesById: Object.fromEntries([...players.values()].map((player) => [String(player.playerId), {
      playerName: player.playerName,
      playerTeam: player.latestTeamId === null ? null : String(player.latestTeamId),
    }])),
  });
  const previousHistory = await readNbaPlayerPropsMarketHistory({ client: supabase, slateDate });
  const history = mergeNbaPlayerPropsMarketHistory({
    previous: previousHistory,
    current: live.observations,
    slateDate,
    capturedAt: evaluatedAt,
  }).history;
  const upcoming = live.games.flatMap((game) => {
    const ids = live.teamIdsByGame[game.canonicalGameId];
    return ids ? [{
      gameId: Number(game.providerGameId),
      season,
      startTime: game.scheduledStart,
      homeTeamId: ids.home,
      awayTeamId: ids.away,
      homeTeam: game.homeTeam,
      awayTeam: game.awayTeam,
    }] : [];
  });
  const gameById = new Map(upcoming.map((game) => [game.gameId, game]));
  const candidates: NbaPlayerPropCandidate[] = [];
  const candidateKeys = new Set<string>();
  for (const observation of history.observations) {
    const gameId = Number(observation.canonicalGameId?.replace(/^.*:/, ""));
    const playerId = Number((observation.canonicalPlayerId ?? observation.providerPlayerId)?.replace(/^.*:/, ""));
    const game = gameById.get(gameId);
    if (!game || !Number.isInteger(playerId)) continue;
    const identity = players.get(playerId);
    const providerTeam = Number(observation.playerTeam);
    const teamId = [providerTeam, identity?.latestTeamId]
      .find((value) => value === game.homeTeamId || value === game.awayTeamId);
    if (!teamId) continue;
    const key = `${gameId}|${playerId}`;
    if (candidateKeys.has(key)) continue;
    candidateKeys.add(key);
    candidates.push({
      gameId,
      playerId,
      playerName: observation.playerName ?? identity?.playerName ?? null,
      teamId,
    });
  }
  const features = buildNbaPlayerPropsPointInTimeFeatures({
    games: [...priorState.games, ...(currentState?.games ?? [])],
    upcomingGames: upcoming,
    boxes: [...priorState.boxes, ...(currentState?.boxes ?? [])],
    advanced: [...priorState.advanced, ...(currentState?.advanced ?? [])],
    candidates,
    emitGameIds: new Set(upcoming.map((game) => game.gameId)),
  });
  const artifact = nbaPlayerPropsFrozenRuntimeArtifact();
  const legacyOffers = selectNbaPlayerPropsLegacyCurrentCanonicalOfferSetsForAudit(live.observations);
  const candidateOffers = selectNbaPlayerPropsCurrentCanonicalOfferSets(live.observations);
  const legacy = buildNbaPlayerPropsForwardDecisionsFromArtifactForAudit({
    artifact,
    features,
    observations: history.observations,
    currentOfferSets: legacyOffers,
    evaluatedAt,
  });
  const candidate = buildNbaPlayerPropsForwardDecisionsFromArtifactForAudit({
    artifact,
    features,
    observations: history.observations,
    currentOfferSets: candidateOffers,
    evaluatedAt,
  });
  const legacyByScope = new Map(legacy.map((row) => [row.scopeKey, row]));
  const candidateByScope = new Map(candidate.map((row) => [row.scopeKey, row]));
  const common = [...legacyByScope.keys()].filter((key) => candidateByScope.has(key));
  const changed = common.filter((key) => comparable(legacyByScope.get(key)!) !== comparable(candidateByScope.get(key)!));
  const added = [...candidateByScope.keys()].filter((key) => !legacyByScope.has(key));
  const removed = [...legacyByScope.keys()].filter((key) => !candidateByScope.has(key));
  const independentOnly = candidate.filter((row) => row.marketEvidenceMode === "independent_projection");
  const foundationMarkets = new Set([
    "points", "rebounds", "assists", "threes", "points_rebounds_assists",
    "points_rebounds", "points_assists", "rebounds_assists",
  ]);
  const foundationOffers = candidateOffers.filter((offer) => foundationMarkets.has(offer.scopeKey.split("|")[2] ?? ""));
  const featureKeys = new Set(features.map((row) => `${row.game_id}|${row.player_id}`));
  const missingFeatureOffers = foundationOffers.filter((offer) => {
    const [gameId, playerId] = offer.scopeKey.split("|");
    return !featureKeys.has(`${Number(gameId?.replace(/^.*:/, ""))}|${Number(playerId?.replace(/^.*:/, ""))}`);
  });
  const liveSnapshot = await readNbaPlayerPropsPrivateSnapshot({ client: supabase, slateDate });
  const liveScopes = new Set(liveSnapshot?.decisions.map((row) => `${row.gameId}|${row.playerId}|${row.market}`) ?? []);
  const candidateOnlyVsLive = candidate.filter((row) => !liveScopes.has(row.scopeKey));
  process.stdout.write(`${JSON.stringify({
    slateDate,
    provider: {
      games: live.games.length,
      observations: live.observations.length,
      requests: live.providerRequests,
      theOddsApiCreditsUsed: live.theOddsApiCreditsUsed,
      findings: live.findings,
    },
    features: features.length,
    offers: { legacy: legacyOffers.length, candidate: candidateOffers.length, foundation: foundationOffers.length },
    decisions: { legacy: legacy.length, candidate: candidate.length, live: liveSnapshot?.decisions.length ?? null },
    candidateOnlyVsLive: {
      decisions: candidateOnlyVsLive.length,
      actionable: candidateOnlyVsLive.filter((row) => row.grade === "Best Angle" || row.grade === "Lean").length,
      independentOnly: candidateOnlyVsLive.filter((row) => row.marketEvidenceMode === "independent_projection").length,
    },
    byMarket: { legacy: counts(legacy), candidate: counts(candidate) },
    common: common.length,
    commonChanged: changed.length,
    changedSample: changed.slice(0, 20).map((key) => ({
      scope: key,
      legacy: compact(legacyByScope.get(key)!),
      candidate: compact(candidateByScope.get(key)!),
    })),
    added: added.length,
    addedByMarket: Object.fromEntries([...new Set(candidate.map((row) => row.market))].sort().map((market) => [
      market,
      added.filter((key) => candidateByScope.get(key)?.market === market).length,
    ])),
    addedActionable: added.filter((key) => {
      const grade = candidateByScope.get(key)?.grade;
      return grade === "Best Angle" || grade === "Lean";
    }).length,
    removed: removed.length,
    independentOnly: independentOnly.length,
    independentOnlyActionable: independentOnly.filter((row) => row.grade === "Best Angle" || row.grade === "Lean").length,
    missingFeatureOffers: missingFeatureOffers.length,
    missingFeaturePlayers: [...new Map(missingFeatureOffers.map((offer) => {
      const observation = offer.observations[0]!;
      return [offer.scopeKey.split("|")[1], {
        playerId: offer.scopeKey.split("|")[1],
        playerName: observation.playerName,
        playerTeam: observation.playerTeam,
        gameId: offer.scopeKey.split("|")[0],
      }];
    })).values()],
    actionables: {
      legacy: legacy.filter((row) => row.grade === "Best Angle" || row.grade === "Lean").length,
      candidate: candidate.filter((row) => row.grade === "Best Angle" || row.grade === "Lean").length,
    },
  }, null, 2)}\n`);
}

void main();

function comparable(row: ReturnType<typeof buildNbaPlayerPropsForwardDecisionsFromArtifactForAudit>[number]): string {
  return JSON.stringify(compact(row));
}
function compact(row: ReturnType<typeof buildNbaPlayerPropsForwardDecisionsFromArtifactForAudit>[number]) {
  return {
    line: row.line, projection: row.finalProjection, side: row.side, probability: row.probability,
    grade: row.grade, sportsbook: row.sportsbook, price: row.americanPrice,
    evidence: row.marketEvidenceMode, otherBooks: row.targetExcludedBooks,
  };
}
function counts(rows: ReturnType<typeof buildNbaPlayerPropsForwardDecisionsFromArtifactForAudit>) {
  return Object.fromEntries([...new Set(rows.map((row) => row.market))].sort().map((market) => [
    market,
    rows.filter((row) => row.market === market).length,
  ]));
}
function required(name: string): string {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`${name} missing`);
  return value;
}
function normalize(value: string): string {
  return value.toLowerCase().normalize("NFKD").replace(/[\u0300-\u036f]/g, "").replace(/[^a-z0-9]/g, "");
}
