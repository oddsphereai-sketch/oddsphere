import { resolveMlbBallparkMetadata } from "./ballparkMetadata";
import type {
  MlbGameEntity,
  MlbScheduleGameProvider,
  MlbWeatherProvider,
  MlbWeatherSnapshot,
} from "./providers";

type CachedRequestInit = RequestInit & { next?: { revalidate?: number; tags?: string[] } };
type FetchLike = (input: string | URL | Request, init?: CachedRequestInit) => Promise<Response>;

type OpenMeteoHourly = {
  time?: unknown;
  temperature_2m?: unknown;
  precipitation_probability?: unknown;
  weather_code?: unknown;
  wind_speed_10m?: unknown;
  wind_direction_10m?: unknown;
};

export type ParsedOpenMeteoForecast = {
  temperatureF: number | null;
  windSpeedMph: number | null;
  windDirection: string | null;
  conditions: string | null;
  precipitationProbability: number | null;
};

/** Global fallback for venues outside the National Weather Service domain. */
export class OpenMeteoWeatherClient implements MlbWeatherProvider {
  constructor(
    private readonly schedule: MlbScheduleGameProvider,
    private readonly fetcher: FetchLike = globalThis.fetch,
  ) {}

  async getWeather(args: { date: string; asOfTimestamp?: string }): Promise<MlbWeatherSnapshot[]> {
    const games = await this.schedule.getGames({ date: args.date });
    return this.getWeatherForGames(games, args.asOfTimestamp ?? new Date().toISOString());
  }

  async getWeatherForGames(games: MlbGameEntity[], asOfTimestamp: string): Promise<MlbWeatherSnapshot[]> {
    if (!isCurrentRead(asOfTimestamp)) return [];
    const rows: MlbWeatherSnapshot[] = [];
    const candidates = games.flatMap((game) => {
      const venue = resolveMlbBallparkMetadata(game.venue);
      return !venue || venue.roofStatus === "dome" ? [] : [{ game, venue }];
    });
    await mapWithConcurrency(candidates, 4, async ({ game, venue }) => {
      const url = new URL("https://api.open-meteo.com/v1/forecast");
      url.searchParams.set("latitude", venue.latitude.toFixed(4));
      url.searchParams.set("longitude", venue.longitude.toFixed(4));
      url.searchParams.set("hourly", "temperature_2m,precipitation_probability,weather_code,wind_speed_10m,wind_direction_10m");
      url.searchParams.set("temperature_unit", "fahrenheit");
      url.searchParams.set("wind_speed_unit", "mph");
      url.searchParams.set("timezone", "UTC");
      url.searchParams.set("forecast_days", "3");
      const response = await this.fetcher(url, {
        headers: { Accept: "application/json" },
        next: { revalidate: 300, tags: [`open-meteo-${venue.latitude.toFixed(3)}-${venue.longitude.toFixed(3)}`] },
      }).catch(() => null);
      if (!response?.ok) return;
      const forecast = parseOpenMeteoHourlyForecast(await response.json(), game.scheduledStart);
      if (!forecast) return;
      rows.push({
        gameId: game.id,
        asOfTimestamp,
        ...forecast,
        provider: "Open-Meteo",
        rawPayload: { venue: venue.name, source: "Open-Meteo hourly forecast" },
      });
    });
    return rows;
  }
}

/** Prefer NWS; ask the global provider only for games NWS could not resolve. */
export class FallbackMlbWeatherClient implements MlbWeatherProvider {
  constructor(
    private readonly schedule: MlbScheduleGameProvider,
    private readonly primary: MlbWeatherProvider,
    private readonly fallback: OpenMeteoWeatherClient,
  ) {}

  async getWeather(args: { date: string; asOfTimestamp?: string }): Promise<MlbWeatherSnapshot[]> {
    const asOfTimestamp = args.asOfTimestamp ?? new Date().toISOString();
    const primaryRows = await this.primary.getWeather(args).catch(() => []);
    const resolved = new Set(primaryRows.map((row) => row.gameId));
    const games = await this.schedule.getGames({ date: args.date });
    const missing = games.filter((game) => !resolved.has(game.id));
    if (missing.length === 0) return primaryRows;
    const fallbackRows = await this.fallback.getWeatherForGames(missing, asOfTimestamp).catch(() => []);
    return [...primaryRows, ...fallbackRows.filter((row) => !resolved.has(row.gameId))];
  }
}

export function parseOpenMeteoHourlyForecast(payload: unknown, gameStartTime: string): ParsedOpenMeteoForecast | null {
  const root = asRecord(payload);
  const hourly = asRecord(root.hourly) as OpenMeteoHourly;
  const times = array(hourly.time).map(String);
  const gameHour = new Date(gameStartTime);
  if (!Number.isFinite(gameHour.getTime()) || times.length === 0) return null;
  gameHour.setUTCMinutes(0, 0, 0);
  const target = gameHour.toISOString().slice(0, 16);
  let index = times.findIndex((value) => value.slice(0, 16) === target);
  if (index < 0) {
    index = times.reduce((best, value, candidate) => {
      const parsed = Date.parse(value.endsWith("Z") ? value : `${value}Z`);
      const bestParsed = best < 0 ? Number.POSITIVE_INFINITY : Date.parse(times[best].endsWith("Z") ? times[best] : `${times[best]}Z`);
      return Math.abs(parsed - gameHour.getTime()) < Math.abs(bestParsed - gameHour.getTime()) ? candidate : best;
    }, -1);
  }
  if (index < 0) return null;
  const direction = finiteAt(hourly.wind_direction_10m, index);
  return {
    temperatureF: finiteAt(hourly.temperature_2m, index),
    windSpeedMph: finiteAt(hourly.wind_speed_10m, index),
    windDirection: direction === null ? null : compassDirection(direction),
    conditions: weatherCodeLabel(finiteAt(hourly.weather_code, index)),
    precipitationProbability: finiteAt(hourly.precipitation_probability, index),
  };
}

function weatherCodeLabel(code: number | null): string | null {
  if (code === null) return null;
  if (code === 0) return "Clear";
  if (code <= 3) return "Partly cloudy";
  if (code <= 48) return "Fog";
  if (code <= 57) return "Drizzle";
  if (code <= 67) return "Rain";
  if (code <= 77) return "Snow";
  if (code <= 82) return "Rain showers";
  if (code <= 86) return "Snow showers";
  return "Thunderstorms";
}

function compassDirection(degrees: number): string {
  const labels = ["N", "NE", "E", "SE", "S", "SW", "W", "NW"];
  return labels[Math.round(((degrees % 360) + 360) % 360 / 45) % labels.length];
}

function finiteAt(value: unknown, index: number): number | null {
  const item = array(value)[index];
  const parsed = typeof item === "number" ? item : Number(item);
  return Number.isFinite(parsed) ? parsed : null;
}

function array(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

function asRecord(value: unknown): Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

function isCurrentRead(asOfTimestamp: string): boolean {
  const asOf = Date.parse(asOfTimestamp);
  return Number.isFinite(asOf) && Math.abs(Date.now() - asOf) <= 60 * 60 * 1000;
}

async function mapWithConcurrency<T>(items: T[], concurrency: number, run: (item: T) => Promise<void>): Promise<void> {
  let cursor = 0;
  const worker = async () => {
    while (cursor < items.length) await run(items[cursor++]);
  };
  await Promise.all(Array.from({ length: Math.min(concurrency, items.length) }, worker));
}
