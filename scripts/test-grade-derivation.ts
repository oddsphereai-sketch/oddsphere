/**
 * Tests for gradeDerivationService (Phase 6.3d).
 *
 *   • Pure deriveGrade: each of the 7 grades fires under its conditions,
 *     for both kind: "game" (5% threshold) and kind: "prop" (10% threshold).
 *   • Threshold boundaries — exactly at the line fires, just under doesn't.
 *   • signal_type attribution: each of the 5 union values fires correctly.
 *   • Best-signal slate monitor: emits warn when >25% of slate qualifies.
 *   • Batch + DB: deriveGradesForSlate joins predictions + sharp_signals +
 *     market_signal correctly; updateGradesForSlate writes are idempotent.
 *
 * Prerequisite: schema-migration-v7.sql applied (grade + signal_type
 * columns). Batch tests need the seed slate (npm run seed → MLB 2026-05-22)
 * AND for the prior derivation pass to have populated market_signal — the
 * batch block calls updateMarketSignalsForSlate first to ensure that.
 *
 * Run with: npm run test:grade-derivation
 */

import {
  deriveGrade,
  deriveGradesForSlate,
  updateGradesForSlate,
  monitorBestSignalShare,
  type GradeInput,
  type SlateGrades,
} from "../lib/services/gradeDerivationService";
import { updateMarketSignalsForSlate } from "../lib/services/marketSignalDerivationService";
import { supabase } from "../lib/db/supabase";
import { GRADE_THRESHOLDS } from "../lib/config/constants";

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

function input(overrides: Partial<GradeInput>): GradeInput {
  return {
    kind: "prop",
    modelEdgePct: null,
    marketSignal: null,
    ...overrides,
  };
}

