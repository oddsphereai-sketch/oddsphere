import {
  BallDontLieMlbPropsClient,
  MLBStatsGameLogClient,
  MLBStatsAPIClient,
  MockMLBProvider,
  SharpApiPropsClient,
} from "./providerClients";
import { NwsWeatherClient } from "./nwsWeatherClient";
import { StatcastParkFactorClient } from "./statcastParkFactors";

export type MlbPropsProviderMode = "mock" | "real";

export function resolveProviderMode(requested?: string | null): MlbPropsProviderMode {
  const value = (requested ?? process.env.ODDSPHERE_MLB_PROVIDER ?? "mock").toLowerCase();
  return value === "real" || value === "production" ? "real" : "mock";
}

export function assertRealProviderKeys() {
  const missing = [
    ["SHARPAPI_KEY", process.env.SHARPAPI_KEY],
    ["BALLDONTLIE_API_KEY", process.env.BALLDONTLIE_API_KEY],
    ["PLAYBOOK_API_KEY", process.env.PLAYBOOK_API_KEY],
  ].filter(([, value]) => !value);
  if (missing.length > 0) {
    throw new Error(`Real MLB props provider mode requires missing env vars: ${missing.map(([name]) => name).join(", ")}`);
  }
}

export function buildMockPropsProvider() {
  return new MockMLBProvider();
}

export function buildRealProviderClients() {
  assertRealProviderKeys();
  const mlbStats = new MLBStatsAPIClient();
  return {
    odds: new SharpApiPropsClient(),
    ballDontLie: new BallDontLieMlbPropsClient(),
    playbook: {
      status: "contract_pending" as const,
      provider: "playbook" as const,
    },
    mlbStats,
    statcast: new MLBStatsGameLogClient(),
    weather: new NwsWeatherClient(mlbStats),
    parkFactors: new StatcastParkFactorClient(),
  };
}
