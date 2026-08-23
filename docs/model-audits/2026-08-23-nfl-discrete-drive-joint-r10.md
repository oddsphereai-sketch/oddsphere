# NFL discrete drive joint r10 audit

Date: 2026-08-23

Status: qualified distribution and representative-score candidate. Production
still requires exact-price grade integration, release wiring, and live proof.

## Frozen selection

r10 retained the r9 PMF and evaluated only the predeclared representative-score
weights on 2023. Weights within `0.05` combined team-score MAE of the best
candidate were eligible. Weight `0.40` won by the lowest mean weekly duplicate
rate, then center fidelity. It had 2023 team-score MAE `7.41728` versus
`7.40809` for r9 weight `0.05`, while reducing mean weekly duplicate rate from
`45.18%` to `24.04%`.

## Untouched confirmation

All r9 PMF probability, exact-score, calibration, and interval gates remain
passed. The r10 point functional additionally passed every frozen confirmation
gate:

- 2024: 100% support and winner fidelity, zero tie contradictions, team-score
  MAE `7.28125` versus r9 `7.31434`, and mean weekly duplicate rate `18.82%`
  versus `41.62%`.
- 2025: 100% support and winner fidelity, zero tie contradictions, team-score
  MAE `7.37868` versus r9 `7.52941`, and mean weekly duplicate rate `22.20%`
  versus `41.62%`.

## Current Week 1

The 16 representative predicted scores are:

- NE@SEA 24-26; SF@LAR 23-27; TB@CIN 23-26; NO@DET 23-27.
- NYJ@TEN 20-21; BAL@IND 24-20; ATL@PIT 20-24; CHI@CAR 23-21.
- CLE@JAX 17-27; BUF@HOU 24-23; MIA@LV 24-20; GB@MIN 20-23.
- WSH@PHI 20-24; ARI@LAC 20-24; DAL@NYG 24-23; DEN@KC 20-19.

The score display has team-score SD `2.51`, margin SD `3.53`, total SD `3.17`,
team scores `17..27`, margins `-4..10`, totals `39..50`, six Over and ten Under
forecast directions, five duplicated away/home pairs, 100% PMF-winner
fidelity, and zero tie contradictions. Mean distance from the PMF center is
`0.33` margin points and `1.07` total points.

All moneyline, spread, and total probabilities come from this same discrete
joint PMF. The representative score is a supported point summary of that PMF,
not an independent probability head, market-copy score, or rounded decimal
mean.

## Release decision boundary

The distribution candidate is qualified. It authorizes production integration
of the coherent Week 1 predictions only after versioned artifact generation,
focused/full verification, clean integration, and live proof. Exact-price Bet
grades remain a separate decision layer: qualifying coherent r6 moneylines may
be Lean, coherent nonqualifiers are No Play, genuine data failures are Held,
and no Best Angle is authorized. Spread and Total predictions do not by
themselves authorize actionable grades.
