/**
 * Gate B.1 Phase 1 — Live integration smoke for BallDontLieProvider +
 * BallDontLieSlateProvider.
 *
 * Gated on BALLDONTLIE_API_KEY. When the key is missing, the test exits 0
 * with a "skipped" message — CI-friendly behavior.
 *
 * Hard call budget: 12 API calls. Well below the observed 600/window
 * GOAT-tier quota.
 *
 * Discipline:
 *   • Read-only — no DB writes
 *   • No mutations to existing rows
 *   • Quota observations are reported in the summary
 *
 * Run: npx tsx --env-file=.env.local scripts/test-bdl-provider.ts
 */

import { BallDontLieProvider } from "../lib/providers/real_api/BallDontLieProvider";
import { BallDontLieSlateProvider } from "../lib/providers/real_api/BallDontLieSlateProvider";
import { BdlAuthError } from "../lib/providers/real_api/_bdlClient";

const KEY = process.env.BALLDONTLIE_API_KEY;
if (!KEY || KEY.length === 0) {
  console.log(
    "[test-bdl-provider] BALLDONTLIE_API_KEY missing — skipping live integration tests"
  );
  process.exit(0);
}

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

function section(label: string) {
  console.log(`\n━━━ ${label} ━━━`);
}

async function main() {
  const statsProvider = new BallDontLieProvider(KEY!);
  const slateProvider = new BallDontLieSlateProvider(KEY!);
  const t0 = Date.now();

  // ───────────────────────────────────────────────────────────
  // Slate provider — teams + games
  // ───────────────────────────────────────────────────────────
  section("BallDontLieSlateProvider");

  try {
    const teams = await slateProvider.getTeams("mlb");
    check(
      `getTeams('mlb') returns ≥ 25 teams (got ${teams.length})`,
      teams.length >= 25
    );
    check(
      "first team has external_id + abbreviation",
      teams.length > 0 &&
        typeof teams[0]!.external_id === "number" &&
        typeof teams[0]!.abbreviation === "string"
    );
    check(
      "first team has provider_ids.balldontlie",
      teams.length > 0 &&
        teams[0]!.provider_ids.balldontlie === teams[0]!.external_id
    );
  } catch (e) {
    if (e instanceof BdlAuthError) {
      console.log(`  ✗ BDL auth failed — ${e.message}`);
      process.exit(1);
    }
    throw e;
  }

  let sampleTeamExternalId = 1;
  try {
    const teams = await slateProvider.getTeams("mlb");
    const yankees = teams.find((t) => t.abbreviation === "NYY");
    if (yankees) sampleTeamExternalId = yankees.external_id;
  } catch {
    // already reported above
  }

  // getGames on today is fragile (depends on schedule); we just assert
  // the shape of the response and don't require non-empty.
  const today = new Date().toISOString().slice(0, 10);
  try {
    const games = await slateProvider.getGames(today, "mlb");
    check(
      `getGames(today='${today}') returns an array (got ${games.length} games)`,
      Array.isArray(games)
    );
    if (games.length > 0) {
      const g = games[0]!;
      check(
        "first game has external_id + sport='mlb'",
        typeof g.external_id === "number" && g.sport === "mlb"
      );
      check(
        "first game has slate_status='draft'",
        g.slate_status === "draft"
      );
      check(
        "first game has provider_ids.balldontlie",
        g.provider_ids.balldontlie === g.external_id
      );
    }
  } catch (e) {
    console.log(`  ✗ getGames error — ${e instanceof Error ? e.message : String(e)}`);
    fail++;
  }

  // Cross-sport filter — non-mlb sport returns []
  try {
    const empty = await slateProvider.getGames(today, "nba");
    check("getGames(today, 'nba') returns [] (sport gate)", empty.length === 0);
  } catch (e) {
    console.log(`  ✗ getGames(nba) error — ${e instanceof Error ? e.message : String(e)}`);
    fail++;
  }

  // ───────────────────────────────────────────────────────────
  // Player stats provider
  // ───────────────────────────────────────────────────────────
  section("BallDontLieProvider");

  let samplePlayerExternalId: number | null = null;
  try {
    const players = await statsProvider.getPlayers(sampleTeamExternalId);
    check(
      `getPlayers(team=${sampleTeamExternalId}) returns ≥ 5 players (got ${players.length})`,
      players.length >= 5
    );
    if (players.length > 0) {
      const p = players[0]!;
      check(
        "first player has external_id, full_name, sport='mlb'",
        typeof p.external_id === "number" &&
          typeof p.full_name === "string" &&
          p.sport === "mlb"
      );
      check(
        "first player has provider_ids.balldontlie",
        p.provider_ids.balldontlie === p.external_id
      );
      samplePlayerExternalId = p.external_id;
    }
  } catch (e) {
    console.log(`  ✗ getPlayers error — ${e instanceof Error ? e.message : String(e)}`);
    fail++;
  }

  // getPlayer(known_id) → returns same shape
  if (samplePlayerExternalId !== null) {
    try {
      const p = await statsProvider.getPlayer(samplePlayerExternalId);
      check(
        `getPlayer(${samplePlayerExternalId}) returns a record`,
        p !== null
      );
      if (p !== null) {
        check(
          "bats and throws fields present (handedness coverage)",
          (p.bats === null || ["L", "R", "S"].includes(p.bats)) &&
            (p.throws === null || ["L", "R"].includes(p.throws))
        );
      }
    } catch (e) {
      console.log(`  ✗ getPlayer error — ${e instanceof Error ? e.message : String(e)}`);
      fail++;
    }
  }

  // getPlayer with garbage id → returns null (NotFound translated)
  try {
    const ghost = await statsProvider.getPlayer(9_999_999);
    check("getPlayer(9999999) returns null (NotFound → null)", ghost === null);
  } catch (e) {
    // Accept either null OR a clean BdlClientError — BDL may behave either way.
    console.log(
      `  ! getPlayer(9999999) threw (acceptable): ${
        e instanceof Error ? e.message : String(e)
      }`
    );
  }

  // getInjuries
  try {
    const injuries = await statsProvider.getInjuries("mlb");
    check(
      `getInjuries('mlb') returns an array (got ${injuries.length})`,
      Array.isArray(injuries)
    );
    if (injuries.length > 0) {
      const inj = injuries[0]!;
      check(
        "first injury has player_external_id + is_active=true",
        typeof inj.player_external_id === "number" && inj.is_active === true
      );
    }
  } catch (e) {
    console.log(`  ✗ getInjuries error — ${e instanceof Error ? e.message : String(e)}`);
    fail++;
  }

  // ───────────────────────────────────────────────────────────
  // Quota observation
  // ───────────────────────────────────────────────────────────
  section("Quota observations");
  const quotaStats = statsProvider.getClient().getQuotaState();
  const quotaSlate = slateProvider.getClient().getQuotaState();
  console.log(`  stats client quota: ${JSON.stringify(quotaStats)}`);
  console.log(`  slate client quota: ${JSON.stringify(quotaSlate)}`);
  check(
    "at least one client observed a numeric quota limit",
    quotaStats.limit !== null || quotaSlate.limit !== null
  );

  const elapsed = ((Date.now() - t0) / 1000).toFixed(1);
  console.log(`\n${"═".repeat(60)}`);
  console.log(`Live BDL smoke completed in ${elapsed}s`);
  if (fail === 0) {
    console.log(`✅ All tests passed (${pass}/${pass})`);
    process.exit(0);
  } else {
    console.log(`❌ ${fail} test(s) failed, ${pass} passed`);
    console.log("\nFailures:");
    for (const f of failures) console.log(f);
    process.exit(1);
  }
}

main().catch((e) => {
  console.error("Unhandled error:", e);
  process.exit(1);
});
