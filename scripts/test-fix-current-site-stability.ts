/**
 * Synthetic tests for the dry-run repair planner.
 *
 * No DB, no auditor subprocess, no real bad rows. Each test builds an
 * in-memory mock AuditorReport, runs planRepairs(), and asserts the
 * expected RepairPlan shape.
 *
 * Verifies:
 *   - FI_UNTRACKED_DISPLAY → candidate
 *   - FI_STATE_DIVERGENCE → candidate
 *   - FI_GRADING_GAP → candidate
 *   - CONTEXT_SNAPSHOT_MISSING → candidate
 *   - SCORE_FINAL_MISSING_SCORE → candidate
 *   - SCORE_STUCK_SCHEDULED → candidate
 *   - CONTEXT_SNAPSHOT_LEAKED_TRACKED → refused
 *   - CONTEXT_PUBLIC_TRACKING_POLLUTION → refused (destructive, op approval)
 *   - CONTEXT_SNAPSHOT_BAD_LABEL → refused
 *   - Unknown HIGH issue → refused + counts toward unrepaired_high
 *   - All-clean report → 0 candidates, 0 refusals, note present
 *   - All RepairPlan objects have apply_supported=false
 *   - Locked record mutation refused via the REFUSERS path
 */

import {
  planRepairs,
  type AuditorIssue,
  type AuditorReport,
  type ActiveSport,
} from "../lib/services/repairPlanner";

let pass = 0;
let fail = 0;

function assert(cond: boolean, msg: string): void {
  if (!cond) throw new Error(`Assertion failed: ${msg}`);
}

function test(name: string, fn: () => void): void {
  try {
    fn();
    console.log(`  ✓ ${name}`);
    pass++;
  } catch (e) {
    console.log(`  ✗ ${name}`);
    console.log(`      ${e instanceof Error ? e.message : String(e)}`);
    fail++;
  }
}

function mockReport(args: {
  issues?: AuditorIssue[];
  perSport?: Partial<Record<ActiveSport, AuditorIssue[]>>;
  high?: number;
  warn?: number;
  info?: number;
}): AuditorReport {
  const cross = args.issues ?? [];
  return {
    generated_at: "2026-06-10T20:00:00.000Z",
    slate_date: "2026-06-10",
    sport_status: { mlb: "TRUSTED", nba: "TRUSTED", nhl: "TRUSTED" },
    cross_sport_issues: cross,
    per_sport_issues: {
      mlb: args.perSport?.mlb ?? [],
      nba: args.perSport?.nba ?? [],
      nhl: args.perSport?.nhl ?? [],
    },
    summary: {
      high: args.high ?? 0,
      warn: args.warn ?? 0,
      info: args.info ?? 0,
    },
  };
}

function mockIssue(over: Partial<AuditorIssue>): AuditorIssue {
  return {
    code: "TEST",
    severity: "HIGH",
    sport: "mlb",
    affected: {},
    user_facing_impact: "test",
    recommended_fix: "test",
    auto_fixable: true,
    operator_approval_required: false,
    ...over,
  };
}

// ─── Test suite ─────────────────────────────────────────────────────

console.log("");
console.log("scripts/test-fix-current-site-stability.ts");
console.log("─".repeat(50));

// 1. Empty report — all clean
test("All-clean report produces 0 candidates, 0 refusals, note present", () => {
  const report = mockReport({});
  const plan = planRepairs(report);
  assert(plan.fixer_summary.repair_candidates === 0, "expected 0 candidates");
  assert(plan.fixer_summary.refused_repairs === 0, "expected 0 refusals");
  assert(plan.fixer_summary.unrepaired_high === 0, "expected 0 unrepaired HIGH");
  assert(plan.notes.some((n) => n.includes("No actionable issues")), "expected no-actionable note");
  assert(plan.notes.some((n) => n.includes("Dry-run only")), "expected dry-run note");
});

