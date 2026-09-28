# NFL current-forward complete market marriage r106 result

Date: 2026-09-28

Scope: NFL Daily Edge Moneyline, Spread, Total, joint score distribution, exact-price selection,
grade calibration, member publication, and tracking continuity.

Writes during audit: zero.

## Decision

The r23 candidate is eligible for the owner-approved provisional production release. The
evidence is the exact 47-game 2026 Weeks 1-3 replay already captured before each game, split
chronologically into Weeks 1-2 selection and Week 3 later confirmation. Because results are now
known, this is opened diagnostic evidence rather than a pristine future holdout. It is not a
promised future win rate.

The reviewed behavior starts from the r22 paid independent team-score forecast. Verified
chronological same-book line movement can perform a real, reversible Spread or Total direction
correction and rebuilds the joint score distribution from the independent base. It does not apply
a cosmetic cap and cannot compound across refreshes. Circa is the preferred named split source;
another named sharp book may substitute and Playbook money/tickets remains the lower-trust
fallback. Missing evidence is unavailable. The exact replay does not authorize split-only flips.

Exact-price reliability is resolved before the forecast is frozen. Grades are downstream and
cannot change the quote, side, probability distribution, expected score, or representative score.
Every public market prediction must agree with the same final joint score distribution.
Expected team scores remain continuous values and are rendered to one decimal place; they are not
quantized to whole or half points. The separate representative score remains a valid whole-number
football score drawn from the same distribution.

## Exact settled replay

| Metric | r22 baseline | r23 candidate |
| --- | ---: | ---: |
| Moneyline | 32-15 | 33-14 |
| Spread, excluding two pushes | 27-18 | 27-18 |
| Total | 24-23 | 28-19 |
| Team-score MAE | 8.0946 | 7.9078 |
| Margin MAE | 9.9729 | 9.9708 |
| Total MAE | 11.5966 | 11.1901 |

Weeks 1-2 selection did not decline in Moneyline, Spread, or Total direction. Week 3 confirmation
held Moneyline and Spread direction and improved Total from 7-8 to 11-4. The candidate produced
18 genuine Total flips: 11 corrected the baseline and seven harmed it, with both Over-to-Under and
Under-to-Over changes retained. Literal score/side contradictions: zero.

The candidate keeps 69 of 81 baseline actionable board entries (85.2%). Excluding the baseline's
two Spread pushes, the combined settled actionable record changes from 47-32 (59.5%) to 44-23
(65.7%). It contains four actionable promotions and sixteen actionable demotions, with 14
Moneylines, 39 Spreads, and 16 Totals on the full 47-game board. Nonpositive-EV actionables: zero.
The board therefore clears the paired promotion/demotion and non-flatness gates without using a
quota.

## Current Week 3 zero-write production proof

At 2026-09-28T19:40:04Z the live r22 member snapshot was healthy: 16 games, 48 priced markets,
16 opening trails, zero missing prices, zero missing trails, and zero held upcoming markets. A
single live-provider r23 writer dry run at 2026-09-28T19:41:52Z proposed only the one still-unlocked
game, inserted zero rows, and produced all three evaluations with one Best Angle, one Lean, one No
Play, and zero held games. It attempted no publication, snapshot write, or tracking write.

The exact stored-evidence replay retains all 16 games and 48 predictions, has one coherent primary
forecast for every game, and changes the full Week 3 grade board from 5 Best Angles / 13 Leans / 6
Watchlists / 24 No Plays to 6 / 9 / 7 / 26. That is four promotions, seven demotions, and 15
actionables rather than 18. PHI-CHI remains a coherent 24-18 representative score with PHI
Moneyline Lean, PHI -3.5 Best Angle, and Over 41.5 No Play. The grade step does not rewrite that
score or any prediction.

## Publication and rollback

The release changes no member copy, labels, layout, stake, provider cadence, writer schedule,
database schema, or second writer. The existing `prediction_pipeline:nfl` lease stays
authoritative. Locked or started r22 and older eligible T-60 rows remain immutable; r23 applies
only to newly generated unlocked or T-60 evidence. The compact snapshot accepts those immutable
predecessors during the bounded release transition.

Rollback is the complete r22 paid-team-score family recorded in `docs/current-model-releases.md`.
Rollback must not rewrite locked evidence. Hold or roll back r23 if the live reader loses a game or
market, a score/side contradiction appears, an older release overwrites r23, a writer/lease
overlap appears, or the actionable board falls below the reviewed safety boundary.
