# MLB model recovery audit — 2026-07-28

## Scope and release ownership

This audit covers MLB Player Props and the MLB Daily Edge moneyline, full-game
total, and First Inning markets.

- Player Props champion before this work: `mlb_props_2026_07_27_r11`
- Player Props candidate: `mlb_props_2026_07_28_r12`
- Daily Edge decision champion: `mlb_daily_edge_decision_2026_07_27_r13`
- Authoritative writers and the sport-scoped `prediction_pipeline` lease are
  unchanged.
- No historical prediction, lock, result, grade, or tracking row is rewritten.

## Corrections to the prior Player Props claims

The prior Singles claim was not an exact production backtest. The earlier audit
omitted live pitch-mix, history, weather, lineup, movement, and board-discipline
inputs. The exact r11 result on 2026-07-27 was 118 settled actionables, 50-68,
-31.529 units, and -26.7% ROI. Singles Best Angles were 10-14 and -6.941 units.

The previous Home Run research did not test the exact production actionability
contract either. It used a 0.62 model weight and an uncapped selection while the
runtime used a 0.10 weight and a ranked five-play sleeve.

Those prior claims must not be used as evidence for the next release.

## Chronological Player Props evaluation

The reproducible audit is
`scripts/audit-mlb-props-recovery.ts`. It uses immutable opening prices,
official results, and pregame-only prior statistics. Policy selection uses data
through 2026-07-12. The final period, 2026-07-16 through 2026-07-23, is not used
to choose the rule.

### Batter Hits Under

The recovered rule is a threshold-only, uncapped price-consensus rule:

- picked-side consensus probability from 0.40 through 0.60;
- at least 2% expected value at the best available price;
- normal price-integrity and best-offer checks still apply.

It does not use a daily, game, or slate count cap. The exact same qualifier is
imported by the runtime and audit.

| Period | Bets | Record | Units | ROI |
|---|---:|---:|---:|---:|
| Discovery | 28 | 16-12 | +10.137 | +36.2% |
| Calibration | 16 | 10-6 | +7.412 | +46.3% |
| Validation 1 | 6 | 3-3 | +1.010 | +16.8% |
| Validation 2 | 7 | 4-3 | +2.250 | +32.1% |
| Untouched validation | 7 | 3-4 | +0.030 | +0.4% |
| Combined | 64 | 36-28 | +20.840 | +32.6% |

The date-cluster bootstrap ROI interval is -0.3% to +64.1%. This is a positive
candidate, not a guarantee; the interval still touches zero.

The former Hits Under promotion remains available as a Lean retention path.
The new price-consensus cohort is an additive Best Angle path:

- retained prior actionables: 82;
- newly promoted actionables: 63;
- actionable demotions: 0;
- net historical actionable-board change: +63;
- paired union: 145 bets, +31.181 units, +21.5% ROI.

### Singles

The unsupported Singles premium Best Angle override is removed. Singles that
otherwise qualify remain Leans, so this is a grade correction rather than an
actionable-board removal. The underlying probability weight is unchanged
because a weight sweep did not establish a materially better replacement.

No Singles cohort survived all chronological periods as a replacement Best
Angle rule. It would be inaccurate to manufacture one to preserve the label.

### Home Runs

No new Home Run cap is introduced.

The development-selected uncapped threshold candidate produced 277 bets and
+22.3% ROI through 2026-07-12, then failed the untouched period:

- 180 bets;
- 29-151;
- -3.07 units;
- -1.7% ROI;
- volume expanded from about seven to about 26 bets per active day.

Other thresholds looked better only after the untouched results were inspected.
Choosing one now would tune on the holdout, so none is promoted. The existing
production Home Run behavior is unchanged in r12 while an uncapped replacement
remains unvalidated.

### Other prop markets

H+R+RBI, Runs Scored, pitcher props, Total Bases, and the remaining hitter
markets retain their r11 runtime behavior and market versions. Exploratory
demotions were withdrawn because they did not have enough tested replacement
promotions and would have flattened the board.

## Daily Edge release-aware audit

The read-only audit is
`scripts/operator/audit-mlb-daily-edge-release-heads.ts`. It separates the
active probability head, decision release, and public grade. It never blends
legacy heads and calls the blend current.

### Exact current probability heads

| Market | Settled | Record | Units | ROI | Brier |
|---|---:|---:|---:|---:|---:|
| Moneyline | 178 | 104-74 | +6.187 | +3.5% | 0.2417 |
| Full-game total | 176 | 92-84 | -1.312 | -0.7% | 0.2523 |
| First Inning | 111 | 67-44 | +13.065 | +11.8% | 0.2440 |

Grade diagnostics:

- Moneyline Best Angles: 20, 14-6, +4.408 units, +22.0% ROI.
- Moneyline Leans: 12, 5-7, -3.309 units, -27.6% ROI.
- Total Best Angles: 22, 11-11, -0.883 units, -4.0% ROI.
- Total Leans: 25, 13-12, +0.089 units, +0.4% ROI.
- First Inning Best Angles: 15, 8-7, +0.086 units, +0.6% ROI.
- First Inning Leans: 76, 45-31, +9.146 units, +12.0% ROI.

The r13 decision release itself has only one settled day: ten moneylines and
ten totals. Its -29.6% moneyline ROI and -3.8% total ROI are disclosed but are
not treated as a stable estimate.

### Daily Edge decision

A broad chronological rule search selected candidates using training and
validation only, then evaluated the untouched holdout:

- selected Moneyline candidate: -2.6% holdout ROI;
- selected Total candidate: -23.1% holdout ROI;
- selected First Inning candidate: -9.9% holdout ROI.

All three candidates are rejected. Therefore this recovery does not change the
Daily Edge probability heads, sides, totals, First Inning probabilities,
grades, or stakes. In particular:

- the profitable Moneyline Best Angle path is retained;
- the weak Moneyline Lean diagnostic is not used to justify a new whitelist;
- Totals are not loosened merely to create board volume;
- profitable First Inning Leans remain intact;
- First Inning Best Angles are not demoted without a validated replacement.

Keeping the Daily Edge champion unchanged is the evidence-backed correction to
the prior over-editing. New Daily Edge changes require a candidate that passes
the untouched period and reports paired promotion/demotion board impact.

## Current-board dry run

The 2026-07-28 r12 Player Props dry run was read-only (`persist=false`):

- 15 games, 5,746 rows, 17 supported markets, six books;
- zero stale odds rows;
- publishable with no validation errors;
- 149 actionable Leans at the preview timestamp;
- no qualifying recovered Hits Under Best Angle at that timestamp.

The lack of a qualifying Best Angle on one timestamp is not hidden. The release
does not convert a failing row into a Best Angle to fill a quota.

## Verification and deployment status

Completed locally:

- Player Props market ownership test;
- Player Props engine test (348 passing);
- release-aware Player Props audit;
- release-aware Daily Edge audit;
- read-only current-board Player Props preview.

This report does not claim deployment. Before production, the release still
requires `npm run verify:model-change`, focused tests, type checking, a clean
intentional commit, deployment of that commit, and live release/lease/cron/
coverage/reader verification.
