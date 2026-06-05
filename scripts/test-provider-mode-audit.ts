/**
 * Phase 4.2.C.1.R-17 Step 2C — pure unit tests for
 * `providerModeAudit.assessProviderModes`.
 *
 * Fixtures only — passes a stub env object so tests don't depend on
 * the shell environment. Covers classification, eligibility, blocking-
 * providers list, and reason-string content.
 *
 * Run: npx tsx scripts/test-provider-mode-audit.ts
 */

import {
  assessProviderModes,
  classifyProviderMode,
  providersEligibleForApply,
  REQUIRED_PROVIDER_KEYS,
} from "../lib/services/providerModeAudit";

let pass = 0;
let fail = 0;
const failures: string[] = [];

function check(label: string, cond: boolean, hint?: string) {
  if (cond) {
    pass++;
    console.log(`  ✓ ${label}`);
  } else {
    fail++;
    const m = `  ✗ ${label}${hint ? ` — ${hint}` : ""}`;
    console.log(m);
    failures.push(m);
  }
}

function section(t: string) {
  console.log(`\n━━━ ${t} ━━━`);
}

const ALL_REAL: Record<string, string> = {
  SLATE_PROVIDER: "real_api",
  ODDS_PROVIDER: "real_api",
  SHARP_SIGNAL_PROVIDER: "real_api",
  PLAYER_STATS_PROVIDER: "real_api",
};

