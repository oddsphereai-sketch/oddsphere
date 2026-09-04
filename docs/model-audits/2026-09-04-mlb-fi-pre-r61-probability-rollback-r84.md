# MLB FI pre-r61 probability rollback — r84

Date: 2026-09-04

## Decision and scope

At the owner's direction, r84 restores the last deployed pre-r61 high-quality
first-inning probability blend from source commit `5f245a0a`: 65% independent
FI run distribution and 35% market context. The medium (45% independent), low
(25%), no-market (100%), severe-missing (5%), 52% NRFI / 48% YRFI boundaries,
and ten-point posterior safety cap are unchanged.

This is deliberately narrower and safer than restoring the old tree. The
current r80/r81 contracts remain authoritative:

- the exact evaluated sportsbook is excluded from forecast consensus when an
  accepted target-excluded complete pair exists;
- a singleton evaluated pair supplies exact price and downstream economics but
  cannot change forecast probability, decimal expected runs, or side;
- the exact offered price, not a no-vig proxy, determines EV and grade;
- Toss-Up remains an explicit null-side, non-actionable prediction;
- locked rows remain byte-immutable and the sole writer, MLB
  `prediction_pipeline` lease, provider paths, and query budgets are unchanged.

No full-game probability head, schema, calibration, decision/rule bundle,
grade policy, Moneyline/Total tuple, or member-tuple contract is restamped.

## Pre-outcome evidence and limitation

The rollback was selected because the owner prefers the previously deployed
model-first behavior after a poor live stretch, not because it won a new
outcome-fitted search. On the already frozen historical comparison, the fixed
65% independent candidate was weaker than the r61 25% independent benchmark:
latest settled directional accuracy 51.1% versus 56.1%, actionable ROI -7.8%
versus -0.4%, and Brier .2462 versus .2438. The 35% and 50% independent
alternatives also failed to establish a superior holdout result. These numbers
are retained here so the rollback is not misrepresented as a statistical win.

That replay also cannot validate the present r84 architecture: historical r46
allowed the evaluated book to participate in its market anchor, whereas r84
keeps the current target-exclusion and singleton-independent safeguards. The
Phase-A named-book capture is forward-only, movement coverage in the historical
cohort was effectively absent, and releases must not be blended. Prediction
proper scores and calibration for r84 therefore begin only with future locked
r84 rows; price-grade ROI is reported separately.

## Required board and production acceptance

Before publication, run the SELECT-only writer-shaped current-board comparator
and report every side, probability, decimal expected-runs, Toss-Up, grade, exact
price, and actionability transition, plus aggregate NRFI/YRFI/Toss-Up, held,
promotion, demotion, and actionable counts. A directional prediction with
negative exact-price EV must remain No Play, and a Toss-Up cannot become an
action through price.

Focused FI model/writer/member/pipeline tests, full model-change verification,
TypeScript, lint, production build, clean diff, fresh-main integration safety,
protected PR checks, and natural postdeploy writer/member/lock/tracking checks
are mandatory. Rollback is r81 probability head v8 / calibration v5; locked
r84 records remain immutable if rollback is later required.

## Frozen current-board comparison

The SELECT-only writer-shaped comparison was frozen on the September 4 slate
before any outcome query. It covered 16 rows and performed no mutation. Exact
evaluated prices and existing null stakes were unchanged on every row. The
candidate board is 12 NRFI, 2 YRFI, and 2 genuine Toss-Ups, with 10 actionable
rows, 2 promotions, 1 demotion, and no held rows.

| Game ID | Matchup | Incumbent side / P(NRFI) / xFI runs / grade | r84 side / P(NRFI) / xFI runs / grade | Exact NRFI price |
| ---: | --- | --- | --- | ---: |
| 61181 | DET@CLE | NRFI / .542552 / .611472 / Lean | NRFI / .598186 / .513853 / Lean | -128 |
| 61182 | MIL@CIN | Toss-Up / .490613 / .712101 / Toss-Up | Toss-Up / .518724 / .656384 / Toss-Up | -115 |
| 61183 | LAA@PIT | Toss-Up / .514557 / .664449 / Toss-Up | NRFI / .536936 / .621877 / Lean | -102 |
| 61184 | ATL@PHI | NRFI / .593638 / .521485 / No Play | NRFI / .596762 / .516237 / No Play | -166 |
| 61188 | SF@NYM | NRFI / .532079 / .630963 / Lean | NRFI / .561354 / .577404 / Lean | -138 |
| 61189 | MIN@CWS | YRFI / .462896 / .770253 / No Play | YRFI / .435524 / .831204 / No Play | +112 |
| 61190 | TB@TEX | NRFI / .532354 / .630447 / Lean | NRFI / .594680 / .519731 / Lean | +100 |
| 61191 | ARI@HOU | Toss-Up / .511569 / .670273 / Toss-Up | NRFI / .561274 / .577547 / Best Angle | +106 |
| 61192 | TOR@KC | NRFI / .520373 / .653210 / Lean | NRFI / .520373 / .653210 / Lean | +114 |
| 61195 | ATH@SEA | NRFI / .538226 / .619476 / Lean | Toss-Up / .497951 / .697254 / Toss-Up | -138 |
| 61196 | WSH@LAD | NRFI / .529326 / .636151 / Lean | NRFI / .564237 / .572281 / Lean | -115 |
| 61185 | BOS@BAL | NRFI / .544818 / .607303 / No Play | NRFI / .574537 / .554191 / No Play | -146 |
| 61186 | CHC@MIA | NRFI / .524973 / .644408 / Lean | NRFI / .559248 / .581163 / Lean | -105 |
| 61187 | DET@CLE | NRFI / .534325 / .626752 / Lean | NRFI / .557069 / .585066 / Lean | -125 |
| 61193 | STL@COL | YRFI / .432526 / .838113 / No Play | YRFI / .428552 / .847344 / No Play | +118 |
| 61194 | NYY@SD | NRFI / .596070 / .517398 / Lean | NRFI / .596070 / .517398 / Lean | -136 |

The two promotions are LAA@PIT to NRFI Lean and ARI@HOU to NRFI Best Angle;
both retain their exact offered prices and have positive offered-price EV. The
demotion is ATH@SEA from NRFI Lean to a true null-side Toss-Up. ATL@PHI and
BOS@BAL remain directional NRFI predictions but No Play because their exact
prices do not qualify; price does not reverse either forecast. TOR@KC and
NYY@SD are byte-identical forecast probabilities because no target-excluded
forecast market was available, proving the singleton/no-alternative identity
path remains intact.
