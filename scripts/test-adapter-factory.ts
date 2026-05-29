/**
 * Tests for the provider factory (Phase 6.3b).
 *
 * Pure unit tests — no DB, no network. Covers the tri-state env-var routing
 * (mock / manual / real_api), defensive fallback to mock for unknown values,
 * notImplemented errors for manual + real_api modes, singleton caching, and
 * the test-only __resetProviderCache() escape hatch.
 *
 * Run with: npm run test:adapter-factory
 */

import {
  getOddsProvider,
  getSharpSignalProvider,
  getPlayerStatsProvider,
  getSlateProvider,
  getWeatherProvider,
  getParkFactorProvider,
  __resetProviderCache,
} from "../lib/providers/factory";

import { MockOddsProvider } from "../lib/providers/mock/MockOddsProvider";
import { MockSharpSignalProvider } from "../lib/providers/mock/MockSharpSignalProvider";
import { MockPlayerStatsProvider } from "../lib/providers/mock/MockPlayerStatsProvider";
import { MockSlateProvider } from "../lib/providers/mock/MockSlateProvider";
import { MockWeatherProvider } from "../lib/providers/mock/MockWeatherProvider";
import { MockParkFactorProvider } from "../lib/providers/mock/MockParkFactorProvider";
import { ManualSlateProvider } from "../lib/providers/manual/ManualSlateProvider";

let pass = 0;
let fail = 0;
const failures: string[] = [];

function check(label: string, cond: boolean, hint?: string) {
  if (cond) {
    pass++;
    console.log(`  ✓ ${label}`);
  } else {
    fail++;
    const msg = `  ✗ ${label}${hint ? ` — ${hint}` : ""}`;
    console.log(msg);
    failures.push(msg);
  }
}

/**
 * Wrap a single test in a clean env-var scope. Saves current values for all
 * 5 provider vars, lets the body set them however it wants, then restores.
 * Resets the singleton cache before AND after so test order can't leak
 * cached instances across cases.
 */
function withEnv(
  label: string,
  overrides: Partial<Record<string, string | undefined>>,
  body: () => void
) {
  console.log(`\n${label}`);

  const KEYS = [
    "ODDS_PROVIDER",
    "SHARP_SIGNAL_PROVIDER",
    "PLAYER_STATS_PROVIDER",
    "SLATE_PROVIDER",
    "WEATHER_PROVIDER",
    "PARK_FACTOR_PROVIDER",
  ] as const;

  const saved: Record<string, string | undefined> = {};
  for (const k of KEYS) saved[k] = process.env[k];

  __resetProviderCache();
  for (const k of KEYS) {
    if (k in overrides) {
      const v = overrides[k];
      if (v === undefined) delete process.env[k];
      else process.env[k] = v;
    } else {
      // Default each var to unset for the duration of the test so the
      // fallback path is exercised deterministically.
      delete process.env[k];
    }
  }

  try {
    body();
  } finally {
    for (const k of KEYS) {
      if (saved[k] === undefined) delete process.env[k];
      else process.env[k] = saved[k];
    }
    __resetProviderCache();
  }
}

// ─── 1. Default (no env vars set) returns mock for every provider ─────────
withEnv("1. Default (env unset) → mock for all 6 providers", {}, () => {
  check(
    "getOddsProvider() is MockOddsProvider",
    getOddsProvider() instanceof MockOddsProvider
  );
  check(
    "getSharpSignalProvider() is MockSharpSignalProvider",
    getSharpSignalProvider() instanceof MockSharpSignalProvider
  );
  check(
    "getPlayerStatsProvider() is MockPlayerStatsProvider",
    getPlayerStatsProvider() instanceof MockPlayerStatsProvider
  );
  check(
    "getSlateProvider() is MockSlateProvider (Fix 7.2)",
    getSlateProvider() instanceof MockSlateProvider
  );
  check(
    "getWeatherProvider() is MockWeatherProvider",
    getWeatherProvider() instanceof MockWeatherProvider
  );
  check(
    "getParkFactorProvider() is MockParkFactorProvider",
    getParkFactorProvider() instanceof MockParkFactorProvider
  );
});

