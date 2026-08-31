import type { IWeatherProvider, WeatherForecastRecord } from "@/lib/providers/interfaces/IWeatherProvider";
import type { PlaybookVenueWeatherRow } from "@/lib/providers/playbook/types";
import type { NcaafGame } from "./balldontlieNcaafSlate";

export const CFB_KICKOFF_WEATHER_RELEASE =
  "cfb_kickoff_weather_2026_08_31_r1_exact_venue_game_time" as const;
export const CFB_WEATHER_REUSE_MAX_AGE_MINUTES = 360 as const;
export const CFB_WEATHER_MAX_FORECAST_OFFSET_HOURS = 6 as const;
export const CFB_WEATHER_PROVIDER_HORIZON_HOURS = 126 as const;

export type CfbKickoffWeatherSnapshot = {
  release: typeof CFB_KICKOFF_WEATHER_RELEASE;
  venueSource: "playbook" | null;
  forecastSource: "openweather" | null;
  venueTeam: string;
  venueName: string | null;
  latitude: number | null;
  longitude: number | null;
  roofType: "open_air" | "fixed" | "retractable" | "unknown";
  status:
    | "forecast_available"
    | "controlled_indoor"
    | "neutral_site"
    | "venue_unavailable"
    | "outside_forecast_window"
    | "provider_unavailable";
  capturedAt: string;
  reused: boolean;
  forecast: WeatherForecastRecord | null;
  independentTotalAdjustmentPoints: number;
  adjustmentReasons: string[];
};

type Venue = {
  source: "playbook";
  teamId: string;
  teamName: string;
  name: string;
  latitude: number;
  longitude: number;
  roofType: CfbKickoffWeatherSnapshot["roofType"];
};

export async function collectCfbKickoffWeather(args: {
  game: NcaafGame;
  stage: "opening" | "unlocked" | "t60";
  capturedAt: string;
  venueRows: readonly unknown[];
  provider: IWeatherProvider | null;
  previous?: CfbKickoffWeatherSnapshot | null;
}): Promise<{ snapshot: CfbKickoffWeatherSnapshot; requests: number }> {
  const base = {
    release: CFB_KICKOFF_WEATHER_RELEASE,
    venueTeam: args.game.home.abbreviation,
    capturedAt: new Date(args.capturedAt).toISOString(),
  } as const;
  if (args.game.neutralSite) {
    return { snapshot: unavailable(base, "neutral_site"), requests: 0 };
  }
  const venue = resolveCfbKickoffVenue({ game: args.game, rows: args.venueRows });
  if (!venue) return { snapshot: unavailable(base, "venue_unavailable"), requests: 0 };
  const venueBase = {
    ...base,
    venueSource: venue.source,
    venueName: venue.name,
    latitude: venue.latitude,
    longitude: venue.longitude,
    roofType: venue.roofType,
  } as const;
  if (venue.roofType === "fixed") {
    return {
      snapshot: {
        ...venueBase,
        forecastSource: null,
        status: "controlled_indoor",
        reused: false,
        forecast: null,
        independentTotalAdjustmentPoints: 0,
        adjustmentReasons: [],
      },
      requests: 0,
    };
  }
  if (args.stage !== "t60" && reusable(args.previous, venue, args.game.scheduledStart, args.capturedAt)) {
    return {
      snapshot: {
        ...args.previous!,
        capturedAt: new Date(args.capturedAt).toISOString(),
        reused: true,
      },
      requests: 0,
    };
  }
  const horizonHours = (Date.parse(args.game.scheduledStart) - Date.parse(args.capturedAt)) / 3_600_000;
  if (horizonHours > CFB_WEATHER_PROVIDER_HORIZON_HOURS) {
    return {
      snapshot: {
        ...venueBase,
        forecastSource: null,
        status: "outside_forecast_window",
        reused: false,
        forecast: null,
        independentTotalAdjustmentPoints: 0,
        adjustmentReasons: [],
      },
      requests: 0,
    };
  }
  if (!args.provider) {
    return {
      snapshot: {
        ...venueBase,
        forecastSource: null,
        status: "provider_unavailable",
        reused: false,
        forecast: null,
        independentTotalAdjustmentPoints: 0,
        adjustmentReasons: [],
      },
      requests: 0,
    };
  }
  let forecast: WeatherForecastRecord | null = null;
  try {
    forecast = await args.provider.getForecast(venue.latitude, venue.longitude, args.game.scheduledStart);
  } catch {
    return {
      snapshot: {
        ...venueBase,
        forecastSource: "openweather",
        status: "provider_unavailable",
        reused: false,
        forecast: null,
        independentTotalAdjustmentPoints: 0,
        adjustmentReasons: [],
      },
      requests: 1,
    };
  }
  if (!validForecast(forecast, args.game.scheduledStart)) {
    return {
      snapshot: {
        ...venueBase,
        forecastSource: "openweather",
        status: horizonHours > 120 ? "outside_forecast_window" : "provider_unavailable",
        reused: false,
        forecast: null,
        independentTotalAdjustmentPoints: 0,
        adjustmentReasons: [],
      },
      requests: 1,
    };
  }
  const adjustment = cfbWeatherTotalAdjustment(forecast);
  return {
    snapshot: {
      ...venueBase,
      forecastSource: "openweather",
      status: "forecast_available",
      reused: false,
      forecast,
      independentTotalAdjustmentPoints: adjustment.points,
      adjustmentReasons: adjustment.reasons,
    },
    requests: 1,
  };
}

