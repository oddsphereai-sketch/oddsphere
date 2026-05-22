/** Mirrors the `weather_forecasts` table. */
export type WeatherForecast = {
  id: number;
  game_id: number | null;
  ballpark_id: number | null;
  forecast_for: string; // When the forecast IS for (game time)
  fetched_at: string; // When we pulled the forecast
  temperature_f: number | null;
  feels_like_f: number | null;
  humidity_pct: number | null;
  precipitation_mm: number | null;
  precipitation_probability: number | null;
  wind_speed_mph: number | null;
  wind_direction_degrees: number | null;
  /** Relative direction with respect to the ballpark's home plate orientation
   *  (e.g., 'out_to_lf', 'in_from_cf', 'crosswind'). */
  wind_direction_relative: string | null;
  conditions: string | null;
  /** True when weather is game-impacting enough to surface in UI breakdown. */
  is_notable: boolean;
  /** Machine-readable reason for `is_notable` (e.g., 'wind_15mph_out',
   *  'temp_45', 'rain_60pct'). UI maps to human-friendly text. */
  notable_reason: string | null;
  created_at: string;
};
