# NFL Daily Edge Moneyline and generalized Total coherence result

Date: 2026-09-20

## Decision

Advance the paired NFL Daily Edge release. The Moneyline half restores the already validated r6
exact-price tuple only when it selects the same team as the holistic outcome forecast. The Total
half removes the pooled-distribution artifact that supplied about 47.8% Over probability before
game-specific evidence by centering the discrete PMF on fresh target-excluded, same-line two-sided
no-vig pricing. Neither half imposes a side or grade quota. Missing exact-line consensus preserves
the preceding coherent forecast.

The single `prediction_pipeline:nfl` lease and writer remain authoritative. Provider request
budgets, schedules, stakes, UI copy, labels, and Player Props behavior are unchanged. Old locked
records remain immutable and performance is separated by release and lock timestamp.

## Historical confirmation

The Total audit used the checksum-verified nflverse regular-season games file
`6497107071c1821bd24ec3b240ed88bdb83d666eb3b4536f29e16507eb232c48` (2,638 eligible games).
The rule had no fitted threshold. On the untouched 2024-2025 confirmation seasons, the incumbent
produced 541/541 Under directions, 46.9501% directional accuracy, 0.251835 Brier, 0.052493 absolute
calibration gap, and 10.0616 points MAE. The priced-neutral candidate produced 356 Over and 185
Under directions, 53.6044% accuracy, 0.250094 Brier, 0.029959 calibration gap, and 10.0298 MAE.
By season, accuracy was 56.5056% in 2024 and 50.7353% in 2025. It therefore clears every
predeclared confirmation gate. The weaker 2022-2023 selection diagnostic is retained in the audit
output and was not hidden or used to retune the rule.

The Moneyline half reuses the frozen direction-coherent r6 confirmation evidence: 54-18 and
+16.080 units in 2024; 67-37 and +2.295 units in 2025; 121-55 and +18.375 units pooled. As a
post-selection forward diagnostic only, its 11 aligned Week 1 actions settled 7-4. Two Week 1 r6
signals that opposed the published forecast winner remain rejected.

## Current-board replay

The read-only 16-game Week 2 replay preserved all 48 market decisions and all 16 primary forecast
triples. Twelve games had stable exact-line target-excluded Total consensus; four used the coherent
fallback. Total direction changed from 15 Under / 1 Over to 13 Under / 3 Over. The paired release
made six tier promotions and five tier demotions, with five new Moneyline actions and one new Total
action. Actionable count increased from five to seven. The final market mix is:

- Moneyline: 1 Best Angle, 4 Leans, 11 No Plays.
- Spread: 1 Lean, 7 Watchlists, 8 No Plays; actionable Spread behavior is unchanged.
- Total: 1 Best Angle, 15 No Plays.

The Total-only correction correctly removes four unsupported incumbent Under actions while adding
PIT@NE Over as a Best Angle. This reduction is not a hidden flat-board mechanism: the paired,
predeclared release adds more qualified actions than it removes, and the demoted Total probabilities
are only 50.24% to 52.03%, below the existing value gates. No promoted
Moneyline opposes the forecast winner. All Moneyline promotions retain the exact r6 probability,
target-excluded fair probability, quote, EV, edge, model release, and calibration release; the
existing Best Angle thresholds are unchanged.

## Releases and rollback

The active family is model/calibration r14, decision/grade r20, member r17, weekly outcome and
distribution/probability r4, market-evidence outcome r5, Total head r5, target-exclusion resolver
r3, collector r8, writer r31, fixture r23, compact snapshot r15, tracking lifecycle r11, composite
bundle r7, tuple boundary r8, and official tracking record r8. The evidence schema remains r6
because its data contract did not change; the collector and every behavior-bearing/published
artifact were versioned.

Rollback the complete paired family to the September 16 injury-pagination family if production
shows a mixed release, fewer than 16 games or 48 prediction markets, a winner/action conflict,
an incoherent price/probability tuple, a writer or lease failure, stale current snapshot, or an
unexpected actionable collapse. Preserve all release-stamped rows and locked records during any
rollback.
