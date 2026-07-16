import { resolveMlbBallparkMetadata } from "./ballparkMetadata";
import type { MlbGameEntity, MlbWeatherProvider } from "./providers";
import { buildPlayerPropEnvironmentEvidence, type PlayerPropEnvironmentEvidence } from "./researchEvidence";
import type { StatcastParkFactor } from "./statcastParkFactors";

export type SlateEnvironmentResearch = {
  byGameId: Map<string, PlayerPropEnvironmentEvidence>;
  parkFactorRows: number;
  weatherRows: number;
  errors: string[];
};

export async function loadSlateEnvironmentResearch(args: {
  games: MlbGameEntity[];
  asOfTimestamp: string;
  parkFactors: { getParkFactors: (season: number) => Promise<StatcastParkFactor[]> };
  weather: MlbWeatherProvider;
}): Promise<SlateEnvironmentResearch> {
  const errors: string[] = [];
  const season = args.games[0]?.season ?? Number(args.asOfTimestamp.slice(0, 4));
  const date = args.games[0]?.gameDate ?? args.asOfTimestamp.slice(0, 10);
  const [parkFactors, weatherRows] = await Promise.all([
    args.parkFactors.getParkFactors(season).catch((error) => {
      errors.push(`park_factor:${message(error)}`);
      return [];
    }),
    args.weather.getWeather({ date, asOfTimestamp: args.asOfTimestamp }).catch((error) => {
      errors.push(`game_time_weather:${message(error)}`);
      return [];
    }),
  ]);
  const weatherByGame = new Map(weatherRows.map((row) => [row.gameId, row]));
  const byGameId = new Map<string, PlayerPropEnvironmentEvidence>();
  for (const game of args.games) {
    const venue = game.venue ?? null;
    const metadata = resolveMlbBallparkMetadata(venue);
    const factor = parkFactors.find((row) => normalizeVenue(row.venue) === normalizeVenue(venue ?? "")) ?? null;
    const weather = weatherByGame.get(game.id) ?? null;
    const roofStatus = normalizeRoofStatus(game.roofStatus, metadata?.roofStatus);
    byGameId.set(game.id, buildPlayerPropEnvironmentEvidence({
      venue,
      roofStatus,
      asOfTimestamp: args.asOfTimestamp,
      park: factor ? {
        status: "available",
        runFactor: factor.runFactor,
        homeRunFactor: factor.homeRunFactor,
        strikeoutFactor: factor.strikeoutFactor,
        source: `${factor.source} ${factor.yearRange}`,
      } : { status: errors.some((error) => error.startsWith("park_factor:")) ? "unavailable" : "pending" },
      weather: weather ? {
        status: "available",
        temperatureF: weather.temperatureF ?? null,
        conditions: weather.conditions ?? null,
        windSpeedMph: weather.windSpeedMph ?? null,
        windDirection: weather.windDirection ?? null,
        precipitationProbability: weather.precipitationProbability ?? null,
        source: weather.provider,
      } : roofStatus === "dome" ? undefined : {
        status: errors.some((error) => error.startsWith("game_time_weather:")) ? "unavailable" : "pending",
      },
    }));
  }
  return { byGameId, parkFactorRows: parkFactors.length, weatherRows: weatherRows.length, errors };
}

function normalizeRoofStatus(
  scheduleStatus: string | null | undefined,
  metadataStatus: PlayerPropEnvironmentEvidence["roofStatus"] | undefined
): PlayerPropEnvironmentEvidence["roofStatus"] {
  const value = scheduleStatus?.toLowerCase() ?? "";
  if (value.includes("dome") || value.includes("closed")) return "dome";
  if (value.includes("retract")) return "retractable";
  if (value.includes("open") || value.includes("outdoor")) return "outdoor";
  return metadataStatus ?? "unknown";
}

function normalizeVenue(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
}

function message(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
