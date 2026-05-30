/**
 * Phase 4W — real OpenWeatherProvider.
 *
 * Implements IWeatherProvider using OpenWeather's free-tier 5-day / 3-hour
 * forecast endpoint:
 *
 *   GET https://api.openweathermap.org/data/2.5/forecast
 *       ?lat=<lat>&lon=<lon>&appid=<key>&units=imperial
 *
 * `units=imperial` is REQUIRED — without it OpenWeather defaults to Kelvin
 * for temperature and m/s for wind speed. The provider pins imperial in
 * the URL; tests pin the URL contains `units=imperial`.
 *
 * The endpoint returns ~40 items at 3-hour intervals over 5 days. The
 * provider selects the item closest to `forGameTime` and rejects matches
 * more than 6 hours off-target (handles >5-day-out games + malformed
 * responses).
 *
 * Error handling:
 *   • Constructor: throws if `apiKey` is empty/whitespace.
 *   • Network error: sanitized throw — NO URL, NO key, NO payload echo.
 *   • Non-200 response: sanitized throw with status code only.
 *   • Empty / malformed list / no usable forecast: returns `null` (caller
 *     skips this venue without crashing the slate).
 *   • Malformed `forGameTime`: returns `null`.
 *
 * Free-tier rate limit: 1000 calls/day. MLB usage ≈ 45 calls/day across
 * the three weather refresh crons. No rate-limiting logic added.
 *
 * V1 scope:
 *   • `wind_direction_relative` is NOT computed here — weatherService
 *     (lib/services/weatherService.ts) hardcodes it to null in V1 until
 *     per-park orientation data lands.
 *   • Retractable roof state at game time is NOT considered — model's
 *     dome suppression uses `ballparks.is_dome` static flag.
 */

import type {
  IWeatherProvider,
  WeatherForecastRecord,
} from "../interfaces/IWeatherProvider";
import type {
  OpenWeatherForecastItem,
  OpenWeatherForecastResponse,
} from "../../types/api/openweather";

/** Reject when closest forecast item is more than this far from game time. */
const MAX_TIME_OFFSET_MS = 6 * 60 * 60 * 1000; // 6 hours

/** OpenWeather 5-day / 3-hour forecast endpoint. */
const OPENWEATHER_FORECAST_URL =
  "https://api.openweathermap.org/data/2.5/forecast";

export class OpenWeatherProvider implements IWeatherProvider {
  constructor(private readonly apiKey: string) {
    if (typeof apiKey !== "string" || apiKey.trim().length === 0) {
      throw new Error("OpenWeatherProvider: apiKey is required (non-empty string)");
    }
  }

  /**
   * Fetch a forecast for the given ballpark coordinates near `forGameTime`.
   * Returns null when no usable forecast exists or inputs are malformed.
   * Throws on network or non-200 API responses.
   */
  async getForecast(
    latitude: number,
    longitude: number,
    forGameTime: string
  ): Promise<WeatherForecastRecord | null> {
    if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) {
      return null;
    }
    const targetMs = Date.parse(forGameTime);
    if (Number.isNaN(targetMs)) {
      return null;
    }

    const url = this.buildUrl(latitude, longitude);

    let resp: Response;
    try {
      resp = await fetch(url);
    } catch {
      // Network error — sanitized throw. Never include URL (contains key)
      // or the underlying error message (could echo headers/body).
      throw new Error(
        "OpenWeatherProvider: network error contacting forecast endpoint"
      );
    }
    if (!resp.ok) {
      // Surface the status code so operators can diagnose 401 / 429 / 500
      // without us leaking the key. Body is NOT echoed.
      throw new Error(
        `OpenWeatherProvider: forecast endpoint returned status ${resp.status}`
      );
    }

    let data: OpenWeatherForecastResponse;
    try {
      data = (await resp.json()) as OpenWeatherForecastResponse;
    } catch {
      throw new Error(
        "OpenWeatherProvider: forecast endpoint returned malformed JSON"
      );
    }

