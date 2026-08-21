import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { PlaybookClient } from "../../lib/providers/playbook/playbookClient";
import type { PlaybookLineGame, PlaybookSplitGame } from "../../lib/providers/playbook/types";
import { fetchBalldontlieNflRegularSlate, type NflPreviewBookOdds } from "../../lib/services/football/balldontlieNflPreviewSlate";
import {
  NFL_REGULAR_MARKET_EVIDENCE_RELEASE,
  matchPlaybookRows,
  readCurrentNflRegularMarketEvidence,
  type NflRegularConsensusLine,
  type NflRegularConsensusMarket,
  type NflRegularConsensusSplit,
  type NflRegularMarketEvidence,
} from "../../lib/services/football/nflRegularMarketEvidence";

const SEASON = 2026 as const;

async function main() {
  const week = Number(process.argv.find((value) => value.startsWith("--week="))?.split("=")[1] ?? "1");
  if (!Number.isInteger(week) || week < 1 || week > 18) throw new Error("--week must be 1 through 18.");
  const bdlKey = process.env.BALLDONTLIE_API_KEY;
  const playbookKey = process.env.PLAYBOOK_API_KEY;
  if (!bdlKey) throw new Error("BALLDONTLIE_API_KEY is required.");
  if (!playbookKey) throw new Error("PLAYBOOK_API_KEY is required.");

  const [slate, linesRead, splitsRead] = await Promise.all([
    fetchBalldontlieNflRegularSlate({ season: SEASON, week, apiKey: bdlKey }),
    new PlaybookClient(playbookKey).lines("nfl"),
    new PlaybookClient(playbookKey).splits("nfl"),
  ]);
  const capturedAt = new Date().toISOString();
  const lines = matchPlaybookRows(slate.games, linesRead.body.data ?? []);
  const splits = matchPlaybookRows(slate.games, splitsRead.body.data ?? []);
  const previous = await readCurrentNflRegularMarketEvidence(week).then((value) => value.payload).catch(() => null);
  const seed = previous ?? await loadSeedInput(week);
  const priceHistoryByGame = Object.fromEntries(slate.games.map((game) => {
    const gameId = game.providerGameId;
    const current = slate.currentOddsByGame[gameId];
    if (!current || !completeOdds(current)) throw new Error(`Named-book odds are incomplete for NFL game ${gameId}.`);
    const prior = seed.priceHistoryByGame[gameId] ?? [];
    return [gameId, dedupeHistory([...prior, current])];
  }));
  const consensusLinesByGame = Object.fromEntries(slate.games.map((game) => [
    game.providerGameId,
    normalizeLine(game.providerGameId, capturedAt, lines[game.providerGameId]!),
  ]));
  const consensusSplitsByGame = Object.fromEntries(slate.games.map((game) => [
    game.providerGameId,
    normalizeSplits(game.providerGameId, capturedAt, splits[game.providerGameId]!),
  ]));
  const gameIds = slate.games.map((game) => game.providerGameId);
  const uniqueTeamIds = new Set(slate.games.flatMap((game) => [game.away.id, game.home.id]));
  const minimumNamedBookObservations = Math.min(...gameIds.map((gameId) => priceHistoryByGame[gameId]!.length));
  const payload: NflRegularMarketEvidence = {
    evidenceRelease: NFL_REGULAR_MARKET_EVIDENCE_RELEASE,
    season: SEASON,
    week,
    capturedAt,
    scheduleRelease: slate.release,
    games: slate.games,
    currentOddsByGame: slate.currentOddsByGame,
    providerOpeningOddsByGame: slate.openingOddsByGame,
    priceHistoryByGame,
    consensusLinesByGame,
    consensusSplitsByGame,
    coverage: {
      games: gameIds.length,
      currentNamedBookPairs: gameIds.filter((gameId) => completeOdds(slate.currentOddsByGame[gameId])).length,
      providerOpenings: Object.keys(slate.openingOddsByGame).length,
      operationalOpenings: gameIds.filter((gameId) => priceHistoryByGame[gameId]!.length > 0).length,
      minimumNamedBookObservations,
      consensusLines: Object.keys(consensusLinesByGame).length,
      consensusSplits: gameIds.filter((gameId) => completeSplitSet(consensusSplitsByGame[gameId]!)).length,
    },
    requestBudget: {
      balldontlie: slate.providerRequests,
      playbook: 2,
      total: slate.providerRequests + 2,
    },
  };
  const scheduleCountPlausible = week === 1
    ? payload.coverage.games === 16
    : payload.coverage.games >= 13 && payload.coverage.games <= 16;
  if (
    !scheduleCountPlausible ||
    new Set(gameIds).size !== gameIds.length ||
    uniqueTeamIds.size !== gameIds.length * 2 ||
    payload.coverage.currentNamedBookPairs !== payload.coverage.games ||
    payload.coverage.operationalOpenings !== payload.coverage.games ||
    payload.coverage.minimumNamedBookObservations < 2 ||
    payload.coverage.consensusLines !== payload.coverage.games ||
    payload.coverage.consensusSplits !== payload.coverage.games
  ) {
    throw new Error(`NFL market-evidence capture is incomplete: ${JSON.stringify(payload.coverage)}.`);
  }
  const bytes = Buffer.from(`${JSON.stringify(payload, null, 2)}\n`, "utf8");
  const checksum = createHash("sha256").update(bytes).digest("hex");
  const root = path.resolve(process.cwd(), "football-research/cache/nfl-model/current");
  await mkdir(root, { recursive: true });
  const filename = `nfl_regular_2026_week_${week}.market-evidence.${checksum.slice(0, 16)}.json`;
  await writeFile(path.join(root, filename), bytes);
  await writeFile(path.join(root, `nfl_regular_2026_week_${week}.market-evidence.latest.json`), `${JSON.stringify({
    evidenceRelease: NFL_REGULAR_MARKET_EVIDENCE_RELEASE,
    filename,
    sha256: checksum,
    season: SEASON,
    week,
    capturedAt,
  }, null, 2)}\n`, "utf8");
  console.log(JSON.stringify({
    evidenceRelease: NFL_REGULAR_MARKET_EVIDENCE_RELEASE,
    week,
    filename,
    sha256: checksum,
    coverage: payload.coverage,
    requestBudget: payload.requestBudget,
  }, null, 2));
}

