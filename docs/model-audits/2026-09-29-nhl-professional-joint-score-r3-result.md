# NHL professional joint-score r3 result — 2026-09-29

## Release-pure result

Source artifact:
`nhl-research/nhl_professional_score_tournament_2026_09_29_r2.json`.

The final chronological dataset contains 5,248 regular-season games and 1,311
priced 2025 games. The market-calibration segment contains 917 games; the
untouched holdout contains 394.

On the exact same holdout:

| Measure | r2 independent | r3 candidate | Change |
|---|---:|---:|---:|
| Team-score MAE | 1.4116 | 1.3938 | -0.0178 |
| Margin MAE | 2.1388 | 2.1033 | -0.0354 |
| Total MAE | 1.8888 | 1.8572 | -0.0317 |
| Winner direction | 54.57% | 54.31% | -1 game |
| Winner Brier | 0.2447 | 0.2438 | improved |
| Winner log loss | 0.6823 | 0.6802 | improved |
| Total direction | 55.27% | 56.56% | +1.29 pp |
| Puck-line direction | 65.74% | 65.74% | even |

The one-game winner-direction difference is disclosed rather than hidden. The
candidate wins the primary score-error comparison, improves winner probability
calibration, improves Total direction, and retains puck-line direction. The old
90% Total market anchor is rejected: it worsens untouched-holdout Total MAE from
1.8572 to 1.9061. The statistically equivalent least-market-dependent tuning
choice is therefore 20% Moneyline sanity correction and 0% fixed Total-line
weight.

## Opening-night board impact

The read-only five-game replay preserves all 15 markets. The r2 board had 2 Best
Angles, 7 Leans, and 6 Watchlists. The r3 candidate has 5 Best Angles, 8 Leans,
and 2 Watchlists: 7 promotions, 4 demotions, and no missing market. Those counts
are evidence outcomes, not quotas.

Material coherence changes include:

- MTL-TOR changes from an impossible inferred `TOR +1.5` to the actual quoted
  `MTL +1.5`, consistent with the same final distribution.
- Total projections no longer equal the book line. Candidate expected totals
  span 5.26 to 5.83 while the evaluated lines span 6.0 to 6.5.
- Each displayed score retains continuous decimal precision and its Moneyline,
  Total, and puck-line sides are computed from the same joint score PMF.

The SharpAPI split preview resolves 30 observations: both sides of Moneyline,
Total, and puck line for all five games. Playbook currently supplies zero NHL
rows, so the existing silent SharpAPI fallback supplies the complete section.
No label or freshness copy is added. Current-season MoneyPuck files presently
return HTTP 404; the daily refresh now attempts current season first and then
silently uses the verified completed-prior team and goalie feeds (160 team rows
and 490 goalie rows in the read-only verification).

## Operational repairs bundled with the release

- NHL is included in the September minute-lock season registry.
- Active NHL is ordered before inactive NBA in the existing sport navigation.
- SharpAPI abbreviation-prefixed split names normalize exactly.
- Current puck lines come from a complete same-book quoted pair.
- Current-season MoneyPuck team and goalie refreshes have a completed-prior
  fallback instead of making the slate unhealthy.
- Dry-run logging exposes the candidate score for operational verification only;
  member copy and layout are unchanged.

This result authorizes publication only after the clean-PR and live acceptance
gates pass. Forward performance remains release- and lock-time separated.
