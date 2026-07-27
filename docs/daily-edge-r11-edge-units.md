# MLB Daily Edge reader edge-unit coherence — r11

Date: 2026-07-27

Decision release: `mlb_daily_edge_decision_2026_07_27_r11`

## Scope

r11 fixes a reader/evidence unit mismatch for MLB First Inning edges.
First Inning `prediction_records.edge` stores a probability delta, while the
Daily Edge DTO and deterministic evidence contracts use percentage points.
The reader previously treated that stored decimal as percentage points.
Moneyline and Total already store percentage points and remain unchanged.

For example, a stored edge of `0.069` incorrectly rendered and scored as
`0.1` percentage point instead of `6.9` percentage points.

This release changes no pick, side, probability, projection, grade, promotion,
demotion, flip, stake, lock, price, tracking outcome, writer, provider call,
cron, or refresh cadence.

## Authoritative path and load

The existing prediction writer and shared sport-scoped `prediction_pipeline`
lease remain unchanged. The fix is a pure conversion in the existing Daily
Edge reader and locked-evidence rehydration paths. It adds no database query,
write, provider request, background job, or refresh.

## Board impact

- Best Angles promoted: 0
- Best Angles demoted: 0
- Leans promoted: 0
- Leans demoted: 0
- Picks or sides changed: 0
- Net actionable-board change: 0

First Inning displayed edge and deterministic evidence strength are corrected
from decimal probability units to percentage points. Top-angle ordering may
change only to reflect the already-stored official FI edge correctly.

## Versioning

- public calibration: `mlb_public_calibration_v10_2026_07_27`
- decision release: `mlb_daily_edge_decision_2026_07_27_r11`
- rule bundle: `mlb_daily_edge_rule_bundle_v12_2026_07_27`
- tracking/reader contract:
  `member_facing_lock_v4_edge_units_coherent_writer_authority_2026_07_27`

Probability heads, projection core, grade policy, and correction policy are
unchanged.

## Verification

Run the edge-unit focused test, Daily Edge reader and writer suites,
`npm run verify:model-change`, TypeScript, production build, a zero-grade-impact
comparison, and the live health/coherence checks. Locked historical rows retain
their original prediction release and results.
