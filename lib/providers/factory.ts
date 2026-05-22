/**
 * Provider factory.
 *
 * Reads the four USE_REAL_* env vars and returns the corresponding
 * implementation — Mock during Phase 2/3 builds, Real (live API) from Phase 4
 * onward. Instances are cached per-process (singletons).
 *
 * Env flag semantics: only the literal string "true" enables the real
 * provider. Any other value (including "1", "TRUE", undefined, empty) keeps
 * the mock. This is intentional — a typo'd env var should NOT silently swap
 * in the live API and start spending paid quota.
 */

import type { IBettingProvider } from "./interfaces/IBettingProvider";
import type { IParkFactorProvider } from "./interfaces/IParkFactorProvider";
import type { IStatsProvider } from "./interfaces/IStatsProvider";
import type { IWeatherProvider } from "./interfaces/IWeatherProvider";

import { MockBettingProvider } from "./mock/MockBettingProvider";
import { MockParkFactorProvider } from "./mock/MockParkFactorProvider";
import { MockStatsProvider } from "./mock/MockStatsProvider";
import { MockWeatherProvider } from "./mock/MockWeatherProvider";

let statsInstance: IStatsProvider | null = null;
let bettingInstance: IBettingProvider | null = null;
let weatherInstance: IWeatherProvider | null = null;
let parkFactorInstance: IParkFactorProvider | null = null;

function useReal(envKey: string): boolean {
  return process.env[envKey] === "true";
}

function notImplemented(
  envFlagSuffix: string,
  realClassName: string,
  phase: string
): never {
  throw new Error(
    `USE_REAL_${envFlagSuffix}=true but ${realClassName} is not yet implemented (planned for ${phase}). ` +
      `Set USE_REAL_${envFlagSuffix}=false (or unset) to use the mock.`
  );
}

export function getStatsProvider(): IStatsProvider {
  if (statsInstance === null) {
    statsInstance = useReal("USE_REAL_STATS")
      ? notImplemented("STATS", "BallDontLieProvider", "Phase 4")
      : new MockStatsProvider();
  }
  return statsInstance;
}

export function getBettingProvider(): IBettingProvider {
  if (bettingInstance === null) {
    bettingInstance = useReal("USE_REAL_BETTING")
      ? notImplemented("BETTING", "SharpAPIProvider", "Phase 4")
      : new MockBettingProvider();
  }
  return bettingInstance;
}

export function getWeatherProvider(): IWeatherProvider {
  if (weatherInstance === null) {
    weatherInstance = useReal("USE_REAL_WEATHER")
      ? notImplemented("WEATHER", "OpenWeatherProvider", "Phase 4")
      : new MockWeatherProvider();
  }
  return weatherInstance;
}

export function getParkFactorProvider(): IParkFactorProvider {
  if (parkFactorInstance === null) {
    parkFactorInstance = useReal("USE_REAL_PARK_FACTORS")
      ? notImplemented("PARK_FACTORS", "FanGraphsProvider", "Phase 4")
      : new MockParkFactorProvider();
  }
  return parkFactorInstance;
}

/**
 * Reset cached provider instances. Test-only escape hatch — production code
 * should never call this. Lives here so tests can swap providers between
 * runs without restarting the process.
 */
export function __resetProviderCache(): void {
  statsInstance = null;
  bettingInstance = null;
  weatherInstance = null;
  parkFactorInstance = null;
}