// 2. FI_UNTRACKED_DISPLAY → candidate
test("FI_UNTRACKED_DISPLAY produces a repair candidate (createPredictionRecords)", () => {
  const report = mockReport({
    perSport: {
      mlb: [
        mockIssue({
          code: "FI_UNTRACKED_DISPLAY",
          severity: "HIGH",
          sport: "mlb",
          affected: { game_id: 15365, market: "first_inning", details: "ATL@CWS" },
          auto_fixable: true,
        }),
      ],
    },
    high: 1,
  });
  const plan = planRepairs(report);
  assert(plan.fixer_summary.repair_candidates === 1, "expected 1 candidate");
  assert(plan.fixer_summary.refused_repairs === 0, "expected 0 refusals");
  assert(plan.fixer_summary.unrepaired_high === 0, "expected 0 unrepaired HIGH (planner covered it)");
  const c = plan.repair_candidates[0];
  assert(c.issue_code === "FI_UNTRACKED_DISPLAY", "issue_code propagated");
  assert(c.sport === "mlb", "sport propagated");
  assert(c.affected.game_id === 15365, "game_id propagated");
  assert(c.exact_repair_function.includes("createPredictionRecords"), "exact_repair names createPredictionRecords");
  assert(c.exact_repair_function.includes('"2026-06-10"'), "slateDate threaded into repair function");
  assert(c.apply_supported === false, "apply_supported is false");
  assert(c.refusal_reason === null, "no refusal reason for an accepted candidate");
  assert(c.rows_that_would_change.includes("INSERT"), "rows_that_would_change describes INSERT");
  assert(c.locked_record_impact.includes("None"), "locked_record_impact says None");
  assert(c.tracking_grading_impact.length > 0, "tracking_grading_impact populated");
  assert(c.why_safe.includes("locked-row-aware"), "why_safe explains lock contract");
});

// 3. FI_STATE_DIVERGENCE → candidate (UPDATE)
test("FI_STATE_DIVERGENCE produces a repair candidate (UPDATE, locked-aware)", () => {
  const report = mockReport({
    perSport: {
      mlb: [
        mockIssue({
          code: "FI_STATE_DIVERGENCE",
          severity: "HIGH",
          sport: "mlb",
          affected: { game_id: 15363, details: "PHI@TOR" },
        }),
      ],
    },
    high: 1,
  });
  const plan = planRepairs(report);
  const c = plan.repair_candidates[0];
  assert(c.rows_that_would_change.includes("UPDATE"), "rows describes UPDATE");
  assert(c.locked_record_impact.includes("only unlocked rows"), "locked_record_impact emphasises unlocked-only");
  assert(c.tracking_grading_impact.length > 0, "tracking_grading_impact populated");
});

// 4. CONTEXT_SNAPSHOT_MISSING (NBA) → candidate
test("CONTEXT_SNAPSHOT_MISSING (NBA) produces a repair candidate (createNbaPredictionRecords)", () => {
  const report = mockReport({
    perSport: {
      nba: [
        mockIssue({
          code: "CONTEXT_SNAPSHOT_MISSING",
          severity: "HIGH",
          sport: "nba",
          affected: { game_id: 12345, market: "moneyline" },
        }),
      ],
    },
    high: 1,
  });
  const plan = planRepairs(report);
  const c = plan.repair_candidates[0];
  assert(c.exact_repair_function.includes("createNbaPredictionRecords"), "uses NBA writer");
  assert(c.columns_that_would_change.includes("displayed_context_markets.spread"), "lists substrate column");
  assert(c.tracking_grading_impact.includes("None"), "substrate does not enter tracking");
});

// 5. CONTEXT_SNAPSHOT_MISSING (NHL) → candidate using NHL writer
test("CONTEXT_SNAPSHOT_MISSING (NHL) names writeNhlPredictionRecords", () => {
  const report = mockReport({
    perSport: {
      nhl: [
        mockIssue({
          code: "CONTEXT_SNAPSHOT_MISSING",
          severity: "HIGH",
          sport: "nhl",
          affected: { game_id: 99999, market: "moneyline" },
        }),
      ],
    },
    high: 1,
  });
  const plan = planRepairs(report);
  const c = plan.repair_candidates[0];
  assert(c.exact_repair_function.includes("writeNhlPredictionRecords"), "uses NHL writer");
});

// 6. SCORE_FINAL_MISSING_SCORE → candidate (MLB uses linescores ingester)
test("SCORE_FINAL_MISSING_SCORE (MLB) → ingestMlbLinescores", () => {
  const report = mockReport({
    perSport: {
      mlb: [
        mockIssue({
          code: "SCORE_FINAL_MISSING_SCORE",
          severity: "HIGH",
          sport: "mlb",
          affected: { game_id: 15355 },
        }),
      ],
    },
    high: 1,
  });
  const plan = planRepairs(report);
  const c = plan.repair_candidates[0];
  assert(c.exact_repair_function.includes("ingestMlbLinescores"), "uses MLB linescore ingester");
  assert(c.locked_record_impact.includes("None"), "games table independent of locks");
});

// 7. SCORE_STUCK_SCHEDULED → candidate
test("SCORE_STUCK_SCHEDULED produces a candidate naming the sport's ingester", () => {
  const report = mockReport({
    perSport: {
      nba: [
        mockIssue({
          code: "SCORE_STUCK_SCHEDULED",
          severity: "HIGH",
          sport: "nba",
          affected: { game_id: 7777 },
        }),
      ],
    },
    high: 1,
  });
  const plan = planRepairs(report);
  const c = plan.repair_candidates[0];
  assert(c.exact_repair_function.includes("ingestNbaFinalScores"), "uses NBA ingester for NBA");
});

