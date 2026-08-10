# Player props predictive-advantage research

Date: 2026-07-30
Status: backtest candidate only; no production writes or live grade/stake changes

## Outcome

A no-new-data-cost residual model plus a stability-based promotion ladder produced a
materially better held-out player-props board than the locked actionables it would replace.

| July 24–29 held-out result | Bets | Record | Units | ROI |
| --- | ---: | ---: | ---: | ---: |
| Candidate portfolio | 114 | 75–39 | +5.535 | +4.86% |
| Candidate Best Angles | 5 | 5–0 | +1.877 | +37.55% |
| Candidate Leans | 109 | 70–39 | +3.657 | +3.36% |
| Comparable locked actionables across their immutable releases | 825 | — | -73.686 | -8.93% |

The candidate also improved probability accuracy over 8,136 held-out rows:

- market Brier score: 0.231550
- candidate Brier score: 0.230741
- Brier improvement: 0.000809

The comparison row is a board-level reference only. It is not labeled as one current-model
era because the locked actionables span model releases r6, r7, r9, r11, r15, r16, and r17.
Those releases remain immutable and were inspected separately.

## What creates the advantage

The durable relationship is **absolute value gating, not quota-based ranking**.

The candidate:

1. starts with the no-vig market probability;
2. predicts only the residual error using prior MLB game logs already available to the
   application;
3. requires a market model to beat the market Brier score in at least two of four
   chronological folds;
4. prefers an absolute probability/edge/EV/price gate that was profitable in at least three
   of four folds;
5. uses a per-day ranked fallback only when no absolute gate qualifies;
6. labels Best Angle only when the probability model wins at least three folds and the action
   policy is profitable in all four folds.

Across 36 nearby portfolio-policy variants:

- 22 were positive on the final period;
- gate-first variants returned +0.51% to +37.55%, depending on strictness and board size;
- score-maximizing variants ranged from -5.28% to +45.36%;
- rank-first variants were consistently negative (-4.01% to -25.48%).

This is evidence that filling a fixed number of slots promotes marginal bets. The board
should be allowed to be naturally small when no candidate clears an absolute value gate.

## Candidate market rules

All thresholds use decimal prices and probabilities expressed from 0 to 1.

| Market | Method | Rule | Held-out |
| --- | --- | --- | ---: |
| Batter runs | Absolute | p≥.54, edge≥.03, EV≥.03, price≥1.20 | 3 bets, -1.130u |
| Batter singles | Absolute | p≥.56, edge≥.03, EV≥.02, price≥1.20 | 30 bets, +0.247u |
| Batter walks | Absolute | p≥.52, edge≥.005, EV≥.03, price≥1.20 | 30 bets, -0.650u |
| Batter doubles | Absolute | p≥.52, edge≥.005, EV≥.005, price≥1.25 | 4 bets, +1.037u |
| Batter total bases | Absolute | p≥.52, edge≥.01, EV≥.01, price≥1.667 | 0 bets |
| Batter H+R+RBI | Absolute | p≥.54, edge≥.04, EV≥.02, price≥1.667 | 1 bet, +0.840u |
| Batter hits | Absolute | p≥.52, edge≥.02, EV≥.01, price≥1.80 | 0 bets |
| Pitcher hits allowed | Ranked fallback | top 3/day, p≥.52, price≥1.80 | 7 bets, +4.447u |
| Pitcher walks | Ranked fallback | top 3/day, p≥.52, price≥1.50 | 12 bets, +0.117u |
| Pitcher earned runs | Absolute | p≥.52, edge≥.02, EV≥.005, price≥1.20 | 27 bets, +0.626u |

The held-out action list contained no duplicate player/date selections after applying the
one-prop-per-player/date correlation cap.

## Data and validation

- Opening-odds observations: 2026-06-03 through 2026-07-23.
- Rolling folds:
  - train through June 21, evaluate June 22–30;
  - train through June 30, evaluate July 1–7;
  - train through July 7, evaluate July 8–12;
  - train through July 12, evaluate July 16–23.
- Final locked-price evaluation: T60 rows from July 24–29.
- Features: no-vig market probability plus prior-only rolling MLB game-log features.
- Models: regularized market-logit residual models and shallow boosted residual stumps.
- Existing live price eligibility was preserved: -500 through +1000 American.
- Production writes: none.

The final period contains 114 bets across 60 game/date clusters. A 20,000-draw
game-cluster bootstrap estimated:

- median ROI: +4.95%;
- 95% interval: -7.89% to +17.67%;
- probability of positive ROI: 77.5%.

This is materially better than the prior board, but the interval still crosses zero.
Additionally, the final cross-market qualification ladder was formalized after inspecting
market-level holdout summaries. Treat this as a frozen release candidate, not fully
confirmatory proof.

## Free-history boundary

The existing BallDontLie connection was probed for May 1–15 and June 1–2. Games were
available, but archived opening player-prop rows were zero on every probed date. The useful
opening-props archive therefore begins June 3; there is no larger free pre-launch odds sample
available from the current provider.

## Release decision

Do not alter live grades or stakes from this report alone.

The next safe step is to freeze this exact ladder and either:

1. obtain a genuinely untouched historical odds period from an already-owned source, or
2. run it as an explicit user-visible audit/backtest after enough newly locked outcomes exist.

Before any live promotion, the implementation must use a new immutable release identifier,
the existing authoritative writer and `prediction_pipeline` lease, release-separated
reporting, focused tests, `npm run verify:model-change`, and production release/coherence
verification.
