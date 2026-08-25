# NFL Daily Edge completion r5

## Decision

Prepare a production release candidate that preserves the qualified r10 football forecast,
the coherent r6+r10 Moneyline Lean lane, and the frozen r4 Spread/Total Watchlist policy.
Make the one-decimal PMF expected team points the primary projected score everywhere and
keep the reachable integer result as secondary context. Normalize NFL filter chips to the
same game-count semantics used by the other Daily Edge sports.

No Spread/Total Lean or Best Angle is promoted. The full frozen tournament did not produce
a rule that survived the 2024 and 2025 confirmation seasons, so manufacturing one would
misrepresent the evidence. Bet count remains an output; no quota, forced minimum, grade
override, stake, or tracking change is introduced.

Release identifiers:

- member: `nfl_v1_member_release_2026_08_24_r5_expected_points_primary`;
- decision/grade: `nfl_v1_daily_edge_decision_2026_08_24_r4_spread_total_watchlist` /
  `nfl_v1_grade_policy_2026_08_24_r4_spread_total_watchlist` (unchanged);
- model/calibration: `nfl_v1_daily_edge_model_2026_08_23_r2` /
  `nfl_v1_daily_edge_calibration_2026_08_23_r2` (unchanged);
- writer: `nfl_forward_evidence_writer_2026_08_24_r6_expected_points_primary`;
- fixture: `nfl_week_one_member_fixture_2026_08_24_r6_expected_points_primary`.

## One-distribution forecast contract

The stored r10 artifact remains the only Week 1 forecast authority. Its discrete joint score
PMF supplies the margin and total marginals. Runtime validation reconstructs expected away
and home points from those marginal means and independently reconstructs away win, home win,
and tie probability from the margin distribution. Focused tests additionally reconstruct the
exact-line Spread and Total cover/Over/Under/push probabilities from those same distributions
and verify the reachable representative result is supported by both marginals.

The reader and board therefore display the PMF means as `Expected score` to one decimal. The
integer outcome is labeled `Representative final`; it is a reachable football score and useful
scenario context, but is no longer presented as the primary point estimate.

## Frozen exact-price tournament

Every family used 2023 for rule selection and 2024–25 for confirmation, reduced duplicate
book offers to the best exact offered tuple, excluded the target book from same-line consensus,
and retained price, health, key-number/total-zone, movement/coherence, CLV, largest-win, and
weekly-cluster checks. The model probability always came from the r10 distribution.

| Frozen family | Spread result | Total result |
| --- | --- | --- |
| pragmatic r2 | zero selection-eligible rules | zero selection-eligible rules |
| residual blend r3 | zero selection-eligible rules | zero selection-eligible rules |
| context calibrator r4 | no selected rule | selected in 2023, then 70 confirmation actions with material miscalibration and only 1.945% weekly-bootstrap probability of positive units |
| price dislocation r5 | zero selection-eligible rules | zero selection-eligible rules |
| high conviction r6 | 44 confirmation actions, -7.201u, -16.37% ROI | 149 actions, -15.887u, -10.66% ROI |
| market-informed r7 | 57 actions, -6.371u, -11.18% ROI | 57 actions, -0.066u, with +3.611u in 2024 and -3.678u in 2025 |
| topology r8 | 121 actions, -11.700u | 79 actions, -15.227u |
| Total provisional v1 | not applicable | 243 frozen rules; zero selection-eligible rules |

No subgroup passed the frozen Best Angle contract. The Total r6 high-conviction subgroup did
finish positive in both confirmation seasons, but contained only eight actions, lost its edge
when the largest winner was removed in each season, and had negative mean CLV; it therefore
failed the predeclared minimum-count, largest-win-independence, and CLV gates.

The evidence-backed r4 Watchlist remains non-actionable. Its fixed Spread cohort was 86 rows,
-9.668u and -11.24% ROI. Its Total cohort was 72 rows, +3.306u and +4.59% ROI, but the weekly
bootstrap interval crossed zero. These cohorts justify monitoring versus No Play, not staking.

## Current authoritative Week 1 impact

A SELECT-only replay of 80 stored rows used the latest exact tuple for all 16 games, captured
through `2026-08-24T17:06:33.302Z`:

- Moneyline: 7 Lean / 3 Watchlist / 6 No Play;
- Spread: 3 Watchlist / 12 No Play / 1 Held;
- Total: 2 Watchlist / 14 No Play;
- all 48 markets: 7 Lean / 8 Watchlist / 32 No Play / 1 Held / 0 Best Angle.

The Spread Watchlists are MIA +3.5 FanDuel -104, ARI +10.5 BetMGM -110, and DEN +2.5
Fanatics +100. The Total Watchlists are CLE Over 40.5 BetRivers -107 and DEN Under 43.5
Caesars -107. The lone Hold is a genuine same-line comparison-inventory failure, not an
ordinary model disagreement. This release changes zero actionable grades and zero stakes.

## Boundaries and rollback

The scheduled NFL forward-evidence job remains the sole writer under the existing
`prediction_pipeline:nfl` lease. It makes no new provider calls for this change and stores the
same coherent exact-price tuple. Member reads remain read-only. Tracking stays disabled; no
prediction record, settlement, lifetime result, or stake is written.

Rollback is the prior r4 member presentation. Immutable evidence and the r10 artifact remain
preserved. A rollback must not restore preseason or replace an incomplete Week 1 tuple with a
fabricated recommendation.
