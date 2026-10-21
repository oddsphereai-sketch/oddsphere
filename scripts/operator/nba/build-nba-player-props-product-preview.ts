/**
 * Builds a compact private visual-QA fixture from the untouched historical
 * confirmation payload emitted by audit-nba-player-props-model-tournament.ts.
 * It never fetches, writes member data, publishes, locks, settles, or changes a
 * grade. The output is deterministic and contains real stored values only.
 */

import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import type { NbaPlayerPropMarket, NbaPlayerPropPriceObservation } from "../../../lib/services/nba/nbaPlayerPropsContract";
import type { NbaPlayerPropFeatureRow } from "../../../lib/services/nba/nbaPlayerPropsPointInTimeFeatures";
import { buildNbaPlayerPropsReaderEvidence } from "../../../lib/services/nba/nbaPlayerPropsReaderContract";
import {
  buildNbaPlayerPropsMemberSnapshot,
  type NbaPlayerPropsMemberDecision,
  type NbaPlayerPropsMemberGame,
  type NbaPlayerPropsMemberGrade,
} from "../../../lib/services/nba/nbaPlayerPropsProductContract";

type PreviewGame = {
  gameId: number;
  startTime: string;
  homeTeamId: number;
  awayTeamId: number;
  homeTeam: string;
  awayTeam: string;
};

type PreviewRow = {
  gameId: number;
  playerId: number;
  playerName: string | null;
  teamId: number;
  opponentTeamId: number;
  featureCutoff: string;
  market: NbaPlayerPropMarket;
  line: number;
  independentProjection: number;
  finalProjection: number;
  finalSide: "over" | "under";
  finalProbability: number;
  sportsbook: string;
  americanPrice: number;
  expectedValue: number;
  targetExcludedProbability: number;
  targetExcludedBooks: number;
  targetExcludedReferenceBooks: number;
  marketEvidenceMode: "target_excluded_arbitration" | "candidate_projection";
  grade: NbaPlayerPropsMemberGrade;
  gradePolicySource: NbaPlayerPropsMemberDecision["gradePolicySource"];
};

type PreviewInput = {
  mode: "private_historical_visual_qa_only";
  games: PreviewGame[];
  rows: PreviewRow[];
  features: NbaPlayerPropFeatureRow[];
  observations: NbaPlayerPropPriceObservation[];
};

function argument(name: string): string | undefined {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : undefined;
}

