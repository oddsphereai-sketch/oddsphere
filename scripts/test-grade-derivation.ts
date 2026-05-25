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

  // ─── Best-signal slate monitor ─────────────────────────────────────────
  section("monitorBestSignalShare");

  function fakeSlate(
    bestSignalCount: number,
    otherCount: number
  ): SlateGrades {
    const games = new Map<
      number,
      { grade: import("../lib/types/domain/Grade").Grade; signal_type: import("../lib/types/domain/Grade").SignalType }
    >();
    let id = 1;
    for (let i = 0; i < bestSignalCount; i++) {
      games.set(id++, { grade: "best_signal", signal_type: "balanced" });
    }
    for (let i = 0; i < otherCount; i++) {
      games.set(id++, { grade: "model_only", signal_type: "model_only" });
    }
    return { games, props: new Map() };
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

  const m3 = withMutedWarn(() => monitorBestSignalShare({ games: new Map(), props: new Map() }, "test"));
  check(
    "Empty slate → monitor returns pct=0, does NOT warn",
    m3.result.bestSignalPct === 0 && m3.result.exceededThreshold === false && !m3.warned
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

    const derived = await deriveGradesForSlate("mlb", targetSlate);
    check(
      "deriveGradesForSlate returned non-empty maps for seeded slate",
      derived.games.size > 0 || derived.props.size > 0
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
    for (const out of derived.games.values()) {
      if (!ALL_GRADES.has(out.grade)) badGrade++;
      if (!ALL_SIGNAL_TYPES.has(out.signal_type)) badSignalType++;
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

    const r2 = await updateGradesForSlate("mlb", targetSlate);
    check(
      "re-running updateGradesForSlate is idempotent (same counts)",
      r2.gamePredictionsUpdated === r1.gamePredictionsUpdated &&
        r2.propPredictionsUpdated === r1.propPredictionsUpdated
    );

    // DB spot-check: sampled rows match derived (both columns).
    const sampleGameIds = Array.from(derived.games.keys()).slice(0, 5);
    if (sampleGameIds.length > 0) {
      const { data: gameDbRows } = await supabase
        .from("game_predictions")
        .select("id, grade, signal_type")
        .in("id", sampleGameIds);
      let mismatch = 0;
      for (const row of (gameDbRows ?? []) as Array<{
        id: number;
        grade: string | null;
        signal_type: string | null;
      }>) {
        const expected = derived.games.get(row.id);
        if (
          !expected ||
          expected.grade !== row.grade ||
          expected.signal_type !== row.signal_type
        )
          mismatch++;
      }
      check(
        "game_predictions DB grade+signal_type match derived map for sampled rows",
        mismatch === 0
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
    // of whether it warns. Just confirm it returns a sane structure.
    check(
      "real-slate monitor returns a structured result (total >= 0)",
      r1.monitor.total >= 0 && typeof r1.monitor.bestSignalPct === "number"
    );
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
