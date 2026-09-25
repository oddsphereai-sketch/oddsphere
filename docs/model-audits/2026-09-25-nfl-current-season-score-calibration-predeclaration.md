# NFL current-season score calibration predeclaration

Date: 2026-09-25

Status: frozen before 2024-2025 confirmation outcomes, probabilities, prices,
economics, or the current Week 3 board are opened by this candidate.

## Objective

Test whether a release-pure team scoring state can improve NFL expected scores,
Spread direction, and Total direction without replacing the market/model marriage
with either a market-only forecast or a forced-action threshold. The candidate is
research-only unless every historical, current-board, release, writer, and
deployment gate below passes.

## Inputs and chronology

- Regular-season nflverse games from 2016-2025, checksum verified through the
  repository cache manifest.
- Only games completed strictly before the predicted game enter a team state.
- 2016-2020 initialize rolling state; 2021-2023 select the fixed blend weights;
  2024-2025 are untouched confirmation.
- The candidate uses final team scores only to update later games. It never uses
  the target game's result, closing result, future-week state, or a same-week
  result that had not completed before kickoff.
- The market anchors are the target game's pregame closing spread and total in
  the frozen source file. The live equivalent remains the current target-excluded
  consensus already captured by the sole NFL writer.

## Frozen independent score state

For every target game, each team's offense and defense are exponentially weighted
over its preceding 24 regular-season games with per-game decay `0.92`. Ratings are
shrunk toward the location-neutral league scoring mean with five prior-games of
weight. The league home and away baselines use only earlier completed games.

The independent team scores are:

- away = league away baseline + one half of the away offensive deviation + one
  half of the home defensive-allowed deviation;
- home = league home baseline + one half of the home offensive deviation + one
  half of the away defensive-allowed deviation.

Scores are bounded to 8-42 points per team. The independent margin and total are
the coherent difference and sum of those two scores.

## Frozen selection and probability rules

Spread and Total independently select one market/independent blend weight from
`0.10, 0.20, 0.30, 0.40` using 2021-2023 only. The winner minimizes point MAE;
ties use RMSE, then the smaller independent weight. The selected point forecast
is `market + weight * (independent - market)`.

For each confirmation season, probabilities use the empirical residual
distribution from 2016 through the preceding season only. Push mass is excluded
from the two-sided probability. An exact-price action requires at least one
percentage point of edge versus two-sided no-vig probability. No grade threshold,
quota, minimum board count, side quota, or post-confirmation parameter may be
introduced.

## Confirmation gates

The candidate qualifies for a production-board replay only if all hold on the
unopened 2024-2025 confirmation set:

1. Pooled point MAE improves the market anchor for both margin and total; neither
   market is worse by more than 0.10 points in either season.
2. Resolved side accuracy is above 50% pooled for both Spread and Total and at
   least 48% in each confirmation season.
3. Both sides occur in each season for each market.
4. Pooled Brier is no worse than the no-vig market baseline by more than 0.001,
   and no season is worse by more than 0.0025.
5. Each one-point exact-price lane has at least 30 resolved actions, at least 50%
   accuracy, positive units, neither season below -5% ROI, and both directions.
6. A same-input current-board replay preserves one coherent score, ML, Spread,
   and Total forecast per game; reports every side change and score change; and
   contains at least one actionable promotion plus one demotion or neutral hold.
   A flatter board is not an acceptable hidden effect.
7. Runtime integration, if qualified, must consume the already durable current-
   season team state inside the existing NFL writer. It may add no provider call,
   cron, timer, database table, reader-side override, copy, label, or stake.

Historical qualification is not deployment authority. A production candidate
still requires new immutable model/calibration/decision/member/writer/tracking
release identifiers, registry update, focused tests, `npm run verify:model-change`,
production build, current-main integration proof, protected pull request, natural
leased writer verification, live release coherence, and rollback to the preceding
complete NFL release family on any mixed or flattened board.