async function main(): Promise<void> {
  const inputPath = path.resolve(argument("--input") ?? "");
  const outputPath = path.resolve(argument("--output") ?? "");
  if (!argument("--input") || !argument("--output")) throw new Error("--input and --output are required.");
  const input = JSON.parse(await readFile(inputPath, "utf8")) as PreviewInput;
  const games = input.games.map<NbaPlayerPropsMemberGame>((game) => ({
    gameId: String(game.gameId),
    scheduledStart: game.startTime,
    homeTeam: game.homeTeam,
    awayTeam: game.awayTeam,
  }));
  const gamesById = new Map(input.games.map((game) => [game.gameId, game]));
  const featuresByScope = new Map(input.features.map((feature) => [`${feature.game_id}|${feature.player_id}`, feature]));
  const selected = selectCompactRows(input.rows);
  const decisions = selected.map<NbaPlayerPropsMemberDecision>((row) => {
    const game = gamesById.get(row.gameId);
    const feature = featuresByScope.get(`${row.gameId}|${row.playerId}`);
    if (!game || !feature || !row.playerName) throw new Error(`NBA preview row ${row.gameId}/${row.playerId} is incomplete.`);
    const team = row.teamId === game.homeTeamId ? game.homeTeam : row.teamId === game.awayTeamId ? game.awayTeam : null;
    const opponent = row.opponentTeamId === game.homeTeamId
      ? game.homeTeam
      : row.opponentTeamId === game.awayTeamId
        ? game.awayTeam
        : null;
    if (!team || !opponent) throw new Error(`NBA preview row ${row.gameId}/${row.playerId} has incoherent team identity.`);
    const exact = input.observations.filter((observation) => observation.providerEventId === String(row.gameId)
      && observation.providerPlayerId === String(row.playerId)
      && observation.market === row.market
      && observation.line === row.line
      && (observation.side === "over" || observation.side === "under"));
    const priceLadder = exact.map((observation) => ({
      sportsbook: observation.sportsbook,
      side: observation.side as "over" | "under",
      line: observation.line,
      americanPrice: observation.americanPrice,
      observedAt: observation.observedAt,
    })).sort((left, right) => left.side.localeCompare(right.side) || right.americanPrice - left.americanPrice);
    if (priceLadder.length === 0) throw new Error(`NBA preview row ${row.gameId}/${row.playerId}/${row.market} has no exact price ladder.`);
    const evidence = buildNbaPlayerPropsReaderEvidence(feature, row.market);
    const evaluatedAt = exact.map((observation) => observation.observedAt)
      .sort((left, right) => Date.parse(right) - Date.parse(left))[0] ?? row.featureCutoff;
    const projection = round(row.finalProjection, 3);
    const side = projection >= row.line ? "over" : "under";
    return {
      decisionKey: [row.gameId, row.playerId, row.market].join("|"),
      gameId: String(row.gameId),
      scheduledStart: game.startTime,
      homeTeam: game.homeTeam,
      awayTeam: game.awayTeam,
      playerId: String(row.playerId),
      playerName: row.playerName,
      team,
      opponent,
      market: row.market,
      line: row.line,
      projection,
      independentProjection: round(row.independentProjection, 3),
      side,
      probability: round(row.finalProbability, 4),
      grade: row.grade,
      sportsbook: row.sportsbook,
      americanPrice: row.americanPrice,
      expectedValue: round(row.expectedValue, 4),
      targetExcludedProbability: round(row.targetExcludedProbability, 4),
      targetExcludedBooks: row.targetExcludedBooks,
      targetExcludedReferenceBooks: row.targetExcludedReferenceBooks,
      marketEvidenceMode: row.marketEvidenceMode,
      gradePolicySource: row.gradePolicySource,
      ...evidence,
      priceLadder,
      movement: null,
      evaluatedAt,
      lockedAt: null,
    };
  });
  const generatedAt = decisions.map((decision) => decision.evaluatedAt)
    .sort((left, right) => Date.parse(right) - Date.parse(left))[0] ?? input.games[0]?.startTime;
  if (!generatedAt) throw new Error("NBA preview has no deterministic generation timestamp.");
  const snapshot = buildNbaPlayerPropsMemberSnapshot({
    mode: input.mode,
    generatedAt,
    slateDate: input.games.map((game) => easternDate(game.startTime)).sort()[0] ?? "2026-04-04",
    games,
    decisions,
    inputRows: input.rows.length,
  });
  await mkdir(path.dirname(outputPath), { recursive: true });
  await writeFile(outputPath, `${JSON.stringify(snapshot, null, 2)}\n`, "utf8");
  process.stdout.write(`${JSON.stringify({
    outputPath,
    games: snapshot.games.length,
    decisions: snapshot.decisions.length,
    diagnostics: snapshot.diagnostics,
  }, null, 2)}\n`);
}

function selectCompactRows(rows: readonly PreviewRow[]): PreviewRow[] {
  const output: PreviewRow[] = [];
  const byGame = new Map<number, PreviewRow[]>();
  for (const row of rows) byGame.set(row.gameId, [...(byGame.get(row.gameId) ?? []), row]);
  for (const gameRows of byGame.values()) {
    const ordered = [...gameRows].sort((left, right) => gradeRank(left.grade) - gradeRank(right.grade)
      || right.expectedValue - left.expectedValue
      || right.finalProbability - left.finalProbability);
    const selected: PreviewRow[] = ordered.filter((row) => row.grade === "Best Angle" || row.grade === "Lean").slice(0, 8);
    const markets = new Set(selected.map((row) => row.market));
    for (const row of ordered) {
      if (selected.length >= 16) break;
      if (selected.includes(row)) continue;
      if (!markets.has(row.market)) {
        selected.push(row);
        markets.add(row.market);
      }
    }
    for (const row of ordered) {
      if (selected.length >= 16) break;
      if (!selected.includes(row)) selected.push(row);
    }
    output.push(...selected);
  }
  return output;
}

function gradeRank(grade: NbaPlayerPropsMemberGrade): number {
  return grade === "Best Angle" ? 0 : grade === "Lean" ? 1 : grade === "Watchlist" ? 2 : 3;
}

function round(value: number, digits: number): number {
  const scale = 10 ** digits;
  return Math.round(value * scale) / scale;
}

function easternDate(value: string): string {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/New_York",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(new Date(value));
  const byType = new Map(parts.map((part) => [part.type, part.value]));
  return `${byType.get("year")}-${byType.get("month")}-${byType.get("day")}`;
}

void main();