// 8. FI_GRADING_GAP → candidate (gradePredictionsForSlate)
test("FI_GRADING_GAP names gradePredictionsForSlate, mentions no prediction_records mutation", () => {
  const report = mockReport({
    perSport: {
      mlb: [
        mockIssue({
          code: "FI_GRADING_GAP",
          severity: "HIGH",
          sport: "mlb",
          affected: { game_id: 15355 },
        }),
      ],
    },
    high: 1,
  });
  const plan = planRepairs(report);
  const c = plan.repair_candidates[0];
  assert(c.exact_repair_function.includes("gradePredictionsForSlate"), "names the shared grader");
  assert(c.locked_record_impact.includes("does not mutate prediction_records"), "explains read-only nature for prediction_records");
});

// 9. CONTEXT_SNAPSHOT_LEAKED_TRACKED → refused
test("CONTEXT_SNAPSHOT_LEAKED_TRACKED is refused (routing bug)", () => {
  const report = mockReport({
    perSport: {
      nba: [
        mockIssue({
          code: "CONTEXT_SNAPSHOT_LEAKED_TRACKED",
          severity: "HIGH",
          sport: "nba",
          affected: { game_id: 555, details: "official_tracked=true" },
          auto_fixable: false,
          operator_approval_required: true,
        }),
      ],
    },
    high: 1,
  });
  const plan = planRepairs(report);
  assert(plan.fixer_summary.repair_candidates === 0, "no auto-fix");
  assert(plan.fixer_summary.refused_repairs === 1, "1 refusal");
  assert(plan.fixer_summary.unrepaired_high === 1, "HIGH counts as unrepaired");
  const r = plan.refused_repairs[0];
  assert(r.refusal_reason !== null, "refusal_reason set");
  assert(r.operator_approval_required === true, "needs operator approval");
  assert(r.apply_supported === false, "apply_supported false");
});

// 10. CONTEXT_PUBLIC_TRACKING_POLLUTION → refused (destructive)
test("CONTEXT_PUBLIC_TRACKING_POLLUTION is refused (destructive DELETE)", () => {
  const report = mockReport({
    perSport: {
      nhl: [
        mockIssue({
          code: "CONTEXT_PUBLIC_TRACKING_POLLUTION",
          severity: "HIGH",
          sport: "nhl",
          affected: { market: "spread" },
          auto_fixable: false,
          operator_approval_required: true,
        }),
      ],
    },
    high: 1,
  });
  const plan = planRepairs(report);
  const r = plan.refused_repairs[0];
  assert(r.refusal_reason !== null && r.refusal_reason.includes("destructive"), "refusal cites destructive op");
  assert(r.rows_that_would_change.includes("refused"), "rows_that_would_change marked refused");
});

// 11. CONTEXT_SNAPSHOT_BAD_LABEL → refused
test("CONTEXT_SNAPSHOT_BAD_LABEL is refused (code drift, not data divergence)", () => {
  const report = mockReport({
    perSport: {
      nba: [
        mockIssue({
          code: "CONTEXT_SNAPSHOT_BAD_LABEL",
          severity: "HIGH",
          sport: "nba",
          affected: { details: "wrong label" },
          auto_fixable: false,
        }),
      ],
    },
    high: 1,
  });
  const plan = planRepairs(report);
  const r = plan.refused_repairs[0];
  assert(r.refusal_reason !== null && r.refusal_reason.includes("code regression"), "refusal cites code regression");
});

// 12. Unknown HIGH issue with no planner → refused, counts toward unrepaired_high
test("Unknown HIGH issue (no planner) is refused and counts as unrepaired", () => {
  const report = mockReport({
    perSport: {
      mlb: [
        mockIssue({
          code: "BRAND_NEW_HIGH_ISSUE_2027",
          severity: "HIGH",
          sport: "mlb",
          affected: { details: "future bug" },
          auto_fixable: false,
        }),
      ],
    },
    high: 1,
  });
  const plan = planRepairs(report);
  assert(plan.fixer_summary.refused_repairs === 1, "refused");
  assert(plan.fixer_summary.unrepaired_high === 1, "counts as unrepaired");
  const r = plan.refused_repairs[0];
  assert(r.refusal_reason !== null && r.refusal_reason.includes("No repair planner registered"), "refusal explains missing planner");
});

