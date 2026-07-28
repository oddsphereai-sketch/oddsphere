# MLB model recovery audit — 2026-07-28

## Scope and release ownership

This recovery now covers MLB Player Props only. Daily Edge is deliberately
frozen for a separate clean audit.

- Player Props champion before this work: `mlb_props_2026_07_27_r11`
- Player Props candidate: `mlb_props_2026_07_28_r13`
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
runtime used a 0.10 weight and a ranked five-play sleeve. The old ranked sleeve
was genuinely profitable in aggregate, but that did not validate betting every
uncapped candidate. This distinction is reconciled below.

## Chronological Player Props evaluation

The reproducible audit is
`scripts/audit-mlb-props-recovery.ts`. It uses immutable opening prices,
official results, and pregame-only prior statistics. Policy selection uses data
through 2026-07-12. The final period, 2026-07-16 through 2026-07-23, is not used
to choose the rule.

The separate reproducible direction audit is
`scripts/audit-mlb-props-two-sided.mjs`. It searches Over and Under
independently for every two-way market and selects each direction using only
discovery and calibration data.

### Over-versus-Under result

The search is not restricted to Unders. Batter Hits Under was the only
two-way cohort with both adequate development sample and positive performance
in all three later periods.

It also found a Hits+Runs+RBIs Over candidate that was positive in every period,
but its three validation samples contained only 3, 3, and 2 bets. Eight later
bets are not enough evidence to alter the live board, so it remains a documented
Over candidate rather than a promotion. Total Bases Over failed Validation 2;
Singles Under failed Validation 2 and the untouched period; no other direction
passed the selection minimums.

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

The old five-ranked-play sleeve really did show an aggregate profit: 240 bets,
44 wins, +29.55 units, and +12.3% ROI. It was not stable in every period,
however: Validation 1 was -11.9% and Validation 2 was -25.2%. More importantly,
the same eligibility rule without ranking was 2,145 bets and negative in every
period. The honest conclusion is that ranking carried the historical result;
it was never evidence that every broadly eligible Home Run candidate was good.

The replacement is a relative-quality Lean path selected without looking at the
untouched period. It applies pregame projection, recent-survival, market-price,
expected-value, and price-integrity eligibility, then takes the highest 15% of
eligible expected values on that slate, including threshold ties.

This is not a fixed play count. Historical daily counts ranged from 1 to 15,
averaging 7.6 on active dates. A larger qualified slate produces more Leans and
a smaller slate produces fewer. There is no minimum, maximum, or forced quota.

| Period | Bets | Record | Units | ROI |
|---|---:|---:|---:|---:|
| Discovery | 122 | 27-95 | +44.45 | +36.4% |
| Calibration | 77 | 15-62 | +17.35 | +22.5% |
| Validation 1 | 52 | 11-41 | +13.25 | +25.5% |
| Validation 2 | 43 | 8-35 | +9.35 | +21.7% |
| Untouched validation | 70 | 12-58 | +4.15 | +5.9% |
| Combined | 364 | 73-291 | +88.55 | +24.3% |

Nearby quality fractions of 12%, 15%, and 18% were positive in every
chronological period. The date-cluster bootstrap 95% ROI interval is -1.2% to
+51.5%, with 96.9% of resamples positive. The interval crosses zero, so the
proper claim is a historically supported Lean strategy, not guaranteed profit.
Across the combined cohort, mean predicted probability was 19.1% versus a
20.1% observed rate (calibration gap -1.0 percentage point), with 0.161 Brier
score and 0.504 log loss. The untouched period's calibration gap was +3.5
percentage points.

Against the former five-play sleeve, the recovered policy retained 191 actions,
promoted 173, demoted 49, and added a net 124 historical actions. Every Home Run
Lean generated by this reason code belongs to this exact cohort, so “bet every
Home Run Lean” is now a coherent historical strategy rather than a request to
bet every raw model candidate.

### Other prop markets

H+R+RBI, Runs Scored, pitcher props, Total Bases, and the remaining hitter
markets retain their r11 runtime behavior and market versions. Exploratory
demotions were withdrawn because they did not have enough tested replacement
promotions and would have flattened the board.

## Daily Edge boundary

No moneyline, full-game total, First Inning probability, side, grade, flip,
promotion, demotion, or stake is changed by this Player Props recovery. Daily
Edge will receive its own fresh release-aware audit next.

## Current-board dry run

The 2026-07-28 r13 Player Props dry run was read-only (`persist=false`):

- 15 games, 5,739 research rows, 17 supported markets, six books;
- zero stale odds rows;
- publishable with no validation errors;
- 145 actionable Leans at the preview timestamp;
- one naturally qualifying Home Run Lean at that timestamp;
- no qualifying recovered Hits Under Best Angle at that timestamp.

The one Home Run Lean is not the result of a cap. Only one row cleared both
eligibility and the relative-quality boundary at that timestamp. The release
does not force extra rows to fill a quota.

## Verification and deployment status

Completed locally:

- Player Props market ownership test;
- Player Props engine test (350 passing);
- release-aware Player Props audit;
- independent Over-versus-Under audit;
- read-only current-board Player Props preview.

This report does not claim deployment. Before production, the release still
requires `npm run verify:model-change`, focused tests, type checking, a clean
intentional commit, deployment of that commit, and live release/lease/cron/
coverage/reader verification.
