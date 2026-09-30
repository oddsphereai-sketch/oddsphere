# NHL roster-aware independent model and discrete market reader r12

## Scope and release

- Model: `nhl_regular_2026_r12_roster_discrete_market_read`
- Calibration: `nhl_regular_calibration_2026_r12_roster_discrete_market_read`
- Decision: `nhl_regular_decision_2026_r12_coherent_exact_price`
- Player-prior artifact: `nhl_roster_player_priors_2026_09_30_r1`
- Member copy, labels, layout, stake, schedule, writer, lease, and official
  tracking scope: unchanged

This release repairs two opening-season input failures without restoring a
market-dominant model: prior-season team identity ignored offseason roster
turnover, and the default goalie selector could assign a departed goalie.

## Chronological independent-model evidence

The frozen tournament uses only information strictly earlier than each target
game: 2022 warm-up, 2023 coefficient training, 2024 family/regularization
selection, then one report on untouched official-score 2025. The selected
roster features are ice-time-weighted skater Game Score, individual expected
goals, and points rates. Market evidence is excluded from every fitted score.

| Metric | Released score | Roster-aware score |
| --- | ---: | ---: |
| 2025 winner accuracy | 54.8855% | 56.2595% |
| 2025 Brier | 0.245298 | 0.244109 |
| 2025 team-score MAE | 1.371894 | 1.366527 |
| 2025 margin MAE | 2.125089 | 2.110944 |
| 2025 Total MAE | 1.844835 | 1.838286 |
| 2025 Total direction | 53.6753% | 53.2925% |
| 2025 puck-line direction | 67.4809% | 67.6336% |
| First-30-day winner accuracy | 54.38% | 56.22% |

The improvement is modest but broad enough to replace the stale opening prior.
The 0.38-point Total-direction tradeoff is retained because both team-score and
Total MAE improve, winner accuracy improves, and the paired live board remains
equally actionable. It is not evidence for a 60% guarantee. The roster path is
therefore bounded to each team's first ten games and automatically yields to
current-season team evidence.

## Market-reader decision

The rejected approach continuously blended every independent margin 20% toward
the market. R12 keeps market evidence out of the independent fit. It records one
of three internal states: independent, confirmed, or flipped.

A flip applies to current and future regular-season games and requires every
condition below:

1. Independent and current no-vig market winner sides conflict.
2. At least two complete books make the market side at least 54%.
3. A continuous same-book opening/current trail moves at least 1 percentage
   point toward that market side.
4. Complete money and ticket evidence both support the market side at 55% or
   better, with medium/high provider agreement.

No individual split, public popularity, or isolated price can flip a forecast.
When all evidence corroborates a correction, the model solves the goal margin
from the current no-vig target and the independent Total, then rebuilds the
joint score distribution. All displayed scores and Moneyline, Total, and
puck-line predictions derive from that one distribution.

## Current production-path replay

The September 30 read-only production-path run loaded all six current rosters,
all three games, and all nine markets with zero provider or model errors.

| Game | r10 Moneyline | r12 Moneyline | r12 score | Grade changes |
| --- | --- | --- | ---: | --- |
| PIT @ PHI | PHI | PHI | PIT 2.75–PHI 3.09 | Under: Watchlist → Lean |
| NYI @ TOR | NYI | TOR | NYI 3.02–TOR 3.29 | ML: Lean → Watchlist; NYI +1.5: Best → Watchlist |
| LAK @ COL | COL | COL | LAK 2.63–COL 3.18 | Under: Watchlist → Lean |

Board impact: one Moneyline side correction, two promotions, two demotions,
five actionables before and after, zero missing games, and zero missing markets.
The NYI/TOR change is a full market-reader correction; it is not a partial
score nudge. LAK/COL correctly keeps COL as the Moneyline winner while retaining
LAK +1.5 because those are different market outcomes at the offered prices.

## Runtime and rollback

The existing daily NHL writer and T-60 refresh remain the only prediction
writers under `prediction_pipeline:nhl`. Current rosters are fetched at slate
scope and cached for 30 minutes. Default goalie history is filtered to current
roster identity; an empty/unavailable verified set yields neutral goalie
context. Locked prior-release tuples are never rewritten.

Rollback the unlocked r12 release tuple to r10 if the live writer loses roster
coverage, any game or market, exact prices, source-separated splits, coherence,
the shared lease, or lock/tracking integrity. Do not roll back the September 30
reader split-source repairs and do not rewrite a valid locked tuple.
