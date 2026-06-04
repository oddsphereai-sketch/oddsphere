/**
 * Gate B.1 Phase 1 — Offline tests for the 4 real_api factory branches
 * wired up in this phase, plus TeamNameNormalizer table coverage.
 *
 * Discipline:
 *   • No network calls — providers are constructed but no methods invoked
 *   • No DB writes — the makeSharpApiGameResolver closure exists but is
 *     never executed in these tests
 *   • Fake keys ("test-key") accepted — constructors don't call the API
 *
 * Run: npx tsx --env-file=.env.local scripts/test-real-api-factory.ts
 * Exit code: 0 on green, non-zero on failure.
 */

import {
  getOddsProvider,
  getSharpSignalProvider,
  getPlayerStatsProvider,
  getSlateProvider,
  __resetProviderCache,
} from "../lib/providers/factory";

import { BallDontLieProvider } from "../lib/providers/real_api/BallDontLieProvider";
import { BallDontLieSlateProvider } from "../lib/providers/real_api/BallDontLieSlateProvider";
import { SharpAPIOddsProvider } from "../lib/providers/real_api/SharpAPIOddsProvider";
import { SharpAPISignalProvider } from "../lib/providers/real_api/SharpAPISignalProvider";

import { normalizeMlbTeamName } from "../lib/providers/real_api/_teamNameNormalizer";
import { BdlClient } from "../lib/providers/real_api/_bdlClient";
import { SharpApiClient } from "../lib/providers/real_api/_sharpApiClient";

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
    "BALLDONTLIE_API_KEY",
    "SHARPAPI_KEY",
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

function throwsWith(
  fn: () => unknown,
  substring: string
): { threw: boolean; message: string } {
  try {
    fn();
    return { threw: false, message: "(no throw)" };
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return { threw: msg.includes(substring), message: msg };
  }
}

// ═══════════════════════════════════════════════════════════════
// 1. Factory wiring — real_api with valid key returns real provider
// ═══════════════════════════════════════════════════════════════

withEnv(
  "1. PLAYER_STATS_PROVIDER=real_api + key → BallDontLieProvider",
  {
    PLAYER_STATS_PROVIDER: "real_api",
    BALLDONTLIE_API_KEY: "test-key-bdl",
  },
  () => {
    const instance = getPlayerStatsProvider();
    check(
      "instance is BallDontLieProvider",
      instance instanceof BallDontLieProvider
    );
  }
);

withEnv(
  "    SLATE_PROVIDER=real_api + key → BallDontLieSlateProvider",
  {
    SLATE_PROVIDER: "real_api",
    BALLDONTLIE_API_KEY: "test-key-bdl",
  },
  () => {
    const instance = getSlateProvider();
    check(
      "instance is BallDontLieSlateProvider",
      instance instanceof BallDontLieSlateProvider
    );
  }
);

withEnv(
  "    ODDS_PROVIDER=real_api + key → SharpAPIOddsProvider",
  {
    ODDS_PROVIDER: "real_api",
    SHARPAPI_KEY: "test-key-sharp",
  },
  () => {
    const instance = getOddsProvider();
    check(
      "instance is SharpAPIOddsProvider",
      instance instanceof SharpAPIOddsProvider
    );
  }
);

withEnv(
  "    SHARP_SIGNAL_PROVIDER=real_api + key → SharpAPISignalProvider",
  {
    SHARP_SIGNAL_PROVIDER: "real_api",
    SHARPAPI_KEY: "test-key-sharp",
  },
  () => {
    const instance = getSharpSignalProvider();
    check(
      "instance is SharpAPISignalProvider",
      instance instanceof SharpAPISignalProvider
    );
  }
);

// ═══════════════════════════════════════════════════════════════
// 2. Friendly error when API key is missing for real_api mode
// ═══════════════════════════════════════════════════════════════

withEnv(
  "2. PLAYER_STATS_PROVIDER=real_api with NO key → throws referencing BALLDONTLIE_API_KEY",
  { PLAYER_STATS_PROVIDER: "real_api" },
  () => {
    const r = throwsWith(getPlayerStatsProvider, "BALLDONTLIE_API_KEY");
    check("throws and message references BALLDONTLIE_API_KEY", r.threw, r.message);
  }
);

withEnv(
  "    SLATE_PROVIDER=real_api with NO key → throws referencing BALLDONTLIE_API_KEY",
  { SLATE_PROVIDER: "real_api" },
  () => {
    const r = throwsWith(getSlateProvider, "BALLDONTLIE_API_KEY");
    check("throws and message references BALLDONTLIE_API_KEY", r.threw, r.message);
  }
);

