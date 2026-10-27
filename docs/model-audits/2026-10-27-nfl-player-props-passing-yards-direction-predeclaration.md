# NFL player-props Passing Yards direction r38 — predeclaration

## Owner objective and scope

Daniel Mengel directed Oddsphere to improve player-prop prediction accuracy rather than cosmetically
balance Overs and Unders, and not to stop at a diagnosis. This candidate is restricted to future-
unlocked NFL Passing Yards forecasts. Existing locked projections, sides, probabilities, prices,
grades, evidence, and tracking rows remain immutable.

The independent Passing Yards point projection remains market-free. When its direction disagrees
with the fresh target-book-excluded Passing Yards market direction, the market direction may correct
the final posterior only if it is at least one percentage point from 50%. A sub-one-point market
toss-up, agreement, or missing target-excluded evidence retains the incumbent posterior. This is a
discrete market-reading rule, not continuous market weighting and not an Over quota.

Every other market, the exact-price grade policy, provider limits, cadence, member copy/layout, sole
writer, and `prediction_pipeline:nfl` lease remain unchanged.

## Frozen evaluation gates

1. Evaluate exact canonical member lines from release
   `nfl_player_props_decision_2026_10_15_r32_independent_rushing_yards` only.
2. Report Week 6 and Week 7 separately and combined.
3. Require candidate direction to improve in both chronological weeks.
4. Report every changed forecast as a correction or harm.
5. Report the existing actionable subset separately; no hidden actionable flattening is allowed.
6. Rehearse the current production board with `apply=false`; require full member-row retention,
   zero locked-row mutation, zero coherence failures, and explicit promotions/demotions.
7. Bump every affected runtime/member/writer/tracking release and update the authoritative registry.
8. Run the focused NFL props suite, TypeScript, `npm run verify:model-change`, latest-main integration
   safety, protected pull-request checks, and post-merge live release verification.

## Reproducible audit

`scripts/operator/audit-nfl-player-props-passing-yards-direction.ts` consumes the immutable Week 6
tracking export and Week 7 canonical-line export, explicitly normalizing their different probability
contracts, and performs zero provider or database calls. The current-board rehearsal uses
`scripts/operator/run-current-nfl-player-props-no-write.ts` with `apply=false`.

## Rollback

Restore the complete r37/r50/r64/r38 Passing Completions release family for future-unlocked rows and
rerun the existing sole writer. Never rewrite an r38 lock or any earlier locked payload.