    const list = Array.isArray(data?.list) ? data.list : [];
    const closest = pickClosestForecast(list, targetMs);
    if (closest === null) return null;
    return mapItemToRecord(closest);
  }

  /**
   * Build the request URL. Exposed via instance method (rather than
   * inlined) so a test can dependency-inject `fetch` and assert the URL
   * contains `units=imperial`. Tests pin this contract.
   */
  private buildUrl(lat: number, lon: number): string {
    const params = new URLSearchParams({
      lat: String(lat),
      lon: String(lon),
      appid: this.apiKey,
      units: "imperial",
    });
    return `${OPENWEATHER_FORECAST_URL}?${params.toString()}`;
  }
}

// ─────────────────────────────────────────────────────────────
// Pure helpers — exported for direct unit testing
// ─────────────────────────────────────────────────────────────

/**
 * Select the forecast item whose `dt` (Unix seconds) is closest to the
 * target time. Returns null when list is empty or the closest is more
 * than MAX_TIME_OFFSET_MS away (covers >5-day-out games + edge cases).
 *
 * Exported for direct unit testing with synthetic fixtures.
 */
export function pickClosestForecast(
  list: readonly OpenWeatherForecastItem[],
  targetMs: number
): OpenWeatherForecastItem | null {
  if (list.length === 0) return null;
  let best: OpenWeatherForecastItem | null = null;
  let bestDiff = Infinity;
  for (const item of list) {
    if (typeof item?.dt !== "number") continue;
    const itemMs = item.dt * 1000;
    const diff = Math.abs(itemMs - targetMs);
    if (diff < bestDiff) {
      bestDiff = diff;
      best = item;
    }
  }
  if (best === null) return null;
  if (bestDiff > MAX_TIME_OFFSET_MS) return null;
  return best;
}

/**
 * Map one OpenWeather forecast item to our internal WeatherForecastRecord.
 *
 * Field mapping (Daniel-approved in Phase 4W planning §5):
 *   • item.dt × 1000           → forecast_for (ISO string)
 *   • Date.now()               → fetched_at (ISO string)
 *   • item.main.temp           → temperature_f      (imperial → °F; rounded int)
 *   • item.main.feels_like     → feels_like_f       (imperial → °F; rounded int)
 *   • item.main.humidity       → humidity_pct       (int 0-100)
 *   • rain["3h"] + snow["3h"]  → precipitation_mm   (sum; default 0)
 *   • item.pop × 100           → precipitation_probability (int 0-100)
 *   • item.wind.speed          → wind_speed_mph     (imperial → mph; rounded int)
 *   • item.wind.deg            → wind_direction_degrees (int 0-360)
 *   • item.weather[0]?.main    → conditions ("Clear", "Rain", etc.)
 *
 * Exported for direct unit testing with fixture items.
 */
export function mapItemToRecord(
  item: OpenWeatherForecastItem
): WeatherForecastRecord {
  const forecastForMs = item.dt * 1000;
  const rain3h =
    typeof item.rain?.["3h"] === "number" ? item.rain["3h"] : 0;
  const snow3h =
    typeof item.snow?.["3h"] === "number" ? item.snow["3h"] : 0;
  const pop = typeof item.pop === "number" ? item.pop : null;
  const conditions =
    item.weather && item.weather.length > 0 && item.weather[0]
      ? item.weather[0].main
      : null;

  return {
    forecast_for: new Date(forecastForMs).toISOString(),
    fetched_at: new Date().toISOString(),
    temperature_f:
      typeof item.main?.temp === "number" ? Math.round(item.main.temp) : null,
    feels_like_f:
      typeof item.main?.feels_like === "number"
        ? Math.round(item.main.feels_like)
        : null,
    humidity_pct:
      typeof item.main?.humidity === "number"
        ? Math.round(item.main.humidity)
        : null,
    precipitation_mm:
      rain3h > 0 || snow3h > 0 ? rain3h + snow3h : 0,
    precipitation_probability:
      pop !== null ? Math.round(pop * 100) : null,
    wind_speed_mph:
      typeof item.wind?.speed === "number"
        ? Math.round(item.wind.speed)
        : null,
    wind_direction_degrees:
      typeof item.wind?.deg === "number" ? Math.round(item.wind.deg) : null,
    conditions,
  };
}
