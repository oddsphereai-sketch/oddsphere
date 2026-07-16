import { resolveMlbBallparkMetadata } from "./ballparkMetadata";
import type { MlbScheduleGameProvider, MlbWeatherProvider, MlbWeatherSnapshot } from "./providers";

type CachedRequestInit = RequestInit & { next?: { revalidate?: number; tags?: string[] } };
type FetchLike = (input: string | URL | Request, init?: CachedRequestInit) => Promise<Response>;

type NwsForecastPeriod = {
  startTime?: unknown;
  endTime?: unknown;
  temperature?: unknown;
  temperatureUnit?: unknown;
  windSpeed?: unknown;
  windDirection?: unknown;
  shortForecast?: unknown;
  probabilityOfPrecipitation?: { value?: unknown } | null;
};

export type ParsedNwsGameForecast = {
  forecastUpdatedAt: string | null;
  temperatureF: number | null;
  windSpeedMph: number | null;
  windDirection: string | null;
  conditions: string | null;
  precipitationProbability: number | null;
};

export class NwsWeatherClient implements MlbWeatherProvider {
  constructor(
    private readonly schedule: MlbScheduleGameProvider,
    private readonly fetcher: FetchLike = globalThis.fetch,
    private readonly userAgent = process.env.ODDSPHERE_NWS_USER_AGENT ?? "OddSphere/1.0 (https://oddsphere.ai)"
  ) {}

  async getWeather(args: { date: string; asOfTimestamp?: string }): Promise<MlbWeatherSnapshot[]> {
    const asOfTimestamp = args.asOfTimestamp ?? new Date().toISOString();
    if (!isCurrentRead(asOfTimestamp)) return [];
    const games = await this.schedule.getGames({ date: args.date });
    const rows: MlbWeatherSnapshot[] = [];
    const candidates = games.flatMap((game) => {
      const venue = resolveMlbBallparkMetadata(game.venue);
      return !venue || venue.roofStatus === "dome" ? [] : [{ game, venue }];
    });
    await mapWithConcurrency(candidates, 4, async ({ game, venue }) => {
      const forecast = await this.getForecast(venue.latitude, venue.longitude, game.scheduledStart).catch(() => null);
      if (!forecast) return;
      rows.push({
        gameId: game.id,
        asOfTimestamp: forecast.forecastUpdatedAt ?? asOfTimestamp,
        temperatureF: forecast.temperatureF,
        windSpeedMph: forecast.windSpeedMph,
        windDirection: forecast.windDirection,
        precipitationProbability: forecast.precipitationProbability,
        conditions: forecast.conditions,
        provider: "National Weather Service",
        rawPayload: { venue: venue.name, source: "api.weather.gov hourly forecast" },
      });
    });
    return rows;
  }

  private async getForecast(latitude: number, longitude: number, gameStartTime: string): Promise<ParsedNwsGameForecast | null> {
    const headers = { Accept: "application/geo+json", "User-Agent": this.userAgent };
    const pointUrl = `https://api.weather.gov/points/${latitude.toFixed(4)},${longitude.toFixed(4)}`;
    const pointResponse = await this.fetcher(pointUrl, {
      headers,
      next: { revalidate: 604_800, tags: [`nws-point-${latitude.toFixed(4)}-${longitude.toFixed(4)}`] },
    });
    if (!pointResponse.ok) return null;
    const pointPayload = asRecord(await pointResponse.json());
    const hourlyUrl = stringValue(asRecord(pointPayload.properties).forecastHourly);
    if (!hourlyUrl) return null;
    const forecastResponse = await this.fetcher(hourlyUrl, {
      headers,
      next: { revalidate: 300, tags: [`nws-hourly-${latitude.toFixed(4)}-${longitude.toFixed(4)}`] },
    });
    if (!forecastResponse.ok) return null;
    return parseNwsHourlyForecast(await forecastResponse.json(), gameStartTime);
  }
}

async function mapWithConcurrency<T>(items: T[], concurrency: number, run: (item: T) => Promise<void>): Promise<void> {
  let cursor = 0;
  const worker = async () => {
    while (cursor < items.length) {
      const index = cursor++;
      await run(items[index]);
    }
  };
  await Promise.all(Array.from({ length: Math.min(concurrency, items.length) }, worker));
}

export function parseNwsHourlyForecast(payload: unknown, gameStartTime: string): ParsedNwsGameForecast | null {
  const properties = asRecord(asRecord(payload).properties);
  const periods = Array.isArray(properties.periods) ? properties.periods as NwsForecastPeriod[] : [];
  const gameTime = Date.parse(gameStartTime);
  if (!Number.isFinite(gameTime)) return null;
  const period = periods.find((candidate) => {
    const start = Date.parse(stringValue(candidate.startTime) ?? "");
    const end = Date.parse(stringValue(candidate.endTime) ?? "");
    return Number.isFinite(start) && Number.isFinite(end) && start <= gameTime && gameTime < end;
  });
  if (!period) return null;
  const temperature = finiteNumber(period.temperature);
  const unit = stringValue(period.temperatureUnit)?.toUpperCase();
  return {
    forecastUpdatedAt: stringValue(properties.updateTime) ?? stringValue(properties.generatedAt),
    temperatureF: temperature === null ? null : unit === "C" ? temperature * 9 / 5 + 32 : temperature,
    windSpeedMph: parseWindSpeedMph(period.windSpeed),
    windDirection: stringValue(period.windDirection),
    conditions: stringValue(period.shortForecast),
    precipitationProbability: normalizeProbability(period.probabilityOfPrecipitation?.value),
  };
}

function isCurrentRead(asOfTimestamp: string): boolean {
  const asOf = Date.parse(asOfTimestamp);
  return Number.isFinite(asOf) && Math.abs(Date.now() - asOf) <= 60 * 60 * 1000;
}

function parseWindSpeedMph(value: unknown): number | null {
  const matches = String(value ?? "").match(/\d+(?:\.\d+)?/g);
  if (!matches?.length) return null;
  return Math.max(...matches.map(Number).filter(Number.isFinite));
}

function normalizeProbability(value: unknown): number | null {
  const number = finiteNumber(value);
  if (number === null) return null;
  return Math.max(0, Math.min(100, number <= 1 ? number * 100 : number));
}

function asRecord(value: unknown): Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

function stringValue(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function finiteNumber(value: unknown): number | null {
  const parsed = typeof value === "number" ? value : typeof value === "string" ? Number(value) : Number.NaN;
  return Number.isFinite(parsed) ? parsed : null;
}
