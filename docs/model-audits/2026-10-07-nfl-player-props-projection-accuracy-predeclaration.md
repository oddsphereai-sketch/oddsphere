# NFL player props projection-accuracy research predeclaration

Date: 2026-10-07
Starting production base: `ad49470ed05d8345bd785d0b2ccd9a094151364b`

## Scope and current champion

This audit is limited to NFL Player Props prediction accuracy. It may replace an
independent market-specific point head and its matching residual distribution
only when the frozen chronology and gates below pass. It does not loosen grade,
edge, EV, movement, or same-line thresholds; expose alternate-line unders;
change canonical exact-line selection; or change stakes, member copy, labels,
layout, cadence, provider calls, locks, settlement, writer ownership, or the
shared `prediction_pipeline:nfl` lease.

The active portable/model/calibration/decision/runtime/board/member/lifecycle/
writer/tracking family is r7/r16/r18/r21/r22/r25/r33/r16/r39/r21 as recorded in
`docs/current-model-releases.md`. Passing Attempts, Passing Yards, Rushing
Attempts, Rushing Yards, and Receiving Yards use the r18 market-selective
predicted-mean-quintile residual distributions. Passing Completions and
Receptions retain their preceding distributions. The underlying full-family
point artifact remains byte-identical to the September 29 release.

All existing locked projections, probabilities, sides, grades, prices, stakes,
evidence, and tracking tuples remain immutable. Any accepted behavior applies
only to newly generated unlocked rows and future locks.

## Established evidence and diagnosis targets

- The October 7 live canonical board moved from 11 actionables across 704 scopes
  to eight across 705 scopes between natural captures. Six of the later eight
  actionables were Unders. Across 289 ordinary Over/Under scopes, the raw
  forecast direction was 90 Overs and 199 Unders (31.1% / 68.9%) before grading.
  This is a forecast-diagnosis target, not an Over quota or permission to lower
  thresholds.
- All 13 internal actionables omitted by canonical selection were alternate-line
  Unders. Exposing them would worsen the imbalance and is prohibited here.
- On the release-pure Week 4 resolved exact-side sample, several Under lanes
  underperformed their matching Over lanes: Receiving Yards was 9/22 Under
  versus 10/12 Over, and Receptions was 25/58 Under versus 18/27 Over. The point
  residuals generally showed underprediction. These opened diagnostics may
  motivate candidates but may not be reused as an untouched holdout claim.
- The supported historical substrate already contains prior player workload,
  snap share, team volume, role share, opponent allowance, team/opponent play
  mix and efficiency, pressure/sacks, explosive plays, air yards/YAC, home
  field, week, and reproducible weather/roof context. Historical injury strings
  are explicitly unstamped and cannot enter training. Live verified injuries
  may continue to gate eligibility but will not receive an unvalidated learned
  coefficient. No separate OL/DL or coverage-grade history is presently
  available on the checksum-pinned substrate, so those candidates are out of
  scope unless a reproducible pregame source is first established in a separate
  predeclaration.

## Frozen hypotheses and candidate order

1. Diagnose the 68.9% Under raw direction by market, position, projected-volume
   band, recent-role band, line band, player tenure, and residual sign. Separate
   point-head underprediction from high sportsbook lines and from downstream
   target-excluded posterior behavior.
2. Test strictly market-specific direct residual corrections learned without a
   prop line: cross-fitted global intercept, predicted-mean/role buckets, and a
   conservative shrinkage surface over prediction, recent workload/share, snap
   share, position, team opportunity, opponent allowance, and supported matchup
   context. A sportsbook line or evaluated-book price is never a point-model
   feature.
3. For Rushing Attempts, Rushing Yards, Receptions, and Receiving Yards, test
   explicit opportunity-by-efficiency heads using the existing leakage-safe
   workload/share features. For related markets, enforce nonnegative output and
   coherent opportunities/efficiencies; retain the stronger direct component
   when chronology supports it.
4. Refit the empirical residual distribution for every advancing point head
   from pre-holdout out-of-sample residuals. A point gain cannot advance if
   CRPS/log loss, calibration, or 80%/90% interval coverage materially worsens.
5. Audit target-book-excluded market reading separately after the independent
   point tournament. It may not hide a weak point head, read the evaluated book,
   fabricate cross-book movement, or change exact-line identity. No market rule
   advances without release-pure chronological evidence beyond the point-model
   holdout.

### Pre-holdout amendment: settlement-population alignment

Before running a participation-conditioned candidate, the audit found that the
released point tournament treats every prior-role-eligible roster/game row as a
settled volume or yardage outcome. In 2025, `participated = 0` for 53.06% of the
QB-eligible rows, 47.15% of rushing rows, and 31.46% of receiving rows. The live
settlement path does not grade a player absent from the final exact-game stats
response; those rows remain pending rather than becoming zero-yard losses. The
historical point target and probability residuals are therefore trained on a
material population that is not in the settled wager denominator.