export function resolveCfbKickoffVenue(args: {
  game: NcaafGame;
  rows: readonly unknown[];
}): Venue | null {
  if (args.game.neutralSite) return null;
  const matches = args.rows.flatMap((value) => {
    const row = record(value) as PlaybookVenueWeatherRow;
    const teamId = text(row.teamId)?.toUpperCase();
    const teamName = text(row.teamName);
    const venue = row.venue;
    const latitude = finite(venue?.location?.lat);
    const longitude = finite(venue?.location?.lon);
    const name = text(venue?.park);
    const exactTeam = teamId === args.game.home.abbreviation.toUpperCase() ||
      (teamName !== null && normalize(teamName) === normalize(args.game.home.name));
    if (!exactTeam || !teamId || !teamName || !name || latitude === null || longitude === null ||
      latitude < -90 || latitude > 90 || longitude < -180 || longitude > 180) return [];
    return [{
      source: "playbook" as const,
      teamId,
      teamName,
      name,
      latitude,
      longitude,
      roofType: roofType(venue?.roof),
    }];
  });
  const unique = new Map(matches.map((row) => [
    `${row.teamId}:${row.latitude.toFixed(5)}:${row.longitude.toFixed(5)}:${normalize(row.name)}`,
    row,
  ]));
  return unique.size === 1 ? [...unique.values()][0]! : null;
}

export function cfbWeatherTotalAdjustment(forecast: WeatherForecastRecord): {
  points: number;
  reasons: string[];
} {
  const reasons: string[] = [];
  let points = 0;
  const wind = forecast.wind_speed_mph;
  if (wind !== null && wind >= 25) {
    points -= 3;
    reasons.push("wind_at_least_25_mph");
  } else if (wind !== null && wind >= 20) {
    points -= 2;
    reasons.push("wind_20_to_24_mph");
  } else if (wind !== null && wind >= 15) {
    points -= 1;
    reasons.push("wind_15_to_19_mph");
  }
  const adversePrecipitation = forecast.precipitation_probability !== null &&
    forecast.precipitation_probability >= 60 &&
    /rain|thunder|storm|snow|sleet|freez/i.test(forecast.conditions ?? "");
  if (adversePrecipitation) {
    points -= 0.5;
    reasons.push("adverse_precipitation_at_least_60_pct");
  }
  if (forecast.temperature_f !== null && forecast.temperature_f <= 25) {
    points -= 0.5;
    reasons.push("temperature_at_or_below_25_f");
  }
  return { points: Math.max(-3, points), reasons };
}

function reusable(
  previous: CfbKickoffWeatherSnapshot | null | undefined,
  venue: Venue,
  gameStartsAt: string,
  capturedAt: string,
): previous is CfbKickoffWeatherSnapshot {
  if (!previous || previous.status !== "forecast_available" || !previous.forecast) return false;
  if (previous.venueName !== venue.name || previous.latitude !== venue.latitude || previous.longitude !== venue.longitude) return false;
  if (!validForecast(previous.forecast, gameStartsAt)) return false;
  const ageMinutes = (Date.parse(capturedAt) - Date.parse(previous.forecast.fetched_at)) / 60_000;
  return Number.isFinite(ageMinutes) && ageMinutes >= 0 && ageMinutes <= CFB_WEATHER_REUSE_MAX_AGE_MINUTES;
}

function validForecast(forecast: WeatherForecastRecord | null, gameStartsAt: string): forecast is WeatherForecastRecord {
  if (!forecast) return false;
  const offsetHours = Math.abs(Date.parse(forecast.forecast_for) - Date.parse(gameStartsAt)) / 3_600_000;
  return Number.isFinite(offsetHours) && offsetHours <= CFB_WEATHER_MAX_FORECAST_OFFSET_HOURS &&
    Number.isFinite(Date.parse(forecast.fetched_at));
}

function unavailable(
  base: Pick<CfbKickoffWeatherSnapshot, "release" | "venueTeam" | "capturedAt">,
  status: "neutral_site" | "venue_unavailable",
): CfbKickoffWeatherSnapshot {
  return {
    ...base,
    venueSource: null,
    forecastSource: null,
    venueName: null,
    latitude: null,
    longitude: null,
    roofType: "unknown",
    status,
    reused: false,
    forecast: null,
    independentTotalAdjustmentPoints: 0,
    adjustmentReasons: [],
  };
}

function roofType(value: unknown): CfbKickoffWeatherSnapshot["roofType"] {
  const normalized = text(value)?.toUpperCase().replace(/[^A-Z]+/g, "_") ?? "";
  if (/FIXED|DOME|INDOOR/.test(normalized)) return "fixed";
  if (/RETRACT/.test(normalized)) return "retractable";
  if (/OPEN/.test(normalized)) return "open_air";
  return "unknown";
}

function normalize(value: string): string {
  return value.toLowerCase().normalize("NFD").replace(/\p{Diacritic}/gu, "").replace(/[^a-z0-9]+/g, " ").trim();
}

function record(value: unknown): Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

function text(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function finite(value: unknown): number | null {
  const parsed = typeof value === "number" ? value : typeof value === "string" ? Number(value) : Number.NaN;
  return Number.isFinite(parsed) ? parsed : null;
}

