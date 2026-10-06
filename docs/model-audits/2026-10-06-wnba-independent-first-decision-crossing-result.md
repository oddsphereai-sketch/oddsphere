# WNBA independent-first decision-crossing arbitration — result

## Release decision

Status: accepted for production publication through the protected pull-request
path.

Predeclaration:
`docs/model-audits/2026-10-05-remaining-sport-market-reading-predeclaration.md`.

Starting production base:
`ece892b84c4efeca8909f9f99cb7e0e4c9fbc685`.

Released authorities:

- model: `wnba_v1_6_independent_first_decision_crossing`
- distribution:
  `wnba_coherent_normal_2026_10_06_v8_independent_first_decision_crossing`
- grade policy:
  `wnba_grade_policy_v11_independent_first_decision_crossing_2026_10_06`
- calibration schema remains:
  `wnba_core_calibration_v4_single_market_entry`

## Defect

The v1.5 path continuously centered every qualified Spread forecast at 25%
independent margin and 75% market-implied margin. That made the market a standing
forecast anchor even when it did not change a winner or Spread decision. It did
not match the current OddSphere contract: the sport model is primary and market
reading arbitrates only meaningful, verified disagreement.

## Accepted rule

The final margin now starts and remains at the independent coherent margin.
The existing target-excluded market center receives forecast authority only
when all of the following are true:

1. the evaluated sportsbook was fixed from the independent forecast and is
   excluded from market evidence;
2. the remaining complete, fresh, predecision pairs contain at least two books
   from two independently classified source families;
3. the qualified market center crosses the independent winner or exact Spread
   decision boundary; and
4. qualified Moneyline and Spread evidence do not imply contradictory winner
   regimes.

When accepted, the one final margin distribution regenerates Moneyline
probability, Spread probability, side, margin and both decimal team scores.
The independent Total projection and Total decision are unchanged. When the
evidence agrees without crossing, it remains available for price economics,
grade context and audit but does not continuously nudge the projection.

## Release-pure evidence

The SELECT-only replay used 42 settled forward captures, official scores, the
immutable capture-time release identifier and target-excluded market evidence.
It made zero writes and zero provider calls. The first 28 games were the
selection block and the last 14 were the untouched chronological confirmation
block.

| Cohort | Rule | Margin MAE | Team-score MAE | Winner | Spread |
| --- | --- | ---: | ---: | ---: | ---: |
| First 28 | v1.5 incumbent | 11.6117 | 8.3611 | 24/28 | 16/27 |
| First 28 | independent | 11.7010 | 8.4026 | 22/28 | 14/27 |
| First 28 | selected crossing | 11.4673 | 8.3773 | 24/28 | 16/27 |
| Final 14 | v1.5 incumbent | 12.3143 | 9.2547 | 9/14 | 10/14 |
| Final 14 | independent | 11.4713 | 9.0620 | 10/14 | 10/14 |
| Final 14 | selected crossing | 11.7627 | 9.1274 | 9/14 | 10/14 |
| All 42 | v1.5 incumbent | 11.8459 | 8.6589 | 33/42 | 26/41 |
| All 42 | independent | 11.6244 | 8.6224 | 32/42 | 24/41 |
| All 42 | selected crossing | 11.5658 | 8.6273 | 33/42 | 26/41 |

The selected rule used market arbitration in seven of 42 games instead of all
42. It preserved the incumbent directional gains while improving its margin
and team-score error. Total MAE is identical by construction because the Total
head is unchanged.

Only three games had reconstructable qualifying same-book movement and only one
had originator movement. Movement-gated challengers therefore either made no
decisions or worsened direction on the final block. They are rejected rather
than being generalized from insufficient evidence. Source-aware split evidence
is retained for future release-pure validation.

## Board and grade impact

The October 6 WNBA slate has zero games and zero current prediction records.
Same-input production-board impact is therefore:

- promotions: 0
- demotions: 0
- side changes: 0
- actionable count: 0 to 0

This is not a hidden flat-board change. Structural fixtures prove both exact-
price promotion and demotion paths under the new release: the positive-value
fixture produces three Best Angles, and price-only perturbations demote two of
those markets to Watchlist without moving any forecast. Old and locked rows
remain immutable and continue to carry their original releases.

## Product and operational invariants

- no member copy, label or layout change
- no generic cross-sport reader
- no new provider call or polling schedule
- no new writer or duplicate refresh path
- existing WNBA-scoped `prediction_pipeline` lease preserved
- exact evaluated quote remains downstream economics only
- public context cannot manufacture a forecast side
- Total projection remains independent
- locks and tracking boundaries remain unchanged

## Verification and rollback

Focused verification covers non-crossing identity, legitimate decision flips,
cross-market contradiction fallback, target exclusion, exact-price promotion
and demotion, decimal score coherence, lock immutability and lease ownership.
The mandatory model-change suite and integration-safety result are recorded in
the pull request.

Rollback restores the v1.5/v7/v10 constants and continuous-center branch for
future unlocked rows only. Historical snapshots and locked rows are never
rewritten.
