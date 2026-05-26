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
 *
 * V2.1.1 fix (Phase 6.3.5e-fix): side defaults to "home" so existing tests
 * that pass modelSide="home" naturally exercise the aligned-case branches.
 * New alignment-aware tests explicitly override side to "away" / "over" /
 * etc. to exercise the opposing-case branches.
 */
function sig(overrides: Partial<MarketSignalSource> = {}): MarketSignalSource {
  return {
    side: "home",
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
    "Public exactly at PUBLIC_SMOKE_TICKET_THRESHOLD with flat money fires public_smoke",
    deriveMarketSignal(
      "home",
      sig({
        is_plus_ev: false,
        public_betting_pct:
          SHARP_SIGNAL_THRESHOLDS.PUBLIC_SMOKE_TICKET_THRESHOLD,
        public_money_pct:
          SHARP_SIGNAL_THRESHOLDS.PUBLIC_SMOKE_TICKET_THRESHOLD,
      })
    ) === "public_smoke"
  );

  check(
    "Public below PUBLIC_SMOKE_TICKET_THRESHOLD does NOT fire public_smoke",
    deriveMarketSignal(
      "home",
      sig({
        is_plus_ev: false,
        public_betting_pct:
          SHARP_SIGNAL_THRESHOLDS.PUBLIC_SMOKE_TICKET_THRESHOLD - 1,
        public_money_pct:
          SHARP_SIGNAL_THRESHOLDS.PUBLIC_SMOKE_TICKET_THRESHOLD - 1,
      })
    ) === "market_neutral"
  );

  // Framework: PUBLIC_SMOKE_FLAT_GAP_MAX is INCLUSIVE — gap of exactly 8pp
  // counts as flat. Boundary test uses GAP_MAX + 1 to exceed flatness.
  check(
    "Public heavy but money divergence > PUBLIC_SMOKE_FLAT_GAP_MAX does NOT fire public_smoke (sharps flowing)",
    deriveMarketSignal(
      "home",
      sig({
        is_plus_ev: false,
        public_betting_pct: 75,
        public_money_pct:
          75 - (SHARP_SIGNAL_THRESHOLDS.PUBLIC_SMOKE_FLAT_GAP_MAX + 1),
      })
    ) === "market_neutral"
  );

  // V2.1.1 framework conformance: gap of EXACTLY PUBLIC_SMOKE_FLAT_GAP_MAX
  // (8pp) fires public_smoke under the ≤ operator. Pre-Fix-1.2 the operator
  // was strict `<` and this case would have fallen to market_neutral.
  check(
    "Public heavy + money divergence == PUBLIC_SMOKE_FLAT_GAP_MAX (inclusive) fires public_smoke",
    deriveMarketSignal(
      "home",
      sig({
        is_plus_ev: false,
        public_betting_pct: 75,
        public_money_pct:
          75 - SHARP_SIGNAL_THRESHOLDS.PUBLIC_SMOKE_FLAT_GAP_MAX,
      })
    ) === "public_smoke"
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
    side: "home",
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
    side: "home",
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
    side: "home",
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

  // ─── Alignment-aware branches (6.3.5e-fix) ─────────────────────────────
  // Pre-fix the service keyed the lookup by (game, market, side) using the
  // model's side; sharp_signals on the opposing side were silently dropped.
  // Post-fix the pure function reads signal.side and compares it to
  // modelSide. These eight cases lock the alignment semantics.
  section("alignment-aware steam / EV (6.3.5e-fix)");

  check(
    "opposing steam → market_resistance (Pinnacle steaming the other side ≠ our pick)",
    deriveMarketSignal(
      "under",
      sig({
        side: "over",
        has_steam_move: true,
        steam_books_count: SHARP_SIGNAL_THRESHOLDS.MIN_STEAM_BOOKS,
      })
    ) === "market_resistance"
  );

  check(
    "aligned steam → steam_alert (Pinnacle steam confirms our pick)",
    deriveMarketSignal(
      "under",
      sig({
        side: "under",
        has_steam_move: true,
        steam_books_count: SHARP_SIGNAL_THRESHOLDS.MIN_STEAM_BOOKS,
      })
    ) === "steam_alert"
  );

  check(
    "opposing +EV → market_resistance (Pinnacle +EV on the other side)",
    deriveMarketSignal(
      "under",
      sig({ side: "over", is_plus_ev: true, ev_pct: 4.2 })
    ) === "market_resistance"
  );

  check(
    "aligned +EV → market_confirmed (Pinnacle +EV agrees with our pick)",
    deriveMarketSignal(
      "under",
      sig({ side: "under", is_plus_ev: true, ev_pct: 4.2 })
    ) === "market_confirmed"
  );

  check(
    "aligned steam + opposing EV → steam_alert (steam priority wins, alignment checked at steam branch)",
    deriveMarketSignal(
      "under",
      sig({
        side: "under",
        has_steam_move: true,
        steam_books_count: SHARP_SIGNAL_THRESHOLDS.MIN_STEAM_BOOKS,
        is_plus_ev: true,
        ev_pct: 4.2,
      })
    ) === "steam_alert"
  );

  // Steam branch sees signal.side="over" ≠ modelSide="under" → market_resistance.
  // EV branch is never reached because steam fires first (priority 1).
  check(
    "opposing steam + aligned EV → market_resistance (steam priority wins even when opposing)",
    deriveMarketSignal(
      "under",
      sig({
        side: "over",
        has_steam_move: true,
        steam_books_count: SHARP_SIGNAL_THRESHOLDS.MIN_STEAM_BOOKS,
        is_plus_ev: true,
        ev_pct: 4.2,
      })
    ) === "market_resistance"
  );

  // signal.side="home" and modelSide="home" but no triggers fire → neutral.
  // Verifies aligned-side has no implicit signal — must have actual trigger.
  check(
    "aligned side with no triggers → market_neutral (alignment alone is not a signal)",
    deriveMarketSignal("home", sig({ side: "home" })) === "market_neutral"
  );

  // RLM was already alignment-aware pre-fix — regression-check the
  // alignment branch still picks up signal.side semantics by routing.
  check(
    "opposing RLM (rlm_direction toward opposing side) → market_resistance",
    deriveMarketSignal(
      "under",
      sig({
        side: "over",
        has_reverse_line_movement: true,
        rlm_direction: "toward_over",
      })
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
      "deriveMarketSignalsForSlate returned non-empty per-pick maps for seeded slate",
      derived.games.ml.size > 0 ||
        derived.games.ou.size > 0 ||
        derived.games.nrfi.size > 0 ||
        derived.props.size > 0
    );

    // Every value is in the canonical MarketSignal union (per-pick only —
    // 6.3.5e dropped gamesLegacy along with dual-write to the legacy
    // game_predictions.market_signal column).
    const ALL_VALID = new Set([
      "market_confirmed",
      "market_neutral",
      "market_resistance",
      "public_smoke",
      "steam_alert",
    ]);
    let badGame = 0;
    for (const market of ["ml", "ou", "nrfi"] as const) {
      for (const v of derived.games[market].values()) {
        if (!ALL_VALID.has(v)) badGame++;
      }
    }
    let badProp = 0;
    for (const v of derived.props.values()) {
      if (!ALL_VALID.has(v)) badProp++;
    }
    check(
      "every derived per-pick game signal is in the canonical MarketSignal union",
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
    check(
      "result includes perMarket sub-counts (derived === written)",
      r1.perMarket.ml.derived === r1.perMarket.ml.written &&
        r1.perMarket.ou.derived === r1.perMarket.ou.written &&
        r1.perMarket.nrfi.derived === r1.perMarket.nrfi.written
    );

    const r2 = await updateMarketSignalsForSlate("mlb", targetSlate);
    check(
      "re-running updateMarketSignalsForSlate is idempotent (same row counts)",
      r2.gamePredictionsUpdated === r1.gamePredictionsUpdated &&
        r2.propPredictionsUpdated === r1.propPredictionsUpdated
    );

    // ── Alignment audit (6.3.5e-fix WSH @ ATL pattern) ─────────────────
    // Locate total-market sharp signals on the OPPOSING side from the
    // model's pick; verify the derived ou map flags them market_resistance.
    // Pre-fix the (game, market, side) lookup keyed by modelSide silently
    // dropped these rows and the signal collapsed to market_neutral.
    const gameIdList = ((mlbGames ?? []) as Array<{ id: number }>).map(
      (g) => g.id
    );
    const { data: ouSignals } = await supabase
      .from("sharp_signals")
      .select("game_id, side")
      .eq("market_type", "total")
      .in("game_id", gameIdList);
    const { data: ouPicks } = await supabase
      .from("game_predictions")
      .select("id, game_id, predicted_ou_side")
      .in("game_id", gameIdList);
    const ouPickByGame = new Map<
      number,
      { id: number; side: string | null }
    >();
    for (const p of (ouPicks ?? []) as Array<{
      id: number;
      game_id: number;
      predicted_ou_side: string | null;
    }>) {
      ouPickByGame.set(p.game_id, { id: p.id, side: p.predicted_ou_side });
    }
    const opposingOuRows: number[] = [];
    for (const s of (ouSignals ?? []) as Array<{
      game_id: number;
      side: string;
    }>) {
      const pick = ouPickByGame.get(s.game_id);
      if (pick && pick.side !== null && pick.side !== s.side) {
        opposingOuRows.push(pick.id);
      }
    }
    if (opposingOuRows.length > 0) {
      let nonResistance = 0;
      for (const id of opposingOuRows) {
        const v = derived.games.ou.get(id);
        if (v !== "market_resistance") nonResistance++;
      }
      check(
        "opposing-side total signals in seed slate derive market_resistance (6.3.5e-fix WSH @ ATL pattern)",
        nonResistance === 0
      );
    } else {
      console.log(
        "  (no opposing-side total signals in seed slate — 6.3.5e-fix coverage relies on pure-function cases above)"
      );
    }

    // Spot-check: DB per-pick columns match derived per-pick maps for a sample.
    // (6.3.5e dropped the legacy market_signal DB column spot-check — that
    // column is no longer written. V14 cleanup migration drops it from the DB.)
    const sampleGameIds = Array.from(derived.games.ml.keys()).slice(0, 5);
    if (sampleGameIds.length > 0) {
      const { data: gameDbRows } = await supabase
        .from("game_predictions")
        .select(
          "id, ml_market_signal, ou_market_signal, nrfi_market_signal"
        )
        .in("id", sampleGameIds);
      let perPickMismatch = 0;
      for (const row of (gameDbRows ?? []) as Array<{
        id: number;
        ml_market_signal: string | null;
        ou_market_signal: string | null;
        nrfi_market_signal: string | null;
      }>) {
        if ((derived.games.ml.get(row.id) ?? null) !== row.ml_market_signal) {
          perPickMismatch++;
        }
        if ((derived.games.ou.get(row.id) ?? null) !== row.ou_market_signal) {
          perPickMismatch++;
        }
        if (
          (derived.games.nrfi.get(row.id) ?? null) !== row.nrfi_market_signal
        ) {
          perPickMismatch++;
        }
      }
      check(
        "DB per-pick ml/ou/nrfi_market_signal match derived maps for sampled rows",
        perPickMismatch === 0
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
    // should NOT appear in ANY per-pick or legacy map.
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
        if (
          derived.games.ml.has(row.id) ||
          derived.games.ou.has(row.id) ||
          derived.games.nrfi.has(row.id)
        ) {
          leaked++;
        }
      }
      check(
        "game_predictions with NULL on all three picks are skipped (absent from all per-pick maps)",
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
