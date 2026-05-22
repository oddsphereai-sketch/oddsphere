import type {
  IWeatherProvider,
  WeatherForecastRecord,
} from "../interfaces/IWeatherProvider";

import weatherJson from "./fixtures/weather.json";
import ballparksJson from "./fixtures/ballparks.json";

type WeatherFixture = WeatherForecastRecord & {
  game_external_id: number;
  ballpark_external_id: number;
  // Local-computed fields stored in the fixture but NOT on the provider
  // Record (they're computed by the weather cron in production):
  wind_direction_relative: string | null;
  is_notable: boolean;
  notable_reason: string | null;
};

type BallparkFixture = {
  team_external_id: number;
  latitude: number;
  longitude: number;
};

const WEATHER = weatherJson as unknown as WeatherFixture[];
const BALLPARKS = ballparksJson as unknown as BallparkFixture[];

const COORD_TOLERANCE = 0.01; // ~1.1 km — sufficient to identify a unique park

export class MockWeatherProvider implements IWeatherProvider {
  async getForecast(
    latitude: number,
    longitude: number,
    _forGameTime: string
  ): Promise<WeatherForecastRecord | null> {
    // Mock has one forecast per ballpark for tonight's slate; the time arg is
    // accepted for API parity but unused in lookup (only one forecast exists
    // per ballpark in the fixture).
    const park = BALLPARKS.find(
      (b) =>
        Math.abs(b.latitude - latitude) < COORD_TOLERANCE &&
        Math.abs(b.longitude - longitude) < COORD_TOLERANCE
    );
    if (!park) return null;
    const entry = WEATHER.find(
      (w) => w.ballpark_external_id === park.team_external_id
    );
    if (!entry) return null;
    // Strip locally-computed fields (wind_direction_relative, is_notable,
    // notable_reason) — these are NOT part of the OpenWeather contract.
    return {
      forecast_for: entry.forecast_for,
      fetched_at: entry.fetched_at,
      temperature_f: entry.temperature_f,
      feels_like_f: entry.feels_like_f,
      humidity_pct: entry.humidity_pct,
      precipitation_mm: entry.precipitation_mm,
      precipitation_probability: entry.precipitation_probability,
      wind_speed_mph: entry.wind_speed_mph,
      wind_direction_degrees: entry.wind_direction_degrees,
      conditions: entry.conditions,
    };
  }
}
