# NFL player props full-family professional model — result

Date: 2026-09-29
Production base: `5388b1d92a37245b11654d590f4ea3a9d87bc8cf`
Predeclaration: `docs/model-audits/2026-09-28-nfl-player-props-full-family-predeclaration.md`

## Decision

Promote five market-specific point/distribution upgrades: Passing Yards, Rushing
Attempts, Rushing Yards, Receptions and Receiving Yards. Retain the already-active
Passing Attempts and Passing Completions champions because their matchup challengers
did not improve both locked holdout MAE and RMSE. Retain the active Anytime Touchdown
model because the previously predeclared role/red-zone and teammate-ranking candidates
failed external confirmation.

This is a complete family-by-family decision, not one architecture applied to every
market. It changes no member copy, labels, layout, canonical one-line selection,
stake, schedule, writer, lease, lock rule or settlement rule. Existing locked rows
remain immutable; the release begins with the next unlocked slate.

## Independent model architecture

The reproducible pregame feature set combines player role and opportunity history
with team/opponent pass and rush mix, completion and yards efficiency, pressure/sack
rate, first-down and turnover rates, explosive-play history, air-yards/YAC context,
home field, week, temperature, wind and roof state. Team rolling play mix represents
coaching and style tendencies without fitting a fragile coach-name coefficient.
Current-season overlays reuse the existing official player and team box-score state;
weather reuses the stored NFL forward-evidence bundle. No provider request was added.

The architecture remains market-specific:

- Passing Yards uses the existing attempt opportunity head with a newly confirmed
  matchup-aware conditional yards-per-attempt head, blended with a regularized direct
  head.
- Rushing Attempts and Receptions use count-aware Poisson HGB heads.
- Rushing Yards uses the confirmed stable shallow Extra Trees head.
- Receiving Yards uses a conservative 75% incumbent / 25% compact matchup-forest
  blend.
- Related quarterback markets remain physically coherent, including Completions not
  exceeding Attempts.

## Frozen chronology and point accuracy

Training ends in 2022, 2023 selects, 2024 confirms and 2025 is the untouched holdout.
The official-outcome dataset contains 138,860 player-games and is pinned to SHA-256
`6afb497b7a18c1e97a6bf2e9e7ec047c2f3ad5d98640914f70e2b8afdb9cc953`.

| Market | Preceding 2025 MAE / RMSE | Selected 2025 MAE / RMSE | Decision |
| --- | ---: | ---: | --- |
| Passing Attempts | 6.0782 / 9.4508 | 6.0782 / 9.4508 | retain |
| Passing Completions | 4.0102 / 6.1916 | 4.0102 / 6.1916 | retain; challenger RMSE regressed |
| Passing Yards | 45.0262 / 70.6226 | 44.7622 / 70.3689 | promote |
| Rushing Attempts | 2.2068 / 3.5135 | 2.1484 / 3.4976 | promote |
| Rushing Yards | 12.2131 / 21.0768 | 11.9864 / 20.9780 | promote |
| Receptions | 1.2106 / 1.7259 | 1.1982 / 1.7174 | promote |
| Receiving Yards | 15.7058 / 23.6538 | 15.6724 / 23.5956 | promote |

Every promoted family improved both point-error measures through selection,
confirmation and holdout. Each promoted mean is paired with a newly selected and
refit release-specific empirical residual distribution; probability, interval and
displayed projection therefore share one center and residual family.

## Market-reading marriage

The target-book-excluded market posterior remains upstream of the single published
projection and downstream of the improved independent mean. The evaluated book is
excluded from consensus and affects only executable economics. The current same-line
residual coefficient and quarterback cross-market workload marriage remain active;
they were not silently retuned from one opened week.

The complete Week 3 evidence audit contained 627 settled representative ordinary
lines. The existing posterior improved Brier score from 0.27030 independent and
0.25717 market-only to 0.25677. Only four representative rows had retained sharp-book
evidence, while movement disagreement was 52-48 in favor of the independent direction.
That is insufficient to fit a new sharp or movement flip coefficient. Circa/Pinnacle/
Bookmaker therefore remain distinct confirmation evidence, not equal-weighted retail
fallbacks or fabricated automatic flips. Same-book movement remains grade context;
the already-validated target-excluded posterior remains the authoritative marriage.

## Locked same-board replay and grade surface

A zero-provider-call replay reconstructed 1,222 exact offers and 238 feature rows from
the immutable Week 3 evidence bundle and current-season state frozen through Week 2.
It matched 800 member decisions. Relative to the stored preceding decisions it showed
14 promotions and six demotions, moving actionables from 22 to 30 rather than
flattening the board. On the 338 settled ordinary identities retained by the evidence
capture, direction wins moved from 153 to 158; actionable wins moved from 8/22 to
13/30. Passing Yards moved from 22/44 to 28/44, with all three newly actionable rows
winning.

This opened Week 3 replay is diagnostic, not a claimed future win rate. Grade
thresholds are unchanged: exact target price, target-book-excluded evidence,
participation, freshness, edge and EV still decide actionability downstream of the
forecast. The result proves paired promotions/demotions and no board collapse; future
performance remains release-separated by lock timestamp.

## Runtime and operational safety

- Portable artifact parity passes at `1e-9`.
- The high-node forest payload uses a compact positional representation, reducing the
  candidate runtime from 18.27 MiB to 11.46 MiB without changing predictions.
- Current-season team matchup overlays, stored weather context, shared-context zero-call
  reuse, one-writer lifecycle, T-60 freeze, tracking and compressed snapshot tests pass.
- Week 4 currently has no complete NFL forward-evidence game bundle, so the no-write
  natural-slate runner correctly holds instead of publishing an empty or synthetic
  board. The release takes effect only after the authoritative NFL evidence writer
  supplies the next unlocked slate.
- Provider ceilings, schedules, `prediction_pipeline:nfl` lease ownership and the sole
  player-props writer remain unchanged.

## Release set and rollback

- portable / model / calibration / decision: `nfl_player_props_runtime_2026_09_29_r6_full_family_matchup` / `nfl_player_props_distribution_model_2026_09_29_r14_full_family_matchup` / `nfl_player_props_distribution_calibration_2026_09_29_r15_full_family_matchup` / `nfl_player_props_decision_2026_09_29_r18_full_family_matchup`
- runtime / board: `nfl_player_props_runtime_2026_09_29_r19_full_family_matchup` / `nfl_player_props_board_2026_09_29_r22_full_family_matchup`
- member / lifecycle / writer / tracking: `nfl_player_props_member_2026_09_29_r29_full_family_matchup` / `nfl_player_props_member_lifecycle_2026_09_29_r12_full_family_matchup` / `nfl_player_props_writer_2026_09_29_r34_full_family_matchup` / `nfl_player_props_tracking_2026_09_29_r17_full_family_matchup`
- inference context / QB joint: `nfl_player_props_inference_context_2026_09_29_r6_matchup_environment` / `nfl_player_props_joint_runtime_2026_09_29_r2_full_family_matchup`

Roll back the complete September 29 family to the September 28 official-outcome
joint release without rewriting locked evidence if a natural cycle loses eligible
games or markets, mixes releases, violates projection/side coherence, exceeds the
existing call ceiling, overlaps the sport lease, materially flattens the board, or
fails member-reader verification.
