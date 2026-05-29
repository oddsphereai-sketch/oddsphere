/**
 * Gate B.1 Phase 1 — Live integration smoke for SharpAPIOddsProvider +
 * SharpAPISignalProvider.
 *
 * Gated on SHARPAPI_KEY. When the key is missing, the test exits 0 with a
 * "skipped" message — CI-friendly behavior.
 *
 * Hard call budget: 8 API calls (well below the observed 1000/window
 * quota).
 *
 * Discipline:
 *   • Read-only — no DB writes
 *   • Uses a MOCK GAME RESOLVER — never touches the production DB.
 *     The mock resolver returns a deterministic external_id for every
 *     team-pair so we can exercise the provider's mapping logic without
 *     depending on the slate state in `games`.
 *
 * Run: npx tsx --env-file=.env.local scripts/test-sharpapi-provider.ts
 */

import { SharpAPIOddsProvider } from "../lib/providers/real_api/SharpAPIOddsProvider";
import { SharpAPISignalProvider } from "../lib/providers/real_api/SharpAPISignalProvider";
import { SharpApiAuthError } from "../lib/providers/real_api/_sharpApiClient";
import type { MlbTeamAbbrev } from "../lib/providers/real_api/_teamNameNormalizer";
import type { Sport } from "../lib/types/domain/Sport";

