/**
 * Bounded, read-only NBA player-props historical pilot.
 *
 * It fetches a deterministic completed-game window, constructs point-in-time
 * features, and runs a release-pure chronological confirmation. It never
 * writes predictions, grades, or member data.
 *
 * Availability probe (12 requests after the schedule):
 *   npx tsx --env-file=.env.local scripts/operator/nba/audit-nba-player-props-historical-pilot.ts \
 *     --season 2025 --availability-only --opening-games 12
 *
 * Bounded replay:
 *   npx tsx --env-file=.env.local scripts/operator/nba/audit-nba-player-props-historical-pilot.ts \
 *     --season 2025 --opening-games 60 --warmup-games 240 --request-ceiling 500
 */

import { createHash } from "node:crypto";
import { mkdir, rename, writeFile } from "node:fs/promises";
import path from "node:path";
import {
  fetchNbaBdlHistoricalRows,
  type NbaBdlHistoricalSeasonType,
} from "../../../lib/services/nba/balldontlieNbaHistorical";
import {
  normalizeNbaHistoricalGame,
  normalizeNbaHistoricalPlayerAdvanced,
  normalizeNbaHistoricalPlayerBox,
  type NbaHistoricalGame,
} from "../../../lib/services/nba/nbaPointInTimeFeatures";
import {
  fetchNbaBdlOpeningPlayerPropsHistory,
} from "../../../lib/services/nba/nbaPlayerPropsHistorical";
import {
  fitNbaPlayerPropsIndependentResearchModel,
  projectNbaPlayerPropsIndependent,
} from "../../../lib/services/nba/nbaPlayerPropsIndependentModel";
import {
  selectNbaPlayerPropsCanonicalOfferSets,
} from "../../../lib/services/nba/nbaPlayerPropsMarketEvidence";
import {
  buildNbaPlayerPropsPointInTimeFeatures,
  type NbaPlayerPropCandidate,
  type NbaPlayerPropFeatureRow,
} from "../../../lib/services/nba/nbaPlayerPropsPointInTimeFeatures";
import { replayNbaPlayerPropsFoundation } from "../../../lib/services/nba/nbaPlayerPropsReplay";

const SEASON_TYPES: readonly NbaBdlHistoricalSeasonType[] = ["regular", "ist"];
const FOUNDATION_MARKETS = new Set([
  "points",
  "rebounds",
  "assists",
  "threes",
  "points_rebounds_assists",
  "points_rebounds",
  "points_assists",
  "rebounds_assists",
]);

function value(name: string): string | undefined {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : undefined;
}

function hasFlag(name: string): boolean {
  return process.argv.includes(name);
}

function positiveInteger(name: string, fallback: number): number {
  const raw = value(name);
  if (raw === undefined) return fallback;
  const parsed = Number(raw);
  if (!Number.isInteger(parsed) || parsed < 1) throw new Error(`${name} must be a positive integer.`);
  return parsed;
}

function isFinalGame(row: Record<string, unknown>): boolean {
  return row.status_state === "final" || row.status === "Final";
}

function isOfficialRegularSeasonGame(row: Record<string, unknown>): boolean {
  return row.ist_stage !== "Championship" && row.postseason !== true;
}

function chunks<T>(values: readonly T[], size: number): T[][] {
  const output: T[][] = [];
  for (let index = 0; index < values.length; index += size) output.push(values.slice(index, index + size));
  return output;
}

function rawPlayerName(row: Record<string, unknown>): string | null {
  const player = row.player && typeof row.player === "object" && !Array.isArray(row.player)
    ? row.player as Record<string, unknown>
    : null;
  if (!player) return null;
  const first = typeof player.first_name === "string" ? player.first_name.trim() : "";
  const last = typeof player.last_name === "string" ? player.last_name.trim() : "";
  const name = `${first} ${last}`.trim();
  return name || null;
}

function gameEventMap(games: readonly NbaHistoricalGame[]) {
  return Object.fromEntries(games.map((game) => [String(game.gameId), {
    canonicalGameId: `nba-bdl:${game.gameId}`,
    homeTeam: game.homeTeam,
    awayTeam: game.awayTeam,
    scheduledStart: game.startTime,
  }]));
}

async function writeAtomicJson(absolute: string, value: unknown): Promise<void> {
  await mkdir(path.dirname(absolute), { recursive: true });
  const body = `${JSON.stringify(value, null, 2)}\n`;
  const temporary = `${absolute}.tmp`;
  await writeFile(temporary, body, "utf8");
  await rename(temporary, absolute);
}

