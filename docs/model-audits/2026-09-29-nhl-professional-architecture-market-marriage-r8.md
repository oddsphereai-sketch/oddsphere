# NHL professional architecture and market-read validation r8 — 2026-09-29

## Release decision

Release `nhl_regular_2026_r8_validated_market_read`, calibration
`nhl_regular_calibration_2026_r8_validated_market_read`, and decision
`nhl_regular_decision_2026_r8_exact_price_calibrated`.

The released score/probability path remains the r7 runtime-parity independent
model, opponent-adjusted Total, and validated 20% Moneyline market sanity layer.
The proposed learned market marriage is rejected after correcting the outcome
target. Puck-line Best Angle now requires a current exact price and a 5pp model
edge, the only tested edge band with positive ROI in both selection and
confirmation. Split source/agreement confidence is retained internally for
forward evaluation. No member copy, labels, layout, stake, provider cadence, or
new writer is introduced.

## Outcome-integrity repair

MoneyPuck team-game exports omit the synthetic shootout-deciding goal, so an
analytics score tie is not a valid settled Moneyline label. Comparing the
archive with official BALLDONTLIE finals found 278 such ties among 3,936 games
and 145 winner-label mismatches, all caused by the omitted shootout goal. Every
r8 tournament restores official settled scores before fitting or evaluating.
This changes the research conclusion; it does not rewrite an immutable member
prediction.

## Professional architecture review

The tournament evaluated sport-specific structures supported by public hockey
modeling research:

- independent team scoring rates from recent goals, xG, shots, 5-on-5,
  special teams, home/rest/travel, opponent-adjusted attack and defence;
- a distinct ability-to-win head solved back into one coherent score pair;
- multi-horizon recency state, nonlinear Poisson/tree models, dynamic
  attack-defence Poisson ratings, bivariate/latent score candidates, and
  two-stage chance/finishing heads;
- prior-game player and goalie-pool evidence with regularization;
- opening/current no-vig price, same-book line/price movement, and conditional
  side-flip arbitration;
- exact-price decision calibration for Moneyline, Total, and puck line.

Reference designs included MoneyPuck's documented pregame architecture,
semi-Markov player hazard research, bivariate count models, and shooter/goalie
skill-adjusted expected goals:

- <https://moneypuck.com/about.htm>
- <https://arxiv.org/abs/1208.0799>
- <https://arxiv.org/abs/2409.17129>
- <https://arxiv.org/abs/2511.07703>

## Chronological protocol

Pregame features are constructed only from earlier games. Hyperparameters are
chosen on a prior season and reported once on a later untouched season. Market
features are never allowed into the independent score head. Official scores are
the settlement target. Every market comparison uses the exact available line
and no-vig two-sided price where available.

The principal corrected confirmation contains 1,311 priced 2025 games:

| path | ML accuracy | Brier | team-score MAE | margin MAE | total MAE |
| --- | ---: | ---: | ---: | ---: | ---: |
| independent | 55.00% | 0.245021 | 1.368611 | 2.124766 | 1.841947 |
| released 20% market sanity | **55.07%** | **0.244434** | **1.368013** | **2.123858** | **1.841947** |
| rejected learned blend | 54.23% | 0.244930 | 1.371459 | 2.119839 | 1.841947 |

The learned blend made 132 side flips: 61 corrected an independent miss and 71
worsened an independent winner. It is not production eligible. Opening market
alone was exactly neutral at 100 corrections and 100 regressions. A historical
closing-price model improved an older 2020–21 confirmation cohort, but did not
have a current-era exact-evidence holdout and is not promoted.

## Independent-score findings

The full 2025 released replay produced team-score MAE 1.3680, total MAE 1.8419,
margin MAE 2.1239, total direction 53.56%, and puck-line direction 67.43%.
Predicted team, Total, and margin correlations were 0.158, 0.083, and 0.194.
Predicted top-versus-bottom deciles separated actual team scoring by 1.10 goals,
actual Totals by 0.68 goals, and actual margins by 1.82 goals. The model is
therefore predictive, although NHL goal noise places a hard limit on exact-score
error.

