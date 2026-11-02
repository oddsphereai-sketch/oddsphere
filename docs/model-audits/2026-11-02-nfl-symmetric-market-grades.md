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
  Each offer retains its own current response-page request start and receipt,
  before later pages and opening-history retrieval. The request must begin after
  the economic move; a slow earlier request cannot become a new observation just
  because its response arrived later. A last price-change timestamp alone is not quote
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

Integrated production base: `0211a1688a87a99c79b4a503b1b457346709ced8` (CBB PR919).
The registry and all CBB follow-up changes remain intact. The initial combined
focused NFL suite, full `verify:model-change`, webpack build and committed
integration-safety check pass. Required focused checks are repeated after final
request-window safeguards; standalone TypeScript is also required. Local hosted
PostgreSQL URL is unset; the PR's real PostgreSQL proof must pass before merge.

The functional promotion suite uses real final-law construction and actual
foundation-grade output, not manually assigned positive grades. It demonstrates
four direct Watchlist→Lean cases and six direct Lean→Best Angle cases, both
directions for sides and totals; full runtime ML cases demonstrate the coherent
market correction moving a genuine pre-market Watchlist into the actionable
ladder. It covers final-law/market/game/source identity, exact price/comparator
quality, stale/future observations, missing proof, negative/zero economics, price
bounds, opposing paths/buyback, latest pressure replacing old pressure, same-clock
conflict, held-price interpretation, single-pass/no-ratchet behavior, new-lock
application and exact stored-lock preservation. Direct interpretation preserves
all numerical score, probability, price, source and execution fields.

Receipt regressions separate13:58:30→13:59 and13:59→14:00 current page windows
from opening-history completion14:10, with the same provider requests and source
timestamps. A page begun before a14:00 market move but completed afterward cannot
qualify an apparent post-move offer. Genuine later requests can qualify; a newer
held source quote does not erase a valid earlier post-move offer. Evaluation time
includes actual receipts in no-write and production paths. Qualification r2 tests
also prove JSON object-key reordering preserves an identical law while changed
numeric or market identity fails.

The read-only current capture completed `2026-11-02T15:14:08.207Z` in42.231s,
with three complete current tuples, no contract findings, no data holds and the
14-game fixture retaining all13 historical cards unchanged. Every current
executable book carried its actual page receipt. On identical final PMFs and offer
sets, before and candidate grades are SEA ML No Play / SEA−3.5 Watchlist /
Under46.5 Best Angle: one actionable, zero promotions or demotions, no new No Plays.
The ML's expected value is negative; the Spread does not pass the qualified
promotion conditions and has unresolved resistance; the existing Under Best Angle
receives explicit qualified market confirmation. This deliberately does not force
an upgraded live pick just to exercise a new path. Each comparison policy rebuilt
its own version's proof format on the identical law; no historical row was regraded.

Private evidence: `/private/tmp/nfl-20261102-r105-qa.json`,
`/private/tmp/nfl-20261102-r105-payloads.json`, and the immutable prepublication
baseline `/private/tmp/nfl-20261102-r105-prepublication.json`.
Publication and live proof remain pending. No predictive win-rate improvement is claimed.
