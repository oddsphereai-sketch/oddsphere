/**
 * Tests for marketSignalDerivationService (Phase 6.3c).
 *
 *   • Pure deriveMarketSignal: every verdict fires under its trigger and
 *     priority ordering holds (steam > resistance > confirmed > smoke > neutral).
 *   • Threshold reuse: all gates use SHARP_SIGNAL_THRESHOLDS values verbatim.
 *   • RLM alignment by suffix match: rlm_direction.endsWith(modelSide).
 *   • NULL signal → market_neutral (explicit, not NULL column).
 *   • Batch + DB: deriveMarketSignalsForSlate joins predictions + sharp_signals
 *     correctly; updateMarketSignalsForSlate writes are idempotent.
 *
 * Prerequisite: schema-migration-v6.sql applied. Batch tests need the seed
 * slate (npm run seed → MLB 2026-05-22).
 *
 * Run with: npm run test:market-signal-derivation
 */

import {
  deriveMarketSignal,
  deriveMarketSignalsForSlate,
  updateMarketSignalsForSlate,
  type MarketSignalSource,
} from "../lib/services/marketSignalDerivationService";
import { supabase } from "../lib/db/supabase";
import { SHARP_SIGNAL_THRESHOLDS } from "../lib/config/constants";
import type { Side } from "../lib/types/domain/Lines";

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

/**
 * Build a SharpSignalSource with sensible "no signal" defaults. Tests
 * override the fields they care about. Mirrors the ctx() helper pattern in
 * test-signal-derivation.ts.
 */
function sig(overrides: Partial<MarketSignalSource> = {}): MarketSignalSource {
  return {
    is_plus_ev: false,
    ev_pct: null,
    has_steam_move: false,
    steam_books_count: null,
    has_reverse_line_movement: false,
    rlm_direction: null,
    public_betting_pct: null,
    public_money_pct: null,
    ...overrides,
  };
}

