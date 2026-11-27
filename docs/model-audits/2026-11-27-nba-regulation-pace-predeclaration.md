# C7: duration-corrected pace for the NBA Total head

Declared November27,2026 before fitting or evaluating C7. Fresh production
base813df7eeb301514a2d5d1131100b0c204f3e1ee2 retains propsR66 and Daily Edge
R39/marriageR41/readerR5/gradeR31/original-card lockR11. C1–C6 remain rejected.
This is offline work; no live shadow, provider/model call, refresh, second writer,
schedule, lease, threshold or locked-record change.

## Specific source problem

The current feature builder assigns mean full-game possession count directly
to `pace`, ignoring game duration. An overtime game therefore raises recent
pace even if possessions per minute are unchanged. Twelve of235 retained2026
games throughNov20 have overtime; for example DET–WAS has115.46 possessions
over58 minutes, equivalent to95.553 per48, not115.46. This is a demonstrated
unit distortion, not proof that it explains every forecast loss.

NBA defines pace per48 minutes and regulation/overtime periods as12/5 minutes:
[NBA stats explanation](https://jr.nba.com/basictraditional-stats-vs-advanced-stats/),
[official timing rule](https://official.nba.com/rule-no-5-scoring-and-timing).
Do not use the raw box's wall-clock `duration`, which includes stoppages.

Use explicit original final period facts: game minutes=48+5*(periods-4).
Identity, original bytes/hash, Final status, oriented scores and period count
must agree. Historical feature admission still requires each prior final's
original publication bound; the target's period/outcome never enters its row.
Current retained complete team-minute totals can corroborate a duration only
when both team totals/5 round to the same legal whole-minute game length.
That is explicitly derived evidence, not an invented provider period field.
Ambiguous evidence cannot authorize a new model. No old source row is overwritten.

## Fixed candidate and chronology

Normalize only the pace observation: possessions*48/gameMinutes. Offensive and
defensive ratings retain their existing per100-possession denominator. All
legacy inputs remain available unchanged in the offline dual-view builder;
normalized pace lags, matchup means/differences and league pace delta have new
names/release. No source windows, outcome target, strengths, rotations, venues,
prices or market-reader formulas change.

C7 is declared **Total-only**. Margin/Moneyline/Spread independent projection
uses the exact unchanged baseline. Fit the same75-column earlier-fit recipe
with all thirteen pace columns mapped to the duration-corrected values.
Use original source-supported2021/2022 training games and fixed ridge1000,
training-only medians/missing indicators/scales and an unpenalized intercept.
No grid, restart, feature selection, fitted weighting or C1–C6 combination.
Freeze the complete Total head before opening C7 evaluation results. Source,
coefficient, numerical or chronological failure rejects the entire candidate.

Compare against frozen earlier-fit A2 on all source-supported2023/2024 games
as reopened development, and2025 as already-opened replication, never untouched
holdouts. Require >=0.10 Total-MAE development improvement, positive95%
Eastern Monday-week lower bound (1000 draws/seed20261123), positive Total-MAE
gain in each development season and in replication, and exactly unchanged
Margin predictions. Report team errors, Total bias and the predeclared exposed
subset whose recent five games include overtime, alongside unexposed games.
The all-game gate remains primary; never select a winning subset afterward.

The problem trace also separates raw model, old roster correction and actual
market-reader consequence on original locked contracts by release and actual
lock time. It must not call historical/native recipe comparisons current-model
performance. No future row, target box, current historical revision, later
availability or guessed opposing price may fill a missing pregame source.

Passing the old-source gate only permits the next stage: a deterministic
duration-corrected Total fit on the current artifact's original training corpus,
source-bound comparison against actual R39 numerical inputs and exact current
market/price/grade replay, calibrated probability checks, transparent promotions/
demotions/counts and genuinely new frozen forward forecasts. Total-only means
Moneyline/Spread must remain exact through the entire downstream path, not just
before market reading. A failed grade balance or probability gate stays offline.

No production release until all model/version/registry, sole-writer/lease,
focused/full/type/lint/build, latest-main/no-overlap/protected/exact-tree/Ready
and ordinary writer/source/reader/lock checks pass. Existing locked payloads
remain authoritative and unchanged. No forced Best Angles, blanket flip, live
shadow, purchased proof or extra provider requests. A pace correction does not
by itself claim that the separate Spread accuracy problem is solved.
