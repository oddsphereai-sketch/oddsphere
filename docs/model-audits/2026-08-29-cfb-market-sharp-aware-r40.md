# CFB market- and sharp-aware projection/grade r40 result

Date: 2026-08-29

Status: coherent shadow candidate; not authorized for production prediction or grade changes

## Outcome

The predeclared candidate is implemented as one coherent joint distribution. It is not a
display overlay. Current canonical market state and strictly matched Circa evidence can move
expected team scores, game total, winner probability, same-line Moneyline/Spread/Total
probabilities, predicted direction, exact-price EV, and Bet grade. Same-book movement and
strict signed Circa evidence additionally form a balanced promotion/demotion overlay.

The candidate keeps the football-only PMF as a measurable baseline, builds a sharp-adjusted
generic market-residual PMF, and mixes 75% independent mass with 25% market/sharp mass. All
published-candidate values are recomputed from the resulting PMF. No alternate probability or
score is relabeled as the candidate prediction.

The candidate remains shadow-only. The current slate proves coherence and impact, not accuracy.
There is no chronological CFB source-specific split history available in the frozen research
inputs with which to validate the sharp probability and grade adjustments. Promoting those
changes live would violate `docs/model-change-safety.md`.

## SELECT-only current replay

The replay read immutable production evidence only. It made zero provider calls and zero writes.
The selected 2026-08-29 ET FBS board contained eight games and 22 current exact-price tuples;
SJSU-USC Moneyline and the latest NMSU-FSU Total state were unavailable at that capture.

- Base grades: 2 Best Angles / 2 Leans / 7 Watchlists / 11 evaluated No Plays.
- Candidate probability grades: 0 Best Angles / 4 Leans / 7 Watchlists / 11 No Plays.
- Final sharp/movement, board-balance, and bounded Spread overlay: 0 / 5 / 12 / 5.
- Grade-tier promotions: 7: six No Play to non-actionable Watchlist and one Watchlist to Lean.
- Grade-tier demotions: 2, both Best Angle to Lean from the coherent probability/EV
  recalculation rather than a reader override.
- Net actionable change: +1; all four base Best Angle/Lean actions remain actionable and
  TCU -8.5 advances to Lean.
- Prediction-side changes: 0.
- Exact evaluated quote changes: 1 tie-break change at the same UNC-TCU Total line and price.
- Strict Circa evidence: 8/22 evaluated markets.
- Same-book operational-opening movement: 5/22 evaluated markets.
- Maximum exact-price decision-probability change: 2.469 percentage points.
- Maximum game winner-probability change: 6.947 percentage points.

The balanced grade overlay has a tested positive-EV, near-threshold Watchlist-to-Lean promotion
path and resistance demotions. No current row entered the actionable promotion cohort. Four
near-neutral exact prices and two qualified market-evidence disagreements moved from No Play to
non-actionable Watchlist. The remaining five No Plays were materially negative, resisted, or
unsupported. Neither board-balance path can create a Lean, Best Angle, stake, or lock.

The separately identified TCU -8.5 boundary case advances from Watchlist to Lean at DraftKings
-105: 54.398% cover probability, +4.994pp target-excluded market edge, and +6.205% exact-price
EV. The active grade artifact would block it both for missing the 5.00pp edge threshold by
0.006pp and for exceeding the seven-point spread band. The r3 candidate path deliberately uses
a 4.99pp edge floor and ten-point maximum absolute line, ordinary `-125..+125` juice, positive
EV, and no qualified sharp/movement resistance. No other current market enters this path.

The board also preserves exact-price cross-market semantics. Jacksonville State-NDSU grades
NDSU -7 Lean at about +6.59% EV while the NDSU Moneyline remains Watchlist at essentially
break-even EV. That is not lower confidence in NDSU winning: it means the projected margin has
value against the spread while the offered winner price does not. The candidate emits an
explicit coherence reason instead of forcing unlike prices to share a grade.

## Current score/probability impact

| Matchup | Independent expected score | Shadow expected score | Home win change |
| --- | ---: | ---: | ---: |
| SAC at EMU | 27.1-28.0 | 25.9-28.9 | +5.103pp |
| Hawaii at Stanford | 27.2-19.4 | 26.0-21.1 | +6.947pp |
| NMSU at FSU | 18.6-32.5 | 16.9-35.3 | +4.677pp |
| Memphis at UNLV | 26.8-31.2 | 26.7-30.7 | -0.382pp |
| NC State at Virginia | 20.5-32.8 | 21.3-31.5 | -3.982pp |
| SJSU at USC | 16.1-39.4 | 15.1-42.2 | +1.856pp |
| UNC at TCU | 17.2-34.4 | 17.7-32.8 | -3.476pp |
| Jacksonville State at NDSU | 17.6-35.8 | 18.2-33.5 | -4.906pp |

No side crossed the candidate probability boundary on this slate, but the implementation does
not prohibit a future side change. A future change must come from the same recomputed joint PMF
and pass the same-line score/prediction/grade coherence gate.

Strict Circa splits materially adjusted the market anchor only for Memphis-UNLV in this replay:
the averaged home-side gap was -19.5pp and the Over-side gap was -33pp, producing the frozen
-0.95-point home-margin and -1.0-point total shifts before the 25% PMF mixture. Other matched
games were neutral, internally offset across Moneyline/Spread, outside exact-line identity, or
inside the frozen +/-10pp band.

## Verification

- New market/sharp PMF mass, expectation, interval, representative-score, promotion,
  demotion, bounded Watchlist monitoring, resistance, and cross-market price-value tests pass.
- Existing football cross-market coherence tests pass.
- Existing CFB exact-price, weekly engine, SharpAPI odds/split identity, market-informed PMF,
  production writer, compact evidence, T-60 tracking, and member-reader tests pass.
- TypeScript `--noEmit` passes.
- Full model-change verification and integration safety are recorded separately before any PR.

## Production boundary

Active production remains public outcome r29, decision r15, grade policy r1, and writer r25.
This branch does not wire the shadow module into the recurring writer, member fixture, lock,
tracking, or settlement path. It changes no current production prediction, probability, grade,
stake, or record.

Advancement requires a release-separated chronological CFB split reconstruction or sufficient
immutable forward observations with outcomes and closing prices. The frozen evaluation must
report Brier/log loss/calibration, locked-price units/ROI, CLV, strict-source coverage, and
promotion/demotion board impact without tuning on the 2026-08-29 outcomes.