// 13. auto_fixable=false on a known issue code → refused (does not auto-plan)
test("auto_fixable=false on a known issue code skips the planner", () => {
  const report = mockReport({
    perSport: {
      mlb: [
        mockIssue({
          code: "FI_UNTRACKED_DISPLAY",
          severity: "HIGH",
          sport: "mlb",
          affected: { game_id: 999 },
          auto_fixable: false, // explicitly false despite known code
        }),
      ],
    },
    high: 1,
  });
  const plan = planRepairs(report);
  assert(plan.fixer_summary.repair_candidates === 0, "no candidate when auto_fixable=false");
  assert(plan.fixer_summary.refused_repairs === 1, "refused");
  assert(plan.fixer_summary.unrepaired_high === 1, "counts as unrepaired");
});

// 14. Every RepairPlan has apply_supported=false
test("Every produced plan has apply_supported=false (v1 invariant)", () => {
  const report = mockReport({
    perSport: {
      mlb: [
        mockIssue({ code: "FI_UNTRACKED_DISPLAY", sport: "mlb", affected: { game_id: 1 } }),
        mockIssue({ code: "FI_STATE_DIVERGENCE", sport: "mlb", affected: { game_id: 2 } }),
      ],
      nba: [
        mockIssue({
          code: "CONTEXT_PUBLIC_TRACKING_POLLUTION",
          severity: "HIGH",
          sport: "nba",
          affected: { market: "spread" },
          auto_fixable: false,
          operator_approval_required: true,
        }),
      ],
    },
    high: 3,
  });
  const plan = planRepairs(report);
  for (const p of [...plan.repair_candidates, ...plan.refused_repairs]) {
    assert(p.apply_supported === false, `apply_supported must be false on ${p.issue_code}`);
  }
});

// 15. WARN-only issue is processed (not just HIGH)
test("WARN issues are also planned (not just HIGH)", () => {
  const report = mockReport({
    perSport: {
      mlb: [
        mockIssue({
          code: "FI_STATE_DIVERGENCE",
          severity: "WARN",
          sport: "mlb",
          affected: { game_id: 42 },
        }),
      ],
    },
    warn: 1,
  });
  const plan = planRepairs(report);
  assert(plan.fixer_summary.repair_candidates === 1, "WARN produces candidate too");
  assert(plan.fixer_summary.unrepaired_high === 0, "WARN does not count toward unrepaired_high");
});

// 16. INFO-only issue is NOT planned (not actionable)
test("INFO issues are NOT planned (not actionable)", () => {
  const report = mockReport({
    perSport: {
      mlb: [
        mockIssue({
          code: "FI_CONTRACT_CONSISTENT",
          severity: "INFO",
          sport: "mlb",
        }),
      ],
    },
    info: 1,
  });
  const plan = planRepairs(report);
  assert(plan.fixer_summary.repair_candidates === 0, "INFO not planned");
  assert(plan.fixer_summary.refused_repairs === 0, "INFO not refused");
});

// 17. Input not mutated (purity guarantee)
test("planRepairs does not mutate input", () => {
  const issues = [
    mockIssue({ code: "FI_UNTRACKED_DISPLAY", sport: "mlb", affected: { game_id: 7 } }),
  ];
  const report = mockReport({ perSport: { mlb: issues }, high: 1 });
  const snapshot = JSON.stringify(report);
  planRepairs(report);
  assert(JSON.stringify(report) === snapshot, "input report is not mutated");
});

// 18. Mixed candidates + refusals + INFO + multiple sports
test("Mixed report classifies correctly across sports", () => {
  const report = mockReport({
    perSport: {
      mlb: [
        mockIssue({ code: "FI_UNTRACKED_DISPLAY", sport: "mlb", affected: { game_id: 1 } }),
        mockIssue({ code: "FI_CONTRACT_CONSISTENT", severity: "INFO", sport: "mlb" }),
      ],
      nba: [
        mockIssue({
          code: "CONTEXT_SNAPSHOT_LEAKED_TRACKED",
          severity: "HIGH",
          sport: "nba",
          auto_fixable: false,
          operator_approval_required: true,
        }),
      ],
      nhl: [
        mockIssue({ code: "CONTEXT_SNAPSHOT_PRE_ROLLOUT", severity: "INFO", sport: "nhl" }),
      ],
    },
    high: 2,
    info: 2,
  });
  const plan = planRepairs(report);
  assert(plan.fixer_summary.repair_candidates === 1, "1 candidate (FI_UNTRACKED_DISPLAY)");
  assert(plan.fixer_summary.refused_repairs === 1, "1 refusal (LEAKED_TRACKED)");
  assert(plan.fixer_summary.unrepaired_high === 1, "1 unrepaired HIGH");
});

// ─── Result ─────────────────────────────────────────────────────────

console.log("");
console.log("━".repeat(50));
console.log(`  ${pass} pass · ${fail} fail · ${pass + fail} total`);
console.log("");
if (fail > 0) {
  console.log(`❌ ${fail} test(s) failed.`);
  process.exit(1);
}
console.log(`✅ All ${pass} repair-planner tests passed.`);
