# NFL Player Props Passing Attempts decomposition predeclaration

Date: 2026-10-15
Status: research-only; no production behavior authorized

## Objective

Improve the market-free Passing Attempts forecast on the completed 2026 season without using a
prop line, price, sportsbook, consensus, movement, spread, total, or post-kickoff fact. Earlier
seasons may train and regularize the candidate, but the product conclusion will be stated from the
release-pure 2026 replay. Passing Completions and Passing Yards remain unchanged until their own
family gates are run after this foundation is decided.

## Frozen diagnosis

The incumbent expected-role head directly predicts team pass attempts from shifted team,
opponent, environment, pressure, pace, xPass, and pass-over-expected features, then multiplies the
result by the expected lead passer share. That is independent of the market and materially better
than the older head, but it asks one model to learn multiple football processes at once.

The challenger will decompose the opportunity chain:

1. forecast total offensive play opportunity from shifted team pace/play volume and opponent play
   allowance;
2. forecast dropback choice from shifted neutral and overall xPass/pass-over-expected, down-state
   tendencies, team style, and opponent context;
3. convert dropbacks to credited attempts using shifted sack, scramble, spike, and pressure context;
4. allocate credited attempts to the expected lead passer using only pregame depth, availability,
   snap, and prior passing-share evidence; and
5. retain a count/empirical outcome distribution fitted without offered thresholds.

No assignment-level OL/DL coefficient will be invented. Public pressure and sack histories are
unit/context proxies; player-to-player blocking interactions require timestamped historical and
live assignment data before they can become a production feature.

## Frozen candidates

- incumbent independent expected-role Passing Attempts head;
- factorized opportunity head: plays × dropback rate × credited-attempt share × lead-passer share;
- 25%, 50%, 75%, and 100% challenger mixtures with the incumbent; and
- the same point heads with only predeclared global, predicted-mean bucketed empirical, Poisson,
  and negative-binomial threshold distributions.

Hyperparameters retain the repository's regularized histogram-gradient-boosting family and are
not selected on a sportsbook outcome. Selection uses 2024; 2025 is confirmation. The candidate is
then frozen before the 2026 replay is opened. The exact 2026 result is the deciding same-era gate,
not a license to fit a correction to five realized weeks.

## Advancement gates

The candidate advances only if all of the following hold:

- 2025 point MAE and RMSE do not regress versus the incumbent;
- 2026 point MAE and RMSE improve on the eligible replay population;
- exact offered-threshold 2026 Brier and log loss improve without worse direction accuracy;
- no chronological 2026 segment shows a material collapse hidden by the aggregate;
- game-clustered uncertainty and residual diagnostics do not reveal one-game domination;
- complete-board replay pairs every actionable demotion with an evaluated promotion rule and
  reports actionables/board size; and
- every non-Passing-Attempts market remains byte-identical in a production rehearsal.

If the factorized head fails, the negative result is retained and Passing Attempts research moves
to a materially different causal feature source or model class. A failed candidate does not make
the market the independent forecast and does not end the family program.

## Immutability and publication boundary

This research reads official outcomes and immutable locks; it writes no prediction or member
snapshot. Existing locked projections, probabilities, picks, grades, prices, stakes, evidence,
and releases remain authoritative. Any production candidate requires new release identifiers,
focused and repository-wide model verification, latest-main integration safety, protected PR
checks, deployment, and live proof through the sole leased writer.
