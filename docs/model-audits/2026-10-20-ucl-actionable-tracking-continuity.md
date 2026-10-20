# UCL actionable tracking continuity — 2026-10-20

## Decision

Repair the UCL Best Angle / Lean Tracking reader and snapshot publication path.
Do not change the UCL model, grades, locked records, or settlement results.

## Production symptom

The member panel showed no historical UCL Best Angles and only a pending Lean.
The underlying locked prediction and grade rows were present. The stored member
snapshot was generated before the soccer/UCL settlement pass had completed, and
the panel sourced its rows from the current-release-only aggregate.

Three independent reader defects combined:

1. UCL's current-release filter correctly protected current-model performance,
   but the Best Angle / Lean panel incorrectly reused that same lifetime cut.
2. Six immutable historical UCL rows stored the visible label `Best Angle`;
   the reader compared only the internal key `best_angle`.
3. The multi-sport tracking refresh published after NBA but did not republish
   after the later soccer/UCL grading work.

## Repair

- Preserve `overall`, `bestAngles`, `leans`, and `bySportMarket` as the exact
  current-release aggregate.
- Add `actionableHistory`, calculated from the same immutable, complete-manifest
  calendar rows already used for date windows.
- Use `actionableHistory.bySportMarket` only for the Best Angle / Lean panel.
- Normalize stored display-grade separators at read time, so `Best Angle` and
  `best_angle` resolve to the same released verdict.
- Retain the early NBA snapshot checkpoint and add a final NHL checkpoint to
  the same existing refresh route/writer. A one-sport operator refresh remains
  self-publishing.
- Reject stored snapshots that predate the `actionableHistory` contract.

There is no database migration, backfill, grade rewrite, lock reconstruction,
or model-output change.

## Read-only live rehearsal

Against the production database on 2026-10-20:

| Scope | Best Angles | Leans | Overall |
| --- | ---: | ---: | ---: |
| Current r11/r13 release | 0 | 3-1 (4) | 22-6 (28) |
| Immutable actionable history | 5-1 (6) | 26-7 (33) | Not presented as current-model performance |

All 39 actionable-history rows were settled: zero pending. Historical Best
Angles are all Match Result (5-1). Historical Leans are BTTS 14-4, Match Result
2-0, and Total 10-3.

## Version boundary

- Aggregate: `tracking_aggregate_v18_ucl_actionable_history_2026_10_20`
- Shared cache: `member-tracking-aggregate-v13-ucl-actionable-history`
- Stored snapshot key: `tracking-foundation-r10-ucl-actionable-history`
- Snapshot payload: `tracking-foundation-v8-ucl-actionable-history`
- Publication: `tracking_refresh_publication_2026_10_20_r2_nba_and_final_checkpoint`

## Acceptance and rollback

Acceptance requires focused tracking tests, TypeScript, the repository
model-change verification, clean latest-main integration safety, protected PR
checks, and post-deploy confirmation that the new snapshot reports the exact
records above. Roll back these five reader/publication identifiers together if
current-model metrics blend releases, the actionable history differs from the
immutable locked grades, or the final checkpoint fails. Never alter existing
locked predictions or grades during rollback.
