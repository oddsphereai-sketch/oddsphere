import {
  preserveTrackingDisplayGradeOverride,
} from "../lib/services/predictionRecordService";
import type { PredictionRecordRow } from "../lib/types/domain/Tracking";

function check(label: string, condition: boolean): void {
  if (!condition) throw new Error(`FAIL: ${label}`);
  console.log(`  ${condition ? "✓" : "✗"} ${label}`);
}

const base = {
  snapshot_json: { generated: "fresh" },
  play_grade: "market_aligned",
  best_angle: false,
  no_bet: true,
} as unknown as PredictionRecordRow;

const preserved = preserveTrackingDisplayGradeOverride(base, {
  tracking_display_grade_override: "best_angle",
  tracking_repair_audit: { reason: "operator_verified" },
  stale_generated_field: "must_not_survive",
});

console.log("\n━━━ prediction-record override persistence ━━━\n");
check("scheduled rebuild preserves explicit override", preserved.snapshot_json?.tracking_display_grade_override === "best_angle");
check("scheduled rebuild preserves correction audit", (preserved.snapshot_json?.tracking_repair_audit as { reason?: string })?.reason === "operator_verified");
check("scheduled rebuild keeps fresh generated snapshot", preserved.snapshot_json?.generated === "fresh");
check("scheduled rebuild does not retain unrelated stale fields", preserved.snapshot_json?.stale_generated_field === undefined);
check("Best Angle correction clears No Play state", preserved.play_grade === "best_angle" && preserved.best_angle === true && preserved.no_bet === false);

const normal = preserveTrackingDisplayGradeOverride(base, { unrelated: true });
check("normal rows remain model-owned", normal === base);

const cleared = preserveTrackingDisplayGradeOverride(base, {
  tracking_display_grade_override: null,
});
check("clearing the override returns ownership to the model", cleared === base);
