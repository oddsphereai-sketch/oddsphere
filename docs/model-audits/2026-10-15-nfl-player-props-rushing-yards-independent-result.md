# NFL player props independent Rushing Yards result

Date: 2026-10-15
Decision: promote the RB-only point and probability repair for future unlocked rows

## Frozen candidate

Running backs alone receive a `75%` blend of the released independent center and a market-free
team rush budget × team-wide QB/RB/FB/WR normalized expected share × attempt-weighted yards per
carry head. The production-parity feature contract excludes
`external_ftn_rusher_is_rpo_lag1` because that research field is not stored by the active runtime.
The complete chronology was rerun after that exclusion. Sportsbook-offer presence does not force
participation or enter the team-share denominator; player participation is inferred strictly from
the stored roster, depth, availability, role, team, opponent, and environment features. QB, WR,
FB, TE, and unsupported positions retain the released center and probability exactly.

RB probability uses 1,001 empirical residual quantiles fitted on preceding-season pooled RB+WR
factorized errors. WR contributes dispersion evidence only and receives no point or probability
authority. Sportsbook line, price, consensus, movement, split, and market probability are absent
from both the center and residual fit. The existing target-book-excluded market reader and exact-
price grade path remain downstream and unchanged.

## Point accuracy

| Evaluation | Rows | Active MAE | Candidate MAE | Active RMSE | Candidate RMSE |
| --- | ---: | ---: | ---: | ---: | ---: |
| 2024 all positions | 1,862 | 19.03715 | **18.71998** | 27.39057 | **26.57469** |
| 2024 RB | 1,270 | 22.06308 | **21.59806** | 30.73849 | **29.66988** |
| 2025 all positions | 1,809 | 18.55798 | **18.20956** | 27.46852 | **26.86350** |
| 2025 RB | 1,233 | 21.61563 | **21.10443** | 31.29633 | **30.51609** |
| Exact 2026 Weeks 1–5 all offers | 30 | 16.90936 | **16.13227** | 24.18451 | **22.83132** |
| Exact 2026 Weeks 1–5 RB offers | 9 | 37.20920 | **34.61889** | 40.30173 | **37.57869** |

The 2025 game-clustered MAE-delta interval is `[-0.54603, -0.14377]`. Every predeclared
chronological segment improves: Weeks 1–4 `-0.31023`, 5–9 `-0.44091`, 10–13 `-0.17464`, and
14–18 `-0.42107` MAE. The 576 non-RB 2025 fallback rows and 21 non-RB exact 2026 offers are
bit-for-bit unchanged.

The official 2024/2025 feature substrate contains settled box-score outcomes but no historical
prop line. A release-pure historical Over/Under directional rate therefore does not exist and is
not reconstructed. On the exact immutable 2026 offered rows, direction is unchanged at `13/30`
overall and `1/9` for RB; QB remains `12/21` exactly.

## Distribution calibration

2024 RB+WR errors are the frozen fit population, not an honest calibration evaluation. On untouched
2025 RB outcomes, pooled non-QB residuals improve:

| 2025 RB metric | Active | Candidate |
| --- | ---: | ---: |
| CRPS | 16.07179 | **15.68432** |
| PIT calibration error | 0.008516 | **0.008029** |
| Mean interval-coverage error | **0.005461** | 0.013085 |

The interval error increases by `0.007624`, inside the frozen `+0.01` ceiling, and the clustered
CRPS-delta interval is `[-0.58221, -0.18712]`. Refitting the same frozen residual identity on 2025
and scoring the nine exact 2026 RB offers moves selected-side Brier `0.50002→0.38882`, log loss
`1.29837→1.00140`, and calibration gap `0.63536→0.55389`; side record and exact-price return remain
`1/9` and `-7.1228u` because no historical offered side changes.

## Rejected probability candidates

The final pooled RB+WR residual distribution was promoted only after three narrower alternatives
failed a frozen calibration or stability gate. A pooled non-QB calibration improved CRPS but
worsened PIT and interval coverage beyond its limits; an RB-only residual fit improved CRPS but
worsened PIT; and the residual-transport candidate improved CRPS while failing PIT and interval
coverage. None received runtime authority.

## Exact Week 6 zero-write rehearsal

The replay uses one frozen live snapshot, the same retained market evidence, the same 924 forward-
evidence rows, and the same current-season state for control and candidate. It makes zero provider
calls and zero production writes. The comparable canonical board has 1,204 exact offers, 1,793
feature rows, and 710 decisions.

| Week 6 impact | Active | Candidate |
| --- | ---: | ---: |
| All actionables | 25 | 25 |
| Rushing Yards actionables | 2 | 2 |
| Rushing Yards Over / Under actionables | 1 / 1 | 1 / 1 |
| Promotions / demotions | — | 0 / 0 |
| Rushing Yards projection changes | — | 66 RB rows |
| Rushing Yards forecast-side changes | — | 19 RB rows |
| Rushing Yards grade changes | — | 3 No Play → Watchlist |

All 42 QB and four WR Rushing Yards rows have zero projection, probability, side, or grade change.
All 19 side changes are non-actionable or Held RB evaluations. The three grade changes are Emanuel
Wilson Under 66.5, Javonte Williams Under 70.5, and Kyren Williams Under 69.5; each moves No Play
to Watchlist. No Lean or Best Angle is promoted or demoted, so the board is neither flattened nor
padded.

## Release and safety contract

- expected-role artifact: `nfl_player_props_expected_role_runtime_2026_10_15_r7_independent_rushing_yards`
- portable artifact: `nfl_player_props_runtime_2026_10_15_r15_independent_rushing_yards`
- model / calibration: `nfl_player_props_distribution_model_2026_10_15_r26_independent_rushing_yards` / `nfl_player_props_distribution_calibration_2026_10_15_r28_independent_rushing_yards`
- decision / runtime / board: `nfl_player_props_decision_2026_10_15_r32_independent_rushing_yards` / `nfl_player_props_runtime_2026_10_15_r33_independent_rushing_yards` / `nfl_player_props_board_2026_10_15_r36_independent_rushing_yards`
- member / lifecycle / writer / tracking: `nfl_player_props_member_2026_10_15_r45_independent_rushing_yards` / `nfl_player_props_member_lifecycle_2026_10_15_r27_independent_rushing_yards` / `nfl_player_props_writer_2026_10_15_r56_independent_rushing_yards` / `nfl_player_props_tracking_2026_10_15_r32_independent_rushing_yards`

The existing sole writer and `prediction_pipeline:nfl` lease remain authoritative. Provider calls,
cadence, representative-line selection, market reading, grade thresholds, stakes, copy, labels,
and layout do not change. Reconciliation continues to return every stored locked decision before
new release semantics are considered; the candidate applies only to unlocked and future rows.
Production rollback restores the complete r6/r14/r25/r27/r31/r32/r35/r44/r26/r55/r31 predecessor
family for future unlocked evaluation without rewriting any lock.