// ─── 2. Explicit "mock" value behaves the same as unset ───────────────────
withEnv(
  "2. Explicit *_PROVIDER=mock returns mock impls",
  {
    ODDS_PROVIDER: "mock",
    SHARP_SIGNAL_PROVIDER: "mock",
    PLAYER_STATS_PROVIDER: "mock",
    SLATE_PROVIDER: "mock",
    WEATHER_PROVIDER: "mock",
    PARK_FACTOR_PROVIDER: "mock",
  },
  () => {
    check("ODDS_PROVIDER=mock", getOddsProvider() instanceof MockOddsProvider);
    check(
      "SHARP_SIGNAL_PROVIDER=mock",
      getSharpSignalProvider() instanceof MockSharpSignalProvider
    );
    check(
      "PLAYER_STATS_PROVIDER=mock",
      getPlayerStatsProvider() instanceof MockPlayerStatsProvider
    );
    check(
      "SLATE_PROVIDER=mock (Fix 7.2)",
      getSlateProvider() instanceof MockSlateProvider
    );
    check(
      "WEATHER_PROVIDER=mock",
      getWeatherProvider() instanceof MockWeatherProvider
    );
    check(
      "PARK_FACTOR_PROVIDER=mock",
      getParkFactorProvider() instanceof MockParkFactorProvider
    );
  }
);

// ─── 2b. SLATE_PROVIDER=manual returns ManualSlateProvider (Fix 7.2) ──────
withEnv(
  "2b. SLATE_PROVIDER=manual returns ManualSlateProvider (Fix 7.2)",
  { SLATE_PROVIDER: "manual" },
  () => {
    check(
      "SLATE_PROVIDER=manual returns ManualSlateProvider instance",
      getSlateProvider() instanceof ManualSlateProvider
    );
  }
);

// ─── 3. "manual" throws notImplemented (Phase 7.25) ───────────────────────
function throwsWith(
  fn: () => unknown,
  substring: string
): { threw: boolean; message: string } {
  try {
    fn();
    return { threw: false, message: "" };
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return { threw: msg.includes(substring), message: msg };
  }
}

withEnv(
  "3. *_PROVIDER=manual throws notImplemented for Phase 7.25",
  { ODDS_PROVIDER: "manual" },
  () => {
    const r = throwsWith(getOddsProvider, "Phase 7.25");
    check("ODDS_PROVIDER=manual throws and mentions Phase 7.25", r.threw, r.message);
  }
);

withEnv(
  "    SHARP_SIGNAL_PROVIDER=manual",
  { SHARP_SIGNAL_PROVIDER: "manual" },
  () => {
    const r = throwsWith(getSharpSignalProvider, "Phase 7.25");
    check("SHARP_SIGNAL_PROVIDER=manual throws and mentions Phase 7.25", r.threw, r.message);
  }
);

withEnv(
  "    PLAYER_STATS_PROVIDER=manual",
  { PLAYER_STATS_PROVIDER: "manual" },
  () => {
    const r = throwsWith(getPlayerStatsProvider, "Phase 7.25");
    check(
      "PLAYER_STATS_PROVIDER=manual throws and mentions Phase 7.25",
      r.threw,
      r.message
    );
  }
);

withEnv(
  "    WEATHER_PROVIDER=manual",
  { WEATHER_PROVIDER: "manual" },
  () => {
    const r = throwsWith(getWeatherProvider, "Phase 7.25");
    check("WEATHER_PROVIDER=manual throws and mentions Phase 7.25", r.threw, r.message);
  }
);

withEnv(
  "    PARK_FACTOR_PROVIDER=manual",
  { PARK_FACTOR_PROVIDER: "manual" },
  () => {
    const r = throwsWith(getParkFactorProvider, "Phase 7.25");
    check(
      "PARK_FACTOR_PROVIDER=manual throws and mentions Phase 7.25",
      r.threw,
      r.message
    );
  }
);

// ─── 4. "real_api" — WEATHER + PARK_FACTOR still throw Phase 8 ────────────
// Gate B.1 Phase 1: ODDS / SHARP_SIGNAL / PLAYER_STATS / SLATE real_api
// branches are now wired to real providers (BallDontLie + SharpAPI).
// Coverage for the 4 wired branches lives in test-real-api-factory.ts.
// Here we assert only the still-unimplemented branches.
withEnv(
  "4. WEATHER_PROVIDER=real_api still throws notImplemented for Phase 8",
  { WEATHER_PROVIDER: "real_api" },
  () => {
    const r = throwsWith(getWeatherProvider, "Phase 8");
    check("WEATHER_PROVIDER=real_api throws and mentions Phase 8", r.threw, r.message);
  }
);

withEnv(
  "    PARK_FACTOR_PROVIDER=real_api still throws notImplemented for Phase 8",
  { PARK_FACTOR_PROVIDER: "real_api" },
  () => {
    const r = throwsWith(getParkFactorProvider, "Phase 8");
    check(
      "PARK_FACTOR_PROVIDER=real_api throws and mentions Phase 8",
      r.threw,
      r.message
    );
  }
);

