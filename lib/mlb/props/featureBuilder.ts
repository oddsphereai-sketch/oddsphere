import { createHash } from "crypto";
import type { MlbPropMarketKey } from "./config";
import type { MlbPropProviderBundle, MlbHistoricalStatRow } from "./providers";

export type PropFeatureSnapshot = {
  gameId: string;
  playerId: string;
  marketKey: MlbPropMarketKey;
  line: number;
  asOfTimestamp: string;
  featureVersion: string;
  features: Record<string, number | string | boolean | null>;
  dataAvailability: Record<string, boolean | string | number | null>;
  leakageGuardHash: string;
};

export async function buildMlbPropFeatureSnapshot(args: {
  provider: MlbPropProviderBundle;
  gameId: string;
  playerId: string;
  marketKey: MlbPropMarketKey;
  line: number;
  asOfTimestamp: string;
  featureVersion?: string;
}): Promise<PropFeatureSnapshot> {
  const logs = await args.provider.getPlayerGameLogs({
    playerId: args.playerId,
    before: args.asOfTimestamp.slice(0, 10),
    limit: 10,
  });
  const safeLogs = logs.filter((log) => isBeforeAsOf(log, args.asOfTimestamp));
  const games = await args.provider.getGames({ date: args.asOfTimestamp.slice(0, 10) });
  const game = games.find((row) => row.id === args.gameId) ?? null;
  const lineups = await args.provider.getLineups({ date: args.asOfTimestamp.slice(0, 10), asOfTimestamp: args.asOfTimestamp });
  const probablePitchers = await args.provider.getProbablePitchers({ date: args.asOfTimestamp.slice(0, 10), asOfTimestamp: args.asOfTimestamp });
  const weather = (await args.provider.getWeather({ date: args.asOfTimestamp.slice(0, 10), asOfTimestamp: args.asOfTimestamp }))
    .find((row) => row.gameId === args.gameId) ?? null;

  const avgStrikeouts = averageNumeric(safeLogs, "strikeouts");
  const avgBattersFaced = averageNumeric(safeLogs, "batters_faced");
  const avgOuts = averageNumeric(safeLogs, "outs");
  const avgPitchCount = averageNumeric(safeLogs, "pitch_count");
  const pitcherTeamId = latestTeamId(safeLogs) ?? probablePitchers.find((row) => row.playerId === args.playerId)?.teamId ?? null;
  const latestGameDate = safeLogs[0]?.gameDate ?? null;
  const recentStarts = safeLogs.length;
  const features = {
    game_date: game?.gameDate ?? args.asOfTimestamp.slice(0, 10),
    scheduled_start_hour_utc: game ? new Date(game.scheduledStart).getUTCHours() : null,
    home_away: game && pitcherTeamId ? (game.homeTeamId === pitcherTeamId ? "home" : game.awayTeamId === pitcherTeamId ? "away" : "unknown") : "unknown",
    park: game?.venue ?? null,
    roof_status: game?.roofStatus ?? null,
    temperature_f: weather?.temperatureF ?? null,
    wind_speed_mph: weather?.windSpeedMph ?? null,
    recent_starts: recentStarts,
    recent_logs: recentStarts,
    rolling_10_start_k: avgStrikeouts,
    rolling_10_batters_faced: avgBattersFaced,
    rolling_10_outs: avgOuts,
    rolling_pitch_count: avgPitchCount,
    days_rest: latestGameDate ? Math.max(0, Math.round((new Date(args.asOfTimestamp).getTime() - new Date(`${latestGameDate}T12:00:00.000Z`).getTime()) / 86_400_000)) : null,
    strikeout_rate_recent: avgBattersFaced && avgBattersFaced > 0 ? avgStrikeouts / avgBattersFaced : null,
    outs_per_start_recent: recentStarts > 0 ? avgOuts : null,
    lineup_status_confirmed: lineups.some((row) => row.gameId === args.gameId && row.lineupStatus === "confirmed"),
    line: args.line,
  };
  const dataAvailability = {
    game: game !== null,
    weather: weather !== null,
    historical_logs: recentStarts,
    probable_pitcher: probablePitchers.some((row) => row.playerId === args.playerId),
    lineups: lineups.filter((row) => row.gameId === args.gameId).length,
    leakage_safe_logs: safeLogs.length === logs.length,
    dropped_future_logs: logs.length - safeLogs.length,
  };
  return {
    gameId: args.gameId,
    playerId: args.playerId,
    marketKey: args.marketKey,
    line: args.line,
    asOfTimestamp: args.asOfTimestamp,
    featureVersion: args.featureVersion ?? "mlb_props_v1",
    features,
    dataAvailability,
    leakageGuardHash: hashLeakageGuard({
      gameId: args.gameId,
      playerId: args.playerId,
      marketKey: args.marketKey,
      line: args.line,
      asOfTimestamp: args.asOfTimestamp,
      features,
      dataAvailability,
    }),
  };
}

function latestTeamId(rows: MlbHistoricalStatRow[]): string | null {
  return rows[0]?.teamId ?? null;
}

function isBeforeAsOf(log: MlbHistoricalStatRow, asOfTimestamp: string): boolean {
  const logTime = new Date(`${log.gameDate}T23:59:59.999Z`).getTime();
  return logTime < new Date(asOfTimestamp).getTime();
}

function averageNumeric(rows: MlbHistoricalStatRow[], key: string): number {
  const values = rows.map((row) => row.stats[key]).filter((value): value is number => typeof value === "number");
  if (values.length === 0) return 0;
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

function hashLeakageGuard(value: unknown): string {
  return createHash("sha256").update(JSON.stringify(value)).digest("hex");
}
