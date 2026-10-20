# NFL player props Anytime Touchdown independent-model predeclaration

Date: 2026-10-09

## Owner objective

Replace the current market-dependent Anytime Touchdown architecture with a materially stronger
football-only probability model. The independent forecast must be created without a sportsbook
total, spread, touchdown price, consensus probability, opening price, current price, or movement.
Market evidence may be read only after the independent probability exists, for exact-price value,
sharp-reference corroboration, and a separately tested adverse/supportive movement decision.

## Known diagnosis before the frozen tournament

- The released touchdown feature vector includes `team_implied_touchdowns`, derived from a
  bookmaker total and spread.
- The released final probability uses a `0.20` model residual weight, leaving 80% of the final
  logit at the target-excluded market benchmark.
- A prior role-aware candidate improved the complete 2025 holdout but failed the separately frozen
  Week 1 2026 scorer test. Week 1 is therefore already observed evidence and is not pristine.
- The retained first-four-week locked-actionable replay has no Anytime Touchdown rows. The primary
  2026 check for this family will instead use every eligible player-game from Weeks 1-4, matched to
  official play-by-play scoring outcomes. This avoids survivorship from an empty actionable ledger.

No Week 2-4 touchdown outcome, probability metric, or scorer metric will be opened until the
candidate family, chronology, and gates below are frozen in this document.

## Frozen data and chronology

- Market-free feature substrate: checksum-recorded
  `nfl_player_props_external_features_2016_2026_r3.parquet`.
- Official outcomes: checksum-recorded nflverse regular-season play-by-play, including the locally
  cached 2026 Weeks 1-4 file.
- Eligible population: QB/RB/FB/WR/TE rows with at least one prior participation. Historical and
  2026 comparisons use the identical eligibility rule.
- Training: 2016-2022.
- Model-shape selection: 2023 only.
- Calibration and scorer-policy selection: chronological halves of 2024 only.
- Historical holdout: 2025, opened once after selection is frozen.
- Owner-priority confirmation: 2026 Weeks 1-4, opened once after the complete historical candidate
  is frozen. Week 1 is reported separately because it was used in the prior September audit; Weeks
  2-4 are the new forward evidence.

The outcome columns from each scored season are never model inputs. Every player, team, opponent,
depth, environment, role, red-zone, goal-line, and touchdown-rate feature is shifted to evidence
available before that game.

## Frozen candidate family

All candidates exclude `team_implied_touchdowns` and every other market field.

1. `market_free_incumbent_hgb`: the released HGB shape and released non-market features, providing
   the cleanest test of simply removing bookmaker team expectation.
2. `market_free_role_hgb`: a regularized 15-leaf HGB using the same base features plus
   roster-normalized recent rushing share, target share, participation, touchdown rate, red-zone
   opportunity, and goal-line opportunity.
3. `market_free_team_budget_role`: a two-stage hierarchy. A Poisson HGB forecasts team offensive
   touchdowns from shifted team/offense/opponent/pace/efficiency inputs. The selected player model's
   Poisson intensity is normalized within each team and allocated across that football-only team
   touchdown budget; `P(anytime TD) = 1 - exp(-lambda)`.
4. `market_free_direct_hierarchy_50`: a fixed 50/50 probability blend of candidates 2 and 3.

Fixed HGB settings are 220 iterations, learning rate 0.04, 15 leaves, L2 5, and minimum leaf 40
for the role head; and 180 iterations, learning rate 0.04, 15 leaves, L2 8, and minimum leaf 40
for the Poisson team-budget head. The incumbent-shape control retains its released settings.
Only Platt and beta calibration may be selected on the frozen 2024 calibration split. Scorer-count
policy is limited to team rounding, team largest remainder, game rounding, or week rounding at the
predeclared multipliers already used by the September scorer audit; no manual scorer quota is
allowed.

If the entire frozen family fails, one diagnostic redesign round is allowed only after documenting
the failed family by position, opportunity source, team budget, calibration, and week. That repair
must be written as a second predeclaration before its unseen confirmation slice is opened.

## Frozen acceptance gates

A production candidate must satisfy all of the following:

1. **Independent historical accuracy:** on 2025, Brier and log loss are both no worse than the
   market-free incumbent; at least one improves, and expected scorers do not show a larger absolute
   calibration error.
2. **Independent current-season accuracy:** on all 2026 Weeks 1-4, Brier and log loss both improve
   versus the released independent model scored without its final market residual. The candidate
   must improve Brier in at least three of four weeks and in the new Weeks 2-4 aggregate.
3. **Scorer discrimination:** 2025 and 2026 scorer F1 may not regress by more than 0.5 percentage
   point versus the released team-scoped policy, and at least one period must improve. Report
   precision, recall, selected count, true positives, false positives, and missed scorers.
4. **Role safety:** report Brier, log loss, calibration, and scorer discrimination for QB, RB/FB,
   WR, and TE. No position group with at least 100 eligible rows may regress in both Brier and log
   loss in both 2025 and 2026.
5. **Independent authority:** the shippable final probability uses model weight `1.00`; the target-
   excluded market is not blended into the forecast. It remains a downstream benchmark for value
   and sharp-reference evidence. A lower independent weight is research-only and cannot win.
6. **Board safety:** on a captured current production input, every non-touchdown row is byte-stable.
   Report TD coverage, all side/probability/grade changes, promotions, demotions, and actionable
   counts. Every actionable demotion must be paired with and evaluated alongside a promotion rule;
   no hidden board flattening is allowed.
7. **Operational safety:** no new provider loop, writer, schedule, lease, copy, label, layout, stake,
   or alternate-line behavior. Existing locked rows retain their stored payload and release tuple.

These are comparative research gates, not a guarantee of future results. Passing them authorizes a
new release only after focused tests, `npm run verify:model-change`, latest-main integration safety,
a protected pull request, deployment verification, and a naturally refreshed live snapshot.
