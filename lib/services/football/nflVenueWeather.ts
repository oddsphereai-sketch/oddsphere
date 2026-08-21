import type { IWeatherProvider } from "@/lib/providers/interfaces/IWeatherProvider";
import type { NflForwardEvidenceStage, NflForwardWeatherSnapshot } from "./nflForwardEvidence";

type Venue = {
  name: string;
  latitude: number;
  longitude: number;
  roofType: "outdoor" | "retractable" | "fixed";
};

const NFL_VENUES: Record<string, Venue> = {
  ARI: { name: "State Farm Stadium", latitude: 33.5276, longitude: -112.2626, roofType: "retractable" },
  ATL: { name: "Mercedes-Benz Stadium", latitude: 33.7554, longitude: -84.4008, roofType: "retractable" },
  BAL: { name: "M&T Bank Stadium", latitude: 39.2780, longitude: -76.6227, roofType: "outdoor" },
  BUF: { name: "Highmark Stadium", latitude: 42.7738, longitude: -78.7870, roofType: "outdoor" },
  CAR: { name: "Bank of America Stadium", latitude: 35.2258, longitude: -80.8528, roofType: "outdoor" },
  CHI: { name: "Soldier Field", latitude: 41.8623, longitude: -87.6167, roofType: "outdoor" },
  CIN: { name: "Paycor Stadium", latitude: 39.0954, longitude: -84.5160, roofType: "outdoor" },
  CLE: { name: "Huntington Bank Field", latitude: 41.5061, longitude: -81.6995, roofType: "outdoor" },
  DAL: { name: "AT&T Stadium", latitude: 32.7473, longitude: -97.0945, roofType: "retractable" },
  DEN: { name: "Empower Field at Mile High", latitude: 39.7439, longitude: -105.0201, roofType: "outdoor" },
  DET: { name: "Ford Field", latitude: 42.3400, longitude: -83.0456, roofType: "fixed" },
  GB: { name: "Lambeau Field", latitude: 44.5013, longitude: -88.0622, roofType: "outdoor" },
  HOU: { name: "NRG Stadium", latitude: 29.6847, longitude: -95.4107, roofType: "retractable" },
  IND: { name: "Lucas Oil Stadium", latitude: 39.7601, longitude: -86.1639, roofType: "retractable" },
  JAX: { name: "EverBank Stadium", latitude: 30.3239, longitude: -81.6373, roofType: "outdoor" },
  KC: { name: "GEHA Field at Arrowhead Stadium", latitude: 39.0489, longitude: -94.4839, roofType: "outdoor" },
  LAC: { name: "SoFi Stadium", latitude: 33.9535, longitude: -118.3392, roofType: "fixed" },
  LAR: { name: "SoFi Stadium", latitude: 33.9535, longitude: -118.3392, roofType: "fixed" },
  LV: { name: "Allegiant Stadium", latitude: 36.0908, longitude: -115.1830, roofType: "fixed" },
  MIA: { name: "Hard Rock Stadium", latitude: 25.9580, longitude: -80.2389, roofType: "outdoor" },
  MIN: { name: "U.S. Bank Stadium", latitude: 44.9738, longitude: -93.2581, roofType: "fixed" },
  NE: { name: "Gillette Stadium", latitude: 42.0909, longitude: -71.2643, roofType: "outdoor" },
  NO: { name: "Caesars Superdome", latitude: 29.9511, longitude: -90.0812, roofType: "fixed" },
  NYG: { name: "MetLife Stadium", latitude: 40.8135, longitude: -74.0745, roofType: "outdoor" },
  NYJ: { name: "MetLife Stadium", latitude: 40.8135, longitude: -74.0745, roofType: "outdoor" },
  PHI: { name: "Lincoln Financial Field", latitude: 39.9008, longitude: -75.1675, roofType: "outdoor" },
  PIT: { name: "Acrisure Stadium", latitude: 40.4468, longitude: -80.0158, roofType: "outdoor" },
  SEA: { name: "Lumen Field", latitude: 47.5952, longitude: -122.3316, roofType: "outdoor" },
  SF: { name: "Levi's Stadium", latitude: 37.4030, longitude: -121.9700, roofType: "outdoor" },
  TB: { name: "Raymond James Stadium", latitude: 27.9759, longitude: -82.5033, roofType: "outdoor" },
  TEN: { name: "Nissan Stadium", latitude: 36.1665, longitude: -86.7713, roofType: "outdoor" },
  WAS: { name: "Northwest Stadium", latitude: 38.9077, longitude: -76.8645, roofType: "outdoor" },
  WSH: { name: "Northwest Stadium", latitude: 38.9077, longitude: -76.8645, roofType: "outdoor" },
};

export async function collectNflForwardWeather(args: {
  homeTeam: string;
  gameStartsAt: string;
  stage: NflForwardEvidenceStage;
  capturedAt: string;
  provider: IWeatherProvider | null;
}): Promise<{ snapshot: NflForwardWeatherSnapshot; requests: number }> {
  const venue = NFL_VENUES[args.homeTeam.toUpperCase()];
  if (!venue) throw new Error(`NFL venue mapping is missing for ${args.homeTeam}.`);
  const base = {
    venueTeam: args.homeTeam,
    venueName: venue.name,
    roofType: venue.roofType,
    capturedAt: args.capturedAt,
  } as const;
  if (venue.roofType === "fixed") {
    return { snapshot: { ...base, status: "controlled_indoor", forecast: null }, requests: 0 };
  }
  if (args.stage === "unlocked") {
    return { snapshot: { ...base, status: "not_captured_for_unlocked", forecast: null }, requests: 0 };
  }
  const horizonMs = Date.parse(args.gameStartsAt) - Date.parse(args.capturedAt);
  if (args.stage === "opening" && horizonMs > 5 * 24 * 60 * 60_000) {
    return { snapshot: { ...base, status: "outside_forecast_window", forecast: null }, requests: 0 };
  }
  if (!args.provider) {
    return { snapshot: { ...base, status: "provider_unavailable", forecast: null }, requests: 0 };
  }
  let forecast = null;
  try {
    forecast = await args.provider.getForecast(venue.latitude, venue.longitude, args.gameStartsAt);
  } catch {
    return { snapshot: { ...base, status: "provider_unavailable", forecast: null }, requests: 1 };
  }
  return {
    snapshot: {
      ...base,
      status: forecast ? "forecast_available" : "provider_unavailable",
      forecast,
    },
    requests: 1,
  };
}

export const __NFL_VENUE_WEATHER_TEST__ = { NFL_VENUES };
