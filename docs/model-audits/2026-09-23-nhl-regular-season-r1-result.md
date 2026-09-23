# NHL regular-season r1 result — 2026-09-23

## Release-pure result

Source artifact:
`nhl-research/nhl_regular_model_tournament_2026_09_23_r1.json`.

Selected independent parameters are exponential scoring alpha `0.04`, Elo K `16`,
home Elo `40`, home scoring `0.05` goals, and moneyline slope `0.78`. Selected market
weights are moneyline `0.30`, total `0.90`, and puck line `0.45`.

On the untouched 336-game holdout:

| Market | Evaluated | Accuracy | Calibration/error |
|---|---:|---:|---:|
| Moneyline | 336 | 57.14% | Brier 0.2414; log loss 0.6758 |
| Total direction | 207 | 53.62% | final-score MAE 1.8058 |
| Puck line | 336 | 67.86% | Brier 0.2135 |

The independent-only holdout was 56.85% moneyline, 50.32% total direction, and
67.86% puck line, with total-score MAE 1.8167. The selected marriage improves
moneyline accuracy/calibration and total direction/score error without replacing the
independent forecast. Puck-line calibration improves slightly while directional
accuracy is retained.

## Board and product result

The NHL regular-season active before-board is zero because the old release was
Finals-scoped and September 22 was preseason. The candidate produces one coherent
score and three predictions per priced type-02 game. Historical holdout actionables
are 296 moneylines, 208 totals, and 317 puck lines (821 total), with the remainder
still predicted as Watchlists rather than removed. That is 821 promotions and zero
active-board demotions; no flattening rule or quota is present.

Puck line is now an official tracked category. Public tracking starts at zero on
September 29 and requires the exact r1 model/calibration pair plus a locked regular-
season game ID. The old Finals and preseason records remain queryable internally but
cannot enter Yesterday, week, month, lifetime, or recent-pick member aggregates.

BallDontLie is authenticated and restored as a cached NHL stats provider with a
completed-prior-season fallback. Playbook and SharpAPI split coverage was verified
on the future regular-season board. Observations are persisted by provider, the
reader requires both money and tickets, prefers Playbook, silently falls back to
SharpAPI, and does not expire the last complete value from the card.

## Production acceptance still required

This result authorizes the candidate, not a claim that it is live. Required proof is
the exact merged commit, green protected PR, current-main ancestor/integration
safety, successful production NHL refresh under one released lease, type-02-only
cards, three rows per game, current prices, persisted split coverage, exact release
stamps, fresh response/tracking snapshots, and responsive member pages. Opening-night
performance must remain release-separated and forward-only.
