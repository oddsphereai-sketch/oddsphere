/**
 * Bounded, read-only NBA player-props provider coverage probe.
 *
 * Defaults to one game and prints aggregate coverage only. It never writes,
 * scores, grades, publishes, or logs credentials/individual prices.
 */

import { normalizeBallDontLieNbaPlayerProps } from "../../lib/services/nba/nbaPlayerPropsProviders";
import { summarizeNbaPlayerPropsCoverage } from "../../lib/services/nba/nbaPlayerPropsContract";

const API_BASE = "https://api.balldontlie.io";

function value(name: string): string | undefined {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : undefined;
}

function easternDate(now = new Date()): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/New_York",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(now);
}

async function bdl(path: string, apiKey: string): Promise<Record<string, unknown>> {
  const response = await fetch(`${API_BASE}${path}`, {
    headers: { Authorization: apiKey, Accept: "application/json" },
    signal: AbortSignal.timeout(20_000),
  });
  const body = await response.text();
  if (!response.ok) throw new Error(`BALLDONTLIE ${path.split("?")[0]} failed with HTTP ${response.status}.`);
  const parsed = JSON.parse(body) as unknown;
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) throw new Error("BALLDONTLIE returned a malformed envelope.");
  return parsed as Record<string, unknown>;
}

function data(envelope: Record<string, unknown>): Record<string, unknown>[] {
  if (!Array.isArray(envelope.data)) throw new Error("BALLDONTLIE returned a malformed data array.");
  return envelope.data.filter((value): value is Record<string, unknown> =>
    value !== null && typeof value === "object" && !Array.isArray(value));
}

async function main(): Promise<void> {
  const apiKey = process.env.BALLDONTLIE_API_KEY;
  if (!apiKey) throw new Error("BALLDONTLIE_API_KEY is required.");
  const date = value("--date") ?? easternDate();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) throw new Error("--date must be YYYY-MM-DD.");
  const maxGames = Number(value("--max-games") ?? "1");
  if (!Number.isInteger(maxGames) || maxGames < 1 || maxGames > 15) throw new Error("--max-games must be from 1 through 15.");
  let requests = 0;
  const gamesEnvelope = await bdl(`/v1/games?dates[]=${encodeURIComponent(date)}&season_type=regular&per_page=100`, apiKey);
  requests += 1;
  const games = data(gamesEnvelope).filter((game) => typeof game.id === "number").slice(0, maxGames);
  const fetchedAt = new Date().toISOString();
  const observations = [];
  const byGame: Array<{ gameId: string; rawRows: number; normalizedRows: number; markets: string[]; books: number }> = [];
  for (const game of games) {
    const gameId = String(game.id);
    const propsEnvelope = await bdl(`/v2/odds/player_props?game_id=${encodeURIComponent(gameId)}`, apiKey);
    requests += 1;
    const raw = data(propsEnvelope);
    const normalized = normalizeBallDontLieNbaPlayerProps({ values: raw, fetchedAt });
    observations.push(...normalized.rows);
    const coverage = summarizeNbaPlayerPropsCoverage(normalized.rows);
    byGame.push({
      gameId,
      rawRows: raw.length,
      normalizedRows: normalized.rows.length,
      markets: Object.keys(coverage.markets),
      books: coverage.sportsbooks.length,
    });
  }
  const coverage = summarizeNbaPlayerPropsCoverage(observations);
  console.log(JSON.stringify({
    mode: "read_only_aggregate_coverage",
    date,
    requests,
    scheduledGamesFound: data(gamesEnvelope).length,
    gamesProbed: games.length,
    byGame,
    total: coverage,
  }, null, 2));
}

void main();