async function main(): Promise<void> {
  const season = positiveInteger("--season", 2025);
  const openingGames = positiveInteger("--opening-games", 60);
  const warmupGames = positiveInteger("--warmup-games", 240);
  const evaluationSpanGames = positiveInteger("--evaluation-span-games", openingGames * 6);
  const requestCeiling = positiveInteger("--request-ceiling", 500);
  const requestIntervalMs = positiveInteger("--request-interval-ms", 125);
  const availabilityOnly = hasFlag("--availability-only");
  const output = path.resolve(value("--output") ?? `nba-research/reports/player-props-pilot-${season}.json`);
  let requests = 0;
  const remainingPages = (label: string, cap: number) => {
    const remaining = requestCeiling - requests;
    if (remaining < 1) throw new Error(`NBA player-props pilot exhausted its request ceiling before ${label}.`);
    return Math.min(cap, remaining);
  };
  const assertWithinCeiling = (label: string) => {
    if (requests > requestCeiling) {
      throw new Error(`NBA player-props pilot exceeded its request ceiling after ${label}: ${requests} > ${requestCeiling}.`);
    }
  };

  const rawGames: Record<string, unknown>[] = [];
  for (const seasonType of SEASON_TYPES) {
    const result = await fetchNbaBdlHistoricalRows({
      dataset: "games",
      season,
      seasonType,
      requestIntervalMs,
      maxPages: remainingPages(`${seasonType} schedule`, 50),
    });
    requests += result.requests;
    assertWithinCeiling(`${seasonType} schedule`);
    if (!result.complete) throw new Error(`NBA ${seasonType} schedule exceeded the bounded page limit.`);
    rawGames.push(...result.rows);
  }
  const uniqueRawGames = [...new Map(rawGames
    .filter(isFinalGame)
    .filter(isOfficialRegularSeasonGame)
    .map((row) => [String(row.id), row])).values()];
  const games = uniqueRawGames.map(normalizeNbaHistoricalGame)
    .sort((left, right) => Date.parse(left.startTime) - Date.parse(right.startTime) || left.gameId - right.gameId);
  if (games.length < evaluationSpanGames + warmupGames) {
    throw new Error(`NBA season ${season} has only ${games.length} eligible games; requested ${evaluationSpanGames + warmupGames}.`);
  }
  const evaluationPool = games.slice(-evaluationSpanGames);
  const evaluationGames = evenlySpaced(evaluationPool, openingGames);
  if (requests + evaluationGames.length > requestCeiling) {
    throw new Error(`NBA player-props pilot cannot fit ${evaluationGames.length} opening requests under its ceiling.`);
  }
  const opening = await fetchNbaBdlOpeningPlayerPropsHistory({
    gameIds: evaluationGames.map((game) => game.gameId),
    events: gameEventMap(evaluationGames),
    canonicalPlayers: Object.fromEntries(
      // BALLDONTLIE player ids are stable canonical ids within this research boundary.
      Array.from({ length: 0 }, () => ["", ""]),
    ),
    requestIntervalMs,
  });
  requests += opening.requests;
  assertWithinCeiling("opening player props");
  const coveredGameIds = new Set(opening.rows.map((row) => Number(row.providerEventId)));
  const availability = {
    season,
    evaluatedGames: evaluationGames.length,
    gamesWithOpeningProps: opening.gamesWithProps,
    openingCoverage: evaluationGames.length > 0 ? opening.gamesWithProps / evaluationGames.length : 0,
    openingRows: opening.rows.length,
    sportsbooks: [...new Set(opening.rows.map((row) => row.sportsbook))].sort(),
    markets: Object.fromEntries([...new Set(opening.rows.map((row) => row.market))].sort().map((market) => [
      market,
      opening.rows.filter((row) => row.market === market).length,
    ])),
    requests,
    requestCeiling,
  };
  if (availabilityOnly) {
    const report = {
      mode: "offline_research_only",
      actionable: false,
      generatedAt: new Date().toISOString(),
      availability,
    };
    await writeAtomicJson(output, report);
    process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
    return;
  }
  if (coveredGameIds.size < 8) throw new Error("NBA props pilot found fewer than 8 games with opening props.");

  const firstEvaluationIndex = games.findIndex((game) => game.gameId === evaluationGames[0]!.gameId);
  const lastEvaluationIndex = games.findIndex((game) => game.gameId === evaluationGames.at(-1)!.gameId);
  const historyGames = games.slice(Math.max(0, firstEvaluationIndex - warmupGames), firstEvaluationIndex);
  // Keep every intervening game so later point-in-time histories are complete,
  // even though opening prices are sampled only for evaluation games.
  const requestedGames = games.slice(Math.max(0, firstEvaluationIndex - warmupGames), lastEvaluationIndex + 1);
  const gameIds = requestedGames.map((game) => game.gameId);
  const rawBoxes: Record<string, unknown>[] = [];
  const rawAdvanced: Record<string, unknown>[] = [];
  for (const batch of chunks(gameIds, 25)) {
    const result = await fetchNbaBdlHistoricalRows({
      dataset: "box",
      gameIds: batch,
      requestIntervalMs,
      maxPages: remainingPages("box-score batch", 25),
    });
    requests += result.requests;
    assertWithinCeiling("box-score batch");
    if (!result.complete) throw new Error("NBA box-score batch exceeded the bounded page limit.");
    rawBoxes.push(...result.rows);
  }
  for (const batch of chunks(gameIds, 25)) {
    const result = await fetchNbaBdlHistoricalRows({
      dataset: "advanced",
      gameIds: batch,
      requestIntervalMs,
      maxPages: remainingPages("advanced-stat batch", 25),
    });
    requests += result.requests;
    assertWithinCeiling("advanced-stat batch");
    if (!result.complete) throw new Error("NBA advanced-stat batch exceeded the bounded page limit.");
    rawAdvanced.push(...result.rows);
  }

  const boxes = unique(rawBoxes.map(normalizeNbaHistoricalPlayerBox), (row) => row.rowId);
  const advanced = unique(rawAdvanced.map(normalizeNbaHistoricalPlayerAdvanced), (row) => row.rowId);
  const boxByGamePlayer = new Map(boxes.map((row) => [`${row.gameId}:${row.playerId}`, row]));
  const playerNames = new Map<string, string>();
  for (const row of rawBoxes) {
    const normalized = normalizeNbaHistoricalPlayerBox(row);
    const name = rawPlayerName(row);
    if (name) playerNames.set(String(normalized.playerId), name);
  }
  // Re-identity the already-fetched observations without a second network call.
  const observations = opening.rows.map((row) => ({
    ...row,
    canonicalPlayerId: row.providerPlayerId ? `nba-bdl-player:${row.providerPlayerId}` : null,
  }));
  const candidatesByIdentity = new Map<string, NbaPlayerPropCandidate>();
  for (const row of observations) {
    if (!FOUNDATION_MARKETS.has(row.market) || row.providerPlayerId === null) continue;
    const playerId = Number(row.providerPlayerId);
    const gameId = Number(row.providerEventId);
    const target = boxByGamePlayer.get(`${gameId}:${playerId}`);
    if (!target) continue;
    const key = `${gameId}:${playerId}`;
    candidatesByIdentity.set(key, {
      gameId,
      playerId,
      playerName: playerNames.get(String(playerId)) ?? null,
      teamId: target.teamId,
    });
  }
  const emitGameIds = new Set(evaluationGames.map((game) => game.gameId));
  const featureRows = buildNbaPlayerPropsPointInTimeFeatures({
    games: requestedGames,
    boxes,
    advanced,
    candidates: [...candidatesByIdentity.values()],
    emitGameIds,
  });
  const coveredOrdered = evaluationGames.filter((game) => coveredGameIds.has(game.gameId));
  const splitIndex = Math.max(4, Math.min(coveredOrdered.length - 1, Math.floor(coveredOrdered.length * 0.75)));
  const trainingGameIds = new Set(coveredOrdered.slice(0, splitIndex).map((game) => game.gameId));
  const confirmationGameIds = new Set(coveredOrdered.slice(splitIndex).map((game) => game.gameId));
  const trainingRows = featureRows.filter((row) => trainingGameIds.has(row.game_id));
  const confirmationRows = featureRows.filter((row) => confirmationGameIds.has(row.game_id));
  const replay = replayNbaPlayerPropsFoundation({ trainingRows, confirmationRows, openingObservations: observations });
  const example = historicalExample({
    trainingRows,
    confirmationRows,
    observations,
    games: evaluationGames,
  });
  const report = {
    mode: "offline_research_only",
    actionable: false,
    generatedAt: new Date().toISOString(),
    requestPolicy: {
      requests,
      requestCeiling,
      withinCeiling: requests <= requestCeiling,
      requestIntervalMs,
    },
    availability,
    dataset: {
      historyGames: historyGames.length,
      evaluationSpanGames,
      requestedGames: requestedGames.length,
      evaluationGames: evaluationGames.length,
      coveredEvaluationGames: coveredOrdered.length,
      rawBoxRows: rawBoxes.length,
      rawAdvancedRows: rawAdvanced.length,
      candidates: candidatesByIdentity.size,
      featureRows: featureRows.length,
      trainingGames: trainingGameIds.size,
      confirmationGames: confirmationGameIds.size,
      trainingRows: trainingRows.length,
      confirmationRows: confirmationRows.length,
    },
    replay,
    genuineHistoricalExample: example,
    integrity: {
      immutableInputsSha256: createHash("sha256").update(JSON.stringify({
        gameIds,
        openingObservationIds: observations.map((row) => row.providerObservationId).sort(),
        boxIds: boxes.map((row) => row.rowId).sort((a, b) => a - b),
        advancedIds: advanced.map((row) => row.rowId).sort((a, b) => a - b),
      })).digest("hex"),
      noDatabaseWrites: true,
      noMemberWrites: true,
      noGradesOrStakes: true,
    },
  };
  await writeAtomicJson(output, report);
  process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
}

