# NFL Player Props scheduler-jitter cadence repair — October 19, 2026

## Scope and incident

- Authoritative path remains `/api/cron/nfl-forward-evidence` under the shared
  `prediction_pipeline:nfl` lease.
- Preceding cadence:
  `nfl_player_props_cadence_2026_10_07_r1_state_aware_refresh`.
- Candidate cadence:
  `nfl_player_props_cadence_2026_10_19_r2_scheduler_jitter_tolerance`.
- Writer remains `nfl_player_props_writer_2026_10_19_r57_stale_reference_retry`.

The first due-boundary verification after r57 deployed exposed a scheduler
alignment defect. The prior snapshot was generated at `13:21:09.464Z`; the
`14:21` production heartbeat began at `14:21:09.322Z`, 142 milliseconds before
the strict one-hour boundary. The planner therefore returned `not_due`, made
zero provider calls, and would not wake again until `14:36`, turning an hourly
policy into a 75-minute interval.

## Repair

The existing pure cadence planner permits at most one second of scheduler
jitter when comparing snapshot age with the released 60-, 30-, or 15-minute
interval. This is less than 0.12% of the shortest cadence and far below the
15-minute heartbeat interval. It cannot create a second writer, bypass the
lease, or flatten the board into every-heartbeat provider calls.

Focused tests prove that a wake 250 milliseconds before the exact hourly
boundary is due, while a wake 1.001 seconds early remains not due. Existing
missing-snapshot, invalid-time, T-60 lock, 60-minute, 30-minute, and 15-minute
cases remain covered.

## Model and lock impact

This is operational timing only. It changes no model input formula, projection,
probability, side, price selection, grade, promotion, demotion, actionability,
stake, provider ceiling, lock, tracking, settlement, copy, or layout. Board
count impact is therefore zero promotions, zero demotions, and zero change in
actionable count for the same writer input. Locked records retain exact stored
precedence.

Rollback only the cadence constant and comparison to r1 if production shows
provider calls outside the existing state-aware windows. Do not rewrite or
reconstruct any locked record.
