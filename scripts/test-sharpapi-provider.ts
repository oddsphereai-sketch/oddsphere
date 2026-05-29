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
import {
  SharpAPISignalProvider,
  __TEST__ as SignalProviderTest,
} from "../lib/providers/real_api/SharpAPISignalProvider";
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
  // Phase 1.6 — Offline helper assertions (no network)
  // ───────────────────────────────────────────────────────────
  section("Phase 1.6 — offline helpers (stripEventBucketSuffix, splits maps, public pcts)");

  check(
    'stripEventBucketSuffix strips "_b0" suffix',
    SignalProviderTest.stripEventBucketSuffix(
      "mlb_marlins_mets_2026-05-29_b0"
    ) === "mlb_marlins_mets_2026-05-29"
  );
  check(
    'stripEventBucketSuffix strips "_b3" suffix',
    SignalProviderTest.stripEventBucketSuffix(
      "mlb_rangers_royals_2026-05-29_b3"
    ) === "mlb_rangers_royals_2026-05-29"
  );
  check(
    "stripEventBucketSuffix passes through event_ids without a _b suffix",
    SignalProviderTest.stripEventBucketSuffix(
      "mlb_diamondbacks_mariners_2026-05-29"
    ) === "mlb_diamondbacks_mariners_2026-05-29"
  );
  check(
    "stripEventBucketSuffix does not strip a non-numeric tail",
    SignalProviderTest.stripEventBucketSuffix("mlb_yankees_redsox_2026-05-29_baz") ===
      "mlb_yankees_redsox_2026-05-29_baz"
  );

  // buildSplitsMap — team-pair lookup excludes non-mlb leagues and
  // unresolvable team strings.
  {
    const fakeRows = [
      {
        event_id: "mlb_marlins_mets_2026-05-29",
        sport: "baseball",
        league: "mlb",
        home_team: "New York Mets",
        away_team: "Miami Marlins",
        moneyline: { bets_pct: { home: 0.68, away: 0.32 } },
      },
      {
        event_id: "kbo_doosan_lg_2026-05-29",
        sport: "baseball",
        league: "kbo",
        home_team: "Doosan",
        away_team: "LG Twins",
      },
      {
        event_id: "mlb_unknown_unknown_2026-05-29",
        sport: "baseball",
        league: "mlb",
        home_team: "Unknown Team",
        away_team: "Other Unknown",
      },
    ];
    const m = SignalProviderTest.buildSplitsMap(fakeRows);
    check(
      "buildSplitsMap keys real MLB games by 'home|away' abbrev pair",
      m.has("NYM|MIA")
    );
    check(
      "buildSplitsMap drops non-MLB league rows (kbo)",
      !m.has("LG|DOOSAN") && !Array.from(m.keys()).some((k) => k.includes("DOOSAN"))
    );
    check(
      "buildSplitsMap drops rows with unresolvable team strings",
      m.size === 1
    );
  }

  // publicPctsFromSplits — exercises every market × side path plus the
  // first_inning_total skip rule.
  {
    const splitsRow = {
      event_id: "mlb_marlins_mets_2026-05-29",
      league: "mlb",
      home_team: "New York Mets",
      away_team: "Miami Marlins",
      moneyline: {
        bets_pct: { home: 0.68, away: 0.32 },
        handle_pct: { home: 0.47, away: 0.53 },
      },
      spread: {
        bets_pct: { home: 0.36, away: 0.64 },
        handle_pct: { home: 0.96, away: 0.04 },
      },
      total: {
        bets_pct: { over: 0.79, under: 0.21 },
        handle_pct: { over: 0.74, under: 0.26 },
      },
    };
    const ml = SignalProviderTest.publicPctsFromSplits("moneyline", "home", splitsRow);
    check(
      "publicPctsFromSplits(moneyline, home) returns 0-1 floats × 100 as 0-100 numbers",
      ml.betting === 68 && ml.money === 47
    );
    const mlAway = SignalProviderTest.publicPctsFromSplits("moneyline", "away", splitsRow);
    check(
      "publicPctsFromSplits(moneyline, away) reads the right side",
      mlAway.betting === 32 && mlAway.money === 53
    );
    const spreadHome = SignalProviderTest.publicPctsFromSplits("spread", "home", splitsRow);
    check(
      "publicPctsFromSplits(spread, home) reads spread.bets_pct.home + handle_pct.home",
      spreadHome.betting === 36 && spreadHome.money === 96
    );
    const totalOver = SignalProviderTest.publicPctsFromSplits("total", "over", splitsRow);
    check(
      "publicPctsFromSplits(total, over) reads total.bets_pct.over + handle_pct.over",
      totalOver.betting === 79 && totalOver.money === 74
    );
    const firstInning = SignalProviderTest.publicPctsFromSplits(
      "first_inning_total",
      "under",
      splitsRow
    );
    check(
      "publicPctsFromSplits(first_inning_total, *) returns nulls — no first-inning splits in V1",
      firstInning.betting === null && firstInning.money === null
    );
    // Missing market — handle_pct only, no bets_pct.
    const partial = SignalProviderTest.publicPctsFromSplits(
      "total",
      "over",
      { home_team: "x", away_team: "y", total: { handle_pct: { over: 0.6 } } }
    );
    check(
      "publicPctsFromSplits handles missing bets_pct gracefully",
      partial.betting === null && partial.money === 60
    );
    // Completely absent market on the splits row
    const noTotal = SignalProviderTest.publicPctsFromSplits(
      "total",
      "over",
      { home_team: "x", away_team: "y" }
    );
    check(
      "publicPctsFromSplits returns null/null when the requested market is absent on the splits row",
      noTotal.betting === null && noTotal.money === null
    );
  }

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
    // Phase 1.5 (Task #162): Provider now uses /opportunities/ev for
    // event discovery. The resolver MUST be invoked at least once when
    // there are any +EV MLB opportunities on today's slate. Empty-slate
    // case (no +EV opps today) is acceptable but reported as a soft warn.
    if (oddsMock.seen.length > 0) {
      check(
        `resolver invoked ${oddsMock.seen.length} unique event(s) (bridge exercised via /opportunities/ev)`,
        true
      );
      // Each resolver invocation should have been for league=mlb only.
      const allMlb = oddsMock.seen.every(
        (s) => s.sport === "mlb"
      );
      check(
        `every resolver call was sport=mlb (league filter held)`,
        allMlb
      );
      // Resolved abbreviations should be uppercase 2-3 letter codes.
      const allValidAbbrevs = oddsMock.seen.every(
        (s) => /^[A-Z]{2,3}$/.test(s.home) && /^[A-Z]{2,3}$/.test(s.away)
      );
      check(
        "every resolver call passed valid 2-3 letter abbreviations",
        allValidAbbrevs
      );
    } else {
      console.log(
        "  ! resolver was not invoked — likely empty +EV slate today (no real MLB games returning +EV opportunities)"
      );
    }

    // Phase 1.5: if we got any lines, verify they're game-level (no Player Props)
    // and from supported markets only.
    if (lines.length > 0) {
      const allGameLevel = lines.every((l) => l.player_external_id === null);
      check(
        "every LineRecord has player_external_id=null (no Player Props from V1 odds provider)",
        allGameLevel
      );
      const supportedMarkets = new Set(["moneyline", "total", "spread", "first_inning_total"]);
      const allSupported = lines.every((l) =>
        supportedMarkets.has(String(l.market_type))
      );
      check(
        "every LineRecord has supported market_type (no team_total/F5/player_prop leakage)",
        allSupported
      );
      // /odds rows don't carry ev_percent/fair_odds — those live on
      // /opportunities/ev. Verify our provider didn't mistakenly populate
      // those fields from /odds.
      const allEvFieldsClean = lines.every(
        (l) =>
          l.ev_percent === null &&
          l.fair_odds === null &&
          l.is_ev_positive === null
      );
      check(
        "every LineRecord has ev_percent/fair_odds/is_ev_positive = null (EV fields belong to /opportunities/ev, not /odds)",
        allEvFieldsClean
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

    // STRICT NULL DISCIPLINE — every row must have NULL on the GENUINELY
    // unavailable framework gap fields. Phase 1.6 introduces /splits
    // integration: public_betting_pct and public_money_pct may now be
    // populated on ML / spread / total signals when SharpAPI returns a
    // matching /splits row. They MUST remain null on first_inning_total
    // signals (no first-inning data in /splits).
    let steamRlmStrengthDisciplineHeld = true;
    let booleanDisciplineHeld = true;
    let firstInningSplitsRemainNull = true;
    for (const s of signals) {
      if (s.steam_detected_at !== null) steamRlmStrengthDisciplineHeld = false;
      if (s.steam_books_count !== null) steamRlmStrengthDisciplineHeld = false;
      if (s.rlm_direction !== null) steamRlmStrengthDisciplineHeld = false;
      if (s.signal_strength !== null) steamRlmStrengthDisciplineHeld = false;
      if (s.signal_summary !== null) steamRlmStrengthDisciplineHeld = false;
      if (s.has_steam_move !== false) booleanDisciplineHeld = false;
      if (s.has_reverse_line_movement !== false) booleanDisciplineHeld = false;
      // First-inning signals must continue to have null public splits
      // because /splits does not cover first-inning markets in V1.
      if (s.market_type === "first_inning_total") {
        if (s.public_betting_pct !== null) firstInningSplitsRemainNull = false;
        if (s.public_money_pct !== null) firstInningSplitsRemainNull = false;
      }
    }
    check(
      "STRICT NULL: steam_detected_at, steam_books_count, rlm_direction, signal_strength, signal_summary all null on every row",
      steamRlmStrengthDisciplineHeld
    );
    check(
      "STRICT BOOL: has_steam_move=false and has_reverse_line_movement=false on every row (SharpAPI Sharp tier does not expose these)",
      booleanDisciplineHeld
    );
    check(
      "Phase 1.6: first_inning_total signals have null public_betting_pct + public_money_pct (no first-inning splits in V1)",
      firstInningSplitsRemainNull
    );

    // ── Phase 1.6 — /splits merge assertions ─────────────────────────
    // We expect AT LEAST ONE ML / spread / total signal to receive a
    // non-null public_betting_pct or public_money_pct via the /splits
    // merge when SharpAPI returns a populated splits row for the
    // matching team pair. Empty-slate cases are still acceptable.
    const gameMarketSignals = signals.filter((s) =>
      s.market_type === "moneyline" ||
      s.market_type === "spread" ||
      s.market_type === "total"
    );
    const splitsMergedCount = gameMarketSignals.filter(
      (s) => s.public_betting_pct !== null || s.public_money_pct !== null
    ).length;
    console.log(
      `  Phase 1.6 splits-merge: ${splitsMergedCount} / ${gameMarketSignals.length} ML/spread/total signals received public splits data`
    );
    if (gameMarketSignals.length > 0) {
      check(
        `Phase 1.6: at least one ML/spread/total signal carries public_betting_pct or public_money_pct from /splits merge (got ${splitsMergedCount}/${gameMarketSignals.length})`,
        splitsMergedCount > 0
      );

      // Scale assertion: when populated, public_betting_pct and
      // public_money_pct must be on the 0-100 scale (the SharpSignal
      // table column convention). /splits returns 0-1 floats; the
      // provider multiplies by 100. Sanity-check the upper bound here.
      const scaleOk = signals.every(
        (s) =>
          (s.public_betting_pct === null || s.public_betting_pct <= 100) &&
          (s.public_money_pct === null || s.public_money_pct <= 100)
      );
      check(
        "Phase 1.6: public_betting_pct and public_money_pct are on the 0-100 scale (≤ 100 when not null)",
        scaleOk
      );
      // And the lower bound — should be ≥ 0 always.
      const scaleNonNegative = signals.every(
        (s) =>
          (s.public_betting_pct === null || s.public_betting_pct >= 0) &&
          (s.public_money_pct === null || s.public_money_pct >= 0)
      );
      check(
        "Phase 1.6: public_betting_pct and public_money_pct are non-negative when populated",
        scaleNonNegative
      );
    }

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

    // Phase 1.5 (Task #162): resolver invocation evidence — confirms the
    // league filter is permitting MLB rows rather than rejecting them all
    // (Phase 1 had a sport==="mlb" filter that rejected every row).
    if (signalMock.seen.length > 0) {
      check(
        `signal provider resolver invoked ${signalMock.seen.length} times (league=mlb filter permits real MLB games)`,
        true
      );
    } else if (signals.length === 0) {
      console.log(
        "  ! signal provider resolver not invoked — acceptable when SharpAPI returns 0 MLB opportunities today, but check upstream if unexpected"
      );
    }
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
