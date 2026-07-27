# MLB Daily Edge unified FI neutralization — r13

Date: 2026-07-27

## Release

- Public calibration: `mlb_public_calibration_v12_2026_07_27`
- Decision release: `mlb_daily_edge_decision_2026_07_27_r13`
- Rule bundle: `mlb_daily_edge_rule_bundle_v14_2026_07_27`
- Grade policy: `mlb_public_grade_policy_v12_model_first_unified_fi_cleanup_2026_07_27`
- Tracking contract: `member_facing_lock_v6_unified_unlocked_release_stamps_2026_07_27`

## Scope

r12 correctly restored model-first moneyline and total grades and completed one
coordinated production cycle. Live verification found one remaining unlocked
First Inning row that had been neutralized from YRFI to Toss-Up at the top
level, but still carried its r9 snapshot and calibration stamp.

r13 makes the existing authoritative stale-FI cleanup update the complete
unlocked record coherently:

- top-level pick/actionability
- calibration version
- model-layer release stamp
- decision pipeline
- member-facing snapshot
- explicit cleanup audit

Locked rows remain immutable and are never changed.

## Prediction and board impact

This does not add or remove a prediction rule and does not promote or demote an
actionable play. It only makes an already non-actionable held/Toss-Up row carry
the current release identity everywhere.

Expected current-board impact:

- Best Angles: 0
- Leans: 0
- Watchlists: 0
- No Play/Toss-Up display: 0
- stale unlocked release stamps: 1 -> 0

The r12 moneyline and total model-first/additive-rule behavior is unchanged,
including the validated `-160` through `-131` moneyline Best Angle sleeve.

## Runtime safety

- No new writer, cron, refresh, or provider call.
- The cleanup remains inside the authoritative prediction-record sync.
- The shared sport-scoped `prediction_pipeline` lease remains unchanged.
- Each row update includes `locked_at IS NULL` as a final write guard.
- Tracking history and locked rows are not rewritten.