withEnv(
  "    ODDS_PROVIDER=real_api with NO key → throws referencing SHARPAPI_KEY",
  { ODDS_PROVIDER: "real_api" },
  () => {
    const r = throwsWith(getOddsProvider, "SHARPAPI_KEY");
    check("throws and message references SHARPAPI_KEY", r.threw, r.message);
  }
);

withEnv(
  "    SHARP_SIGNAL_PROVIDER=real_api with NO key → throws referencing SHARPAPI_KEY",
  { SHARP_SIGNAL_PROVIDER: "real_api" },
  () => {
    const r = throwsWith(getSharpSignalProvider, "SHARPAPI_KEY");
    check("throws and message references SHARPAPI_KEY", r.threw, r.message);
  }
);

// ═══════════════════════════════════════════════════════════════
// 3. Singleton caching for real providers
// ═══════════════════════════════════════════════════════════════

withEnv(
  "3. Real providers are cached as singletons",
  {
    PLAYER_STATS_PROVIDER: "real_api",
    BALLDONTLIE_API_KEY: "test-key-bdl",
  },
  () => {
    const a1 = getPlayerStatsProvider();
    const a2 = getPlayerStatsProvider();
    check("getPlayerStatsProvider() returns same instance on repeat", a1 === a2);
  }
);

withEnv(
  "    SharpAPI providers are cached as singletons",
  {
    ODDS_PROVIDER: "real_api",
    SHARP_SIGNAL_PROVIDER: "real_api",
    SHARPAPI_KEY: "test-key-sharp",
  },
  () => {
    const o1 = getOddsProvider();
    const o2 = getOddsProvider();
    check("getOddsProvider() returns same instance on repeat", o1 === o2);
    const s1 = getSharpSignalProvider();
    const s2 = getSharpSignalProvider();
    check("getSharpSignalProvider() returns same instance on repeat", s1 === s2);
  }
);

// ═══════════════════════════════════════════════════════════════
// 4. Direct constructor inspection — confirm no network at construct
// ═══════════════════════════════════════════════════════════════

console.log("\n4. Direct constructor exercise — no network calls");
{
  const bdlClient = new BdlClient("test-key");
  check(
    "BdlClient constructor returns instance without network",
    bdlClient instanceof BdlClient
  );
  check(
    "BdlClient.getQuotaState() returns null fields initially",
    bdlClient.getQuotaState().limit === null &&
      bdlClient.getQuotaState().remaining === null
  );

  const sharpClient = new SharpApiClient("test-key");
  check(
    "SharpApiClient constructor returns instance without network",
    sharpClient instanceof SharpApiClient
  );
  check(
    "SharpApiClient.getQuotaState() returns null fields initially",
    sharpClient.getQuotaState().remaining === null
  );

  // Empty/invalid keys should throw at construction time.
  let bdlEmptyThrew = false;
  try {
    new BdlClient("");
  } catch {
    bdlEmptyThrew = true;
  }
  check("BdlClient throws on empty apiKey", bdlEmptyThrew);

  let sharpEmptyThrew = false;
  try {
    new SharpApiClient("");
  } catch {
    sharpEmptyThrew = true;
  }
  check("SharpApiClient throws on empty apiKey", sharpEmptyThrew);
}

// ═══════════════════════════════════════════════════════════════
// 5. TeamNameNormalizer — all 30 teams reachable, common variants covered
// ═══════════════════════════════════════════════════════════════

console.log("\n5. TeamNameNormalizer table coverage");

// Phase 4.2.C.1.R-16C — "Oakland Athletics" / "Athletics" / "Oakland"
// now normalize to ATH (post-2025 relocation; SharpAPI still emits the
// legacy team strings but our games table uses ATH). OAK is removed
// from the full-name round-trip set; the bare "OAK" → ATH case is
// tested below in the round-trip section.
const ALL_ABBREVS = [
  "ARI","ATL","BAL","BOS","CHC","CWS","CIN","CLE","COL","DET",
  "HOU","KC","LAA","LAD","MIA","MIL","MIN","NYM","NYY",
  "PHI","PIT","SD","SEA","SF","STL","TB","TEX","TOR","WSH",
] as const;

