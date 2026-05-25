/**
 * Provider factory.
 *
 * Rewritten in Phase 6.3b to align with V2.1's tri-state provider routing.
 * Each provider reads a `<DOMAIN>_PROVIDER` env var whose value is one of:
 *
 *   mock      (V1 default, also chosen when var is unset or unrecognized)
 *   manual    (admin-pasted via Phase 7.25 — throws notImplemented until then)
 *   real_api  (paid live feed — throws notImplemented until Phase 8)
 *
 * Defensive default: any value other than the three above falls back to
 * mock. A typo'd env var must NEVER silently swap in a paid feed and start
 * spending quota.
 *
 * Instances are cached per-process (singletons). `__resetProviderCache()` is
 * a test-only escape hatch — production code never calls it.
 */

import type { IOddsProvider } from "./interfaces/IOddsProvider";
import type { ISharpSignalProvider } from "./interfaces/ISharpSignalProvider";
import type { IPlayerStatsProvider } from "./interfaces/IPlayerStatsProvider";
import type { IWeatherProvider } from "./interfaces/IWeatherProvider";
import type { IParkFactorProvider } from "./interfaces/IParkFactorProvider";

import { MockOddsProvider } from "./mock/MockOddsProvider";
import { MockSharpSignalProvider } from "./mock/MockSharpSignalProvider";
import { MockPlayerStatsProvider } from "./mock/MockPlayerStatsProvider";
import { MockWeatherProvider } from "./mock/MockWeatherProvider";
import { MockParkFactorProvider } from "./mock/MockParkFactorProvider";

type ProviderMode = "mock" | "manual" | "real_api";

let oddsInstance: IOddsProvider | null = null;
let sharpSignalInstance: ISharpSignalProvider | null = null;
let playerStatsInstance: IPlayerStatsProvider | null = null;
let weatherInstance: IWeatherProvider | null = null;
let parkFactorInstance: IParkFactorProvider | null = null;

/**
 * Read the provider mode from the named env var. Defaults to "mock" when
 * unset OR when the value isn't one of the three valid modes — defensive
 * to typos so we never accidentally route to a paid API.
 */
function readMode(envKey: string): ProviderMode {
  const raw = process.env[envKey];
  if (raw === "manual" || raw === "real_api") return raw;
  return "mock";
}

function notImplemented(
  envKey: string,
  mode: ProviderMode,
  realClassName: string,
  phase: string
): never {
  throw new Error(
    `${envKey}=${mode} but ${realClassName} is not yet implemented (planned for ${phase}). ` +
      `Set ${envKey}=mock (or unset) to use the mock.`
  );
}

export function getOddsProvider(): IOddsProvider {
  if (oddsInstance === null) {
    const mode = readMode("ODDS_PROVIDER");
    if (mode === "mock") {
      oddsInstance = new MockOddsProvider();
    } else if (mode === "manual") {
      notImplemented("ODDS_PROVIDER", mode, "AdminUploadOddsProvider", "Phase 7.25");
    } else {
      notImplemented("ODDS_PROVIDER", mode, "SharpAPIOddsProvider", "Phase 8");
    }
  }
  return oddsInstance;
}

export function getSharpSignalProvider(): ISharpSignalProvider {
  if (sharpSignalInstance === null) {
    const mode = readMode("SHARP_SIGNAL_PROVIDER");
    if (mode === "mock") {
      sharpSignalInstance = new MockSharpSignalProvider();
    } else if (mode === "manual") {
      notImplemented("SHARP_SIGNAL_PROVIDER", mode, "AdminUploadSharpSignalProvider", "Phase 7.25");
    } else {
      notImplemented("SHARP_SIGNAL_PROVIDER", mode, "SharpAPISignalProvider", "Phase 8");
    }
  }
  return sharpSignalInstance;
}

export function getPlayerStatsProvider(): IPlayerStatsProvider {
  if (playerStatsInstance === null) {
    const mode = readMode("PLAYER_STATS_PROVIDER");
    if (mode === "mock") {
      playerStatsInstance = new MockPlayerStatsProvider();
    } else if (mode === "manual") {
      notImplemented("PLAYER_STATS_PROVIDER", mode, "AdminUploadStatsProvider", "Phase 7.25");
    } else {
      notImplemented("PLAYER_STATS_PROVIDER", mode, "BallDontLieProvider", "Phase 8");
    }
  }
  return playerStatsInstance;
}

export function getWeatherProvider(): IWeatherProvider {
  if (weatherInstance === null) {
    const mode = readMode("WEATHER_PROVIDER");
    if (mode === "mock") {
      weatherInstance = new MockWeatherProvider();
    } else if (mode === "manual") {
      notImplemented("WEATHER_PROVIDER", mode, "AdminUploadWeatherProvider", "Phase 7.25");
    } else {
      notImplemented("WEATHER_PROVIDER", mode, "OpenWeatherProvider", "Phase 8");
    }
  }
  return weatherInstance;
}

export function getParkFactorProvider(): IParkFactorProvider {
  if (parkFactorInstance === null) {
    const mode = readMode("PARK_FACTOR_PROVIDER");
    if (mode === "mock") {
      parkFactorInstance = new MockParkFactorProvider();
    } else if (mode === "manual") {
      notImplemented("PARK_FACTOR_PROVIDER", mode, "AdminUploadParkFactorProvider", "Phase 7.25");
    } else {
      notImplemented("PARK_FACTOR_PROVIDER", mode, "FanGraphsProvider", "Phase 8");
    }
  }
  return parkFactorInstance;
}

/**
 * Reset cached provider instances. Test-only escape hatch — production code
 * should never call this. Lives here so tests can swap providers between
 * runs without restarting the process.
 */
export function __resetProviderCache(): void {
  oddsInstance = null;
  sharpSignalInstance = null;
  playerStatsInstance = null;
  weatherInstance = null;
  parkFactorInstance = null;
}
