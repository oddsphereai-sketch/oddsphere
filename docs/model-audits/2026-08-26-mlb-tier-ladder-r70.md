# MLB Moneyline tier ladder r70

Date: 2026-08-26

Status: production candidate. The audit was read-only; no writer, cron,
provider, or database mutation was invoked. Locked rows remain immutable.

## Decision

Ship only `ml_coherent_near_edge_watchlist_v1_2026_08_26` as a strictly
nonactionable monitoring rung. Reject all three proposed Lean candidates and
the prior-action hysteresis Watchlist. The release changes no forecast side,
probability, projected score, evaluated quote, Best Angle/Lean action, stake,
provider call, writer, lease, or T-60 behavior.

The Watchlist resolver requires a complete market-scoped Moneyline tuple,
unchanged side, model probability at least 50%, exact price -300..+200,
exact-price EV at least -3%, nonnegative same-side score-projection gap, no
independent public conflict, no correction/inversion/raw-side/provisional/data
hold, and adverse same-book movement no greater than 0.75 implied-probability
points. The 0.75 boundary preserves the predeclared +/-0.25pp stability cushion
inside the public 1.0pp limit. Signed money-below-tickets resistance remains in
the audit snapshot. The public tier is Watchlist, while
`decision_pipeline.board_action` remains `no_play`, `actionable_grade` remains
null, Best Angle remains false, and no stake is created.

## Frozen protocol and data

The protocol was committed before querying post-r69 outcomes or current-board
counterfactuals in
`docs/model-audits/2026-08-26-mlb-tier-ladder-predeclaration.md`. The read-only
query loaded 684 prediction records from August 10-26 and evaluated 127 settled,
locked Moneyline rows carrying the active probability head. Windows were
August 10-14 development, August 15-19 validation, August 20-24 confirmation,
and August 25-26 current impact only. The latest August 26 row per game/market
was used for the current board. Release coverage was reported separately and
spanned r48-r69; the active probability head, exact locked selected-side price,
projection agreement, stored same-book movement, timestamp-valid SharpAPI
split, completeness, grade history, result, and available CLV were required.

## Candidate evidence

| Candidate | Dev | Validation | Confirmation | Pooled settled | Decision |
| --- | ---: | ---: | ---: | ---: | --- |
| coherent near-edge Watchlist | 0 | 6 (4-2, +1.356u) | 3 (2-1, +0.009u) | 9 (6-3, +1.365u) | nonactionable only |
| prior-action hysteresis Watchlist | 0 | 1 (0-1, -1.000u) | 0 | 1 (0-1, -1.000u) | reject |
| strong-value resistance Lean | 0 | 0 | 0 | 0 | reject |
| prior-action hysteresis Lean | 0 | 0 | 0 | 0 | reject |
| clean near-market Lean | 0 | 0 | 0 | 0 | reject |

The near-edge Watchlist's pooled locked-price ROI was +15.16%; after removing
its largest win it retained +0.472u. This is descriptive only. Validation
calibration gap was +13.32pp; confirmation contained only three games,
retained just -0.590u after removing its largest win, and date-cluster
bootstrap probability of positive units was 73.31% with a -24.78%..+77.93%
ROI interval. Five rows had comparable beat-close flags and only one beat close;
mean derived CLV over nine rows was +0.597pp. Stored grade-history state changed
more than once for 77.78% of the cohort. These limitations forbid Lean or any
return/CLV claim, but do not invalidate a truthful monitor-only label.

Every actionable candidate had zero historical qualifiers after the complete
exact-tuple and chronology gates. Consequently no Lean/Best Angle rule may be
loosened, and there are zero actionable promotions and zero demotions.

## Exact current-board impact

Read-only snapshot time: 2026-08-26T20:57:52Z. The 15-game Moneyline board was
1 Best Angle / 1 Lean / 1 Watchlist / 12 No Plays. The candidate changes only:

- CIN@SF, SF -119, model probability 53.4713%, exact-price EV -1.5948%,
  same-side projection agreement, signed SharpAPI money-minus-tickets -13pp,
  neutral same-book movement 0.2095pp: No Play -> Watchlist.

Candidate board: 1 Best Angle / 1 Lean / 2 Watchlists / 11 No Plays. Actionable
count is unchanged. Total and First Inning are unchanged.

The remaining 11 Moneyline No Plays are not hidden operational exceptions:

- seven have material adverse same-book movement above 1pp: TB@DET 1.57,
  CHC@ARI 2.05 (also signed resistance), MIL@NYM 1.17, LAD@ATL 2.02,
  BOS@MIA 4.60, BAL@STL 1.35, and HOU@NYY 2.02;
- four remaining tuples have exact-price EV worse than -3%: PIT@SD -3.48%
  (signed gap -36pp), TEX@CWS -3.07% (signed gap -22pp), COL@WSH -6.15%,
  and MIN@ATH -8.24%.

Operational/incomplete rows remain internal high-severity exceptions and
member-facing reasoned No Play. They cannot enter this Watchlist resolver.

## Release and rollback

- public calibration remains
  `mlb_public_calibration_v27_strong_winner_resistance_lean_2026_08_22`;
- decision release `mlb_daily_edge_decision_2026_08_26_r70`;
- rule bundle
  `mlb_daily_edge_rule_bundle_v58_coherent_near_edge_watchlist_2026_08_26`;
- grade policy
  `mlb_public_grade_policy_v48_coherent_near_edge_watchlist_2026_08_26`;
- correction policy
  `mlb_prediction_corrections_v22_coherent_near_edge_watchlist_2026_08_26`.

Rollback is r69/v57/v47/correction v21. Probability heads and tracking v8 are
unchanged.

