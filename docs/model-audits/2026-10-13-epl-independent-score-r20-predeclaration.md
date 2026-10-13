# EPL independent-score r20 candidate predeclaration

Date: 2026-10-13

Status: predeclared research candidate. This document does not authorize a
production change.

## Scope

- Competition: English Premier League only.
- Candidate layer: independent regulation-time score distribution.
- Downstream markets: Match Result, Double Chance, Total 2.5, and BTTS,
  derived coherently from one joint score distribution.
- Unchanged during candidate selection: sportsbook/provider hierarchy,
  target-excluded market reader, exact-price grading, stakes, member copy,
  layout, writer, sport-scoped lease, cadence, locks, and settlement.
- Existing locked rows remain byte-for-byte authoritative.

The active champion is
`epl_goals_coherent_2026_10_01_r19_draw_arbitration` with grade release
`epl_grade_policy_2026_10_10_v25_exact_match_result_price_tiering` and coherent
market release
`epl_coherent_market_outcome_2026_09_02_r2_structural_target_exclusion`.

## Outcome-blind design

The candidate replaces the venue-only ratio fit with a shared attack/defence
Poisson fit containing an explicit home-rate term, chronological time decay,
regularized club effects, and a bounded recent-process adjustment using only
prior-match shots, shots on target, possession, and available xG. Injury and
lineup rows are not permitted to alter a historical score because equivalent
pregame history is not stored for the evaluation seasons.

Candidate grid, selected only on the 2024 season:

- half-life: 240 or 365 days;
- effective-match shrinkage: 6 or 10;
- xG target weight: 20% or 35% when xG exists;
- prior-match process weight: 15% or 30%; and
- Dixon-Coles low-score correction: -0.10 or -0.15.

The existing r19 draw arbitration is evaluated unchanged. No new market input,
score nudge, flip threshold, or play-grade rule is selected in this stage.

## Chronological partitions

- Foundation/training history: 2022 and 2023.
- Candidate selection: 2024, evaluated by match round with only earlier games
  available to each fit.
- Untouched holdout: 2025, opened once after one configuration is selected.
- Current 2026 locked releases: release-separated forward confirmation only;
  they are not used to select parameters.

## Selection and release gates

Selection minimizes team-score MAE, then Match Result log loss, subject to no
material deterioration in Total or BTTS Brier score on 2024. Production
eligibility additionally requires the untouched 2025 holdout to:

1. improve team-score MAE and at least one of total MAE or margin MAE;
2. improve Match Result Brier or log loss without reducing directional
   accuracy by more than one match;
3. avoid material deterioration in both Total and BTTS proper scores;
4. increase useful cross-game score dispersion without adding random noise;
5. preserve coherent market sides and decimal expected scores;
6. report current-board promotions, demotions, market mix, and exact-price
   actionability before any grade release; and
7. pass the paired-promotion/no-hidden-flattening requirement.

Failure of any release gate keeps the candidate out of production. A failed
candidate remains research evidence and cannot change unlocked or locked
member predictions.
