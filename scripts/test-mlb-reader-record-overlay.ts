import { strict as assert } from "node:assert";

import { mergeUnlockedMlbMoneylineCalibrationContext } from "../app/api/lab/daily-edge/mlbRecordOverlay";

const current = {
  mlb_data_completeness: {
    status: "ready",
    can_publish_normal: true,
    missing_fields: [],
  },
  posted_lines: {
    total: {
      book: "pinnacle",
      side: "over",
      line_value: 6.5,
      odds_american: -122,
      observed_at: "2026-10-19T22:29:01.307Z",
    },
  },
  v2_2_audit: {
    ou_model_prob: 0.523482,
    ou_market_prob: 0.534572,
    over_odds_american: -122,
    under_odds_american: 109,
  },
  fi_v2_audit: { fi_pick: "NRFI" },
};

const olderMoneylineRecord = {
  pick_calibration: {
    applied: true,
    rule_id: "mlb_ml_raw_model_side_pick_calibration_v1",
    calibrated_side: "away",
  },
  mlb_data_completeness: {
    status: "incomplete_missing_required_data",
    can_publish_normal: false,
    missing_fields: ["over_price", "under_price"],
  },
  posted_lines: {
    total: {
      book: "betonline",
      side: "under",
      line_value: 6.5,
      odds_american: -110,
    },
  },
  v2_2_audit: {
    ou_model_prob: 0.51,
    over_odds_american: null,
    under_odds_american: null,
  },
  fi_v2_audit: { fi_pick: "Toss-Up" },
};

const merged = mergeUnlockedMlbMoneylineCalibrationContext(
  current,
  olderMoneylineRecord,
);

assert.deepEqual(
  merged.pick_calibration,
  olderMoneylineRecord.pick_calibration,
  "the stored Moneyline calibration audit must remain available",
);
assert.equal(
  (merged.mlb_data_completeness as { can_publish_normal: boolean }).can_publish_normal,
  true,
  "an older Moneyline record must not restore a stale game-wide completeness hold",
);
assert.deepEqual(
  merged.posted_lines,
  current.posted_lines,
  "an older Moneyline record must not replace the current Total price context",
);
assert.deepEqual(
  merged.v2_2_audit,
  current.v2_2_audit,
  "an older Moneyline record must not replace the current Total probability/price audit",
);
assert.deepEqual(
  merged.fi_v2_audit,
  current.fi_v2_audit,
  "an older Moneyline record must not replace current first-inning evidence",
);

const untouched = mergeUnlockedMlbMoneylineCalibrationContext(current, {
  pick_calibration: { applied: false },
  mlb_data_completeness: olderMoneylineRecord.mlb_data_completeness,
});
assert.equal(
  untouched,
  current,
  "a non-applied calibration record must not create any reader overlay",
);

console.log("MLB reader record-overlay tests passed.");
