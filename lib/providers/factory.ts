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
import type { ISlateProvider } from "./interfaces/ISlateProvider";
import type { IWeatherProvider } from "./interfaces/IWeatherProvider";
import type { IParkFactorProvider } from "./interfaces/IParkFactorProvider";

import { MockOddsProvider } from "./mock/MockOddsProvider";
import { MockSharpSignalProvider } from "./mock/MockSharpSignalProvider";
import { MockPlayerStatsProvider } from "./mock/MockPlayerStatsProvider";
import { MockSlateProvider } from "./mock/MockSlateProvider";
import { MockWeatherProvider } from "./mock/MockWeatherProvider";
import { MockParkFactorProvider } from "./mock/MockParkFactorProvider";
import { ManualSlateProvider } from "./manual/ManualSlateProvider";

// Gate B.1 Phase 1 — real_api implementations.
import { BallDontLieProvider } from "./real_api/BallDontLieProvider";
import { BallDontLieSlateProvider } from "./real_api/BallDontLieSlateProvider";
import { SharpAPIOddsProvider, type SharpApiGameResolver } from "./real_api/SharpAPIOddsProvider";
import { SharpAPISignalProvider } from "./real_api/SharpAPISignalProvider";
// Phase 4W — real OpenWeather provider.
import { OpenWeatherProvider } from "./real_api/OpenWeatherProvider";
import type { MlbTeamAbbrev } from "./real_api/_teamNameNormalizer";
import { supabase } from "../db/supabase";
import type { Sport } from "../types/domain/Sport";

type ProviderMode = "mock" | "manual" | "real_api";

let oddsInstance: IOddsProvider | null = null;
let sharpSignalInstance: ISharpSignalProvider | null = null;
let playerStatsInstance: IPlayerStatsProvider | null = null;
let slateInstance: ISlateProvider | null = null;
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

/**
 * Gate B.1 Phase 1 — read a required env var with a clear error when
 * missing. Used by the real_api branches to surface a friendly error
 * naming the env var (BALLDONTLIE_API_KEY / SHARPAPI_KEY) instead of a
 * cryptic "apiKey must be non-empty" from a downstream constructor.
 */
function readRequiredEnv(envKey: string, providerName: string): string {
  const value = process.env[envKey];
  if (typeof value !== "string" || value.length === 0) {
    throw new Error(
      `${providerName} requires ${envKey} to be set in the environment. ` +
        `Found: ${value === undefined ? "unset" : `'${value}'`}.`
    );
  }
  return value;
}

/**
 * Gate B.1 Phase 1 — resolver closure that maps a SharpAPI event's natural
 * key (sport + slate_date + team abbreviations) to the BDL integer
 * external_id already stored in the `games` table. Both
 * SharpAPIOddsProvider and SharpAPISignalProvider receive an instance of
 * this resolver at construction time. Returns null when no matching game
 * is found — caller skips the event without throwing.
 *
 * Implementation strategy: two-step lookup (teams by abbreviation, then
 * games by home/away team id + slate_date). Avoids the need for a
 * server-side join. The Supabase server-side client uses the
 * SERVICE_ROLE_KEY so RLS is bypassed.
 */
function makeSharpApiGameResolver(): SharpApiGameResolver {
  return async (
    sport: Sport,
    date: string,
    homeAbbrev: MlbTeamAbbrev,
    awayAbbrev: MlbTeamAbbrev
  ): Promise<number | null> => {
    const { data: teams, error: teamsError } = await supabase
      .from("teams")
      .select("id, abbreviation")
      .eq("sport", sport)
      .in("abbreviation", [homeAbbrev, awayAbbrev]);
    if (teamsError) return null;
    if (!teams || teams.length < 2) return null;
    const homeRow = teams.find((t) => t.abbreviation === homeAbbrev);
    const awayRow = teams.find((t) => t.abbreviation === awayAbbrev);
    if (homeRow === undefined || awayRow === undefined) return null;

    const { data: game, error: gameError } = await supabase
      .from("games")
      .select("external_id")
      .eq("sport", sport)
      .eq("slate_date", date)
      .eq("home_team_id", homeRow.id)
      .eq("away_team_id", awayRow.id)
      .limit(1)
      .maybeSingle();
    if (gameError) return null;
    return game?.external_id ?? null;
  };
}

export function getOddsProvider(): IOddsProvider {
  if (oddsInstance === null) {
    const mode = readMode("ODDS_PROVIDER");
    if (mode === "mock") {
      oddsInstance = new MockOddsProvider();
    } else if (mode === "manual") {
      notImplemented("ODDS_PROVIDER", mode, "AdminUploadOddsProvider", "Phase 7.25");
    } else {
      // Gate B.1 Phase 1 — SharpAPI wired.
      const key = readRequiredEnv("SHARPAPI_KEY", "SharpAPIOddsProvider");
      oddsInstance = new SharpAPIOddsProvider(key, makeSharpApiGameResolver());
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
      // Gate B.1 Phase 1 — SharpAPI wired.
      const key = readRequiredEnv("SHARPAPI_KEY", "SharpAPISignalProvider");
      sharpSignalInstance = new SharpAPISignalProvider(
        key,
        makeSharpApiGameResolver()
      );
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
      // Gate B.1 Phase 1 — Ball Don't Lie wired.
      const key = readRequiredEnv("BALLDONTLIE_API_KEY", "BallDontLieProvider");
      playerStatsInstance = new BallDontLieProvider(key);
    }
  }
  return playerStatsInstance;
}

/**
 * Fix 7.2 — separate factory for slate (games + teams) so manual slate
 * ingestion can be enabled without taking the rest of the player-stats
 * surface with it. Reads SLATE_PROVIDER env (mock | manual | real_api).
 * Default mock. Manual mode wires the staging-table-backed ingestion
 * (lib/providers/manual/ManualSlateProvider.ts).
 *
 * Gate B.1 Phase 1 — real_api branch now wires BallDontLieSlateProvider.
 * SharpAPI slate provider deferred (post-launch enhancement per Gate B
 * roadmap; BDL is canonical for V1).
 */
export function getSlateProvider(): ISlateProvider {
  if (slateInstance === null) {
    const mode = readMode("SLATE_PROVIDER");
    if (mode === "mock") {
      slateInstance = new MockSlateProvider();
    } else if (mode === "manual") {
      slateInstance = new ManualSlateProvider();
    } else {
      // Gate B.1 Phase 1 — Ball Don't Lie wired as canonical slate provider.
      const key = readRequiredEnv("BALLDONTLIE_API_KEY", "BallDontLieSlateProvider");
      slateInstance = new BallDontLieSlateProvider(key);
    }
  }
  return slateInstance;
}

export function getWeatherProvider(): IWeatherProvider {
  if (weatherInstance === null) {
    const mode = readMode("WEATHER_PROVIDER");
    if (mode === "mock") {
      weatherInstance = new MockWeatherProvider();
    } else if (mode === "manual") {
      notImplemented("WEATHER_PROVIDER", mode, "AdminUploadWeatherProvider", "Phase 7.25");
    } else {
      // Phase 4W — real OpenWeather. Reached only when WEATHER_PROVIDER
      // is explicitly set to "real_api" (readMode coerces unknown/typo'd
      // values to mock per the factory's defensive tri-state contract).
      // Requires OPENWEATHER_API_KEY; throws clear error if missing
      // rather than silently falling back to mock.
      const key = readRequiredEnv("OPENWEATHER_API_KEY", "OpenWeatherProvider");
      weatherInstance = new OpenWeatherProvider(key);
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
  slateInstance = null;
  weatherInstance = null;
  parkFactorInstance = null;
}
