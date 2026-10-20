/**
 * Local-only NBA player-props forward observer.
 *
 * Captures genuine current and opening quotes without a database, member,
 * grade, stake, lock, or production write. Files are create-only so an earlier
 * checkpoint cannot be silently replaced by a later provider response.
 */

import { createHash } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import {
  buildNbaPlayerPropsObservationSnapshot,
  type NbaPlayerPropGameIdentity,
} from "../../../lib/services/nba/nbaPlayerPropsContract";
import { normalizeBallDontLieNbaPlayerProps } from "../../../lib/services/nba/nbaPlayerPropsProviders";
import { nbaPlayerPropsCadenceStage } from "../../../lib/services/nba/nbaPlayerPropsSourcePolicy";

const API_BASE = "https://api.balldontlie.io";
const CAPTURE_RELEASE = "nba_player_props_forward_snapshot_2026_10_20_r1" as const;

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

async function bdl(endpoint: string, apiKey: string): Promise<Record<string, unknown>> {
  const response = await fetch(`${API_BASE}${endpoint}`, {
    headers: { Authorization: apiKey, Accept: "application/json" },
    signal: AbortSignal.timeout(20_000),
  });
  const body = await response.text();
  if (!response.ok) throw new Error(`BALLDONTLIE ${endpoint.split("?")[0]} failed with HTTP ${response.status}.`);
  const parsed = JSON.parse(body) as unknown;
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) throw new Error("BALLDONTLIE returned a malformed envelope.");
  return parsed as Record<string, unknown>;
}

function data(envelope: Record<string, unknown>): Record<string, unknown>[] {
  if (!Array.isArray(envelope.data)) throw new Error("BALLDONTLIE returned a malformed data array.");
  return envelope.data.filter((item): item is Record<string, unknown> => item !== null && typeof item === "object" && !Array.isArray(item));
}

function record(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : null;
}

function text(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function gameIdentity(game: Record<string, unknown>): NbaPlayerPropGameIdentity | null {
  const providerGameId = typeof game.id === "number" || typeof game.id === "string" ? String(game.id) : null;
  const scheduledStart = text(game.datetime) ?? text(game.date);
  const home = record(game.home_team);
  const away = record(game.visitor_team);
  const homeTeam = text(home?.abbreviation) ?? text(home?.full_name);
  const awayTeam = text(away?.abbreviation) ?? text(away?.full_name);
  if (!providerGameId || !scheduledStart || !homeTeam || !awayTeam || !Number.isFinite(Date.parse(scheduledStart))) return null;
  return {
    canonicalGameId: `nba-bdl:${providerGameId}`,
    provider: "balldontlie",
    providerGameId,
    scheduledStart: new Date(Date.parse(scheduledStart)).toISOString(),
    homeTeam,
    awayTeam,
  };
}

async function main(): Promise<void> {
  const apiKey = process.env.BALLDONTLIE_API_KEY;
  if (!apiKey) throw new Error("BALLDONTLIE_API_KEY is required.");
  const date = value("--date") ?? easternDate();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) throw new Error("--date must be YYYY-MM-DD.");
  const maxGames = Number(value("--max-games") ?? "15");
  if (!Number.isInteger(maxGames) || maxGames < 1 || maxGames > 15) throw new Error("--max-games must be from 1 through 15.");
  const label = (value("--label") ?? "observed").toLowerCase().replace(/[^a-z0-9_-]+/g, "-");
  const outputDirectory = path.resolve(value("--output-dir") ?? "/private/tmp/oddsphere-nba-player-props-forward");
  const generatedAt = new Date().toISOString();
  const gamesEnvelope = await bdl(`/v1/games?dates[]=${encodeURIComponent(date)}&season_type=regular&per_page=100`, apiKey);
  const games = data(gamesEnvelope).map(gameIdentity).filter((game): game is NbaPlayerPropGameIdentity => game !== null).slice(0, maxGames);
  if (games.length === 0) throw new Error(`No regular-season NBA games were found for ${date}.`);
  const eventMap = Object.fromEntries(games.map((game) => [game.providerGameId, {
    canonicalGameId: game.canonicalGameId,
    homeTeam: game.homeTeam,
    awayTeam: game.awayTeam,
    scheduledStart: game.scheduledStart,
  }]));
  const observations = [];
  let requests = 1;
  for (const game of games) {
    const current = data(await bdl(`/v2/odds/player_props?game_id=${encodeURIComponent(game.providerGameId)}`, apiKey));
    const opening = data(await bdl(`/nba/v2/odds/player_props/opening?game_id=${encodeURIComponent(game.providerGameId)}`, apiKey));
    requests += 2;
    observations.push(
      ...normalizeBallDontLieNbaPlayerProps({ values: opening, fetchedAt: generatedAt, opening: true, events: eventMap }).rows,
      ...normalizeBallDontLieNbaPlayerProps({ values: current, fetchedAt: generatedAt, events: eventMap }).rows,
    );
  }
  const snapshot = buildNbaPlayerPropsObservationSnapshot({
    generatedAt,
    games,
    observations,
    providerRequests: { balldontlie: requests },
    providerComplete: { balldontlie: true },
  });
  const serializedSnapshot = JSON.stringify(snapshot);
  const sha256 = createHash("sha256").update(serializedSnapshot).digest("hex");
  const envelope = {
    release: CAPTURE_RELEASE,
    date,
    label,
    sha256,
    cadenceByGame: Object.fromEntries(games.map((game) => [game.canonicalGameId, nbaPlayerPropsCadenceStage({
      now: generatedAt,
      scheduledStart: game.scheduledStart,
      slateDate: date,
    })])),
    snapshot,
  };
  await mkdir(outputDirectory, { recursive: true });
  const timestamp = generatedAt.replace(/[:.]/g, "-");
  const output = path.join(outputDirectory, `${date}-${timestamp}-${label}.json`);
  await writeFile(output, `${JSON.stringify(envelope, null, 2)}\n`, { encoding: "utf8", flag: "wx" });
  console.log(JSON.stringify({
    mode: snapshot.mode,
    actionable: snapshot.actionable,
    output,
    sha256,
    games: games.length,
    observations: observations.length,
    requests,
    providerCoverage: snapshot.providerCoverage,
    cadenceByGame: envelope.cadenceByGame,
  }, null, 2));
}

void main();
