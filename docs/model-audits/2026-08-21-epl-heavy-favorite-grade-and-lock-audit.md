# EPL heavy-favorite grade and T-60 lock audit — 2026-08-21

## Decision

The `epl_goals_coherent_2026_08_20_r16` forecast remains unchanged. The
`epl_grade_policy_2026_08_20_v21` heavy-favorite exception is not promoted or
changed in this candidate. Chronological evidence supports separating a likely
winner from an actionable bet, but the available historical prices are exact
average pre-closing quotes rather than production same-book T-60 captures. A
public grade change therefore remains shadow-only pending chronologically
locked evidence.

The production T-60 implementation did have a separate, deterministic defect.
The targeted lock query assumed provider fixture IDs were below one million and
therefore searched synthetic IDs only in `[20,000,000, 21,000,000)`. The live
Arsenal fixture was `23,818,188`, so the scheduled lock route could never select
it. This candidate removes the arbitrary provider-ID ceiling, scopes discovery
through unlocked current-release EPL records, and repairs a due member snapshot
when the slower writer locked database rows first.

## Exact live case

At 1:37 PM EDT for Coventry at Arsenal (3:00 PM EDT):

- Arsenal model probability: 71.825%
- de-vigged market probability: 79.563%
- selected same-book quote: Circa -500
- model/market gap: -7.738 percentage points
- exact-price model EV: -13.81%
- same-book movement: Circa -600 opening, -530 prior, -500 current; this is
  adverse movement for Arsenal
- grade: Lean only because the special `>=70%`, `<=-300` heavy-favorite branch
  calls parlay/coverage context actionable

Manchester United at Hull was materially different. The model was 46.1%, the
market 70.4%, and Pinnacle -272. Movement supported United, but the 24.3-point
model/market disagreement correctly activated the existing calibration hold.
Supportive movement cannot rescue a price whose probability disagreement and
model EV are that severe.

The economic interpretation is therefore:

- Arsenal is the model's likely winner, but -500 is not an actionable model bet.
- Manchester United is the market's likely winner, but the current model is too
  far from the market to publish it as an actionable model bet.
- Same-book movement is corroborating evidence. It must not be counted as a
  second independent signal when market prices already inform a probability.

## Required two-axis product contract

The reader should expose two independent concepts:

1. **Outcome confidence / likely winner** — the model's most likely regulation
   result and its probability. This is prediction context and is not an
   actionable wager label.
2. **Exact-price bet grade** — No Play, Watchlist, Lean, or Best Angle at the
   displayed side, sportsbook, and price. Lean and Best Angle require
   chronological exact-price support.

For Arsenal, axis one remains `ARS · 71.8% likely winner`; axis two is not an
actionable bet at Circa -500. The product may describe high-probability outcomes
as context for users considering singles or coverage, but must not call them a
parlay recommendation: parlays remain price-sensitive and compound sportsbook
hold. Shared reader and type changes are intentionally left to repository
consolidation because active cross-sport work currently owns those files.

## Chronological exact-price replay

Protocol: 2022-23 and 2023-24 are prior history; 2024-25 is validation; 2025-26
is untouched holdout. Returns use the exact selected-side Football-Data
`AvgH/AvgD/AvgA` decimal quote for each match. Those are average pre-closing
prices, not reconstructed T-60 book quotes.

### Probability baseline

| Partition | N | Model accuracy | Market accuracy | Model Brier | Market Brier | Model log loss | Market log loss |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| 2024-25 validation | 272 | 51.10% | 53.68% | 0.5949 | 0.5825 | 0.9948 | 0.9760 |
| 2025-26 holdout | 342 | 50.29% | 51.17% | 0.6082 | 0.5995 | 1.0149 | 1.0001 |

The market baseline is better in both partitions on accuracy, Brier score, and
log loss. This is evidence for careful market interpretation, not permission to
silently substitute the market favorite for the model forecast.

### Current heavy-favorite Lean cohort

| Partition | N | Record | Accuracy | Mean model P | Calibration gap | Units | ROI | Mean price | Mean model EV |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| Validation | 17 | 12-5 | 70.59% | 75.55% | -4.97 pp | -2.36 | -13.88% | -493 | -7.64% |
| Holdout | 19 | 15-4 | 78.95% | 71.36% | +7.59 pp | -0.81 | -4.26% | -510 | -13.12% |

Combined, the cohort went 27-9 (75.0%) but lost 3.17 units over 36 bets
(-8.81% ROI). It is useful likely-winner context and a losing standalone betting
cohort. A shared public `Lean` label conflates those two facts.

Price bands are too small for a new rule. In the holdout, -300 to -399 was 4-2
and -14.0% ROI; -400 to -599 was 8-2 and -3.1% ROI; -600 or shorter was 3-0 and
+11.3% ROI on only three matches.

## Candidate board impact (shadow only)

The evaluated semantic candidate removes the heavy-favorite exception from
actionable Match Result grades and exposes the forecast on the separate
non-actionable Outcome-confidence axis. It does not change the forecast side or
probability.

The paired promotion search was selected only on validation and evaluated once
on the untouched holdout. Its rule was model probability at least 35%, de-vigged
edge at least 2 points, and non-negative exact-price EV among currently
non-actionable Match Result rows.

| Partition | Promotions | Demotions | Net actionable | Promoted record / ROI | Candidate total record / ROI |
| --- | ---: | ---: | ---: | ---: | ---: |
| Validation | 21 | 17 | +4 | 10-11 / +18.57% | 87-81 / -3.74% |
| Holdout | 24 | 19 | +5 | 11-13 / +20.00% | 98-83 / +4.52% |

This paired path passes the scripted holdout gates, but it is only 24 holdout
matches, was chosen from a small rule grid, and lacks production T-60 price
history. Activating it now would overstate the evidence. On the current live
Gameweek 1 board, separating Arsenal would demote one of two Match Result Leans,
changing the Match Result mix from 2 Lean / 4 No Play / 2 Best Angle / 2
Watchlist to 1 Lean / 5 No Play / 2 Best Angle / 2 Watchlist before any paired
promotion. No Total, BTTS, or Double Chance grade changes are proposed here.

## T-60 production proof

- Kickoff: 3:00 PM EDT
- scheduled lock: 2:00 PM EDT
- targeted schedule: every five minutes
- 2:00:01 targeted run: success, zero records updated
- 2:05:01 targeted run: success, zero records updated
- 2:06:26 check: member snapshot open; all four r16/v21 records unlocked
- 2:07:24 daily refresh started
- 2:07:35 database rows locked by the daily refresh at the then-current prices
- 2:07:39 daily refresh completed; member snapshot remained `locking` rather
  than immutable `locked`

The locked Match Result row contains Arsenal -500, model 71.825%, market
79.563%, -7.738-point gap, -13.81% EV, and Lean. The delayed daily writer
rescued database eligibility but did not prove the dedicated lock route or the
public immutable-snapshot transition.

The repair is release-neutral because it changes no probability, projection,
selection, grade, threshold, stake, provider quote, or market interpretation.
It restores the already documented T-60 persistence contract. After merge, the
next due fixture must prove: a nonzero targeted-lock run, `locked_at` at the
natural boundary, a member snapshot with `lockState=locked`, the same locked
price/grade in both stores, and no later ordinary-refresh mutation.

## Reproduction and validation

- `npx tsx --env-file=.env.local scripts/operator/audit-epl-heavy-favorite-grading.ts`
- `npx tsx --env-file=.env.local scripts/operator/audit-epl-arsenal-lock.ts`
- `npx tsx scripts/test-epl-shadow-model.ts`
- focused ESLint and `npx tsc --noEmit`
