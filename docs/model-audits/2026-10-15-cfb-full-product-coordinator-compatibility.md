# CFB full-product coordinator compatibility correction

Date: 2026-10-15

Status: qualified candidate; publication pending protected-PR approval
Scope: future unlocked CFB forecasts only; stored locked payloads remain immutable

## Decision

Keep the independent weekly model and complete professional market reader as the authoritative
full-product forecast. Continue to evaluate the frozen r2 correct-QB final-winner coordinator for
diagnostics, but do not let it replace the reader forecast. Record every would-be boundary cross as
`full_product_compatibility_hold` with the learned probability, combined probability, authority,
and feature snapshot intact.

This is not a removal of market reading. The candidate preserves the current professional reader's
number, price, hold, chronology, split-provenance, target-book-exclusion, and cross-market logic.
It removes only the later coordinator's ability to overturn that already-reconciled forecast.

## What the loss audit found

The October 14 coordinator was qualified incrementally against an older forecast/reader context.
That question was too narrow. In the actual current product, the coordinator runs after the newer
independent weekly model and complete market reader. The combined stack therefore differs from the
stack on which the coordinator first looked useful.

On the exact 393-game official-lock replay, the coordinator crosses the winner boundary 41 times.
Removing those post-reader overrides changes Moneyline from 285-108 to 296-97. The same correction
does not weaken direct Spread or Total direction. This is an interaction/distribution mismatch: a
component that looked helpful in isolation is harmful when applied after the current reader.

The audit also tested minimum selected-probability gates. A 70% gate produced 298-95 Moneyline and
146-126-4 Spread, but it applied only four of the 41 raw crosses and all incremental gains over the
no-coordinator candidate occurred in the opened development block. Confirmation and later-opened
games were flat. That four-game threshold is rejected as an overfit tweak and has no production
path.

## Exact replay comparison

Both columns replay the same immutable pregame evidence, outcomes, current independent model,
complete market reader, evaluated lines, prices, and current grade policy. The only ablation is
whether the r2 coordinator may replace the reader forecast.

| Measure | Current full-product control | Compatibility candidate | Delta |
|---|---:|---:|---:|
| Moneyline | 285-108 (72.52%) | 296-97 (75.32%) | +11 wins, +2.80 pp |
| Spread | 145-127-4 (53.31%) | 145-127-4 (53.31%) | unchanged |
| Spread +3 | 169-107 (61.23%) | 170-106 (61.59%) | +1 net win |
| Spread +6 | 189-86-1 (68.73%) | 191-84-1 (69.45%) | +2 net wins |
| Total | 168-120 (58.33%) | 168-120 (58.33%) | unchanged |
| Total +3 | 183-105 (63.54%) | 183-105 (63.54%) | unchanged |
| Total +6 | 198-90 (68.75%) | 198-90 (68.75%) | unchanged |
| All direct market records | 598-355-4 | 609-344-4 | +11 wins |

The Moneyline improvement is not confined to the development segment:

| Segment | Control | Candidate | Delta |
|---|---:|---:|---:|
| Development through Sep 27 | 164-42 | 172-34 | +8 wins |
| Confirmation Sep 28-Oct 4 | 65-29 | 65-29 | unchanged |
| Later opened from Oct 5 | 56-37 | 59-34 | +3 wins |

## Probability and score quality

| Measure | Control | Candidate | Better? |
|---|---:|---:|---|
| Moneyline Brier | 0.190519 | 0.186264 | candidate |
| Moneyline log loss | 0.556145 | 0.547550 | candidate |
| Spread Brier | 0.253976 | 0.252386 | candidate |
| Spread log loss | 0.701488 | 0.697848 | candidate |
| Team-score MAE | 9.0576 | 9.0223 | candidate |
| Margin MAE | 11.7451 | 11.6074 | candidate |
| Total MAE | 13.4187 | 13.4187 | unchanged |

The candidate improves both direction and proper scoring. It is not merely converting uncertain
probabilities into extra binary wins.

## Actionability and price economics

Across all 957 replayed market records, the current-runtime grade replay changes from 323 actions at
180-142-1, +17.0973 units and 5.29% ROI to 316 actions at 179-136-1, +22.1781 units and 7.02% ROI.
That is seven fewer actions, six fewer losses, one fewer win, +5.0808 units, and +1.73 percentage
points of ROI. The board is not flattened: 316 actions remain across all three markets.

