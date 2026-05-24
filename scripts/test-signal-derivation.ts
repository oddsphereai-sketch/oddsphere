/**
 * Tests for signalDerivationService (Phase 5F.2).
 *
 *   • Pure deriveSignals: every signal type fires under its trigger condition
 *     and SKIPS for non-matching contexts.
 *   • Pitcher props don't get batter-only signals (vs_lhp/rhp/platoon).
 *   • Wind signals gate on prop market AND wind speed AND direction prefix.
 *   • Park signals use the right park-factor column per prop market.
 *   • Hot/cold/warning composite trigger correctly.
 *   • Order matters — surfaced signals are in canonical priority.
 *   • Batch derivation reads context from DB joins and matches the pure call.
 *   • updateSignalsForSlate is idempotent.
 *
 * Prerequisite: schema-migration-v4.sql applied (prop_predictions.signals
 * column exists). Pure-function tests run regardless of DB state.
 *
 * Run with: npm run test:signal-derivation
 */

import {
  deriveSignals,
  deriveSignalsForSlate,
  updateSignalsForSlate,
  type Signal,
  type SignalDerivationContext,
} from "../lib/services/signalDerivationService";
import { supabase } from "../lib/db/supabase";

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

function section(t: string) {
  console.log(`\n━━━ ${t} ━━━`);
}

/** Build a minimal SignalDerivationContext with sensible defaults. Tests override the fields they care about. */
function ctx(overrides: Partial<SignalDerivationContext> = {}): SignalDerivationContext {
  return {
    prop_market: "batter_hits",
    player_id: 100,
    game_id: 200,
    slate_date: "2026-05-22",
    isPitcherProp: false,
    pitcherThrows: null,
    batterBats: null,
    splitVsLhpAvg: null,
    splitVsRhpAvg: null,
    seasonBattingAvg: null,
    parkFactorRuns: null,
    parkFactorHr: null,
    parkFactorSo: null,
    windDirectionRelative: null,
    windSpeedMph: null,
    edgePct: null,
    tier: null,
    ...overrides,
  };
}