function historicalExample(args: {
  trainingRows: NbaPlayerPropFeatureRow[];
  confirmationRows: NbaPlayerPropFeatureRow[];
  observations: ReturnType<typeof selectNbaPlayerPropsCanonicalOfferSets>[number]["observations"];
  games: NbaHistoricalGame[];
}) {
  if (args.trainingRows.length < 8) return null;
  const model = fitNbaPlayerPropsIndependentResearchModel(args.trainingRows);
  const canonical = selectNbaPlayerPropsCanonicalOfferSets(args.observations.filter((row) => row.isOpening));
  const gameById = new Map(args.games.map((game) => [game.gameId, game]));
  const choices = args.confirmationRows.flatMap((row) => {
    const scope = `nba-bdl:${row.game_id}|nba-bdl-player:${row.player_id}|points`;
    const offer = canonical.find((item) => item.scopeKey === scope);
    if (!offer || row.target_points === null) return [];
    return [{ row, offer }];
  }).sort((left, right) => right.offer.completeBooks - left.offer.completeBooks);
  const selected = choices[0];
  if (!selected) return null;
  const projection = projectNbaPlayerPropsIndependent(selected.row, model);
  const game = gameById.get(selected.row.game_id) ?? null;
  return {
    gameId: selected.row.game_id,
    game: game ? `${game.awayTeam} @ ${game.homeTeam}` : null,
    scheduledStart: game?.startTime ?? selected.row.feature_cutoff,
    playerId: selected.row.player_id,
    playerName: selected.row.player_name,
    teamId: selected.row.team_id,
    market: "points",
    line: selected.offer.canonicalLine,
    independentProjection: projection.components.points,
    conditionalMinutes: projection.conditionalMinutes,
    participationProbability: projection.participationProbability,
    actual: selected.row.target_points,
    completeBooks: selected.offer.completeBooks,
    prices: selected.offer.observations.map((row) => ({
      sportsbook: row.sportsbook,
      side: row.side,
      line: row.line,
      price: row.americanPrice,
      observedAt: row.observedAt,
    })),
    evidence: {
      gamesPrior: selected.row.player_games_prior,
      minutesMean3: selected.row.minutes_mean_3,
      minutesMean10: selected.row.minutes_mean_10,
      pointsPerMinute10: selected.row.points_per_minute_10,
      usageMean5: selected.row.usage_mean_5,
      fgaPerMinute10: selected.row.fga_per_minute_10,
      fg3aPerMinute10: selected.row.fg3a_per_minute_10,
      ftaPerMinute10: selected.row.fta_per_minute_10,
      trueShootingMean5: selected.row.true_shooting_mean_5,
    },
  };
}

function unique<T>(rows: T[], key: (row: T) => number): T[] {
  return [...new Map(rows.map((row) => [key(row), row])).values()];
}

function evenlySpaced<T>(values: readonly T[], count: number): T[] {
  if (count > values.length) throw new Error(`Cannot select ${count} values from ${values.length}.`);
  if (count === 1) return [values.at(-1)!];
  const indexes = Array.from({ length: count }, (_, index) =>
    Math.round(index * (values.length - 1) / (count - 1)));
  return indexes.map((index) => values[index]!);
}

main().catch((error) => {
  process.stderr.write(`${error instanceof Error ? error.stack ?? error.message : String(error)}\n`);
  process.exitCode = 1;
});
