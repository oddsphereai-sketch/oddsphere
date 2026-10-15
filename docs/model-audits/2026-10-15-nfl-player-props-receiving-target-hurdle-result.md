# NFL player props receiving target-hurdle result

Date: 2026-10-15
Decision: reject at historical selection; retain the released Receptions and Receiving Yards heads

## Result

The target-participation × conditional-target-share architecture does not improve the released
independent centers. No position cohort clears the frozen 2024 requirement to improve both MAE and
RMSE, so the 2025 confirmation window is reported only as the unchanged control and the 2026 replay,
probability, and board gates remain closed.

| Market | Released 2024 MAE / RMSE | 25% candidate MAE / RMSE |
| --- | ---: | ---: |
| Receptions | 1.512054 / 2.023363 | 1.542400 / 2.054766 |
| Receiving Yards | 19.796445 / 27.297911 | 19.999527 / 27.695723 |

Larger `50%`, `75%`, and `100%` weights worsen both aggregate metrics further. The only partial
signal is lower tight-end RMSE at the 25% weight: Receptions RMSE moves `2.141489 → 2.089333` and
Receiving Yards RMSE moves `24.647635 → 24.309885`. Tight-end MAE worsens in both markets, however,
so neither result qualifies.

## Diagnosis

The roster-normalized hurdle systematically reallocates volume between position groups rather than
solving the role miss. At the 100% component weight, Receptions bias is `+1.486370` for backs,
`-1.441698` for wide receivers, and `+1.008087` for tight ends. Receiving Yards shows the same
direction: `+9.787254`, `-18.294768`, and `+10.774575` yards respectively. The model therefore
overallocates opportunity to backs and tight ends and underallocates it to wide receivers.

The experiment uses no sportsbook line, price, book, consensus, movement, current-game result, or
prop-availability feature. It confirms that a pooled target-survival probability followed by one
team normalization is not an adequate replacement for position- and role-conditioned receiving
volume. It does not support increasing market dependence.

## Decision boundary

No production projection, distribution, probability, side, grade, stake, writer, lease, cadence,
or locked record changes. The released Receptions and Receiving Yards heads retain full authority.
The next materially distinct receiving test should preserve the released point centers and test
position- and role-conditioned residual/tail distributions, with Receptions and Receiving Yards
scored separately. It must not retune this failed target-share architecture or invent unavailable
route-participation, coverage-shell, or defender-assignment observations.
