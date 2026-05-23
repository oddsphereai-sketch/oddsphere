/**
 * weatherService — pull forecasts from the weather provider and write to
 * weather_forecasts. Computes is_notable + notable_reason locally (raw
 * OpenWeather data doesn't include these).
 *
 * Indoor (dome) games skip the API call entirely — saves quota. Retractable
 * roof games are treated as outdoor for forecasting; the roof state at game
 * time would be needed to suppress weather effects but isn't in V1.
 *
 * Strategy: DELETE existing forecasts for tonight's games before INSERT.
 * Idempotent.
 */

import { supabase } from "../db/supabase";
import { getWeatherProvider } from "../providers/factory";
import type { Sport } from "../types/domain/Sport";
import type { CronHandlerResult } from "../cron/runCron";
import {
  loadBallparkMetadata,
  loadGameIdMap,
} from "./_idMaps";

type GameRow = {
  id: number;
  external_id: number;
  game_date: string;
  home_team_id: number;
  ballpark_id: number;
};

/**
 * V1 notable thresholds. Re-tune in Phase 7 with backtested wind/temp
 * vs HR-outcome residuals.
 */
const WEATHER_NOTABLE = {
  WIND_OUT_MPH: 12,
  TEMP_HOT_F: 90,
  TEMP_COLD_F: 50,
  PRECIP_PROB: 60,
} as const;

function determineNotable(weather: {
  wind_speed_mph: number | null;
  wind_direction_relative: string | null;
  temperature_f: number | null;
  precipitation_probability: number | null;
}): { is_notable: boolean; notable_reason: string | null } {
  const reasons: string[] = [];
  if (
    weather.wind_speed_mph !== null &&
    weather.wind_speed_mph >= WEATHER_NOTABLE.WIND_OUT_MPH &&
    weather.wind_direction_relative !== null &&
    weather.wind_direction_relative.startsWith("out_")
  ) {
    reasons.push(`wind_${Math.round(weather.wind_speed_mph)}mph_${weather.wind_direction_relative}`);
  }
  if (
    weather.temperature_f !== null &&
    weather.temperature_f >= WEATHER_NOTABLE.TEMP_HOT_F
  ) {
    reasons.push(`temp_extreme_hot`);
  }
  if (
    weather.temperature_f !== null &&
    weather.temperature_f <= WEATHER_NOTABLE.TEMP_COLD_F
  ) {
    reasons.push(`temp_extreme_cold`);
  }
  if (
    weather.precipitation_probability !== null &&
    weather.precipitation_probability >= WEATHER_NOTABLE.PRECIP_PROB
  ) {
    reasons.push(`rain`);
  }
  return {
    is_notable: reasons.length > 0,
    notable_reason: reasons.length > 0 ? reasons.join("+") : null,
  };
}

export const weatherService = {
  /**
   * Refresh weather for all of `sport`'s games on `date`.
   * Dome games are skipped (no API call). Returns the number of forecasts
   * actually written + the API call count.
   */
  async refreshForecasts(sport: Sport, date: string): Promise<CronHandlerResult> {
    const weather = getWeatherProvider();
    const gameIdByExternal = await loadGameIdMap(sport, date);
    const gameIds = [...gameIdByExternal.values()];

    if (gameIds.length === 0) {
      return { records_updated: 0, api_calls_made: 0 };
    }

    const { data: gamesData, error: gErr } = await supabase
      .from("games")
      .select("id, external_id, game_date, home_team_id, ballpark_id")
      .in("id", gameIds);
    if (gErr) {
      throw new Error(`weatherService.refreshForecasts games query failed: ${gErr.message}`);
    }
    const games = (gamesData ?? []) as GameRow[];

    const ballparks = await loadBallparkMetadata();
    let apiCalls = 0;
    let domeSkipped = 0;

    const payload: Array<Record<string, unknown>> = [];

    for (const g of games) {
      const ballpark = ballparks.get(g.home_team_id);
      if (!ballpark) continue;
      if (ballpark.is_dome) {
        // Dome → no need to fetch; record a controlled-indoor stub so
        // downstream queries don't return null
        payload.push({
          game_id: g.id,
          forecast_for: g.game_date,
          fetched_at: new Date().toISOString(),
          temperature_f: 72,
          feels_like_f: 72,
          humidity_pct: 50,
          precipitation_mm: 0,
          precipitation_probability: 0,
          wind_speed_mph: 0,
          wind_direction_degrees: null,
          wind_direction_relative: null,
          conditions: "Dome",
          is_notable: false,
          notable_reason: null,
        });
        domeSkipped++;
        continue;
      }

      const forecast = await weather.getForecast(
        ballpark.latitude,
        ballpark.longitude,
        g.game_date
      );
      apiCalls++;
      if (!forecast) continue;

      // V1: wind_direction_relative isn't derivable from raw lat/lng without
      // ballpark orientation data. Leaving null until Phase 7 adds it.
      const wind_direction_relative: string | null = null;
      const notableInputs = {
        wind_speed_mph: forecast.wind_speed_mph,
        wind_direction_relative,
        temperature_f: forecast.temperature_f,
        precipitation_probability: forecast.precipitation_probability,
      };
      const { is_notable, notable_reason } = determineNotable(notableInputs);

      payload.push({
        game_id: g.id,
        forecast_for: forecast.forecast_for,
        fetched_at: forecast.fetched_at,
        temperature_f: forecast.temperature_f,
        feels_like_f: forecast.feels_like_f,
        humidity_pct: forecast.humidity_pct,
        precipitation_mm: forecast.precipitation_mm,
        precipitation_probability: forecast.precipitation_probability,
        wind_speed_mph: forecast.wind_speed_mph,
        wind_direction_degrees: forecast.wind_direction_degrees,
        wind_direction_relative,
        conditions: forecast.conditions,
        is_notable,
        notable_reason,
      });
    }

    const { error: delErr } = await supabase
      .from("weather_forecasts")
      .delete()
      .in("game_id", gameIds);
    if (delErr) {
      throw new Error(`weatherService.refreshForecasts delete failed: ${delErr.message}`);
    }

    if (payload.length > 0) {
      const { error } = await supabase
        .from("weather_forecasts")
        .insert(payload);
      if (error) {
        throw new Error(`weatherService.refreshForecasts insert failed: ${error.message}`);
      }
    }

    return {
      records_updated: payload.length,
      api_calls_made: apiCalls,
      details: { dome_games_stubbed: domeSkipped },
    };
  },
};