async function loadSeedInput(week: number): Promise<Pick<NflRegularMarketEvidence, "priceHistoryByGame">> {
  const root = path.resolve(process.cwd(), "football-research/cache/nfl-model/current");
  const pointer = JSON.parse(await readFile(path.join(root, `nfl_regular_2026_week_${week}.latest.json`), "utf8")) as { filename?: unknown; sha256?: unknown };
  if (typeof pointer.filename !== "string" || typeof pointer.sha256 !== "string") throw new Error("NFL regular seed pointer is invalid.");
  const bytes = await readFile(path.join(root, pointer.filename));
  if (createHash("sha256").update(bytes).digest("hex") !== pointer.sha256) throw new Error("NFL regular seed checksum mismatch.");
  const input = JSON.parse(bytes.toString("utf8")) as { slate?: { currentOddsByGame?: Record<string, NflPreviewBookOdds> } };
  const prices = input.slate?.currentOddsByGame ?? {};
  return { priceHistoryByGame: Object.fromEntries(Object.entries(prices).map(([gameId, odds]) => [gameId, [odds]])) };
}

function normalizeLine(gameId: string, capturedAt: string, row: PlaybookLineGame): NflRegularConsensusLine {
  return {
    provider: "playbook",
    providerGameId: gameId,
    capturedAt,
    sourceTier: text(row.lineSourceTier),
    homeMoneyline: finite(row.lines?.moneyline?.home),
    awayMoneyline: finite(row.lines?.moneyline?.away),
    homeSpread: finite(row.lines?.spread?.home),
    awaySpread: finite(row.lines?.spread?.away),
    total: finite(row.lines?.total),
  };
}

function normalizeSplits(gameId: string, capturedAt: string, row: PlaybookSplitGame): Record<NflRegularConsensusMarket, NflRegularConsensusSplit> {
  const base = { provider: "playbook" as const, providerGameId: gameId, capturedAt };
  return {
    moneyline: {
      ...base,
      booksUsed: finite(row.splits?.moneyline?.source?.booksUsed),
      homeMoneyPct: finite(row.splits?.moneyline?.money?.homePercent),
      awayMoneyPct: finite(row.splits?.moneyline?.money?.awayPercent),
      homeBetsPct: finite(row.splits?.moneyline?.bets?.homePercent),
      awayBetsPct: finite(row.splits?.moneyline?.bets?.awayPercent),
      overMoneyPct: null, underMoneyPct: null, overBetsPct: null, underBetsPct: null,
    },
    spread: {
      ...base,
      booksUsed: finite(row.splits?.spread?.source?.booksUsed),
      homeMoneyPct: finite(row.splits?.spread?.money?.homePercent),
      awayMoneyPct: finite(row.splits?.spread?.money?.awayPercent),
      homeBetsPct: finite(row.splits?.spread?.bets?.homePercent),
      awayBetsPct: finite(row.splits?.spread?.bets?.awayPercent),
      overMoneyPct: null, underMoneyPct: null, overBetsPct: null, underBetsPct: null,
    },
    total: {
      ...base,
      booksUsed: finite(row.splits?.total?.source?.booksUsed),
      homeMoneyPct: null, awayMoneyPct: null, homeBetsPct: null, awayBetsPct: null,
      overMoneyPct: finite(row.splits?.total?.money?.overPercent),
      underMoneyPct: finite(row.splits?.total?.money?.underPercent),
      overBetsPct: finite(row.splits?.total?.bets?.overPercent),
      underBetsPct: finite(row.splits?.total?.bets?.underPercent),
    },
  };
}

function completeSplitSet(markets: Record<NflRegularConsensusMarket, NflRegularConsensusSplit>): boolean {
  return complementary(markets.moneyline.homeMoneyPct, markets.moneyline.awayMoneyPct) &&
    complementary(markets.moneyline.homeBetsPct, markets.moneyline.awayBetsPct) &&
    complementary(markets.spread.homeMoneyPct, markets.spread.awayMoneyPct) &&
    complementary(markets.spread.homeBetsPct, markets.spread.awayBetsPct) &&
    complementary(markets.total.overMoneyPct, markets.total.underMoneyPct) &&
    complementary(markets.total.overBetsPct, markets.total.underBetsPct);
}

function complementary(first: number | null, second: number | null): boolean {
  return first !== null && second !== null && Math.abs(first + second - 100) <= 1;
}

function dedupeHistory(rows: NflPreviewBookOdds[]): NflPreviewBookOdds[] {
  return rows
    .sort((first, second) => Date.parse(first.observedAt) - Date.parse(second.observedAt))
    .filter((row, index, values) => index === 0 || row.observedAt !== values[index - 1]!.observedAt || row.sportsbook !== values[index - 1]!.sportsbook);
}

function completeOdds(value: NflPreviewBookOdds | undefined): boolean {
  return Boolean(value?.moneyline && value.spread && value.total);
}

function finite(value: unknown): number | null {
  const parsed = typeof value === "number" ? value : typeof value === "string" && value.trim() ? Number(value) : NaN;
  return Number.isFinite(parsed) ? parsed : null;
}

function text(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
