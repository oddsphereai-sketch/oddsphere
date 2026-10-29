# College basketball pick repair: Total regression remains unresolved

**Status: private/offline only.** The R2 comparison preview, CBB activation,
production reader, writer, grades, stakes and locked records are unchanged.
The four fixed trials below did not justify a model promotion. The full receipts
and exact quote ledgers are in `/private/tmp/oddsphere-cbb-data/`; the concise
machine-readable result is
[`decision-repair-r13-r16.json`](../../lib/cbb/artifacts/decision-repair-r13-r16.json).
The tests and failure conditions were recorded before fitting in the
[decision plan](2026-10-28-cbb-pick-repair-predeclaration.md) and
[overtime plan](2026-10-29-cbb-overtime-distribution-predeclaration.md).

## What actually got worse

The prior R12 trial gained 14 outright winners across 5,721 historical games
versus R2, and reduced both mean margin and mean Total error. It was not a
three-market improvement at archived bookmaker openings:

| Fixed evaluation set | R2 | R12 | R13 | R14 | R15 | R16 |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| Full 2025 outright winners / 5,721 | 4,112 | **4,126** | 4,126 | 4,126 | 4,115 | 4,126 |
| 353 opening Moneyline wins | **241** | 237 | 237 | 237 | 238 | 237 |
| 353 opening Spread wins | **198** | 195 | 195 | 195 | 192 | 195 |
| 353 opening Total wins | 175 | **186** | 176 | 182 | 184 | 184 |
| Wider 635 opening Total wins | **341** | 333 | 325 | 330 | 324 | 329 |

All counts are wins with no pushes or passes in these selected quote sets.
The 353 and 635 cohorts are *different quote decisions*, even for overlapping
games: only 100/353 use the same sportsbook and forecast cutoff, 230/353 share
the same Total line, and the cutoff can differ by 21 hours. Thus R12's 186
versus 175 in one Total cohort cannot be netted against its 333 versus 341 in
the other. Within each row of the table, every model uses the same quotes and
forecast timestamps. These are opening prices, not closing lines or verified
sharp movement.

On the wider set, R12 raised the Total forecast by 1.80 points on average. It
flipped 158 picks from under to over, eight from over to under, corrected 79
previous losses and spoiled 87 previous wins. The 600 regulation games account
for six of the eight net losses; the 35 overtime games account for two. The
largest *accounting* contributions to harmful changes came from the learned
matchup-mechanism residual and sample-size features. Correlated feature
accounting does not establish that either feature caused those losses.

The full R12 Total residual had an average underprediction, but the quoted
games tell a different decision story: 336/635 settled under, even while the
mean result was 0.69 points above the line. Thirty-five overtime games
averaged 18.79 points above their lines; regulation games had a median result
1.5 points below their lines. A mean score can therefore get closer while the
50% side of a betting line moves the wrong way. This is a diagnosis of the
archived sample, not a rule to bet every under.

## Four fixed repairs and what they taught us

R13 retrained the Total residual over a prior-season-fitted projection instead
of the original monthly expanding projection. The original training forecast
had zero global Total correction, while the later forecasts had fitted
corrections. On identical 2023 games, reconstructing the prior-season forecast
changed the average Total prediction by +0.804 points. This verifies a real
training/serving mismatch. R13 improved the 2024 fixed-threshold probability
score, kept R12's 4,126 outright winners and exact Moneyline/Spread outputs,
but won only 325/635 historical opening Totals. Fixing that mismatch alone did
not repair betting picks.

R14 used a smoothed absolute-error Total objective on the same matched
training setup. It failed the predeclared 2024 choice test and won 330/635
opening Totals. R15 directly fitted outcome probabilities at a fixed grid of
score thresholds for margin and Total. It also failed its 2024 joint choice
test; in the opened quote sample it reduced Spread wins to 192/353 and Total
wins to 324/635. Its slightly better average score error does not make it a
better betting model.

R16 represented the final Total as a pregame overtime mixture, using only
earlier-season games to learn overtime frequency and points added. The mixture
preserves R12's exact expected final score and variance. It improved the 2024
Total grid log score from 0.280746 to 0.280242 and grid decisions by 14 of
119,910. On actual archived lines it fell to 329/635 Totals (17 corrected,
21 harmed versus R12). This rejects the simple overtime-shape explanation as
a sufficient repair. Moneyline and Spread picks stayed exactly R12. Overtime
is never supplied as a current-game input.

The 2024 grid consists of fixed score thresholds, not historical bookmaker
lines. It is useful for checking probability quality but repeatedly failed to
select the best archived opening-line model. A bounded earlier BallDontLie
opening-quote probe returned zero rows for two preselected 2024/2025 dates;
Owls' named CBB archive starts in January 2026, and an alternative historical
Odds API key is not configured. The necessary earlier-season actual-line
selection set is therefore absent from the configured evidence. The opened
2025 quotes cannot be reused as a clean model-selection season.

## Decision and remaining gap

No trial improves the wider Total decisions while preserving the existing
outright winner gain and improving the quoted Moneyline and Spread decisions.
Selecting the best 2025 result after inspecting it would overstate accuracy;
none was promoted. The independent projection and a sharp market reader still
need a qualifying, chronological, actual-line evaluation together. The current
cached openings cannot establish line movement, sharper splits, prices at
decision time, or how a final market-aware grade would perform. This work
does not claim that any market signal was captured or interpreted as a sharp.

The concrete next evidence requirement is historical pregame lines from an
earlier season with source timestamps and exact team orientation, or a
forward-collected chronological quote set after the prelaunch model is frozen.
That allows training and selection on *real decisions* for Moneyline, Spread
and Total and a later untouched check. The private test harness now preserves
the exact quote, cutoff, model release, W/L/push and paired flip for that check.
No additional provider subscription or live collection was created here.