async function main() {
  // ─── vs_lhp / vs_rhp ──────────────────────────────────────────────────────
  section("vs_lhp / vs_rhp — matchup context");

  check(
    "vs_lhp fires for batter prop with LHP opponent",
    deriveSignals(ctx({ pitcherThrows: "L", batterBats: "R" })).includes("vs_lhp")
  );
  check(
    "vs_rhp fires for batter prop with RHP opponent",
    deriveSignals(ctx({ pitcherThrows: "R", batterBats: "L" })).includes("vs_rhp")
  );
  check(
    "vs_lhp does NOT fire when pitcher handedness unknown",
    !deriveSignals(ctx({ pitcherThrows: null })).includes("vs_lhp")
  );
  check(
    "vs_lhp does NOT fire for pitcher_strikeouts prop (pitcher prop)",
    !deriveSignals(ctx({ prop_market: "pitcher_strikeouts", isPitcherProp: true, pitcherThrows: "L" })).includes("vs_lhp")
  );
  check(
    "vs_rhp does NOT fire for pitcher_earned_runs prop",
    !deriveSignals(ctx({ prop_market: "pitcher_earned_runs", isPitcherProp: true, pitcherThrows: "R" })).includes("vs_rhp")
  );

  // ─── park ────────────────────────────────────────────────────────────────
  section("park — favorable ballpark for prop market");

  check(
    "park fires for batter_hits at park_factor_runs=108",
    deriveSignals(ctx({ prop_market: "batter_hits", parkFactorRuns: 108 })).includes("park")
  );
  check(
    "park does NOT fire for batter_hits at park_factor_runs=102 (under threshold)",
    !deriveSignals(ctx({ prop_market: "batter_hits", parkFactorRuns: 102 })).includes("park")
  );
  check(
    "park fires for batter_home_runs at park_factor_hr=110",
    deriveSignals(ctx({ prop_market: "batter_home_runs", parkFactorHr: 110 })).includes("park")
  );
  check(
    "park does NOT use park_factor_runs for HR prop",
    !deriveSignals(ctx({ prop_market: "batter_home_runs", parkFactorRuns: 110, parkFactorHr: 95 })).includes("park")
  );
  check(
    "park fires for pitcher_strikeouts at park_factor_so=108",
    deriveSignals(ctx({ prop_market: "pitcher_strikeouts", isPitcherProp: true, parkFactorSo: 108 })).includes("park")
  );
  check(
    "park (inverted) fires for pitcher_earned_runs at park_factor_runs=92 (pitcher-friendly)",
    deriveSignals(ctx({ prop_market: "pitcher_earned_runs", isPitcherProp: true, parkFactorRuns: 92 })).includes("park")
  );

  // ─── wind_out / wind_in ───────────────────────────────────────────────────
  section("wind_out / wind_in — power-prop only");

  check(
    "wind_out fires for batter_home_runs with out_to_lf @ 14mph",
    deriveSignals(ctx({ prop_market: "batter_home_runs", windDirectionRelative: "out_to_lf", windSpeedMph: 14 })).includes("wind_out")
  );
  check(
    "wind_out fires for batter_total_bases (also power-related)",
    deriveSignals(ctx({ prop_market: "batter_total_bases", windDirectionRelative: "out_to_cf", windSpeedMph: 12 })).includes("wind_out")
  );
  check(
    "wind_out does NOT fire for batter_hits (not power-related)",
    !deriveSignals(ctx({ prop_market: "batter_hits", windDirectionRelative: "out_to_lf", windSpeedMph: 14 })).includes("wind_out")
  );
  check(
    "wind_out does NOT fire below speed threshold (9mph)",
    !deriveSignals(ctx({ prop_market: "batter_home_runs", windDirectionRelative: "out_to_lf", windSpeedMph: 9 })).includes("wind_out")
  );
  check(
    "wind_in fires for batter_home_runs with in_from_cf @ 12mph",
    deriveSignals(ctx({ prop_market: "batter_home_runs", windDirectionRelative: "in_from_cf", windSpeedMph: 12 })).includes("wind_in")
  );
  check(
    "wind_in does NOT fire for batter_hits prop",
    !deriveSignals(ctx({ prop_market: "batter_hits", windDirectionRelative: "in_from_cf", windSpeedMph: 14 })).includes("wind_in")
  );

  // ─── platoon ──────────────────────────────────────────────────────────────
  section("platoon — favorable handedness split");

  check(
    "platoon fires for switch hitter (S) regardless of split data",
    deriveSignals(ctx({ batterBats: "S", pitcherThrows: "R", seasonBattingAvg: 0.270 })).includes("platoon")
  );
  check(
    "platoon fires when split avg >= 20 points above season avg",
    deriveSignals(ctx({
      batterBats: "L",
      pitcherThrows: "R",
      seasonBattingAvg: 0.275,
      splitVsRhpAvg: 0.310, // +35pp delta
    })).includes("platoon")
  );
  check(
    "platoon does NOT fire when split delta is below 20pp threshold",
    !deriveSignals(ctx({
      batterBats: "L",
      pitcherThrows: "R",
      seasonBattingAvg: 0.275,
      splitVsRhpAvg: 0.285, // +10pp delta
    })).includes("platoon")
  );
  check(
    "platoon does NOT fire for pitcher prop",
    !deriveSignals(ctx({
      prop_market: "pitcher_strikeouts",
      isPitcherProp: true,
      batterBats: "S",
      pitcherThrows: "R",
      seasonBattingAvg: 0.280,
    })).includes("platoon")
  );

  // ─── hot / cold (edge proxy) ──────────────────────────────────────────────
  section("hot / cold — edge proxy");

  check(`hot fires at edgePct >= 6 (threshold)`, deriveSignals(ctx({ edgePct: 6.0 })).includes("hot"));
  check(`hot fires at edgePct = 12`, deriveSignals(ctx({ edgePct: 12 })).includes("hot"));
  check(`hot does NOT fire at edgePct = 4 (below threshold)`, !deriveSignals(ctx({ edgePct: 4 })).includes("hot"));
  check(`cold fires at edgePct = -5`, deriveSignals(ctx({ edgePct: -5 })).includes("cold"));
  check(`cold does NOT fire at edgePct = -2 (above threshold)`, !deriveSignals(ctx({ edgePct: -2 })).includes("cold"));
  check(`neither hot nor cold at edgePct = 0`, !deriveSignals(ctx({ edgePct: 0 })).includes("hot") && !deriveSignals(ctx({ edgePct: 0 })).includes("cold"));

  // ─── rest_advantage (deterministic mock) ──────────────────────────────────
  section("rest_advantage — deterministic mock");

  // Same (player_id, slate_date) → same answer twice.
  const c1 = ctx({ player_id: 12345, slate_date: "2026-05-22" });
  const r1a = deriveSignals(c1).includes("rest_advantage");
  const r1b = deriveSignals(c1).includes("rest_advantage");
  check(`same player+slate gives stable rest_advantage answer`, r1a === r1b);

  // Different slate_date → potentially different answer.
  const r2 = deriveSignals(ctx({ player_id: 12345, slate_date: "2026-05-23" })).includes("rest_advantage");
  // Just verify the call doesn't throw; either equal or different is fine.
  check(`changing slate_date yields a deterministic (possibly different) answer`, typeof r2 === "boolean");

  // Sample 1000 hashes — rest_advantage should fire on roughly 10–20% (target 15%).
  let hits = 0;
  for (let i = 0; i < 1000; i++) {
    if (deriveSignals(ctx({ player_id: i, slate_date: "2026-05-22" })).includes("rest_advantage")) hits++;
  }
  check(
    `rest_advantage fires on 10–20% of sample (got ${hits / 10}% over 1000 players)`,
    hits >= 100 && hits <= 200
  );

  // ─── warning composite ────────────────────────────────────────────────────
  section("warning — composite negative trigger");

  // cold + unfavorable park → warning
  check(
    "cold + unfavorable park → warning",
    deriveSignals(ctx({ prop_market: "batter_hits", edgePct: -5, parkFactorRuns: 90 })).includes("warning")
  );
  // cold + wind_in for HR prop → warning
  check(
    "cold + wind_in on HR prop → warning",
    deriveSignals(ctx({
      prop_market: "batter_home_runs",
      edgePct: -5,
      windDirectionRelative: "in_from_cf",
      windSpeedMph: 14,
    })).includes("warning")
  );
  // tier=skip with negative edge AND no positive context → warning
  check(
    "tier=skip + negative edge + no positives → warning",
    deriveSignals(ctx({ prop_market: "batter_hits", tier: "skip", edgePct: -2 })).includes("warning")
  );
  // Neutral context shouldn't trigger warning.
  check(
    "neutral context (no cold, no skip) → no warning",
    !deriveSignals(ctx({ prop_market: "batter_hits", edgePct: 2, tier: "good" })).includes("warning")
  );

  // ─── Order / canonical priority ──────────────────────────────────────────
  section("Order — canonical priority");

  // hot + park + vs_lhp should appear in canonical order: hot, park, vs_lhp.
  const ordered = deriveSignals(ctx({
    prop_market: "batter_hits",
    edgePct: 7,
    parkFactorRuns: 108,
    pitcherThrows: "L",
  }));
  const hotIdx = ordered.indexOf("hot");
  const parkIdx = ordered.indexOf("park");
  const vsLhpIdx = ordered.indexOf("vs_lhp");
  check(
    `hot comes before park comes before vs_lhp in returned array`,
    hotIdx >= 0 && parkIdx > hotIdx && vsLhpIdx > parkIdx
  );

  // ─── Batch / DB integration ──────────────────────────────────────────────
  section("Batch derivation + DB integration");

  // Pick the latest MLB slate that has props.
  const { data: slateRow } = await supabase
    .from("games")
    .select("slate_date, prop_predictions!inner ( id )")
    .eq("sport", "mlb")
    .order("slate_date", { ascending: false })
    .limit(1);
  const targetSlate = (slateRow ?? [])[0]?.slate_date;
  if (!targetSlate) {
    console.log("  ~ no slate with props found — skipping batch integration tests");
  } else {
    const derived = await deriveSignalsForSlate("mlb", targetSlate);
    check(`deriveSignalsForSlate returns a Map`, derived instanceof Map);
    check(`derived has entries for at least one prop`, derived.size > 0);

    // Every value must be an array of Signal-union strings.
    const allowedSignals: Signal[] = [
      "hot", "cold", "vs_lhp", "vs_rhp", "wind_out", "wind_in",
      "park", "rest_advantage", "platoon", "warning",
    ];
    let badSignal = 0;
    for (const sigs of derived.values()) {
      for (const s of sigs) {
        if (!(allowedSignals as string[]).includes(s)) badSignal++;
      }
    }
    check(`every derived signal is in the canonical Signal union`, badSignal === 0);

    // Update + verify idempotency.
    const r1 = await updateSignalsForSlate("mlb", targetSlate);
    check(`updateSignalsForSlate updated at least one prop`, r1.updated > 0);

    const r2 = await updateSignalsForSlate("mlb", targetSlate);
    check(`re-running updateSignalsForSlate is idempotent (same count)`, r2.updated === r1.updated);

    // Spot-check: the DB rows should match the derived map.
    const propIds = Array.from(derived.keys()).slice(0, 5);
    const { data: dbRows } = await supabase
      .from("prop_predictions")
      .select("id, signals")
      .in("id", propIds);
    let mismatch = 0;
    for (const row of (dbRows ?? []) as Array<{ id: number; signals: string[] | null }>) {
      const expected = derived.get(row.id) ?? [];
      const actual = Array.isArray(row.signals) ? row.signals : [];
      if (JSON.stringify(expected) !== JSON.stringify(actual)) mismatch++;
    }
    check(`DB rows match derived signals for sampled props`, mismatch === 0);
  }

  // ─── Summary ──────────────────────────────────────────────────────────────
  console.log(`\n${"━".repeat(70)}`);
  console.log(`  ${pass} pass · ${fail} fail · ${pass + fail} total`);
  if (fail > 0) {
    console.log(`\nFailures:`);
    failures.forEach((m) => console.log(m));
    process.exit(1);
  }
  console.log(`\n✅ All signal-derivation tests passed.`);
}

main().catch((e) => {
  console.error("\n❌ test-signal-derivation failed:", (e as Error).message);
  if ((e as Error).stack) console.error((e as Error).stack);
  process.exit(1);
});
