# NFL Spread/Total High-Conviction Watchlist r4

## Decision

Publish a non-actionable Spread/Total Watchlist and same-PMF decimal expected-points
context. Preserve the qualified r10 discrete joint forecast, existing r6+r10 moneyline
Leans, all stakes, and tracking boundaries. Do not publish a Spread/Total Lean or Best
Angle: none of the tested architectures passed their frozen confirmation contract.

Release identifiers:

- member: `nfl_v1_member_release_2026_08_24_r4_spread_total_watchlist`
- decision: `nfl_v1_daily_edge_decision_2026_08_24_r4_spread_total_watchlist`
- grade: `nfl_v1_grade_policy_2026_08_24_r4_spread_total_watchlist`
- writer: `nfl_forward_evidence_writer_2026_08_24_r5_spread_total_watchlist`
- fixture: `nfl_week_one_member_fixture_2026_08_24_r5_spread_total_watchlist`

## Forecast and display contract

The reachable integer `Predicted final score` and one-decimal `Expected points` are both
read from `nfl_v1_week_one_outcome_artifact_2026_08_23_r2_discrete_joint`. Artifact loading
now recomputes mean margin and total from the stored PMF marginals and fails if they do not
reconstruct the stored away/home means within 0.000002. The reader never invents decimal
precision. Representative scores retain 100% PMF-winner fidelity and zero non-tie forecast
contradictions.

Week 1 remains six Over and ten Under directions. Expected totals span 38.7–49.0. Examples:

- NE@SEA: predicted final 24–26; expected points 23.5–25.4;
- CLE@JAX: predicted final 17–27; expected points 17.6–27.7;
- MIA@LV: predicted final 24–20; expected points 24.4–20.3;
- DEN@KC: predicted final 20–19; expected points 20.1–18.6.

## Exact-price semantics

The single leased forward writer passes its already-captured comparable book inventory into
the existing production decision builder. Spread and Total evaluate each target quote at
its own exact line. Only other books at that same line enter the leave-one-book-out fair
probability, and at least two are required. The target is excluded. The deterministic best
tuple is chosen by Watchlist qualification, model EV, model edge, price, then sportsbook.

Watchlist requires conditional r10 probability >=60%, exact-price EV >=0%, edge over the
target-excluded same-line consensus >=3 percentage points, and PMF scoring cushion >=1
point, plus 0.5 at key spreads or <=41/>=50 total zones. It is monitoring only. Healthy
nonqualifiers are No Play; missing same-line inventory is Held. Lean and Best Angle cannot
be emitted by this policy.

## Historical evidence

The fixed 2023–25 cohort is descriptive because the current Week 1 examples were inspected
before the product-semantic threshold froze.

- Spread: 86 rows, 38-45-3, -9.668u, -11.24% ROI, -10.668u without largest win,
  positive CLV 31.40%, mean CLV +0.297, weekly bootstrap probability-positive 10.22%,
  ROI interval -29.52% to +5.98%. This is explicit evidence against actionability.
- Total: 72 rows, 38-32-2, +3.306u, +4.59% ROI, +2.325u without largest win,
  positive CLV 48.61%, mean CLV +0.417, weekly bootstrap probability-positive 69.10%,
  ROI interval -13.41% to +22.71%. This supports monitoring, not a Lean.

Rejected separate research included the raw exact-price r1 lane, pragmatic high-conviction
r2/r6 lanes, residual blend r3, nonlinear context calibration r4, target-excluded price
dislocation r5, market-informed classifier r7, and topology r8. None authorizes a live
action tier; their negative evidence is preserved in their predeclarations/operators.

## Current board impact

Read-only production evidence through 2026-08-24T17:06:33.302Z yields:

- moneyline unchanged: 7 Lean / 3 Watchlist / 6 No Play;
- Spread: 3 Watchlist / 12 No Play / 1 Held;
- Total: 2 Watchlist / 14 No Play;
- all 48: 7 Lean / 8 Watchlist / 32 No Play / 1 Held / 0 Best Angle.

The Spread Watchlists are MIA +3.5 FanDuel -104, ARI +10.5 BetMGM -110, and DEN +2.5
Fanatics +100. The Total Watchlists are CLE Over 40.5 BetRivers -107 and DEN Under 42.5
Caesars -107. DEN Under 43.5 FanDuel -118 was explicitly audited: the exact tuple selector
preferred Under 42.5 -107 after recomputing the PMF probability at 42.5, so no line/price
semantic mismatch exists.

Actionable promotions 0, actionable demotions 0, net actionable change 0. No stake or
tracking behavior changes.
