# NFL Player Props QB Passing-Yards Projection Repair — Predeclaration

Date: 2026-09-01  
Owner authorization: Daniel Mengel explicitly authorized a production repair of the quarterback passing-yards product gap and asked that it ship before the separate retail-market discussion.

## Defect and scope

The current Week 1 board exposed complete quarterback passing-yards offers but the incumbent unconditional runtime projected several established expected starters at implausible backup-scale volume (for example Patrick Mahomes near 103 yards against 225.5–227.5 offers). Because DraftKings and FanDuel commonly post different passing-yard lines, the same-line-only comparison then compared each target offer to its own no-vig probability and collapsed almost every edge toward zero.

This release changes only NFL quarterback `passing_yards` rows. It does not alter passing attempts, completions, rushing, receiving, receptions, touchdowns, Daily Edge, providers, collection cadence, cron ownership, database schema, stakes, locks, settlement, or the sole `prediction_pipeline:nfl` writer.

The candidate also corrects two test-only verification defects. `scripts/test-nfl-r6-shadow-writer.ts` expected superseded writer r17 even though protected main already runs the registered r18 serialized-history writer. `scripts/test-cfb-v1-production.ts` allowed its fixed August 29 opening-week fixture to use the real current date, so after the weekly rollover it filtered out its own only row. The assertions now target r18 and the fixture's declared August 29 evaluation time. Both repairs are required to let `verify:model-change` exercise the current production tree and change no runtime file or behavior.

## Frozen production behavior

- Apply only when the player is a quarterback who exactly matches the timestamped expected starting-quarterback identity and is `projected` or `confirmed` to start.
- Do not apply the starter adjustment when the player is Out, Inactive, on injured reserve, or Doubtful. The existing prediction remains present; no new hold is created.
- Estimate the displayed passing-yards center as 90% current complete primary-book market-implied center and 10% the median of prior passing-yards avg3, avg5, and EWM role inputs. One complete book may repair the projection, but one book can never authorize an action grade.
- For passing yards only, translate each target-book-excluded primary book's no-vig probability from its exact source line to the exact target line through the existing empirical passing-yards residual distribution.
- A positive exact target price/edge with at least one independent cross-line benchmark and non-adverse same-book movement may be shown as `Watchlist` only. A different-line book alone can never authorize `Lean` or `Best Angle`.
- Existing `Lean` and `Best Angle` thresholds and their independent same-line exact-book requirement remain unchanged. Adverse movement, identity/role problems, stale quotes, locks, and settlement remain fail-closed or immutable under their existing rules.
- Select one canonical primary line per sportsbook/player/market for cross-line inference so alternate ladders cannot multiply evidence.

## Frozen evaluation

Projection accuracy is evaluated chronologically on the existing 2025 exact-price cohort, trained only through 2024. The selection boundary is before 2025-11-01 and the later confirmation window begins 2025-11-01. The frozen candidate is compared with the incumbent scorer and the market line; no Week 1 game outcome is available or used.

The current Week 1 candidate must report exact before/after grades, actionable counts, projection range, unchanged-market identity, provider-call change, and writer/load change. Promotion is limited to non-actionable Watchlist visibility; an actionable-count reduction or any non-passing decision change is a release blocker.

## Release and rollback

This behavior receives new model, calibration, market-residual, decision, runtime, board, member, writer, and tracking identifiers while retaining the current exact-market-board, provider, runtime-artifact, settlement, writer lease, and rollback flags. Roll back by disabling `NFL_PLAYER_PROPS_MEMBER_ENABLED` for reader visibility or `NFL_PLAYER_PROPS_ENABLED` for future writer stages, without rewriting locked rows.
