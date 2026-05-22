/**
 * IWeatherProvider — contract for weather forecasts.
 *
 * Real implementation: OpenWeatherProvider (free tier handles 12 games/day).
 * Mock implementation: MockWeatherProvider (reads from JSON fixtures).
 *
 * Provider returns RAW forecast values only — the conditional-notable flags
 * (`is_notable`, `notable_reason`, `wind_direction_relative`) are computed by
 * our cron logic, not by OpenWeather.
 *
 * RECORD SHAPES: see IStatsProvider header for the conventions.
 */

/**
 * One forecast for one game's start time.
 *
 * Wind direction here is the raw compass bearing in degrees. Translating it
 * to ballpark-relative direction (`out_to_lf`, `in_from_cf`, etc.) is a
 * post-processing step that uses each ballpark's home-plate orientation.
 */
export type WeatherForecastRecord = {
  forecast_for: string; // ISO timestamp — when the forecast IS for
  fetched_at: string; // ISO timestamp — when we pulled it
  temperature_f: number | null;
  feels_like_f: number | null;
  humidity_pct: number | null;
  precipitation_mm: number | null;
  precipitation_probability: number | null;
  wind_speed_mph: number | null;
  wind_direction_degrees: number | null;
  conditions: string | null; // 'Clear', 'Rain', 'Clouds', etc.
};

// ─────────────────────────────────────────────────────────────
// Interface
// ─────────────────────────────────────────────────────────────

export interface IWeatherProvider {
  /**
   * Forecast for a single ballpark at a specific game time.
   *
   * @param latitude    Ballpark latitude (decimal degrees).
   * @param longitude   Ballpark longitude (decimal degrees).
   * @param forGameTime ISO timestamp of the game start.
   * @returns           null if the forecast is unavailable (game too far out,
   *                    location unsupported, API error).
   */
  getForecast(
    latitude: number,
    longitude: number,
    forGameTime: string
  ): Promise<WeatherForecastRecord | null>;
}
