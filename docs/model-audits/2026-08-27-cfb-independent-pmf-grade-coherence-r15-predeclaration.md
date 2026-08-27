# CFB independent-PMF grade coherence r15 predeclaration

Date: 2026-08-27

Status: predeclared research; no production authorization

## Objective

Repair the current grade-only side-flip defect without replacing OddSphere's
qualified CFB football forecast with a bookmaker-copy forecast. The existing
independent joint PMF remains the sole owner of expected points,
representative score, winner, Moneyline probability, Spread probability and
Total probability. The exact-price layer may evaluate only the higher-
probability side selected by that PMF at the offered line.

A natural rerun may change the forecast only by recomputing the full PMF from
new football inputs. A price, consensus or grading change cannot change the
forecast side, score or probability distribution.

## Frozen chronology and inputs

- Expanding football-model fit strictly before each evaluated season.
- 2023: policy selection only.
- 2024 and 2025: repeated chronological confirmation.
- Immutable 2026 Opening/unlocked/T-60 exact-price tuples: first forward
  evidence and the only source for true named-book execution and CLV.

The historical source admits only final games with genuine numeric pregame
spread and total data. Synthetic/default rows are excluded by the existing
source builder. No current Week 0 row, result, split or price participates in
policy selection.

## Candidate family

For each market and game, freeze the raw independent PMF side first. Test the
existing blend weights 0.25, 0.35, 0.50, 0.65 and 1.00; edge thresholds 1-5pp;
EV thresholds 0-3%; and the existing bounded abstention families. The market
fair probability can shrink confidence but cannot select the opposite side.
The disconnected logistic calibration heads are excluded.

Selection score is frozen as ROI + 0.35 times the lower weekly-bootstrap ROI
bound + 0.002 times log(1 + actions). Minimum selection actions are 15 for
Moneyline and 20 for Spread/Total. Best Angle is the selected Lean threshold
plus 2pp edge and 2% EV.

## Qualification gates

Lean requires, in each 2024 and 2025 confirmation season:

1. at least five actions;
2. positive units;
3. positive units after removing the largest win;
4. no Brier or log-loss regression versus the market-fair comparator on the
   frozen PMF-selected side;
5. pooled weekly-cluster bootstrap probability of positive units at least
   80%.

Best Angle additionally requires at least five actions and positive units
after the largest win in each confirmation season. A complete positive tuple
below Lean is Watchlist; a complete nonqualifier is No Play. An identity,
PMF, price, consensus, freshness or lock failure remains an internal
operational exception and a reasoned public No Play with the outcome forecast
preserved.

Historical Spread/Total prices are fixed -110 and historical Moneyline prices
are reconstructed from the archived pregame spread curve. The report must not
claim named-book execution or CLV from those rows. Any qualified lane is
therefore provisional and must be monitored against immutable 2026 exact
Opening/T-60 tuples without stake inflation.

## Board and writer safety

The current board replay must report exact named book/line/price, promotions,
demotions, side changes and tier counts. A release cannot ship if it silently
flattens the board or leaves an actionable demotion without a tested coherent
promotion rule.

The existing CFB forward-evidence writer and `prediction_pipeline:cfb` lease
remain authoritative. This work adds no writer, provider request, schedule,
stake, lock or tracking path.
