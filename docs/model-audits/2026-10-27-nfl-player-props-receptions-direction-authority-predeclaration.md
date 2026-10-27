# NFL player-props Receptions direction-authority predeclaration

Date: 2026-10-27
Starting production base: `3084ed45545ba8655b65b3e249993a4bb53dc0d1`

## Owner direction

Daniel Mengel directed Oddsphere to correct the player-props models' pervasive-looking Under
concentration by improving prediction accuracy rather than enforcing an Over quota, flattening the
board, or accepting an inaccurate model as the endpoint. NFL and NBA are the current priority.

## Fixed NFL candidate

This release is limited to future-unlocked NFL **Receptions** forecasts. The independent projection
keeps directional authority. Target-book-excluded market evidence may still calibrate probability
and the coherent decimal projection while it remains on the independent side; it may not cross the
offered line and reverse that side. Exact evaluated price, same-book movement, downstream grade
economics, every non-Receptions market, provider calls, cadence, UI, copy, labels, writer topology,
and the shared `prediction_pipeline:nfl` lease remain unchanged.

This is not a generic independent-only rule. It is a market-specific correction to the October 7
Receptions flip rule after two newer exact release-pure weeks showed that the independent direction
now carries the stronger transported signal. Existing locked rows retain their exact stored payloads
and release identities.

## Chronological evidence

The read-only audit used 341 exact canonical member-line Receptions outcomes from the current r32
model family across Weeks 6 and 7. It made zero writes and zero provider calls.

| Block | Incumbent | Candidate independent side |
| --- | ---: | ---: |
| Week 6 selection | 96-83 (53.6%) | 107-72 (59.8%) |
| Week 7 confirmation | 98-64 (60.5%) | 97-65 (59.9%) |
| Combined | 194-147 (56.9%) | 204-137 (59.8%) |

The candidate's combined Brier score improves from `0.24653` to `0.24278`. Preserving incumbent
calibration when it stays on the independent side and reverting only crossed directions lowers
projected-reception MAE from `1.52625` to `1.50258` and reduces projection bias from `-0.35064` to
`-0.39256`, rather than simply raising every projection. The direction mix changes from 147 Overs /
194 Unders to 143 / 198; the accuracy improvement is therefore not manufactured by adding Overs.

Rushing Yards remains unchanged. A market-direction replacement improved Week 6 from 44-44 to
49-39 but regressed Week 7 from 41-36 to 38-39. Blanket projection lifts and direction quotas remain
rejected.

## Mandatory remaining gates

- Recompute the current unlocked board and report all side changes, promotions, demotions, and
  actionable direction counts. Reject a hidden board collapse.
- Prove every non-Receptions numeric output is unchanged apart from release identifiers.
- Prove locked writer and reader precedence remains exact.
- Bump the complete affected release family and update the release registry in the same commit.
- Run focused runtime, production-contract, writer, cadence, tracking, TypeScript, and
  `npm run verify:model-change` checks.
- Rebase on the latest remote `main`, run integration safety from a clean committed worktree, publish
  only by protected pull request, and verify the deployed release plus the next natural writer cycle.

Rollback applies only to future-unlocked evaluation. Never rewrite a prior lock.