const KEY = process.env.SHARPAPI_KEY;
if (!KEY || KEY.length === 0) {
  console.log(
    "[test-sharpapi-provider] SHARPAPI_KEY missing — skipping live integration tests"
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

/**
 * Mock game resolver — deterministic mapping from (home, away) → unique
 * external_id. Lets the provider's resolution flow execute without DB
 * dependency.
 *
 * Records which team pairs were queried so we can assert the provider
 * actually invoked the resolver (i.e., events were filtered through the
 * natural-key bridge as designed).
 */
function makeMockResolver() {
  const seen: Array<{ sport: Sport; date: string; home: string; away: string }> =
    [];
  function abbrevToCode(a: string): number {
    let h = 0;
    for (let i = 0; i < a.length; i++) h = (h * 31 + a.charCodeAt(i)) >>> 0;
    return h;
  }
  return {
    resolver: async (
      sport: Sport,
      date: string,
      homeAbbrev: MlbTeamAbbrev,
      awayAbbrev: MlbTeamAbbrev
    ): Promise<number | null> => {
      seen.push({ sport, date, home: homeAbbrev, away: awayAbbrev });
      // Deterministic 9-digit external_id derived from the team pair.
      return 900_000_000 + (abbrevToCode(`${homeAbbrev}|${awayAbbrev}`) % 99_000_000);
    },
    seen,
  };
}

async function main() {
  const today = new Date().toISOString().slice(0, 10);
  const t0 = Date.now();

  // ───────────────────────────────────────────────────────────
  // SharpAPIOddsProvider
  // ───────────────────────────────────────────────────────────
  section("SharpAPIOddsProvider");

  const oddsMock = makeMockResolver();
  const oddsProvider = new SharpAPIOddsProvider(KEY!, oddsMock.resolver);

  try {
    const lines = await oddsProvider.getGameLines(today, "mlb");
    check(
      `getGameLines(today='${today}') returns an array (got ${lines.length} lines)`,
      Array.isArray(lines)
    );
    if (lines.length > 0) {
      const sample = lines[0]!;
      check(
        "first line has game_external_id (resolver-supplied)",
        typeof sample.game_external_id === "number" &&
          sample.game_external_id >= 900_000_000
      );
      check(
        "first line has player_external_id = null (game line, not prop)",
        sample.player_external_id === null
      );
      check(
        "first line has market_type in {moneyline, total, spread, first_inning_total}",
        ["moneyline", "total", "spread", "first_inning_total"].includes(
          String(sample.market_type)
        )
      );
      check(
        "first line has side in {home, away, over, under, yes, no}",
        sample.side === null ||
          ["home", "away", "over", "under", "yes", "no"].includes(
            String(sample.side)
          )
      );
      check(
        "first line has sportsbook string (lowercase)",
        typeof sample.sportsbook === "string" &&
          sample.sportsbook === sample.sportsbook.toLowerCase()
      );
      check(
        "first line has fetched_at ISO string",
        typeof sample.fetched_at === "string" &&
          !Number.isNaN(Date.parse(sample.fetched_at))
      );
    }
    // Resolver invoked at least once if any events came back from /events
    // and matched our normalizer table. Soft check — slate may be empty.
    if (oddsMock.seen.length > 0) {
      check(
        `resolver invoked ${oddsMock.seen.length} times (bridge exercised)`,
        true
      );
    } else {
      console.log(
        "  ! resolver was not invoked — likely empty SharpAPI slate or no recognizable teams"
      );
    }
  } catch (e) {
    if (e instanceof SharpApiAuthError) {
      console.log(`  ✗ SharpAPI auth failed — ${e.message}`);
      process.exit(1);
    }
    console.log(`  ✗ getGameLines error — ${e instanceof Error ? e.message : String(e)}`);
    fail++;
  }

  // V1 stub: getPlayerProps → []
  try {
    const props = await oddsProvider.getPlayerProps(today, "mlb");
    check("getPlayerProps(today, 'mlb') returns [] (V1 stub)", props.length === 0);
  } catch (e) {
    console.log(`  ✗ getPlayerProps error — ${e instanceof Error ? e.message : String(e)}`);
    fail++;
  }

  // Non-mlb sport returns []
  try {
    const empty = await oddsProvider.getGameLines(today, "nba");
    check("getGameLines(today, 'nba') returns [] (sport gate)", empty.length === 0);
  } catch (e) {
    console.log(`  ✗ getGameLines(nba) error — ${e instanceof Error ? e.message : String(e)}`);
    fail++;
  }

  // ───────────────────────────────────────────────────────────
  // SharpAPISignalProvider
  // ───────────────────────────────────────────────────────────
  section("SharpAPISignalProvider");

  const signalMock = makeMockResolver();
  const signalProvider = new SharpAPISignalProvider(KEY!, signalMock.resolver);

  try {
    const signals = await signalProvider.getSharpSignals(today);
    check(
      `getSharpSignals(today='${today}') returns an array (got ${signals.length} signals)`,
      Array.isArray(signals)
    );

    // STRICT NULL DISCIPLINE — every row must have NULL on the gap fields
    // and false (not null) on the boolean steam/RLM flags.
    let allNullDisciplineHeld = true;
    let allBooleanDisciplineHeld = true;
    for (const s of signals) {
      if (s.steam_detected_at !== null) allNullDisciplineHeld = false;
      if (s.steam_books_count !== null) allNullDisciplineHeld = false;
      if (s.rlm_direction !== null) allNullDisciplineHeld = false;
      if (s.public_betting_pct !== null) allNullDisciplineHeld = false;
      if (s.public_money_pct !== null) allNullDisciplineHeld = false;
      if (s.signal_strength !== null) allNullDisciplineHeld = false;
      if (s.signal_summary !== null) allNullDisciplineHeld = false;
      if (s.has_steam_move !== false) allBooleanDisciplineHeld = false;
      if (s.has_reverse_line_movement !== false) allBooleanDisciplineHeld = false;
    }
    check(
      "STRICT NULL: steam_detected_at, steam_books_count, rlm_direction, public_betting_pct, public_money_pct, signal_strength, signal_summary all null on every row",
      allNullDisciplineHeld
    );
    check(
      "STRICT BOOL: has_steam_move=false and has_reverse_line_movement=false on every row (SharpAPI does not expose these)",
      allBooleanDisciplineHeld
    );

    if (signals.length > 0) {
      const sample = signals[0]!;
      check(
        "first signal has game_external_id (resolver-supplied)",
        typeof sample.game_external_id === "number" &&
          sample.game_external_id >= 900_000_000
      );
      check(
        "first signal has market_type in supported set",
        ["moneyline", "total", "spread", "first_inning_total"].includes(
          String(sample.market_type)
        )
      );
      check(
        "first signal has side in supported set",
        ["home", "away", "over", "under", "yes", "no"].includes(
          String(sample.side)
        )
      );
      check(
        "first signal has computed_at ISO string",
        typeof sample.computed_at === "string" &&
          !Number.isNaN(Date.parse(sample.computed_at))
      );
      // is_plus_ev should be true for /opportunities/ev rows and false for
      // the secondary endpoints. At least ONE row should have is_plus_ev=true
      // (assuming the slate has any +EV opportunities today).
      const evRows = signals.filter((s) => s.is_plus_ev === true);
      console.log(
        `  ! +EV rows: ${evRows.length} / ${signals.length} (low_hold/arbitrage rows have is_plus_ev=false)`
      );
    }

    // Dedup invariant: every (game, market, side) triple is unique.
    const triples = new Set<string>();
    let dupeFound = false;
    for (const s of signals) {
      const key = `${s.game_external_id}|${s.market_type}|${s.side}`;
      if (triples.has(key)) dupeFound = true;
      triples.add(key);
    }
    check(
      "dedup invariant: no two rows share (game_external_id, market_type, side)",
      !dupeFound
    );
  } catch (e) {
    if (e instanceof SharpApiAuthError) {
      console.log(`  ✗ SharpAPI auth failed — ${e.message}`);
      process.exit(1);
    }
    console.log(`  ✗ getSharpSignals error — ${e instanceof Error ? e.message : String(e)}`);
    fail++;
  }

  // ───────────────────────────────────────────────────────────
  // Quota
  // ───────────────────────────────────────────────────────────
  section("Quota observations");
  const oddsQuota = oddsProvider.getClient().getQuotaState();
  const signalQuota = signalProvider.getClient().getQuotaState();
  console.log(`  odds client quota:   ${JSON.stringify(oddsQuota)}`);
  console.log(`  signal client quota: ${JSON.stringify(signalQuota)}`);
  check(
    "at least one client observed a numeric quota limit",
    oddsQuota.limit !== null || signalQuota.limit !== null
  );

  const elapsed = ((Date.now() - t0) / 1000).toFixed(1);
  console.log(`\n${"═".repeat(60)}`);
  console.log(`Live SharpAPI smoke completed in ${elapsed}s`);
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
