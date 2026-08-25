# CFB v1 composite grade release contract

Date: 2026-08-25

Status: implementation contract from previously frozen passing lanes

The production candidate combines only lanes that passed their predeclared
selection and repeated-confirmation gates:

- Moneyline: the 2022-fitted frozen market-residual calibrator and exact-price
  policy from the frozen-calibrator tournament;
- Spread: the 2022-fitted frozen independent calibrator and exact-price policy
  from the frozen-calibrator tournament;
- Total: the original fixed-PMF probability blend from the first tournament,
  whose Total lane passed independently even though that tournament's
  Moneyline and Spread lanes failed.

The synthesis script must reproduce the historical evidence and export the
immutable calibrator coefficients. It may not reselect a threshold or inspect a
new subgroup. Moneyline and Total may emit Best Angle because their predeclared
stronger subgroups passed both confirmation seasons. Spread may emit Lean but
not Best Angle. Watchlist remains a complete, positive exact-price tuple below
the Lean threshold. No Play remains a complete non-positive tuple. Held remains
reserved for a real identity, price, consensus, PMF, personnel, or lock-health
failure.

The public independent PMF stays separate from the market-calibrated Bet
probability. Forward grading requires a named offered price and target-excluded
same-line consensus. No quota, cap, forced grade, stake, or reader override is
allowed.

## Frozen chronological evidence

- Independent score head: 2021-22 training, 2023 selection, 2024 and 2025
  repeated confirmation. Team-score MAE was 9.501 in 2024 and 9.218 in 2025;
  margin MAE was 13.956 and 13.368; total MAE was 12.830 and 12.640. Moneyline
  Brier was 0.17902 and 0.16905, ECE was 0.03867 and 0.03925, and winner
  accuracy was 72.46% and 74.84%. The head materially beat the frozen simple
  football baseline in each confirmation season.
- Moneyline Lean lane: 36 actions, +11.161 units, +31.00% ROI in 2024; 34
  actions, +12.061 units, +35.47% ROI in 2025. The largest-win-removed and
  weekly-cluster bootstrap gates passed. Its stronger Best Angle subgroup also
  passed both confirmation seasons.
- Spread Lean lane: 36 actions, +9.818 units, +27.27% ROI in 2024; 34 actions,
  +19.455 units, +57.22% ROI in 2025. Largest-win-removed and weekly-cluster
  gates passed. The stronger Best Angle subgroup was rejected, so Spread is
  capped at Lean.
- Total Lean lane: 371 actions, +39.455 units, +10.63% ROI in 2024; 432
  actions, +5.182 units, +1.20% ROI in 2025. Largest-win-removed evidence stayed
  positive in both years. The stronger Best Angle subgroup passed both years.
- Historical CFB prices are a declared limitation: Spread and Total used a
  fixed -110 execution contract and the historical Moneyline price reconstruction
  is synthetic. No historical CLV claim is made. The exact named-book forward
  tuple and immutable 2026 T-60 record are the true production holdout.

## Current opening-week release impact

The 2026 opening-week artifact contains exactly eight provider-identified games
and 24 market slots. Seven games currently have a complete named-book offered
price plus target-excluded same-line consensus; SJSU-USC lacks that coherent
tuple and therefore shows three explicit Held markets while retaining its live
independent outcome forecast.

The latest frozen replay produces 1 Best Angle, 2 Leans, 10 Watchlists, 8 No
Plays, and 3 Held markets. Moneyline is 0/1/2/4 plus 1 Held; Spread is 0/1/4/2
plus 1 Held; Total is 1/0/4/2 plus 1 Held. Relative to the prior no-model CFB
surface this is three actionable promotions and zero demotions. Bet count is an
uncapped output; no minimum or maximum was imposed.

Expected team points span 16.08 to 39.42 with SD 7.26, expected margins span
-7.82 to +23.34 with SD 9.68, and expected totals span 46.58 to 58.08 with SD
3.23. The board forecasts four Overs and four Unders. Decimal expected points
are primary. The separately labeled central reachable representative score is
selected from the same joint PMF and passed winner fidelity, expected
margin/total proximity, duplicate, outlier, and CFB scoring-support checks; the
earlier implausible 0-34/0-33/tie artifact was rejected and cannot ship.

## Production boundary

- Runtime releases: score artifact `cfb_v1_joint_score_artifact_2026_08_25_r2`,
  model `cfb_v1_independent_score_model_2026_08_25_r1`, distribution
  `cfb_v1_empirical_joint_score_distribution_2026_08_25_r1`, representative
  score `cfb_v1_central_reachable_score_2026_08_25_r1`, grade policy
  `cfb_v1_composite_grade_policy_2026_08_25_r1`, and decision
  `cfb_v1_daily_edge_decision_2026_08_25_r4`.
- The single `cfb-forward-evidence` writer holds exactly the shared
  `prediction_pipeline:cfb` lease. It captures first-observed operational
  Opening, unlocked refreshes, and one immutable T-60 tuple per game. T-60
  captures more than 20 minutes late fail closed.
- BALLDONTLIE supplies schedule, named-book prices, active rosters, and prior
  season quarterback passing context. Playbook supplies separately labeled
  public money/ticket consensus. SharpAPI NCAAF splits, timestamped injury
  reports, confirmed depth/starter status, and venue weather are unavailable in
  the current provider contract and are labeled rather than fabricated.
- Every recurring evidence row stores only the compact published forecast;
  the large source PMF remains in the one versioned model artifact. Member
  reads make no provider calls.
- Public tracking starts forward-only on the 2026-08-29 ET slate. Only a
  complete, on-time T-60 exact-price tuple enters `prediction_records`; unlocked
  grades never enter lifetime results.