async function main() {
  // ─── steam_alert — highest priority, alignment doesn't matter ──────────
  section("steam_alert (priority 1)");

  check(
    "steam_alert fires when steam present and books >= MIN_STEAM_BOOKS, aligned with model",
    deriveMarketSignal(
      "home",
      sig({
        has_steam_move: true,
        steam_books_count: SHARP_SIGNAL_THRESHOLDS.MIN_STEAM_BOOKS,
        rlm_direction: "toward_home",
        has_reverse_line_movement: true,
      })
    ) === "steam_alert"
  );

  check(
    "steam_alert wins over RLM-opposes-model (would otherwise be market_resistance)",
    deriveMarketSignal(
      "home",
      sig({
        has_steam_move: true,
        steam_books_count: 4,
        has_reverse_line_movement: true,
        rlm_direction: "toward_away", // opposes model
      })
    ) === "steam_alert"
  );

  check(
    "steam below MIN_STEAM_BOOKS does NOT fire steam_alert (falls through)",
    deriveMarketSignal(
      "home",
      sig({
        has_steam_move: true,
        steam_books_count: SHARP_SIGNAL_THRESHOLDS.MIN_STEAM_BOOKS - 1,
      })
    ) !== "steam_alert"
  );

  check(
    "has_steam_move=false does NOT fire steam_alert even with high book count",
    deriveMarketSignal(
      "home",
      sig({ has_steam_move: false, steam_books_count: 99 })
    ) !== "steam_alert"
  );

  // ─── market_resistance — RLM AGAINST model side ────────────────────────
  section("market_resistance (priority 2)");

  check(
    "RLM toward_away with home pick → market_resistance",
    deriveMarketSignal(
      "home",
      sig({ has_reverse_line_movement: true, rlm_direction: "toward_away" })
    ) === "market_resistance"
  );

  check(
    "RLM long-format opposing direction → market_resistance",
    deriveMarketSignal(
      "over",
      sig({
        has_reverse_line_movement: true,
        rlm_direction: "over_total_to_under",
      })
    ) === "market_resistance"
  );

  check(
    "RLM with null rlm_direction does NOT fire resistance",
    deriveMarketSignal(
      "home",
      sig({ has_reverse_line_movement: true, rlm_direction: null })
    ) !== "market_resistance"
  );

  // ─── market_confirmed — RLM-aligned or positive Pinnacle EV ────────────
  section("market_confirmed (priority 3)");

  check(
    "RLM toward_home with home pick → market_confirmed",
    deriveMarketSignal(
      "home",
      sig({ has_reverse_line_movement: true, rlm_direction: "toward_home" })
    ) === "market_confirmed"
  );

  check(
    "RLM long-format aligned direction → market_confirmed",
    deriveMarketSignal(
      "over",
      sig({
        has_reverse_line_movement: true,
        rlm_direction: "under_total_to_over",
      })
    ) === "market_confirmed"
  );

  check(
    "Pinnacle positive EV at exactly MIN_EV_FOR_PLUS_EV_SIGNAL → market_confirmed",
    deriveMarketSignal(
      "home",
      sig({
        is_plus_ev: true,
        ev_pct: SHARP_SIGNAL_THRESHOLDS.MIN_EV_FOR_PLUS_EV_SIGNAL,
      })
    ) === "market_confirmed"
  );

  check(
    "Pinnacle positive EV below threshold does NOT fire confirmed (falls to neutral)",
    deriveMarketSignal(
      "home",
      sig({
        is_plus_ev: true,
        ev_pct: SHARP_SIGNAL_THRESHOLDS.MIN_EV_FOR_PLUS_EV_SIGNAL - 0.5,
      })
    ) === "market_neutral"
  );

  check(
    "is_plus_ev=false with high ev_pct does NOT fire confirmed (flag controls)",
    deriveMarketSignal(
      "home",
      sig({ is_plus_ev: false, ev_pct: 5.0 })
    ) !== "market_confirmed"
  );

  // ─── public_smoke — heavy public, flat money, no Pinnacle EV ───────────
  section("public_smoke (priority 4)");

  check(
    "Heavy public (75%) + flat money (76%) + !is_plus_ev → public_smoke",
    deriveMarketSignal(
      "home",
      sig({
        is_plus_ev: false,
        public_betting_pct: 75,
        public_money_pct: 76,
      })
    ) === "public_smoke"
  );

  check(
    "Public exactly at MIN_PUBLIC_HEAVY_PCT with flat money fires public_smoke",
    deriveMarketSignal(
      "home",
      sig({
        is_plus_ev: false,
        public_betting_pct: SHARP_SIGNAL_THRESHOLDS.MIN_PUBLIC_HEAVY_PCT,
        public_money_pct: SHARP_SIGNAL_THRESHOLDS.MIN_PUBLIC_HEAVY_PCT,
      })
    ) === "public_smoke"
  );

  check(
    "Public below MIN_PUBLIC_HEAVY_PCT does NOT fire public_smoke",
    deriveMarketSignal(
      "home",
      sig({
        is_plus_ev: false,
        public_betting_pct:
          SHARP_SIGNAL_THRESHOLDS.MIN_PUBLIC_HEAVY_PCT - 1,
        public_money_pct: SHARP_SIGNAL_THRESHOLDS.MIN_PUBLIC_HEAVY_PCT - 1,
      })
    ) === "market_neutral"
  );

  check(
    "Public heavy but money divergence >= PUBLIC_MONEY_FLATNESS_PP does NOT fire public_smoke (sharps flowing)",
    deriveMarketSignal(
      "home",
      sig({
        is_plus_ev: false,
        public_betting_pct: 75,
        public_money_pct:
          75 - SHARP_SIGNAL_THRESHOLDS.PUBLIC_MONEY_FLATNESS_PP, // exactly at the boundary — not strictly less than
      })
    ) === "market_neutral"
  );

  check(
    "Public heavy + flat money but is_plus_ev=true → NOT public_smoke (Pinnacle agrees)",
    deriveMarketSignal(
      "home",
      sig({
        is_plus_ev: true,
        ev_pct: 3.0,
        public_betting_pct: 75,
        public_money_pct: 76,
      })
    ) === "market_confirmed"
  );

  // ─── market_neutral — fallback + null signal ───────────────────────────
  section("market_neutral (default)");

  check(
    "NULL signal → market_neutral (explicit, never leaves column NULL post-derivation)",
    deriveMarketSignal("home", null) === "market_neutral"
  );

  check(
    "Signal with all flags false / nulls → market_neutral",
    deriveMarketSignal("home", sig()) === "market_neutral"
  );

  check(
    "Signal with non-actionable EV (positive but below threshold, no RLM/steam/smoke) → market_neutral",
    deriveMarketSignal(
      "over",
      sig({ is_plus_ev: true, ev_pct: 1.0, public_betting_pct: 40 })
    ) === "market_neutral"
  );

  // ─── Priority ordering verification ────────────────────────────────────
  section("priority ordering (steam > resistance > confirmed > smoke > neutral)");

  // Build a signal that would trigger MULTIPLE verdicts if priority were
  // wrong — steam + opposing RLM + positive EV + heavy flat public.
  const allTriggers: MarketSignalSource = {
    has_steam_move: true,
    steam_books_count: SHARP_SIGNAL_THRESHOLDS.MIN_STEAM_BOOKS,
    has_reverse_line_movement: true,
    rlm_direction: "toward_away",
    is_plus_ev: true,
    ev_pct: 5.0,
    public_betting_pct: 75,
    public_money_pct: 76,
  };
  check(
    "All triggers fire → steam_alert wins (priority 1)",
    deriveMarketSignal("home", allTriggers) === "steam_alert"
  );

  const noSteamAllOthers: MarketSignalSource = {
    has_steam_move: false,
    steam_books_count: null,
    has_reverse_line_movement: true,
    rlm_direction: "toward_away",
    is_plus_ev: true,
    ev_pct: 5.0,
    public_betting_pct: 75,
    public_money_pct: 76,
  };
  check(
    "No steam, all others fire → resistance wins (priority 2 over confirmed/smoke)",
    deriveMarketSignal("home", noSteamAllOthers) === "market_resistance"
  );

  const noSteamNoRlmEvSmoke: MarketSignalSource = {
    has_steam_move: false,
    steam_books_count: null,
    has_reverse_line_movement: false,
    rlm_direction: null,
    is_plus_ev: true,
    ev_pct: 5.0,
    public_betting_pct: 75,
    public_money_pct: 76,
  };
  check(
    "No steam/RLM, EV + smoke conditions both fire → confirmed wins (priority 3 over 4)",
    deriveMarketSignal("home", noSteamNoRlmEvSmoke) === "market_confirmed"
  );

  // ─── RLM endsWith() matching across formats ────────────────────────────
  section("rlm_direction.endsWith(modelSide) suffix matching");

  check(
    "toward_over with model=over → confirmed (suffix 'over')",
    deriveMarketSignal(
      "over",
      sig({ has_reverse_line_movement: true, rlm_direction: "toward_over" })
    ) === "market_confirmed"
  );

  check(
    "away_total_to_under with model=under → confirmed (suffix 'under')",
    deriveMarketSignal(
      "under",
      sig({
        has_reverse_line_movement: true,
        rlm_direction: "away_total_to_under",
      })
    ) === "market_confirmed"
  );

  check(
    "toward_home with model=over → resistance (not a suffix match for 'over')",
    deriveMarketSignal(
      "over",
      sig({ has_reverse_line_movement: true, rlm_direction: "toward_home" })
    ) === "market_resistance"
  );

  // ─── Batch + DB integration ────────────────────────────────────────────
  section("batch derivation against the seed slate");

  // Pick a date that has MLB data seeded. seed.ts uses 2026-05-22 — same
  // convention test-signal-derivation uses.
  const targetSlate = "2026-05-22";

  const { data: mlbGames } = await supabase
    .from("games")
    .select("id")
    .eq("sport", "mlb")
    .eq("slate_date", targetSlate);
  const mlbCount = (mlbGames ?? []).length;

  if (mlbCount === 0) {
    console.log(
      "\n  (skipping batch tests — no MLB games at " +
        targetSlate +
        "; run `npm run seed` to populate)"
    );
  } else {
    const derived = await deriveMarketSignalsForSlate("mlb", targetSlate);
    check(
      "deriveMarketSignalsForSlate returned non-empty maps for seeded slate",
      derived.games.size > 0 || derived.props.size > 0
    );

    // Every value is in the canonical MarketSignal union.
    const ALL_VALID = new Set([
      "market_confirmed",
      "market_neutral",
      "market_resistance",
      "public_smoke",
      "steam_alert",
    ]);
    let badGame = 0;
    for (const v of derived.games.values()) {
      if (!ALL_VALID.has(v)) badGame++;
    }
    let badProp = 0;
    for (const v of derived.props.values()) {
      if (!ALL_VALID.has(v)) badProp++;
    }
    check(
      "every derived game signal is in the canonical MarketSignal union",
      badGame === 0
    );
    check(
      "every derived prop signal is in the canonical MarketSignal union",
      badProp === 0
    );

    // Write + idempotency.
    const r1 = await updateMarketSignalsForSlate("mlb", targetSlate);
    check(
      "updateMarketSignalsForSlate wrote at least one row",
      r1.gamePredictionsUpdated > 0 || r1.propPredictionsUpdated > 0
    );

    const r2 = await updateMarketSignalsForSlate("mlb", targetSlate);
    check(
      "re-running updateMarketSignalsForSlate is idempotent (same counts)",
      r2.gamePredictionsUpdated === r1.gamePredictionsUpdated &&
        r2.propPredictionsUpdated === r1.propPredictionsUpdated
    );

    // Spot-check: DB rows match the derived map for a sample.
    const sampleGameIds = Array.from(derived.games.keys()).slice(0, 5);
    const sampleGameIdsLength = sampleGameIds.length;
    if (sampleGameIdsLength > 0) {
      const { data: gameDbRows } = await supabase
        .from("game_predictions")
        .select("id, market_signal")
        .in("id", sampleGameIds);
      let mismatch = 0;
      for (const row of (gameDbRows ?? []) as Array<{
        id: number;
        market_signal: string | null;
      }>) {
        if (derived.games.get(row.id) !== row.market_signal) mismatch++;
      }
      check(
        "game_predictions DB market_signal matches derived map for sampled rows",
        mismatch === 0
      );
    }

    const samplePropIds = Array.from(derived.props.keys()).slice(0, 5);
    if (samplePropIds.length > 0) {
      const { data: propDbRows } = await supabase
        .from("prop_predictions")
        .select("id, market_signal")
        .in("id", samplePropIds);
      let mismatch = 0;
      for (const row of (propDbRows ?? []) as Array<{
        id: number;
        market_signal: string | null;
      }>) {
        if (derived.props.get(row.id) !== row.market_signal) mismatch++;
      }
      check(
        "prop_predictions DB market_signal matches derived map for sampled rows",
        mismatch === 0
      );
    }

    // Skip-NULL-side rows: any game_prediction with all three picks NULL
    // should NOT appear in derived.games (we skip rather than default).
    const { data: nullSideRows } = await supabase
      .from("game_predictions")
      .select("id, predicted_ml_winner, predicted_ou_side, predicted_nrfi")
      .in(
        "game_id",
        ((mlbGames ?? []) as Array<{ id: number }>).map((g) => g.id)
      )
      .is("predicted_ml_winner", null)
      .is("predicted_ou_side", null)
      .is("predicted_nrfi", null);
    const nullSideCount = (nullSideRows ?? []).length;
    if (nullSideCount > 0) {
      let leaked = 0;
      for (const row of (nullSideRows ?? []) as Array<{ id: number }>) {
        if (derived.games.has(row.id)) leaked++;
      }
      check(
        "game_predictions with NULL on all three picks are skipped (no entry in derived map)",
        leaked === 0
      );
    } else {
      console.log(
        "  (no all-NULL-side game_predictions in seed slate — skip-NULL behavior covered by pure unit only)"
      );
    }
  }

  // ─── Summary ──────────────────────────────────────────────────────────────
  console.log(`\n${"━".repeat(70)}`);
  console.log(`  ${pass} pass · ${fail} fail · ${pass + fail} total`);
  if (fail > 0) {
    console.log(`\nFailures:`);
    failures.forEach((m) => console.log(m));
    process.exit(1);
  }
  console.log(`\n✅ All market-signal-derivation tests passed.`);
}

main().catch((e) => {
  console.error(
    "\n❌ test-market-signal-derivation failed:",
    (e as Error).message
  );
  if ((e as Error).stack) console.error((e as Error).stack);
  process.exit(1);
});