function main() {
  section("classifyProviderMode");
  check("undefined → unset", classifyProviderMode(undefined) === "unset");
  check("empty string → unset", classifyProviderMode("") === "unset");
  check("whitespace → unset", classifyProviderMode("   ") === "unset");
  check("'real_api' → real_api", classifyProviderMode("real_api") === "real_api");
  check("'mock' → mock", classifyProviderMode("mock") === "mock");
  check("'manual' → manual", classifyProviderMode("manual") === "manual");
  check("'REAL_API' uppercase → unknown (case-sensitive)", classifyProviderMode("REAL_API") === "unknown");
  check("'real-api' hyphen → unknown", classifyProviderMode("real-api") === "unknown");
  check("'sharpapi' typo → unknown", classifyProviderMode("sharpapi") === "unknown");
  check("trimmed 'real_api  ' → real_api", classifyProviderMode("  real_api  ") === "real_api");

  section("assessProviderModes — happy path: all real_api → eligible");
  {
    const r = assessProviderModes(ALL_REAL);
    check("eligibleForApply = true", r.eligibleForApply === true);
    check("blockingProviders empty", r.blockingProviders.length === 0);
    check("modes has 4 entries", r.modes.length === 4);
    check(
      "all 4 modes report real_api",
      r.modes.every((m) => m.status === "real_api")
    );
    check(
      "reason mentions apply-eligible",
      r.reason.toLowerCase().includes("apply eligible")
    );
  }

  section("assessProviderModes — empty env → all unset, blocked");
  {
    const r = assessProviderModes({});
    check("eligibleForApply = false", r.eligibleForApply === false);
    check("all 4 are unset", r.modes.every((m) => m.status === "unset"));
    check("blockingProviders has 4", r.blockingProviders.length === 4);
    check(
      "reason calls out apply blocked",
      r.reason.toLowerCase().includes("apply blocked")
    );
    check(
      "reason lists SLATE_PROVIDER=unset",
      r.reason.includes("SLATE_PROVIDER=unset")
    );
  }

  section("assessProviderModes — one mock breaks eligibility (each provider)");
  for (const provider of REQUIRED_PROVIDER_KEYS) {
    const env: Record<string, string> = { ...ALL_REAL };
    env[provider.envKey] = "mock";
    const r = assessProviderModes(env);
    check(
      `${provider.envKey}=mock → eligibleForApply = false`,
      r.eligibleForApply === false
    );
    check(
      `${provider.envKey}=mock → blocking includes ${provider.envKey}`,
      r.blockingProviders.some(
        (b) => b.envKey === provider.envKey && b.status === "mock"
      )
    );
    check(
      `${provider.envKey}=mock → other 3 providers still real_api`,
      r.modes.filter((m) => m.status === "real_api").length === 3
    );
  }

  section("assessProviderModes — one unset breaks eligibility (each provider)");
  for (const provider of REQUIRED_PROVIDER_KEYS) {
    const env: Record<string, string | undefined> = { ...ALL_REAL };
    env[provider.envKey] = undefined;
    const r = assessProviderModes(env);
    check(
      `${provider.envKey}=unset → eligibleForApply = false`,
      r.eligibleForApply === false
    );
    check(
      `${provider.envKey}=unset → blocking marks it 'unset'`,
      r.blockingProviders.some(
        (b) => b.envKey === provider.envKey && b.status === "unset"
      )
    );
  }

  section("assessProviderModes — 'manual' mode also blocks (not real_api)");
  {
    const env: Record<string, string> = { ...ALL_REAL, ODDS_PROVIDER: "manual" };
    const r = assessProviderModes(env);
    check("manual mode → not eligible", r.eligibleForApply === false);
    check(
      "manual mode → blocking entry has status='manual'",
      r.blockingProviders.some(
        (b) => b.envKey === "ODDS_PROVIDER" && b.status === "manual"
      )
    );
  }

  section("assessProviderModes — unknown typo blocks");
  {
    const env: Record<string, string> = {
      ...ALL_REAL,
      SHARP_SIGNAL_PROVIDER: "shparapi", // typo
    };
    const r = assessProviderModes(env);
    check("typo → not eligible", r.eligibleForApply === false);
    check(
      "typo → blocking status='unknown'",
      r.blockingProviders.some(
        (b) => b.envKey === "SHARP_SIGNAL_PROVIDER" && b.status === "unknown"
      )
    );
  }

  section("assessProviderModes — mixed: some real, some not");
  {
    const env = {
      SLATE_PROVIDER: "real_api",
      ODDS_PROVIDER: "mock",
      SHARP_SIGNAL_PROVIDER: "real_api",
      PLAYER_STATS_PROVIDER: undefined,
    } as Record<string, string | undefined>;
    const r = assessProviderModes(env);
    check("mixed → eligible = false", r.eligibleForApply === false);
    check("mixed → 2 blocking", r.blockingProviders.length === 2);
    check(
      "mixed → ODDS_PROVIDER blocked as mock",
      r.blockingProviders.some(
        (b) => b.envKey === "ODDS_PROVIDER" && b.status === "mock"
      )
    );
    check(
      "mixed → PLAYER_STATS_PROVIDER blocked as unset",
      r.blockingProviders.some(
        (b) => b.envKey === "PLAYER_STATS_PROVIDER" && b.status === "unset"
      )
    );
    check(
      "reason lists both blockers",
      r.reason.includes("ODDS_PROVIDER=mock") &&
        r.reason.includes("PLAYER_STATS_PROVIDER=unset")
    );
  }

  section("REQUIRED_PROVIDER_KEYS — sanity");
  {
    check("4 required providers", REQUIRED_PROVIDER_KEYS.length === 4);
    const keys = REQUIRED_PROVIDER_KEYS.map((p) => p.envKey);
    check("includes SLATE_PROVIDER", keys.includes("SLATE_PROVIDER"));
    check("includes ODDS_PROVIDER", keys.includes("ODDS_PROVIDER"));
    check(
      "includes SHARP_SIGNAL_PROVIDER",
      keys.includes("SHARP_SIGNAL_PROVIDER")
    );
    check(
      "includes PLAYER_STATS_PROVIDER",
      keys.includes("PLAYER_STATS_PROVIDER")
    );
    check(
      "does NOT include WEATHER_PROVIDER (read-only, deferred)",
      !keys.includes("WEATHER_PROVIDER" as never)
    );
  }

  section("providersEligibleForApply convenience predicate");
  {
    check("all real → true", providersEligibleForApply(ALL_REAL) === true);
    check(
      "any mock → false",
      providersEligibleForApply({ ...ALL_REAL, ODDS_PROVIDER: "mock" }) === false
    );
    check(
      "empty env → false",
      providersEligibleForApply({}) === false
    );
  }

  // ── Summary ──────────────────────────────────────────────────────
  console.log(`\n${"━".repeat(70)}`);
  console.log(`  ${pass} pass · ${fail} fail · ${pass + fail} total`);
  if (fail > 0) {
    console.log(`\nFailures:`);
    failures.forEach((m) => console.log(m));
    process.exit(1);
  }
  console.log(`\n✅ All provider-mode-audit tests passed.`);
}

main();