The best new multi-horizon score head improved untouched 2025 team-score MAE
to 1.3648 and Total MAE to 1.8295, but worsened winner accuracy and failed to
improve the preceding 2024 selection season. Component ensembling selected zero
weight on that new Total head in 2024. A dynamic attack-defence Poisson model,
nonlinear score models, player residuals, goalie pools, direct Total classifier,
settlement correction, and tail recalibration also failed the complete
chronological objective. None is released post hoc.

## Decision calibration

Accuracy increases materially in the validated confidence cohorts:

| decision evidence | 2024 selection | untouched 2025 confirmation |
| --- | ---: | ---: |
| ML winner conviction at least 12pp | 67.92% (159) | 65.00% (100) |
| Total model-line gap at least 0.5 goal | 56.86% (153) | 62.22% (90) |
| puck probability 64–70% | 67.69% (359) | 62.76% (145) |
| puck probability at least 70% | 73.03% (356) | 77.78% (135) |

Puck-line hit rate alone is insufficient because +1.5 prices are often
expensive. Exact-price filtering produced:

| minimum no-vig edge | 2024 selection ROI | 2025 confirmation ROI |
| --- | ---: | ---: |
| 1.5pp | -3.13% | +3.48% |
| 3pp | -1.92% | +5.15% |
| 5pp | **+2.56%** (601) | **+8.76%** (432) |

Accordingly 5pp is the puck-line Best Angle value floor. Existing Moneyline and
Total promotion paths remain symmetric. No quota promotes a game merely to
populate the board.

## Market-reading and fallback evidence

Circa, Pinnacle, and Bookmaker remain the priority for continuous same-book
movement; a fallback book is used only when no priority book has both an opening
and current quote. Public money/ticket observations remain provider-separated.
The member section prefers the last complete Playbook pair and silently falls
back to the last complete SharpAPI pair, with no expiry, stale tag, warning, or
new copy. The resolved source, agreement state, provider gap, and confidence are
now retained in the internal NHL feature snapshot. They are not treated as a
validated side-flip rule until forward locked evidence exists.

Historical SBR confirmation supports Moneyline movement as information but not
as an unconditional flip: a 5pp move was 57.83% directional in 2017–21, while a
selected conditional flip rule corrected and worsened 40 games each on its
untouched cohort. Total line/price movement was unstable and is not promoted to
a blind flip rule. Current bounded split and movement adjustments remain
downstream of the independent model.

## Board and transition impact

The current five-game replay retains 5/5 games, 15/15 markets, and 10
actionables: four Moneyline Leans, two Total Leans, four puck-line Leans, and
five Watchlists. The r8 exact-price rule demotes one still-unlocked puck line;
there is no quota promotion. All previously locked r7 cards remain byte-for-byte
writer-owned and visible. Reader release
`nhl_daily_edge_reader_2026_09_29_r4_release_transition_continuity`, the writer,
and tracking eligibility accept the bounded r7 transition release so deployment
cannot recompute, duplicate, or drop those locks. Reader coherence is scoped to
the release tuple, and the writer treats any locked transition row as immutable
even when unlocked rows from both releases coexist.

## Operational gates and rollback

Publication requires the focused NHL test, TypeScript, lint/build as applicable,
`npm run verify:model-change`, current-main ancestor/integration safety, protected
PR checks, and live verification of release IDs, 3/3 market coverage per game,
two-sided prices, split continuity, one writer/lease, lock immutability, tracking
eligibility, and zero score/side contradiction. Roll back unlocked r8 output on
coverage loss, missing exact prices, board collapse, mixed current-release rows,
coherence failure, writer overlap, or reader/lock failure. Never delete or
rewrite a valid locked r7 tuple.
