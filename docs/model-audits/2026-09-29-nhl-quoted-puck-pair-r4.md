# NHL quoted puck-pair r4 — 2026-09-29

## Predeclaration

The live r3 acceptance check found one missing exact price: MTL-TOR was written
as `TOR +1.5` even though the stored provider rows quoted `TOR -1.5` and
`MTL +1.5`. The provider also supplied repeated zero-handicap rows for the same
book. The r3 selector retained only the last row per side, making selection
dependent on database row order and allowing the complete `-1.5/+1.5` pair to
be erased.

The repair is limited to current puckline pair resolution. Enumerate every
distinct home/away value per normalized book, retain only complementary pairs,
then apply the existing book-count and standard-puckline priority. Score-model
coefficients, the 20% Moneyline sanity correction, zero fixed Total-line weight,
split/movement corrections, grade thresholds, UI, and member copy do not change.

Release identifiers:

- Model: `nhl_regular_2026_r4_quoted_puck_pair`
- Calibration: `nhl_regular_calibration_2026_r4_quoted_puck_pair`
- Decision: `nhl_regular_decision_2026_r4_quoted_puck_pair`

## Result and board impact

The exact live provider fixture now resolves `home=-1.5, away=+1.5`
independently of row order. The five-game replay retains all 15 markets and the
r3 joint-score projections. MTL-TOR changes from the unpriced, non-actionable
inferred `TOR +1.5` row to the actually quoted `MTL +1.5` row at its current
price. This is one tested promotion and zero actionable demotions; no market is
removed and the board does not flatten.

Because the score means and joint distribution are unchanged, the r3 untouched
holdout score, winner, Total, and puckline-direction metrics remain the governing
accuracy evidence. The repair changes only which real puckline the distribution
is evaluated against when a provider returns multiple same-book rows.

## Safety and rollback

The authoritative NHL writer, shared `prediction_pipeline` lease, locked-row
immutability, schedule, data providers, and tracking markets remain unchanged.
Rollback is the r3 release; do not rewrite a locked r4 row. Live acceptance
requires 5 games, 15 records, an exact current price for every market, coherent
score/pick sides, healthy split fallbacks, and the r4 release identifiers.
