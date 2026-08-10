# MLB Player Props Promotion Policy Bake-Off — 2026-07-30

## Decision

No tested challenger qualifies for a live promotion-rule change.

The current actionable ladder is decisively poor, but the candidate replacements either:

- fail a chronological validation block;
- fail the final T60 holdout;
- have a date-cluster confidence interval that includes a material loss; or
- reduce the actionable board without supplying a sufficiently proven replacement.

No production data, grades, probabilities, stakes, writers, readers, or release identifiers
were changed by this audit.

## Data

Two snapshot types were evaluated separately:

1. Ball Don't Lie immutable opening-price archives from 2026-06-03 through 2026-07-23,
   settled from official MLB game logs.
2. The official internal T60 lock ledger from 2026-07-16 through 2026-07-29:
   21,002 settled rows that were display-enabled at lock.

Opening observations and T60 locks were not blended into one performance number. Multiple
offers were reduced to one candidate per player/game where applicable, and uncertainty was
resampled by full slate date.

## Current ladder control

The current T60 actionable cohort produced:

- 1,834 bets;
- 949-885;
- -129.50 units;
- -7.06% flat-bet ROI;
- 62.44% mean locked final probability versus 51.74% observed;
- 0.2515 Brier score versus 0.2391 for the market;
- date-cluster 95% ROI interval of -12.20% to -2.54%.

The negative result is not explained by one isolated slate.

## Candidate 1: validated under portfolio

The candidate contains batter hits unders, H+R+RBI unders at 1.5, and runs-scored unders,
with the pre-registered probability/edge/EV thresholds and one promoted candidate per game.

Opening-price evaluation after the discovery period:

- 172 bets, 106-66;
- +23.10 units, +13.43% ROI;
- three of four chronological windows positive;
- date-cluster 95% ROI interval: -1.78% to +27.56%.

T60 evaluation:

- 154 bets, 90-64;
- +1.71 units, +1.11% ROI;
- chronological blocks: -3.02%, +9.78%, -1.59%;
- date-cluster 95% ROI interval: -10.56% to +12.62%;
- projected board change versus the historical actionable cohort: 1,834 to 154
  (-1,680 bets, -91.6%).

Disposition: rejected for live release. It improves the control but fails the final T60
holdout and does not provide sufficient evidence for the board reduction.

## Candidate 2: market-anchored modest EV

The candidate promotes observations with modeled EV from 1% inclusive to 3% exclusive.

T60 produced +1.90% ROI before concentration caps and +2.24% after one candidate per
player/game. However, the same policy lost -4.65% on the pre-launch opening archive, with a
date-cluster 95% interval entirely below zero (-7.86% to -1.46%).

Disposition: rejected. The launch-ledger relationship does not generalize backward.

## Candidate 3: runs-scored unders

A post-hoc 1%-3% EV runs-scored-under slice was promising:

- opening archive: 362 bets, +12.38% ROI, date-cluster interval +3.84% to +20.26%;
- T60 ledger: 224 bets, +2.65% ROI, well calibrated overall;
- final T60 block: -1.68% ROI.

Because the 3% upper EV boundary was noticed from the T60 results, the T60 period cannot
honestly be called untouched holdout evidence for that exact rule.

A separate tournament selected its rule using only observations through 2026-06-21. That
pre-launch-selected rule used model probability >=54%, non-negative edge/EV, and EV below
5%. It then returned:

- +5.09% across the later opening-price windows;
- -2.95% across T60;
- -11.88% in the final T60 block.

Disposition: rejected. The clean pre-launch-selected rule failed the launch ledger.

## Market/side findings

- Pitcher strikeout promotion remains unproven. Neither side passed the pre-launch
  chronological evaluation.
- Pitcher-outs overs were strong in the T60 ledger, but the relationship did not pass the
  pre-launch policy search.
- Batter-hits unders remain the most promising component of the under portfolio, but their
  standalone clustered intervals still include losses.
- Large modeled edges and large modeled EV remain anti-calibrated in the T60 ledger.

## Release consequence

There is no evidence-compliant live challenger from this bake-off. Under
`docs/model-change-safety.md`, the correct action is to reject these candidates rather than
change grades under a new release identifier.

The existing uncommitted promotion-policy edits in the worktree were not modified by this
audit and should not be treated as approved for deployment based on these results.
