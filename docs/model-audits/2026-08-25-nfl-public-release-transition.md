# NFL public release transition writer repair

Date: 2026-08-25

## Declared scope

- Sport: NFL.
- Markets: Moneyline, Spread, and Total publication timing only.
- Model / calibration / decision / grade policy: unchanged at the qualified r3 / r3 / r9 / r9 releases.
- Reader: unchanged and still fails closed on stale or mixed releases.
- Writer / cron: the single `/api/cron/nfl-forward-evidence` path under the existing `prediction_pipeline:nfl` lease.
- Tracking and stakes: unchanged; preseason remains excluded and official records still require an on-time T-60 tuple. No stake sizing is authorized.

## Production defect

After PR #205 deployed, the 2026-08-25 09:21 ET natural writer run completed successfully with zero calls and zero writes. The latest stored rows used the reusable r3 evidence schema, so ordinary cadence logic treated them as current even though all 16 rows carried member release `nfl_v1_member_release_2026_08_24_r3_grading_tiers` and all 48 decisions carried `nfl_v1_daily_edge_decision_2026_08_24_r3_grading_tiers`, rather than the active r6/r9 tuple. The member reader correctly rejected those rows, leaving the Week 1 board held at zero games until the next six-hour provider refresh.

## Repair

Writer release `nfl_forward_evidence_writer_2026_08_25_r8_release_refresh` checks only upcoming games that remain before T-60. Before accepting a cadence skip, each latest row must contain exactly three current r9 decisions under the current r6 member release. A stale or incomplete public tuple forces one normal provider-backed unlocked wave on the next scheduled cycle. T-60 work retains priority, while completed and no-unlocked slates cannot trigger release-transition calls. The writer does not mutate old rows, copy their price forward, fabricate a fresh timestamp, create a second writer, bypass the lease, or invoke providers from a member request.

Once a current public tuple exists, ordinary six-hour/hourly/T-60 cadence resumes unchanged. A genuinely current health-held row is not retried merely because it has zero evaluated bets.

## Board impact and rollback

- Prediction, probability, side, grade, stake, promotion, and demotion impact: zero.
- Availability impact for this transition: the coherent current release becomes eligible to restore the qualified 16-game / 48-market board on the next natural writer wave.
- Rollback: restore r7 writer behavior. The reader will continue to fail closed; immutable evidence and tracking records are untouched.
