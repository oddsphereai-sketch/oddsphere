# NFL player props Passing Attempts hierarchical opportunity predeclaration

Date: 2026-10-15
Status: frozen after residual diagnosis and before tournament execution; research only

## Diagnosis that determines this candidate

The released opportunity model is not missing one universal pressure, pace, or pass-rate
multiplier. On 490 lead-passers in 2025, no inspected shifted pace, neutral pass-rate, pass-over-
expected, scramble, opponent-hit, opponent-sack, experience, or prior-workload feature has an
absolute linear correlation with the residual above `0.08`. Extreme misses are dominated by
full-game workload tails and early exits rather than a stable one-factor matchup error.

The 16 exact offered 2026 rows show the same instability more sharply: the largest miss is an
in-game four-attempt exit, while the other tail contains 51-52-attempt games. A global fixed blend
cannot solve both. The next candidate therefore pools stable team/QB tendencies toward a common
state model according to the amount of prior evidence, instead of applying another uniform
correction.

## Frozen architecture

The candidate has two levels and no sportsbook input:

1. A common team-attempt model is trained on prior seasons with the existing shifted neutral-script
   pace/pass-rate, pass-over-expected, pressure/sack, opponent, weather/roof, and team context.
2. The common team estimate is partially pooled with the offense's last-eight credited-attempt
   mean. A separately pooled defense-allowed last-eight mean may supply 0% or 25% of the final team
   budget.
3. A common lead-QB share model uses shifted QB workload, scramble/archetype, depth, availability,
   and the same matchup context. It is partially pooled with that quarterback's last-eight share.
4. Final attempts equal the pooled team budget times the pooled QB share. No blend with the
   incumbent is permitted.

Prior means are strictly shifted by game. Effective sample counts are capped at eight. The finite
grid is team pseudo-count `{4, 8, 16}` × QB-share pseudo-count `{2, 4, 8}` × opponent weight
`{0, 0.25}`: 18 identities. The pseudo-count is interpretable shrinkage strength, not an authority
weight on a sportsbook forecast.

The offer may identify the named pregame player as the expected participant, but its line, price,
side, book, movement, and outcome are prohibited. The earlier explicit no/partial/full survival
mixture remains rejected and is not silently folded into this candidate; unpredictable in-game
injuries are reported as irreducible tail risk.

## Gates

Select once on 2024 MAE+RMSE among identities improving both metrics. Refit through 2024 and require
the frozen identity to improve both 2025 metrics, have a negative game-clustered median MAE delta,
and not worsen more than one of four fixed chronological segments. Only then open the exact 2026
offered replay through Week 5.

Current qualification requires lower MAE and RMSE, non-worse offered-line direction, and no
mathematical replacement or reinterpretation of any stored locked field. Passing opens a separate
portable-parity/current-board replay; it does not authorize production. Failure retains the
incumbent with zero board impact.
