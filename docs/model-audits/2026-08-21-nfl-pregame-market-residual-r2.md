# NFL pregame market-residual tournament r2

Date: 2026-08-21
Scope: NFL regular-season moneyline, spread, and total; isolated local shadow research only
Production predictions, grades, stakes, tracking, readers, crons, and release pointers changed: **no**

## Decision

Accept `nfl_pregame_market_residual_shadow_2026_08_21_r2` as a **point-margin
shadow challenger only**. Reject the tested total correction and fall that target
back to the zero-correction market reference. Reject both opening-price and
terminal-price wagering policies. This release cannot create an actionable grade.

This is a genuine football challenger rather than a relabeled market probability:
it learns a capped correction to a provider-native opening from opponent-adjusted
EPA, pass/rush efficiency, success, explosiveness, pressure/sack/turnover rates,
pace, red-zone performance, quarterback performance/continuity, roster/coaching
continuity, rest, division context, and snap-weighted player availability. The
correction is selected chronologically and frozen before the 2024-2025
confirmation seasons are evaluated.

## Immutable releases and boundary

- Tournament: `nfl_opening_residual_tournament_2026_08_21_r2`
- Model: `nfl_pregame_market_residual_shadow_2026_08_21_r2`
- Calibration experiment: `nfl_pregame_residual_logit_shadow_2026_08_21_r2`
- Feature input: `nfl_player_value_features_2016_2025_2026_08_20_r3`
- Champion reference: `nfl_market_reference_core_2026_08_20_r1`
- Selection seasons: 2022-2023
- Confirmation seasons: 2024-2025
- Preseason rows: excluded
- Promotions: 0
- Demotions: 0
- Net actionable-board change: 0

The script is `scripts/operator/tournament_nfl_opening_residual_v2.py`. It reads
checksum-verified local data, writes only ignored local research artifacts, and
has no production writer, database, API, member-reader, tracking, or cron path.

## Data and timestamp contract

The evaluation joins 1,358 genuine DraftKings opening snapshots across the 2021-
2025 regular seasons. Provider-native opening lines and two-sided prices are used;
no opening is synthesized. Incomplete target/baseline pairs are excluded rather
than imputed.

The player-availability fields come from the final weekly historical report. They
are therefore valid only as a near-kick overlay when the live availability
snapshot has reached the same information state. They are never represented as
knowledge available at the opening timestamp. Game-time weather is excluded from
this tournament. Public and sharp split history is absent and was not fabricated.

## Selected point model

The selected margin recipe is
`residual__multiscale_player__hist_l20__w0.25`: a strongly shrunk, capped
histogram-gradient correction with a mean absolute adjustment of approximately
0.45 points in confirmation.

| Margin evaluation | Games | Opening | Challenger | MAE improvement |
|---|---:|---:|---:|---:|
| 2024 | 271 | 9.7011 | **9.6733** | +0.0278 |
| 2025 | 272 | 9.7482 | **9.7457** | +0.0024 |
| 2024-2025 pooled | 543 | 9.7247 | **9.7096** | +0.0151 |

The effect is real enough to retain in shadow but too small to claim a betting
edge. The 2025 season was inspected by earlier NFL work, so it is historical
confirmation rather than a pristine future holdout. Timestamp-locked 2026 forward
predictions remain mandatory.

## Rejected total correction

The selection-period total challenger failed both confirmation seasons and is
automatically replaced by the zero-correction reference.

| Total evaluation | Games | Opening | Challenger | MAE improvement |
|---|---:|---:|---:|---:|
| 2024 | 271 | **9.7030** | 9.7436 | -0.0407 |
| 2025 | 272 | **10.4449** | 10.4852 | -0.0403 |
| 2024-2025 pooled | 543 | **10.0746** | 10.1151 | -0.0405 |

The effective r2 total model is therefore the unchanged champion reference. The
previous tiny player-value total residual remains a separate shadow experiment;
r2 does not silently combine or promote it.

## Probability results

Against opening prices, the margin challenger improved confirmation proper scores:

- Moneyline Brier: **0.20695** versus 0.20813 market-only.
- Spread Brier: **0.24950** versus 0.24964 market-only.
- Total: exact market fallback, 0.25017 versus 0.25017.

Against terminal nflverse prices, the challenger did not beat the market:

- Moneyline Brier: 0.20637 versus **0.20618** market-only.
- Spread Brier: 0.25089 versus **0.25028** market-only.
- Total: exact market fallback, 0.25009 versus 0.25009.

The terminal probability gate therefore fails. This is important product
evidence: the football correction contains a small opening-stage forecasting
signal, but the later market generally absorbs it. The reader may show the
independent projection in shadow; play grades must still use the champion
probability until a correction adds value at the actual decision timestamp.

## Sharp-brain policy result

No terminal-price policy qualified on the 2023 policy-selection season. The
opening-price rule that looked best in 2023 failed immediately in 2024-2025:
20-42, -16.76 units, -27.0% ROI. It is rejected rather than repackaged through a
lower threshold or a different grade name.

Consequently:

- Point-margin shadow gate: pass.
- Total shadow gate: fail, zero-correction fallback.
- Opening probability gate: pass for moneyline/spread.
- Terminal probability gate: fail.
- Weekly portfolio gate: fail.
- Actionable-grade authorization: **false**.

## What this closes and what remains

This tournament establishes a reproducible independent NFL margin component and
proves that simply converting its largest disagreements into bets is not enough.
The remaining work is narrower:

1. Create timestamp-matched T-24h, T-6h, and T-60m availability/weather features
   rather than treating a final weekly report as available all week.
2. Collect same-book current and lock prices so decisions are evaluated at the
   price the member actually saw, not a terminal consensus proxy.
3. Preserve the independent point projection while shrinking probability influence
   to zero whenever the current market has already absorbed the information.
4. Evaluate splits and movement only after comparable historical or forward rows
   exist; no split-derived grade can be backfilled from current percentages.
5. Freeze the next candidate before 2026 Week 1 and require forward CLV, proper-
   score, calibration, and locked-price evidence before grade promotion.

## Verification

- Python compilation of `tournament_nfl_opening_residual_v2.py`.
- Full chronological r2 tournament completed from checksum-verified inputs.
- Generated report invariants checked: margin target pass, total target fail with
  zero fallback, probability gate fail, portfolio gate fail, actionable false.
- Existing focused football runtime suites are run separately in the isolated
  worktree; no production behavior is changed by this research-only commit.

## Rollback

Delete the isolated tournament script and this audit. Generated report/model files
are ignored local research artifacts. No production state or shared-checkout work
requires rollback.