// ─── 5. Unknown values fall back to mock (typo defense) ───────────────────
withEnv(
  "5. Unknown *_PROVIDER value (typo) falls back to mock",
  {
    ODDS_PROVIDER: "REAL_API", // wrong case
    SHARP_SIGNAL_PROVIDER: "true", // a bare "true" must NOT enable any real provider
    PLAYER_STATS_PROVIDER: "production",
    WEATHER_PROVIDER: "",
    PARK_FACTOR_PROVIDER: " manual ", // whitespace
  },
  () => {
    check(
      "ODDS_PROVIDER='REAL_API' (wrong case) → mock",
      getOddsProvider() instanceof MockOddsProvider
    );
    check(
      "SHARP_SIGNAL_PROVIDER='true' (legacy boolean) → mock",
      getSharpSignalProvider() instanceof MockSharpSignalProvider
    );
    check(
      "PLAYER_STATS_PROVIDER='production' → mock",
      getPlayerStatsProvider() instanceof MockPlayerStatsProvider
    );
    check(
      "WEATHER_PROVIDER='' (empty string) → mock",
      getWeatherProvider() instanceof MockWeatherProvider
    );
    check(
      "PARK_FACTOR_PROVIDER=' manual ' (whitespace) → mock",
      getParkFactorProvider() instanceof MockParkFactorProvider
    );
  }
);

// ─── 6. Singleton caching: repeated calls return the same instance ────────
withEnv("6. Singleton caching: same instance per process", {}, () => {
  const a1 = getOddsProvider();
  const a2 = getOddsProvider();
  check("getOddsProvider() returns same instance on repeat call", a1 === a2);

  const b1 = getSharpSignalProvider();
  const b2 = getSharpSignalProvider();
  check("getSharpSignalProvider() cached", b1 === b2);

  const c1 = getPlayerStatsProvider();
  const c2 = getPlayerStatsProvider();
  check("getPlayerStatsProvider() cached", c1 === c2);

  const c1s = getSlateProvider();
  const c2s = getSlateProvider();
  check("getSlateProvider() cached (Fix 7.2)", c1s === c2s);

  const d1 = getWeatherProvider();
  const d2 = getWeatherProvider();
  check("getWeatherProvider() cached", d1 === d2);

  const e1 = getParkFactorProvider();
  const e2 = getParkFactorProvider();
  check("getParkFactorProvider() cached", e1 === e2);
});

// ─── 7. __resetProviderCache() clears all 6 singletons ────────────────────
withEnv("7. __resetProviderCache() returns fresh instances afterwards", {}, () => {
  const before = {
    odds: getOddsProvider(),
    sharp: getSharpSignalProvider(),
    stats: getPlayerStatsProvider(),
    slate: getSlateProvider(),
    weather: getWeatherProvider(),
    park: getParkFactorProvider(),
  };
  __resetProviderCache();
  const after = {
    odds: getOddsProvider(),
    sharp: getSharpSignalProvider(),
    stats: getPlayerStatsProvider(),
    slate: getSlateProvider(),
    weather: getWeatherProvider(),
    park: getParkFactorProvider(),
  };
  check("odds reset", before.odds !== after.odds);
  check("sharp signal reset", before.sharp !== after.sharp);
  check("player stats reset", before.stats !== after.stats);
  check("slate reset (Fix 7.2)", before.slate !== after.slate);
  check("weather reset", before.weather !== after.weather);
  check("park factor reset", before.park !== after.park);
});

// ─── 8. Cross-getter isolation: changing one var doesn't disturb others ───
withEnv("8. Cross-getter isolation: changing ODDS_PROVIDER doesn't affect others", {}, () => {
  // Prime all 5 with the default (mock).
  const initialWeather = getWeatherProvider();
  const initialStats = getPlayerStatsProvider();

  // Now flip ODDS_PROVIDER to manual mid-test and confirm the others stay
  // on their cached mock instances — the factory caches independently.
  process.env.ODDS_PROVIDER = "manual";
  // Calling getOddsProvider here would throw — what matters is that the
  // other singletons are untouched.
  check(
    "WeatherProvider singleton unchanged after ODDS_PROVIDER change",
    getWeatherProvider() === initialWeather
  );
  check(
    "PlayerStatsProvider singleton unchanged after ODDS_PROVIDER change",
    getPlayerStatsProvider() === initialStats
  );
});

// ─── Summary ──────────────────────────────────────────────────────────────
console.log(`\n${"═".repeat(60)}`);
if (fail === 0) {
  console.log(`✅ All tests passed (${pass}/${pass})`);
  process.exit(0);
} else {
  console.log(`❌ ${fail} test(s) failed, ${pass} passed`);
  console.log("\nFailures:");
  for (const f of failures) console.log(f);
  process.exit(1);
}