By market, Moneyline moves from 27 actions at 14-13 and -5.5755 units to 31 at 17-14 and -3.9370
units; Spread moves from 115 at 61-53-1 and +3.1534 units to 104 at 57-46-1 and +6.5957 units;
Total is unchanged at 181 actions, 105-76 and +19.5194 units.

The narrower 570-market exact-grade-comparable subset is a real tradeoff. Direction improves from
370-197-3 to 372-195-3, but actions move from 196 at 103-92-1 and -2.0577 units to 191 at 100-90-1
and -2.5898 units. The candidate therefore gives back 0.5321 units in that narrower subset. The
full-board price result, calibration, direct direction, alternate-line direction, and score error
still favor the candidate, but this subset must remain in forward monitoring.

## Competitor context

The supplied competitor screenshot reports 448 CFB games: Moneyline 372-76 (83.0%), Spread 221-219
(50.2%), Spread +3 251-194 (56.4%), Spread +6 285-160 (64.0%), Total 213-235 (47.5%), Total +3
245-203 (54.7%), and Total +6 282-166 (62.9%). The Oddsphere candidate uses different denominators:
393 Moneylines, 276 Spreads, and 288 Totals. These are therefore raw reference gaps, not normalized
head-to-head claims.

On that raw basis, the candidate remains 7.68 percentage points behind the competitor's Moneyline
rate. It is ahead by 3.11 points on direct Spread, 5.20 on Spread +3, 5.45 on Spread +6, 10.83 on
direct Total, 8.84 on Total +3, and 5.85 on Total +6. Moneyline remains the primary improvement gap;
the correction closes 2.80 points of it without sacrificing the other markets.

## Current-board rehearsal

The read-only October 15 board audit found 95 games, including 86 exact baseline replay matches.
The r2 coordinator would intervene once: Villanova at Fordham, changing a Villanova 27.82-Fordham
23.97 reader forecast to Fordham 26.26-Villanova 25.56 at only 50.45% combined home probability and
0.407 authority. Holding the coordinator reverts that projection. It changes zero current decisions,
zero actionable promotions, and zero actionable demotions.

## Data coverage and what this does not claim

The preceding ingestion repair remains active. The zero-write current-board evidence rehearsal has
verified injury-report coverage for 26 of 97 games, reliable canonical market anchors for all 60
FBS-involved games, FCS-only anchor holds for 37 games, and rich team/QB profile coverage for all 97.
Conference injury reports remain report/continuity evidence unless separately qualified for model
authority. This correction does not pretend that every injury designation has predictive authority,
and it does not alter provider cadence, matching, source timestamps, or last-known-report precedence.

This is opened retrospective evidence, not an untouched holdout or a promise of future returns.
The competitor population is not matchup-normalized. The next valid coordinator must be trained and
qualified against the full current stack, with development, confirmation, and later-opened reporting,
rather than against an older intermediate forecast.

## Implementation and immutable transition

- Future unlocked forecasts use `marketReader.forecast` as the sole final forecast.
- The frozen coordinator still runs once against target-excluded evaluated-book families.
- `finalWinnerCoordinatorApplied` is always false in the candidate release.
- `finalWinnerCoordinatorWouldApply` and the full diagnostic payload remain stored.
- Every existing r51/r46/r63/r39 locked payload remains directly readable and takes precedence.
- The release family advances score/model/distribution/probability/reachable-score/calibration,
  decision tuple, reader publication, evidence, member, fixture, snapshot, writer, and tracking IDs.
- Rollback restores future unlocked computation to the r51 correct-QB coordinator family. Rollback
  never changes a stored lock.

## Publication gates

1. Focused CFB production suite passes, including the explicit no-application path and exact r51
   locked-reader precedence.
2. `npm run verify:model-change` passes.
3. Latest `origin/main` is an ancestor of the candidate and integration safety reports no overlap.
4. Protected PR checks pass and the PR remains current with `main`.
5. Owner approves publication after reviewing this evidence.
6. Post-deploy verification proves the new release tuple, one writer and shared
   `prediction_pipeline:cfb` lease, unchanged stored locks, stable board, coordinator would-apply
   telemetry, and no hidden fallback to coordinator application.

## Reproduction

The detailed replay is summarized by
`scripts/operator/summarize_cfb_complete_product_replay.py`. The loss-regime audit used
`scripts/operator/audit_cfb_release_pure_loss_regimes.py`; it derives candidate thresholds from the
development block only and reports confirmation/later-opened behavior separately.
