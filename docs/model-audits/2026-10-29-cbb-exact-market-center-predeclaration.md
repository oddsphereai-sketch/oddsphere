# CBB r18 exact-price center audit — private predeclaration

Scope: college basketball research only. No site, writer, cron, grade, stake,
member prediction, locked record, or other sport changes. The current private
independent champion remains r2; r17 Total-only preview is separate. This
audit does not promote either candidate.

The old reader converts a no-vig Spread or Moneyline price to a score center
with a continuous Normal approximation. The actual market decision function
conditions basketball spreads and moneylines on no final tie. A reviewer found
that these are not inverse functions. The correction is to solve for the center
that reproduces the observed two-sided no-vig probability under the *same*
`cbbThresholdProbabilities` semantics used for decisions. No price, push, or
market movement is invented.

Freeze this test before observing its result:

- Preserve the same 1,070 exact-opening games, target book, target price,
  independent r2 forecast, date split, and target-family exclusion. Rebuild
  only the reference-center features from the original timestamped evidence.
- Train exactly one depth-2, 40-round full score head on the 433 early games;
  compare the old and corrected feature versions on the same eligible
  February selection games and 229 March games. Refit each on early+February
  and compare on the same eligible March games.
- Report Moneyline, Spread, Total W/L/push and paired corrections/harms,
  margin/Total MAE, Brier, and exact target-price units. Also compare the
  reference-only Spread decisions using the canonical probability function,
  separately from any trained head.
- A candidate is not qualified merely because a point-center mismatch exists
  or one market improves. Do not activate a full score head that harms another
  market, and do not promote grades from these opened outcomes.

The archived references are earlier *opening* quotes, often not contemporaneous
current quotes. This test can falsify the conversion, but cannot validate a
live movement reader, Owls-versus-BDL source parity, or 2026–27 accuracy.