The second candidate is frozen before its 2025 conditional metrics are opened:

- Keep the released market-specific architecture, features, recipes, and QB
  opportunity/rate coherence unchanged, but fit the volume/yardage point heads
  and empirical residual distributions only on rows with `participated = 1`.
- Evaluate incumbent and candidate on the same `participated = 1` rows because
  this is the settlement-aligned target population. `participated` is a target
  filter only and may not enter the pregame feature matrix.
- Keep the separately trained participation probability, verified injury holds,
  role/identity holds, and minimum-participation grade gate unchanged. The
  candidate does not infer that an offered player is healthy, does not create a
  wager when participation evidence is weak, and does not settle a DNP as zero.
- Reapply every original selection, confirmation, clustered holdout, segment,
  distribution, coherence, exact-board, lock, and actionability gate. Report the
  excluded nonparticipant counts explicitly by season and market.
- Because a 100% conditional replacement can overcorrect a strong incumbent,
  test only the fixed conservative blend grid 25%, 50%, 75%, and 100%
  conditional. Select the weight on 2023 only, require the identical weight to
  improve both MAE and RMSE on 2024, and then open 2025 once. A weight may not be
  chosen or revised from 2025 results.

This amendment corrects the evaluation population to the existing settlement
contract; it is not a threshold or side adjustment. If the conditional head
fails the frozen gates, it is rejected without retuning on 2025.

## Chronology and frozen metrics

- Use the checksum-pinned official 2016-2025 player-game history. Training ends
  in 2022; 2023 selects a candidate family; 2024 confirms it; and 2025 remains
  the one untouched point/distribution holdout. The incumbent is refit on the
  same bytes for every comparison.
- Candidate hyperparameters, correction strength, feature family, and blend
  weight are selected without 2025 outcomes. The holdout is opened once for the
  fixed selected-and-confirmed candidate. A failed candidate does not authorize
  retuning on 2025; a new hypothesis must use the remaining pre-holdout evidence
  or remain shadow-only.
- Report rows and game clusters; MAE, RMSE, median absolute error, bias, and
  underprediction rate; game-clustered bootstrap intervals for paired MAE and
  bias changes; and results by market, position, role/volume band, and season
  segment.
- Recalibrated distributions report CRPS, negative log likelihood or the
  applicable proper scoring rule, PIT/calibration diagnostics, and 50%/80%/90%
  interval coverage. Probability evaluation at historical sportsbook lines is
  reported only where a release-pure pregame line is actually stored.
- Current and Week 4 exact-board replays remain decision diagnostics. They must
  use identical captured inputs and report every projection, side, probability,
  grade, promotion, demotion, actionable, market, and Over/Under transition.

## Frozen acceptance gates

- A point head may advance only when it beats the refit incumbent in both MAE
  and RMSE in 2023 selection and 2024 confirmation, then improves 2025 holdout
  MAE and RMSE with a game-clustered 95% interval for paired MAE delta below
  zero. Absolute bias and underprediction rate must improve or remain within a
  predeclared negligible tolerance of 0.25% of the market mean.
- The result must survive at least four chronological 2025 segments and the
  principal role/volume strata without a single small cohort accounting for the
  aggregate gain. Rows from the same game are clustered for uncertainty.
- An advancing point head must also produce a recalibrated residual distribution
  whose holdout CRPS improves and whose NLL/proper score and 80%/90% coverage do
  not materially worsen. Displayed projection, probability, and side must remain
  one coherent posterior.
- Point-model acceptance is independent of actionable count. Any downstream
  actionable change must arise from the better projection under the unchanged
  price and grade contract. Every demotion is evaluated against the same
  symmetric promotion path; report paired counts, exact-price EV, market mix,
  side mix, and board count. No nonpositive-EV actionable or hidden board
  flattening is allowed.
- A candidate adds no provider request, database loop, writer, schedule, lease,
  member copy, label, layout, alternate-line selection, or stake behavior. It
  must preserve all offered eligible game/market scopes, fail closed on missing
  required context, retain the last coherent snapshot on failure, and
  byte-preserve every prior lock.

If no candidate passes every point and distribution gate, the result is a
documented negative research outcome. No grade-only change, alternate-line
Under expansion, model identifier, calibration identifier, or live decision
behavior advances.

## Publication boundary

This research branch reserves no production release number. If and only if a
candidate passes, a result audit will name a new immutable full release family,
verify the exact exported runtime constants and registry in the same commit,
and run focused tests, `npm run verify:model-change`, identical-board replays,
latest-main integration, integration-safety, protected pull-request checks, and
deployed writer/reader/lease/coverage/lock proof. The coordinating task must be
notified before any model change is published.