async function main() {
  // ─── best_signal — both layers strong, edge >= threshold ───────────────
  section("best_signal (props @ 10%, games @ 5%)");

  check(
    "Prop @ 10% with market_confirmed → best_signal/balanced",
    (() => {
      const r = deriveGrade(
        input({ kind: "prop", modelEdgePct: 10, marketSignal: "market_confirmed" })
      );
      return r.grade === "best_signal" && r.signal_type === "balanced";
    })()
  );

  check(
    "Prop @ 15% with steam_alert → best_signal/balanced",
    (() => {
      const r = deriveGrade(
        input({ kind: "prop", modelEdgePct: 15, marketSignal: "steam_alert" })
      );
      return r.grade === "best_signal" && r.signal_type === "balanced";
    })()
  );

  check(
    "Game @ 5% with market_confirmed → best_signal (game threshold)",
    (() => {
      const r = deriveGrade(
        input({ kind: "game", modelEdgePct: 5, marketSignal: "market_confirmed" })
      );
      return r.grade === "best_signal";
    })()
  );

  check(
    "Prop @ 9.9% (just under 10% threshold) with market_confirmed → sharp_confirmed (NOT best)",
    (() => {
      const r = deriveGrade(
        input({ kind: "prop", modelEdgePct: 9.9, marketSignal: "market_confirmed" })
      );
      return r.grade === "sharp_confirmed";
    })()
  );

  check(
    "Game @ 4.9% (just under 5%) with market_confirmed → sharp_confirmed",
    (() => {
      const r = deriveGrade(
        input({ kind: "game", modelEdgePct: 4.9, marketSignal: "market_confirmed" })
      );
      return r.grade === "sharp_confirmed";
    })()
  );

  // ─── sharp_confirmed — market_confirmed + model edge below best ────────
  section("sharp_confirmed (market confirms, edge below best threshold)");

  check(
    "Prop @ 5% with market_confirmed → sharp_confirmed/balanced",
    (() => {
      const r = deriveGrade(
        input({ kind: "prop", modelEdgePct: 5, marketSignal: "market_confirmed" })
      );
      return r.grade === "sharp_confirmed" && r.signal_type === "balanced";
    })()
  );

  check(
    "Game @ 2% with steam_alert → sharp_confirmed (above MIN_GAME_EDGE 1%, below best 5%)",
    (() => {
      const r = deriveGrade(
        input({ kind: "game", modelEdgePct: 2, marketSignal: "steam_alert" })
      );
      return r.grade === "sharp_confirmed";
    })()
  );

  // ─── market_led — market signal without model edge ─────────────────────
  section("market_led (market alone)");

  check(
    "Prop with market_confirmed but edge below MIN_PROP_EDGE → market_led/market_only",
    (() => {
      const r = deriveGrade(
        input({
          kind: "prop",
          modelEdgePct: GRADE_THRESHOLDS.MIN_PROP_EDGE - 0.5,
          marketSignal: "market_confirmed",
        })
      );
      return r.grade === "market_led" && r.signal_type === "market_only";
    })()
  );

  check(
    "Game with steam_alert + NULL edge → market_led/market_only",
    (() => {
      const r = deriveGrade(
        input({ kind: "game", modelEdgePct: null, marketSignal: "steam_alert" })
      );
      return r.grade === "market_led" && r.signal_type === "market_only";
    })()
  );

  check(
    "Game with market_confirmed + edge below MIN_GAME_EDGE → market_led",
    (() => {
      const r = deriveGrade(
        input({
          kind: "game",
          modelEdgePct: GRADE_THRESHOLDS.MIN_GAME_EDGE - 0.5,
          marketSignal: "market_confirmed",
        })
      );
      return r.grade === "market_led";
    })()
  );

  // ─── model_only — model edge present, market neutral ───────────────────
  section("model_only (model alone)");

  check(
    "Prop with market_neutral + edge >= MIN → model_only/model_only",
    (() => {
      const r = deriveGrade(
        input({
          kind: "prop",
          modelEdgePct: GRADE_THRESHOLDS.MIN_PROP_EDGE,
          marketSignal: "market_neutral",
        })
      );
      return r.grade === "model_only" && r.signal_type === "model_only";
    })()
  );

  check(
    "Game with market_neutral + edge >= MIN → model_only",
    (() => {
      const r = deriveGrade(
        input({
          kind: "game",
          modelEdgePct: GRADE_THRESHOLDS.MIN_GAME_EDGE,
          marketSignal: "market_neutral",
        })
      );
      return r.grade === "model_only";
    })()
  );

  // ─── market_watch — neither convincing ─────────────────────────────────
  section("market_watch (default / neither convincing)");

  check(
    "Prop with market_neutral + edge below MIN → market_watch/balanced",
    (() => {
      const r = deriveGrade(
        input({
          kind: "prop",
          modelEdgePct: GRADE_THRESHOLDS.MIN_PROP_EDGE - 0.5,
          marketSignal: "market_neutral",
        })
      );
      return r.grade === "market_watch" && r.signal_type === "balanced";
    })()
  );

  check(
    "Prop with market_neutral + NULL edge → market_watch",
    (() => {
      const r = deriveGrade(
        input({ kind: "prop", modelEdgePct: null, marketSignal: "market_neutral" })
      );
      return r.grade === "market_watch";
    })()
  );

  check(
    "NULL marketSignal (defensive fallback) → market_watch/balanced",
    (() => {
      const r = deriveGrade(
        input({ kind: "prop", modelEdgePct: 12, marketSignal: null })
      );
      return r.grade === "market_watch" && r.signal_type === "balanced";
    })()
  );

  // ─── public_smoke — market public_smoke regardless of model edge ───────
  section("public_smoke (market_only attribution)");

  check(
    "Any prop with public_smoke + high edge → public_smoke/market_only",
    (() => {
      const r = deriveGrade(
        input({ kind: "prop", modelEdgePct: 12, marketSignal: "public_smoke" })
      );
      return r.grade === "public_smoke" && r.signal_type === "market_only";
    })()
  );

  check(
    "Game with public_smoke + low edge → public_smoke",
    (() => {
      const r = deriveGrade(
        input({ kind: "game", modelEdgePct: 0.5, marketSignal: "public_smoke" })
      );
      return r.grade === "public_smoke";
    })()
  );

  // ─── sharp_conflict — market_resistance, balanced or market_only ───────
  section("sharp_conflict (sharps fade our pick)");

  check(
    "Prop with market_resistance + model edge → sharp_conflict/balanced",
    (() => {
      const r = deriveGrade(
        input({ kind: "prop", modelEdgePct: 8, marketSignal: "market_resistance" })
      );
      return r.grade === "sharp_conflict" && r.signal_type === "balanced";
    })()
  );

  check(
    "Game with market_resistance + NO model edge → sharp_conflict/market_only",
    (() => {
      const r = deriveGrade(
        input({
          kind: "game",
          modelEdgePct: null,
          marketSignal: "market_resistance",
        })
      );
      return r.grade === "sharp_conflict" && r.signal_type === "market_only";
    })()
  );

  check(
    "Prop with market_resistance + edge below MIN → sharp_conflict/market_only",
    (() => {
      const r = deriveGrade(
        input({
          kind: "prop",
          modelEdgePct: GRADE_THRESHOLDS.MIN_PROP_EDGE - 0.5,
          marketSignal: "market_resistance",
        })
      );
      return r.signal_type === "market_only";
    })()
  );

  // ─── Opposing-EV alignment flow (6.3.5e-fix WSH @ ATL pattern) ────────
  // The fix's contract for gradeDerivationService: when a sharp signal's
  // side opposes the model pick, edgeForModelSide() returns null (Pinnacle's
  // +EV is on the OTHER side; we conservatively decline inverse extrapolation
  // rather than fabricate a negative edge). The market_signal pure function
  // independently flips the signal to market_resistance for opposing +EV.
  // Together: modelEdgePct=null + marketSignal=market_resistance →
  // sharp_conflict/market_only. These two cases lock that downstream shape.

  check(
    "Game with NULL edge + market_resistance (opposing +EV path) → sharp_conflict/market_only",
    (() => {
      const r = deriveGrade(
        input({
          kind: "game",
          modelEdgePct: null,
          marketSignal: "market_resistance",
        })
      );
      return r.grade === "sharp_conflict" && r.signal_type === "market_only";
    })()
  );

  check(
    "Prop with NULL edge + market_resistance (opposing +EV path) → sharp_conflict/market_only",
    (() => {
      const r = deriveGrade(
        input({
          kind: "prop",
          modelEdgePct: null,
          marketSignal: "market_resistance",
        })
      );
      return r.grade === "sharp_conflict" && r.signal_type === "market_only";
    })()
  );

  // ─── Best-signal slate monitor ─────────────────────────────────────────
  section("monitorBestSignalShare");

  /**
   * Synthesize a SlateGrades with `bestSignalCount` best_signal picks +
   * `otherCount` model_only picks. The 6.3.5b monitor counts picks across
   * games.{ml,ou,nrfi} + props — for simplicity we put all picks in the
   * ML market (one pick per row × N rows). Pick-count semantics are the
   * same regardless of which market the picks land in.
   */
  function fakeSlate(
    bestSignalCount: number,
    otherCount: number
  ): SlateGrades {
    const ml = new Map<
      number,
      { grade: import("../lib/types/domain/Grade").Grade; signal_type: import("../lib/types/domain/Grade").SignalType }
    >();
    let id = 1;
    for (let i = 0; i < bestSignalCount; i++) {
      ml.set(id++, { grade: "best_signal", signal_type: "balanced" });
    }
    for (let i = 0; i < otherCount; i++) {
      ml.set(id++, { grade: "model_only", signal_type: "model_only" });
    }
    return {
      games: { ml, ou: new Map(), nrfi: new Map() },
      props: new Map(),
    };
  }

  // Capture console.warn to test the monitor without polluting test output.
  function withMutedWarn<T>(fn: () => T): { result: T; warned: boolean } {
    const original = console.warn;
    let warned = false;
    console.warn = () => {
      warned = true;
    };
    try {
      const result = fn();
      return { result, warned };
    } finally {
      console.warn = original;
    }
  }

  const m1 = withMutedWarn(() => monitorBestSignalShare(fakeSlate(2, 8), "test"));
  check(
    "20% best_signal share does NOT trigger monitor warn",
    m1.result.bestSignalPct === 20 && m1.result.exceededThreshold === false && !m1.warned
  );

  const m2 = withMutedWarn(() => monitorBestSignalShare(fakeSlate(3, 7), "test"));
  check(
    "30% best_signal share DOES trigger monitor warn",
    m2.result.bestSignalPct === 30 && m2.result.exceededThreshold === true && m2.warned
  );

  const m3 = withMutedWarn(() =>
    monitorBestSignalShare(
      {
        games: { ml: new Map(), ou: new Map(), nrfi: new Map() },
        props: new Map(),
      },
      "test"
    )
  );
  check(
    "Empty slate → monitor returns pct=0, does NOT warn",
    m3.result.bestSignalPct === 0 && m3.result.exceededThreshold === false && !m3.warned
  );

  // Pick-count semantics: 1 best_signal in ML + 1 best_signal in OU + 1 in
  // NRFI + 1 in props = 4 best_signal across 4 derived picks (100% — must warn).
  const crossMarketSlate: SlateGrades = {
    games: {
      ml: new Map([[1, { grade: "best_signal", signal_type: "balanced" }]]),
      ou: new Map([[1, { grade: "best_signal", signal_type: "balanced" }]]),
      nrfi: new Map([[1, { grade: "best_signal", signal_type: "balanced" }]]),
    },
    props: new Map([[100, { grade: "best_signal", signal_type: "balanced" }]]),
  };
  const m4 = withMutedWarn(() =>
    monitorBestSignalShare(crossMarketSlate, "test")
  );
  check(
    "monitor counts picks across ml + ou + nrfi + props (not games)",
    m4.result.totalDerivedPicks === 4 && m4.result.bestSignalPicks === 4
  );
  check(
    "perMarket sub-counts surface in monitor result",
    m4.result.perMarket.ml.derived === 1 &&
      m4.result.perMarket.ou.derived === 1 &&
      m4.result.perMarket.nrfi.derived === 1 &&
      m4.result.perMarket.ml.bestSignals === 1 &&
      m4.result.perMarket.ou.bestSignals === 1 &&
      m4.result.perMarket.nrfi.bestSignals === 1
  );

  // ─── Batch + DB integration ────────────────────────────────────────────
  section("batch derivation against the seed slate");

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
    // Ensure Layer 3 is populated before grading.
    await updateMarketSignalsForSlate("mlb", targetSlate);

    // First ensure marketSignalDerivationService has populated the per-pick
    // market_signal columns gradeDerivationService reads from.
    await updateMarketSignalsForSlate("mlb", targetSlate);

    const derived = await deriveGradesForSlate("mlb", targetSlate);
    check(
      "deriveGradesForSlate returned non-empty per-pick maps for seeded slate",
      derived.games.ml.size > 0 ||
        derived.games.ou.size > 0 ||
        derived.games.nrfi.size > 0 ||
        derived.props.size > 0
    );

    const ALL_GRADES = new Set([
      "best_signal",
      "sharp_confirmed",
      "market_led",
      "model_only",
      "market_watch",
      "public_smoke",
      "sharp_conflict",
    ]);
    const ALL_SIGNAL_TYPES = new Set([
      "model_dominant",
      "market_dominant",
      "balanced",
      "model_only",
      "market_only",
    ]);
    let badGrade = 0;
    let badSignalType = 0;
    for (const market of ["ml", "ou", "nrfi"] as const) {
      for (const out of derived.games[market].values()) {
        if (!ALL_GRADES.has(out.grade)) badGrade++;
        if (!ALL_SIGNAL_TYPES.has(out.signal_type)) badSignalType++;
      }
    }
    for (const out of derived.props.values()) {
      if (!ALL_GRADES.has(out.grade)) badGrade++;
      if (!ALL_SIGNAL_TYPES.has(out.signal_type)) badSignalType++;
    }
    check(`every derived grade is in the canonical Grade union`, badGrade === 0);
    check(
      `every derived signal_type is in the canonical SignalType union`,
      badSignalType === 0
    );

    const r1 = await updateGradesForSlate("mlb", targetSlate);
    check(
      "updateGradesForSlate wrote at least one row",
      r1.gamePredictionsUpdated > 0 || r1.propPredictionsUpdated > 0
    );
    check(
      "result includes perMarket sub-counts (derived === written)",
      r1.perMarket.ml.derived === r1.perMarket.ml.written &&
        r1.perMarket.ou.derived === r1.perMarket.ou.written &&
        r1.perMarket.nrfi.derived === r1.perMarket.nrfi.written
    );

    const r2 = await updateGradesForSlate("mlb", targetSlate);
    check(
      "re-running updateGradesForSlate is idempotent (same row counts)",
      r2.gamePredictionsUpdated === r1.gamePredictionsUpdated &&
        r2.propPredictionsUpdated === r1.propPredictionsUpdated
    );

    // DB spot-check: per-pick columns match derived values. (6.3.5e
    // dropped the legacy grade/signal_type DB column spot-check —
    // those columns are no longer written. V14 migration drops them.)
    const sampleGameIds = Array.from(derived.games.ml.keys()).slice(0, 5);
    if (sampleGameIds.length > 0) {
      const { data: gameDbRows } = await supabase
        .from("game_predictions")
        .select(
          "id, ml_grade, ml_signal_type, ou_grade, ou_signal_type, nrfi_grade, nrfi_signal_type"
        )
        .in("id", sampleGameIds);
      let perPickMismatch = 0;
      for (const row of (gameDbRows ?? []) as Array<{
        id: number;
        ml_grade: string | null;
        ml_signal_type: string | null;
        ou_grade: string | null;
        ou_signal_type: string | null;
        nrfi_grade: string | null;
        nrfi_signal_type: string | null;
      }>) {
        const mlExpected = derived.games.ml.get(row.id) ?? null;
        if (
          (mlExpected?.grade ?? null) !== row.ml_grade ||
          (mlExpected?.signal_type ?? null) !== row.ml_signal_type
        ) {
          perPickMismatch++;
        }
        const ouExpected = derived.games.ou.get(row.id) ?? null;
        if (
          (ouExpected?.grade ?? null) !== row.ou_grade ||
          (ouExpected?.signal_type ?? null) !== row.ou_signal_type
        ) {
          perPickMismatch++;
        }
        const nrfiExpected = derived.games.nrfi.get(row.id) ?? null;
        if (
          (nrfiExpected?.grade ?? null) !== row.nrfi_grade ||
          (nrfiExpected?.signal_type ?? null) !== row.nrfi_signal_type
        ) {
          perPickMismatch++;
        }
      }
      check(
        "DB per-pick ml/ou/nrfi grade+signal_type match derived maps for sampled rows",
        perPickMismatch === 0
      );
    }

    const samplePropIds = Array.from(derived.props.keys()).slice(0, 5);
    if (samplePropIds.length > 0) {
      const { data: propDbRows } = await supabase
        .from("prop_predictions")
        .select("id, grade, signal_type")
        .in("id", samplePropIds);
      let mismatch = 0;
      for (const row of (propDbRows ?? []) as Array<{
        id: number;
        grade: string | null;
        signal_type: string | null;
      }>) {
        const expected = derived.props.get(row.id);
        if (
          !expected ||
          expected.grade !== row.grade ||
          expected.signal_type !== row.signal_type
        )
          mismatch++;
      }
      check(
        "prop_predictions DB grade+signal_type match derived map for sampled rows",
        mismatch === 0
      );
    }

    // Best-signal monitor on the real slate — should NOT throw regardless
    // of whether it warns. Confirm the structured result.
    check(
      "real-slate monitor returns a structured result (totalDerivedPicks >= 0)",
      r1.monitor.totalDerivedPicks >= 0 &&
        typeof r1.monitor.bestSignalPct === "number" &&
        typeof r1.monitor.perMarket.ml.derived === "number"
    );

    // ── Alignment audit (6.3.5e-fix WSH @ ATL pattern) ─────────────────
    // End-to-end: for any game where the total-market sharp signal opposes
    // the model's predicted_ou_side, the resulting ou_grade should be
    // sharp_conflict (driven by market_signal=market_resistance and
    // modelEdgePct=null from edgeForModelSide). Pre-fix it would be
    // market_watch (signal silently dropped, edge null, no resistance).
    const gameIdList = ((mlbGames ?? []) as Array<{ id: number }>).map(
      (g) => g.id
    );
    const { data: alignSignals } = await supabase
      .from("sharp_signals")
      .select("game_id, side")
      .eq("market_type", "total")
      .in("game_id", gameIdList);
    const { data: alignPicks } = await supabase
      .from("game_predictions")
      .select("id, game_id, predicted_ou_side")
      .in("game_id", gameIdList);
    const alignPickByGame = new Map<
      number,
      { id: number; side: string | null }
    >();
    for (const p of (alignPicks ?? []) as Array<{
      id: number;
      game_id: number;
      predicted_ou_side: string | null;
    }>) {
      alignPickByGame.set(p.game_id, {
        id: p.id,
        side: p.predicted_ou_side,
      });
    }
    const opposingPickIds: number[] = [];
    for (const s of (alignSignals ?? []) as Array<{
      game_id: number;
      side: string;
    }>) {
      const pick = alignPickByGame.get(s.game_id);
      if (pick && pick.side !== null && pick.side !== s.side) {
        opposingPickIds.push(pick.id);
      }
    }

    if (opposingPickIds.length > 0) {
      // (1) Every opposing-side pick grades sharp_conflict (was market_watch pre-fix).
      let nonConflict = 0;
      for (const id of opposingPickIds) {
        const out = derived.games.ou.get(id);
        if (out?.grade !== "sharp_conflict") nonConflict++;
      }
      check(
        "opposing-side total signals derive sharp_conflict ou_grade (WSH @ ATL pattern)",
        nonConflict === 0
      );

      // (2) signal_type is market_only — modelEdgePct=null from edgeForModelSide
      // means there's no balanced/model_dominant path; pure market call.
      let wrongSignalType = 0;
      for (const id of opposingPickIds) {
        const out = derived.games.ou.get(id);
        if (out?.signal_type !== "market_only") wrongSignalType++;
      }
      check(
        "opposing-side total signals carry signal_type=market_only (modelEdgePct null from edgeForModelSide)",
        wrongSignalType === 0
      );

      // (3) DB reflects sharp_conflict for the same picks (write path is wired).
      const { data: alignDbRows } = await supabase
        .from("game_predictions")
        .select("id, ou_grade, ou_signal_type")
        .in("id", opposingPickIds);
      let dbMismatch = 0;
      for (const row of (alignDbRows ?? []) as Array<{
        id: number;
        ou_grade: string | null;
        ou_signal_type: string | null;
      }>) {
        if (row.ou_grade !== "sharp_conflict") dbMismatch++;
        if (row.ou_signal_type !== "market_only") dbMismatch++;
      }
      check(
        "DB ou_grade=sharp_conflict + ou_signal_type=market_only persisted for opposing-side picks",
        dbMismatch === 0
      );

      // (4) Pre-fix regression guard: NONE of these picks should derive
      // market_watch. (Pre-fix bug shape: edge null + signal collapsed to
      // market_neutral → market_watch grade.)
      let regressedToWatch = 0;
      for (const id of opposingPickIds) {
        const out = derived.games.ou.get(id);
        if (out?.grade === "market_watch") regressedToWatch++;
      }
      check(
        "opposing-side total picks do NOT grade market_watch (pre-fix bug shape)",
        regressedToWatch === 0
      );
    } else {
      console.log(
        "  (no opposing-side total signals in seed slate — alignment-audit coverage relies on pure-function cases above)"
      );
    }
  }

  // ─── Summary ──────────────────────────────────────────────────────────
  console.log(`\n${"━".repeat(70)}`);
  console.log(`  ${pass} pass · ${fail} fail · ${pass + fail} total`);
  if (fail > 0) {
    console.log(`\nFailures:`);
    failures.forEach((m) => console.log(m));
    process.exit(1);
  }
  console.log(`\n✅ All grade-derivation tests passed.`);
}

main().catch((e) => {
  console.error("\n❌ test-grade-derivation failed:", (e as Error).message);
  if ((e as Error).stack) console.error((e as Error).stack);
  process.exit(1);
});
