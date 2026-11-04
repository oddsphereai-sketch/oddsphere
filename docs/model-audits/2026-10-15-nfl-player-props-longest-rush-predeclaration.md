# NFL player props: longest rush predeclaration

Date: 2026-10-15

Status: research only; production and public actionability unchanged

## Question and chronology

Can an independent extreme-value model improve Longest Rush accuracy using expected carry opportunity, player explosiveness, offensive/defensive matchup context, box/contact efficiency, game environment, and role stability?

Fit on 2017-2024, select on 2025, refit through 2025, and score 2026 Weeks 2-5. Report eligible rushers in the two OddSphere Week 5 archive games separately. No Longest Rush offers were retained, so this is an official-outcome accuracy test rather than an economic replay.

## Outcome and eligibility

The outcome is the maximum official play-by-play rushing gain by a player in a game, excluding kneels, spikes, and aborted plays. A player with a valid rush but no positive gain has an outcome of zero.

Pregame eligibility requires RB/QB/WR position plus prior rushing-attempt volume consistent with a plausible longest-rush market. Same-game carries do not determine eligibility. Official participation is used only for settlement/void handling.

## Architectures

- Foundation: a partially pooled combination of prior longest-rush average/recency, expected carry volume, position, and recent yards per carry.
- Candidate A: regularized ridge regression on `log(1 + longest rush)`.
- Candidate B: shallow, strongly regularized gradient boosting on `log(1 + longest rush)`.

Features may include only pregame rushing workload, rush share, team/opponent rush volume, position-specific opponent allowance, NGS rushing efficiency/RYOE/box context, PFR yards before/after contact, FTN box count/motion/RPO, role/depth/injury, home/roof/wind/temperature, and the player's own prior longest/explosive-run history. Sportsbook data is excluded.

Threshold probabilities at 9.5, 14.5, 19.5, 24.5, and 29.5 yards use a log-residual distribution whose scale is fitted only on pre-validation/pre-test residuals.

## Selection and gate

Select on 2025 MAE, then RMSE, then average threshold Brier. On 2026 the winner must improve MAE, RMSE, average threshold Brier, and at least four of five threshold Brier scores versus the foundation. A paired game bootstrap quantifies uncertainty.

Passing the accuracy gate cannot authorize production without prospective exact-offer/price capture and a versioned product path. No live model, grade, stake, writer, reader, or public page changes.
