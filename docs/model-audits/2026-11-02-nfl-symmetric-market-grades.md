# NFL symmetric market-conviction grading — November 2

Starting base: `1196af6b0b1550d42f97a25c69f1f7376453090a` (PR918).
Dedicated branch: `codex/nfl-symmetric-market-grades-20261102`.

## Owner requirement and policy frozen before board comparison

The owner identified the direct grader's asymmetry: market-adjusted probabilities
can change numerical grades, but the separate market-context layer could only
temper Best Angle to Lean. It had no Watchlist→Lean or Lean→Best Angle action.
The owner explicitly requires selective positive recognition as well as demotion.
This is a forward-evaluated product repair, not a historical fitted tournament.

The new layer interprets the source consequence already applied to the final law.
It cannot add probability or score points, manufacture an executable quote, use
another market's movement as exact-market confirmation, or promote a No Play.
Existing independent-edge grading remains eligible without market agreement.

Promotion requires all of the following, with no source-count vote or movement
size threshold beyond numerical solver tolerance:

- A qualified same-event, exact final-law receipt and the selected physical source's
  actual same-market episode and current economic path. The path's net and current
  leg support the selected side, and that exact offered contract's probability
  improves from the independent forecast after the real market consequence.
- A complete current executable pair, matching selected side/line/price/source
  clock, positively reobserved after the source's actual latest economic move.
  Each offer retains its own current response-page receipt, before later pages
  and opening-history retrieval. A last price-change timestamp alone is not quote
  availability; a later unchanged source quote does not reset the economic move.
- Existing exact-comparator reliability and source-clock/target-exclusion rules.
  Missing data, stale evidence and wrong-event/line/law receipts cannot be waived.
- Positive executable EV, positive comparator edge and positive score cushion.
  Current opposing price legs, unresolved buybacks/conflicts and named picked-side
  pressure meeting held prices block promotion. Opposing money met by held prices
  resists that opposing pressure; it is not an automatic veto or score update.

Watchlist→Lean keeps the existing Spread Lean probability/EV/edge minima and can
replace the redundant key-number cushion penalty with exact-contract confirmation;
positive score cushion remains mandatory. The Total confirmation lane uses the
already declared movement probability minimum52.5%, keeps standard Total Lean
EV2% and comparator edge1pp, and requires positive cushion. This replaces the
legacy movement lane's2.5pp disagreement requirement only with actual applied
same-market confirmation. It is not a new near-50% positivity-only lane.
Moneyline must retain healthy execution and positive EV/edge; a numerical Watchlist
whose economics remain negative is not promoted. The existing integrated forecast
path can also move a Moneyline Watchlist to Lean when a genuine market consequence
improves its economics. No fake positive fixture is made by overwriting its grade.

Lean→Best Angle retains the common59% modeled-confidence minimum, existing
market-specific Best Angle EV requirements, existing price bounds and exact
execution reliability. Clean causal confirmation can replace the old4pp
model-versus-comparator disagreement requirement with a positive edge. This
recognizes corroborated conviction without requiring the model to disagree more
with a market that supports its forecast. It does not establish empirical calibration.

Each direct pass can promote only one tier from the incoming current grade.
Unresolved adverse buybacks and disagreements still temper Best Angle to Lean;
new verified picked-side money pressure met by held quotes can do so too.
Repeated production runs rebuild grades from the same base; an ephemeral
same-evidence marker also prevents a standalone repeat from ratcheting promotions.
The marker is never persisted in an evaluated tuple. Every other probability, score, side, quote, stake and source field
is unchanged by the direct grading step.

## Safety and verification contract

Writer105 / runtime15 / model49 / calibration48 / decision57 / policy57 / member54 /
innovation3 / posture3 / fixture70 / snapshot62 use the `2026_11_02` market-conviction
suffixes in exported constants. Collector31 records exact quote availability and
regular-slate source r5 records page and current-batch receipt clocks. Schema r6,
independent heads and market transport equations remain unchanged. Exact r61/fixture69/member53/decision56
is an accepted reader predecessor. Qualification r2 uses a transport-stable
fingerprint of the exact numeric law, so JSON key ordering cannot invalidate it;
changed scores, probabilities, PMFs, event or market still fail qualification.
The old locked qualification receipts are preserved opaquely. Exact preceding releases
retain reader precedence. Preserve every existing lock and historical
failed-slot card, the one `prediction_pipeline:nfl` writer/lease, provider budget,
schedule and tracking ownership. No UI copy, layout, extra writer or production shadow.

Before publication: real pipeline promotion/demotion and counterexample tests,
one-tier and frozen-input idempotence, source/clock/quote/law identity, both selected
directions, forward lock immutability and exact reader precedence, same-input board
counts, focused NFL verification, `verify:model-change`, TypeScript, build, fresh-main
integration safety and protected PR checks. After merge: exact production tree,
released identifiers, leased writer, data coverage, historical hashes and live reader.

## Results

Pending; this private predeclaration does not certify deployment or accuracy.
