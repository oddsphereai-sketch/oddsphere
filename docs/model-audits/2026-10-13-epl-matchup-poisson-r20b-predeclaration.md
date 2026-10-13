# EPL matchup-Poisson r20b candidate predeclaration

Date: 2026-10-13

Status: outcome-blind research candidate. No production authority.

The r20a hand-weighted attack/defence candidate failed its untouched holdout
gate: Match Result and margin improved modestly, but team-score MAE and Total
accuracy worsened and projected score dispersion contracted. It is rejected.

R20b keeps the same immutable-lock, writer, lease, provider, market-reader,
grade, stake, copy, and layout boundaries. It evaluates a fitted Poisson
regression for each team's regulation goals. Pregame features are limited to
information available before kickoff:

- the incumbent independent lambda as a structural prior;
- trailing five- and ten-match goals for/against;
- trailing shots and shots on target for and allowed;
- possession and result form;
- opponent attack/defence equivalents;
- rest days and available-history depth; and
- home/away status and bounded matchup interactions.

No evaluated sportsbook price, market movement, split, final score, future
match, injury row, or lineup row enters a feature. Injury/lineup history is not
available with equivalent timestamp integrity and is therefore excluded rather
than reconstructed.

Chronological protocol:

- 2022-2023 train coefficients;
- 2024 select L2 regularization from `[0.01, 0.1, 1, 10]` and low-score tau
  from `[-0.05, -0.10, -0.15]`;
- refit coefficients on 2022-2024 using only the selected regularization;
- open 2025 once as the untouched holdout.

Selection prioritizes team-score MAE, Match Result log loss, and margin MAE,
subject to no material deterioration in both Total and BTTS Brier scores. The
production gates remain those declared for r20: score accuracy, proper scores,
coherent derived markets, useful dispersion, current-board promotion/demotion
balance, exact-price actionability, focused tests, full model verification,
clean current-main integration, and live release proof.