const FULL_NAMES: Record<typeof ALL_ABBREVS[number], string> = {
  ARI: "Arizona Diamondbacks",
  ATL: "Atlanta Braves",
  BAL: "Baltimore Orioles",
  BOS: "Boston Red Sox",
  CHC: "Chicago Cubs",
  CWS: "Chicago White Sox",
  CIN: "Cincinnati Reds",
  CLE: "Cleveland Guardians",
  COL: "Colorado Rockies",
  DET: "Detroit Tigers",
  HOU: "Houston Astros",
  KC: "Kansas City Royals",
  LAA: "Los Angeles Angels",
  LAD: "Los Angeles Dodgers",
  MIA: "Miami Marlins",
  MIL: "Milwaukee Brewers",
  MIN: "Minnesota Twins",
  NYM: "New York Mets",
  NYY: "New York Yankees",
  PHI: "Philadelphia Phillies",
  PIT: "Pittsburgh Pirates",
  SD: "San Diego Padres",
  SEA: "Seattle Mariners",
  SF: "San Francisco Giants",
  STL: "St. Louis Cardinals",
  TB: "Tampa Bay Rays",
  TEX: "Texas Rangers",
  TOR: "Toronto Blue Jays",
  WSH: "Washington Nationals",
};

for (const abbrev of ALL_ABBREVS) {
  const fullName = FULL_NAMES[abbrev];
  check(
    `"${fullName}" → ${abbrev}`,
    normalizeMlbTeamName(fullName) === abbrev
  );
}

// R-16C — Athletics franchise normalization (post-2025 relocation).
// SharpAPI keeps emitting legacy strings; our games table uses ATH.
check('"Oakland Athletics" → ATH (R-16C)', normalizeMlbTeamName("Oakland Athletics") === "ATH");
check('"Athletics" → ATH (R-16C)', normalizeMlbTeamName("Athletics") === "ATH");
check('"Oakland" → ATH (R-16C)', normalizeMlbTeamName("Oakland") === "ATH");
check('"OAK" → ATH (legacy abbreviation routes to canonical)', normalizeMlbTeamName("OAK") === "ATH");
check('"ATH" → ATH (round-trip)', normalizeMlbTeamName("ATH") === "ATH");
check('"Sacramento Athletics" → ATH', normalizeMlbTeamName("Sacramento Athletics") === "ATH");
check('"Las Vegas Athletics" → ATH', normalizeMlbTeamName("Las Vegas Athletics") === "ATH");

// Nickname-only variants
check('"Yankees" → NYY', normalizeMlbTeamName("Yankees") === "NYY");
check('"Mets" → NYM', normalizeMlbTeamName("Mets") === "NYM");
check('"Red Sox" → BOS', normalizeMlbTeamName("Red Sox") === "BOS");
check('"White Sox" → CWS', normalizeMlbTeamName("White Sox") === "CWS");
check('"Rays" → TB', normalizeMlbTeamName("Rays") === "TB");
check('"Cardinals" → STL', normalizeMlbTeamName("Cardinals") === "STL");

// Whitespace / case
check('"  yankees  " → NYY (trim+lowercase)', normalizeMlbTeamName("  yankees  ") === "NYY");
check('"BOSTON RED SOX" → BOS (uppercase)', normalizeMlbTeamName("BOSTON RED SOX") === "BOS");

// Abbreviation round-trip
check('"NYY" → NYY (round-trip)', normalizeMlbTeamName("NYY") === "NYY");
check('"BOS" → BOS (round-trip)', normalizeMlbTeamName("BOS") === "BOS");

// Unmatched returns null — no best-guess
check('"Unknown FC" → null', normalizeMlbTeamName("Unknown FC") === null);
check('"" → null', normalizeMlbTeamName("") === null);
check('"   " → null (whitespace only)', normalizeMlbTeamName("   ") === null);
check("undefined → null", normalizeMlbTeamName(undefined) === null);
check("123 (number) → null", normalizeMlbTeamName(123 as unknown) === null);

// Ambiguity guard
check('"NY" → null (ambiguous Yankees/Mets)', normalizeMlbTeamName("NY") === null);

// ═══════════════════════════════════════════════════════════════
// Summary
// ═══════════════════════════════════════════════════════════════

console.log(`\n${"═".repeat(60)}`);
if (fail === 0) {
  console.log(`✅ All real_api factory tests passed (${pass}/${pass})`);
  process.exit(0);
} else {
  console.log(`❌ ${fail} test(s) failed, ${pass} passed`);
  console.log("\nFailures:");
  for (const f of failures) console.log(f);
  process.exit(1);
}
