# NHL roster-adjusted opening prior r12 — predeclaration

## Problem

The released r10 NHL runtime can enter a new regular season with prior-season
team rates and a prior-team default goalie. That is not a complete independent
forecast when offseason roster turnover is material. A market disagreement may
therefore be exposing stale independent inputs rather than supplying a reason to
blend the score toward the market.

The September 30 slate exposed both failure modes. Toronto's current roster has
substantial turnover that is not represented in the 2025 team prior, while the
Pittsburgh fallback selected a prior-season goalie who is not on Pittsburgh's
current roster.

## Frozen protocol

1. Keep market prices, movement and split evidence out of the independent score
   fit.
2. Construct player states only from games strictly earlier than the target
   game. Current-game player identity is used only as a historical roster/lineup
   diagnostic; no target-game performance value enters a feature.
3. Warm up on 2022, train coefficients on 2023, select regularization and feature
   family on 2024, then report once on untouched 2025.
4. Compare the roster candidates with the exact released score architecture on
   team-score MAE, margin MAE, Total MAE, winner accuracy/Brier, Total direction
   and puck-line direction. Report full-season and first-30-day results.
5. A roster feature is production-eligible only if it improves the multi-metric
   chronological objective, does not create a material winner or market-direction
   regression, and can be reproduced from a timestamped current roster without
   target outcomes.
6. A current-roster goalie filter is evaluated separately. An invalid prior-team
   goalie must never be represented as the current assumed goalie; absent a
   verified starter, the independent model falls back to neutral goalie context.

## Market arbitration boundary

This audit rejects continuous high-weight market anchoring. The independent
forecast remains independent. A separate market reader may confirm, leave alone,
or flip a market only when a predeclared, chronological, source-aware rule
corrects more independent misses than it overturns correct calls on untouched
evidence. Any authorized flip must rebuild one coherent final score distribution
whose Moneyline, Total and puck-line predictions cannot contradict that score.

## Release gates

No production behavior changes from this predeclaration alone. A release requires
an r12 model/calibration/decision identifier, focused tests, current-board paired
impact with promotions and demotions, `npm run verify:model-change`, a clean
latest-main integration check, protected pull request, and live writer/reader,
coverage, price, split, lock and tracking verification. No member copy, label,
layout, stake, provider cadence or second writer is authorized.
