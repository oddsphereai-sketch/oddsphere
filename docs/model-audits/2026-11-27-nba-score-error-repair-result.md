# NBA score-error investigation and duration-corrected replacement

November 27, 2026. Starting production base
`813df7eeb301514a2d5d1131100b0c204f3e1ee2`; dedicated worktree/branch
`codex/nba-score-error-repair-20261127`. The owner asked for a substantive
Total/Spread accuracy repair and deployment only if supported, without forcing
plays. This implements a specific feature correction and tests two frozen
Total replacements. **Neither qualifies for activation.** No numerical, grade,
stake, writer, provider, reader, tracking or historical change is live.

Production remains Daily Edge R39, marriage R41, grade R31, reader R5 and exact
saved-card locks R11. Props R66 is preserved. C1–C6 remain inactive, and this
work does not relabel opened evaluation years as untouched evidence.

## A concrete input defect, with a bounded correction

The legacy feature builder uses full-game estimated possessions as its pace
observation. Extra overtime possessions therefore increase pace as though the
team played faster. Per-100-possession offensive/defensive efficiencies use
the appropriate possession denominator already; dividing those by game
duration would introduce another error. NBA pace is possessions per 48 minutes
([NBA explanation](https://jr.nba.com/basictraditional-stats-vs-advanced-stats/));
regulation is four twelve-minute periods and overtime is five minutes
([NBA timing rule](https://official.nba.com/rule-no-5-scoring-and-timing/)).

For example, the retained November 13 DET–WAS source has 115.46 estimated
possessions in 58 game minutes: 95.5531 per 48, versus the legacy 115.46 input.
Twelve of the original 235 completed-current-season inputs through November 20
had overtime. This proves a pace distortion, not that it explains every loss.

`buildNbaRegulationPaceFeatures` now provides a separately versioned offline
view with thirteen normalized pace substitutions. It requires explicit legal
game durations; historical native final-period facts provide 48+5*(period−4).
Original source publication clocks govern admission. It cannot use target-game
duration, a future final, wall-clock elapsed duration or a later retrieval as
an earlier fact. Every legacy R13 feature remains exact, and the production
writer still selects the original view. Neither current model coefficients nor
current locked records are reinterpreted under different units.

Historical bootstrap player-minute sums are unsuitable as an exact overtime
clock: some regulation totals are truncated below 240 minutes. Exact original
start/team/final-score matching corroborates 6,136 of 6,152 bootstrap games;
14 lack that exact clock match and two have final-score discrepancies. These
are refusals/diagnostics, not authorization to correct originals. Eleven old
bootstrap team-box rows also fail box-point/final-score arithmetic. All 270
captured current-season inputs pass that arithmetic. The old defects are not
established as the main cause of recent prediction errors.

## Frozen experiments, unchanged qualification bar

Both candidates use the same 6,142 verified original native rows and fixed
ridge 1000. No parameter search, restart, grade change, candidate Margin fit,
source substitution or outcome-selected subset. C7's declaration preceded
fitting; its frozen head was committed in `8b69745c9`. C8 was separately
declared after C7 failed; all three annual heads were committed in `ebc418fc2`
before C8 replay. C8's first annual head reproduces frozen A2 and C7 to within
2.77e−12. These compare historical native recipes, **not the live incumbent**.

| Candidate | Reopened 2023/24 Total MAE, old → new | Gain | 95% week-block gain CI | Opened 2025 Total MAE, old → new |
| --- | --- | --- | --- | --- |
| C7, fixed 2021/22 training |14.872707 →14.805042|0.067665|[0.015952, 0.125673]|15.178929 →15.081405|
| C8, annual prior-season training |14.848643 →14.762492|0.086151|[0.033014, 0.145997]|15.236303 →15.140533|

Both improve Total MAE in each of 2023, 2024 and 2025, with exactly unchanged
Margin. Neither reaches its predeclared 0.10-point all-game development gain.
Both development gates are false; replication gates are true; advancement and
production-promotion eligibility are false. Larger gains on games recently
exposed to overtime are reported without promoting a selected subset. Overall
bias does not uniformly improve, another reason not to call this a complete
accuracy solution. The original C7 gate is not lowered after seeing C8.

Frozen heads:

- C7 `2545346abf4c2a0e913e3b15afcaa015db41e6834ccbcb4f0ba3c85cac64a9e0`.
- C8 `525829ca19e382c5926411a1254678496cada71f3f6c85d6b65339988894e3fb`.
- Shared source input SHA `93e1be3304001f63cf272209968f49b428360fc2f8c48f3f59e30fa0f3012fd8`.

## Separate the independent model, roster residual and market consequence

The read-only diagnostic joins 112 previously retained original forecasts and
35 additional original Total snapshots, preserving the actual release and
lock clocks. Scores are decomposed into raw portable, roster-adjusted
independent, and published final stages. These are point diagnostics; alternate
directions at the original line are **unpriced**, not new bets, corrected public
records, ROI or newly graded candidate plays.

| Original release / games | Total MAE, raw → roster → final | Spread direction, raw → roster → final | Total point direction, raw → roster → final |
| --- | --- | --- | --- |
| R36 /103, Nov 6–19 |14.0621 →13.8009 →13.6588|52–51 →52–51 →47–56|52–50–1 →56–46–1 →52–50–1|
| R38 /30, Nov 20–23 |19.9325 →19.7790 →19.6420|17–13 →17–13 →17–13|12–18 →11–19 →10–20|
| R39 /14, Nov 23–25 |15.5865 →16.0620 →15.7261|8–6 →8–6 →6–8|8–5–1 →6–7–1 →6–7–1|

R39 raw Total bias is +8.3849 points and final bias +8.2067. Thus the recent
overprediction largely exists **before** market reading; a blanket market flip
does not repair the independent model. The old roster residual changes two
recent raw Total wins into losses. Market Margin adjustments change seven
R39 games: three reduce error and four increase it, increasing average absolute
Margin error by 1.2703 points among those seven. That is a specific Spread
failure stage worth further modeling, not proof that all movement should be
removed. R38 market Margin adjustment improves error; R36 roster improves Total
direction. The small R39 cohort cannot justify selecting only its losing rules.

The diagnostic's first private revision mishandled the opposite Spread side's
handicap when a stage changed sides. R4 fixes that orientation; R1 and the
failed R3 run remain preserved. Score MAE and official records are unaffected.
The table above uses R4 only. Old R36/R38 published point-direction versus
stored-pick discrepancies remain explicit and are not reconstructed or fixed.

## Today's availability and remaining work

At 14:39:20.766 UTC (09:39 ET), the ordinary current reader contains 11 games,
33 market records, 33 prices and 33 complete line scopes, all on R39. The R5
snapshot was generated at 14:31:26.905 UTC. First tip is November 28 00:00 UTC
(November 27 19:00 ET), with earliest T−60 at 18:00 ET. This is a timestamped
health observation, not a promise that every later provider update will succeed.
Recent refresh jobs report partial coverage for 15 scopes on five rolling
future games; that warning must not be described as an entirely clean job.

No candidate promotion, demotion, forced Best Angle or board contraction is
published. The factual pace correction is retained for the next independently
declared model, alongside the evidence that the old roster residual and Margin
market consequence need separate attention. A deployable replacement still
needs qualification against source-bound current inputs, genuinely new frozen
forward evidence, probability calibration, exact target-excluded market/price
and grade replay, promotion/demotion counts and the normal release checks.
The failed C7/C8 heads cannot skip those stages or supply a current-model
accuracy claim. No production shadow or extra paid/provider test is allowed.

Private originals, frozen heads, source receipts, all experiment results,
diagnostics and failed logs are archived append-only under
`ops-local/learning-lab/nba-score-error-repair-20261127`. Public summaries
contain aggregate metrics only; no original source or locked record is changed.

## Mechanical validation

Pass: six independent Python ridge/admission tests; C7/C8 scorer and head
integrity controls; duration/legacy feature and no-leakage controls; professional
runtime artifact/candidate coherence; locked-member reader, prediction-record
lock authority and T−60 lifecycle; full TypeScript; scoped ESLint; and the
complete `npm run verify:model-change` suite. Source-arithmetic census
reproduction is byte-identical. Optional local Market Brain PostgreSQL proof
is explicitly skipped because `MARKET_BRAIN_POSTGRES_URL` is unset. Mechanical
passes do not override either accuracy failure. No production build, merge,
deployment or live predictive-success proof is asserted.
