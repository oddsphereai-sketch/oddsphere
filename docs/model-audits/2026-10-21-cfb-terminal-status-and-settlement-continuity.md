# CFB terminal-status and settlement continuity

Date: 2026-10-21
Base: `c9098cdc3d98ee660a41a9869e4be09e0189af28`

## Problem

The CFB evidence writer upserted provider game status without consulting the
existing canonical game row. A stale scheduled payload could therefore regress
an already-final or in-progress game. The multi-sport tracking refresh also
reached CFB late enough to collide repeatedly with the sole writer's normal
five-minute lease opportunities. The result was an operational gap in score
settlement and tracking, not a predictive-model deficiency.

## Repair

- Writer release:
  `cfb_forward_evidence_writer_2026_10_20_r132_terminal_status_immutability`.
- Tracking publication release:
  `tracking_refresh_publication_2026_10_20_r3_cfb_collision_avoidance`.
- Existing final status wins over stale non-final input.
- Existing in-progress status wins over stale scheduled input.
- Genuine scheduled-to-live and live-to-final advances remain allowed.
- Scheduled tracking processes CFB first at minute `:33`, before the writer's
  usual `:35`/`:40` lease opportunities.

The repair changes no prediction, projection, probability, side, price, grade,
stake, T-60 payload, or locked record. It ensures the actual result survives
long enough to settle the exact immutable prediction that members saw.

## Verification

- CFB production contract passed.
- Tracking-refresh helper suite passed 45/45.
- Current-refresh schedule contract passed.
- Repository-wide `npm run verify:model-change` passed.
- Unit coverage proves final-to-scheduled and live-to-scheduled regression are
  rejected while legitimate forward status movement is retained.

Rollback is r131/r2 for future writer/refresh operations only. Existing game
results and every locked prediction remain unchanged.
