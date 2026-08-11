import assert from "node:assert/strict";
import {
  expectedFinalFiGradeFromResolution,
  isFinalFiGradeCoherent,
} from "../lib/services/dailyEdge/fiGradeCoherence";

const snapshot = (base: string, action?: string) => ({
  fi_v2_audit: { fi_play_grade: base },
  ...(action ? { fi_final_grade_resolution: { original_play_grade: base, action } } : {}),
});

assert.equal(expectedFinalFiGradeFromResolution({ baseGrade: "lean", snapshot: snapshot("lean") }), "lean");
assert.equal(expectedFinalFiGradeFromResolution({ baseGrade: "best_angle", snapshot: snapshot("best_angle", "demote_to_lean") }), "lean");
assert.equal(expectedFinalFiGradeFromResolution({ baseGrade: "lean", snapshot: snapshot("lean", "promote_to_best_angle") }), "best_angle");
assert.equal(expectedFinalFiGradeFromResolution({ baseGrade: "best_angle", snapshot: snapshot("best_angle", "block_to_no_bet") }), "no_bet");

assert.equal(isFinalFiGradeCoherent({ liveBaseGrade: "best_angle", recordGrade: "lean", snapshot: snapshot("best_angle", "demote_to_lean") }), true);
assert.equal(isFinalFiGradeCoherent({ liveBaseGrade: "lean", recordGrade: "best_angle", snapshot: snapshot("lean", "promote_to_best_angle") }), true);
assert.equal(isFinalFiGradeCoherent({ liveBaseGrade: "lean", recordGrade: "best_angle", snapshot: snapshot("lean") }), false);
assert.equal(isFinalFiGradeCoherent({ liveBaseGrade: "lean", recordGrade: "lean", snapshot: snapshot("best_angle") }), false);

console.log("FI final-grade coherence tests passed.");
