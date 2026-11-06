# Confidence-led Daily Edge grade repair

Starting remote main: `b77b1ed087765f7f9b5ce9ec323c0517d00b5408`.
Branch: `codex/daily-edge-market-grade-audit-20261106`.

On November 6 the owner explicitly clarified that Lean describes confidence
in the predicted outcome and can carry a poor/nonpositive-value price. Price
still matters to recommendation strength; it must not be an unconditional
override of outcome confidence. This supersedes the November 5 document's
claim that every Lean must have positive exact-price EV. No accuracy guarantee,
side quota, desired play count or permission to rewrite a lock is implied.

Scope: audit all nine Daily Edge readers and today's CBB, NBA, NHL, CFB and
EPL. Repair demonstrated active-path mismatches, starting with CBB/NBA. Keep
every sport's one authoritative final score law, native interpretation, source
clocks, uncertainty, opposite evidence, writer, lease and schedule. Preserve
the concurrent CBB Total-head development; no refit or second forecast here.

The confidence-led Lean route uses an explicit 55% selected-win confidence
floor, already used by NBA and the shared binary confidence contract. It is a
product boundary, not a newly validated win-rate claim. Actual paired quotes
bound the price contribution: negative offered value can remain Lean when the
forecast is inside the same book's observed overround envelope. No hand-set
negative-EV tolerance or synthetic opposite price is permitted. Unavailable or
invalid pairs do not qualify. Existing value-led Leans remain eligible.

CBB additionally retains its fitted-location sensitivity and declared
one-adverse-case policy for the outcome-confidence assessment, with pushes
refunded rather than counted as wins. The actual quote's return must still
support the existing declared risk; an impractically tiny payout does not
acquire a recommendation merely through a near-certain point estimate. Best
retains the stronger actual-value, uncertainty and price assessment. NBA keeps
its data-quality and opposition composition; clean confirmation cannot
misrepresent a confidence-only Lean as positive-value Best.

Version every affected policy and publish same-input board/market counts,
promotions, demotions, unchanged forecasts and prices, tests and limits. Prior
stored releases and locked member/tracking tuples remain exact. Complete the
full model-change verification, focused tests, latest-main integration safety,
protected PR and natural-writer/reader/next-cycle proof before claiming live.

## Captured audit and controlled effect

The authenticated current-board capture at approximately 18:06 UTC contains
491 games across the rolling/weekly readers, not 491 games today. Filtering
actual kickoff instants to November 6 in America/New_York yields:

| Sport | Today's games | Core markets | Best / Lean / Watch / No Play |
| --- | ---: | ---: | --- |
| CBB | 59 | 177 | 1 / 30 / 99 / 47 |
| NBA | 9 | 27 | 1 / 6 / 20 / 0 |
| NHL | 3 | 9 | 0 / 4 / 5 / 0 |
| CFB | 5 | 15 | 2 / 5 / 6 / 2 |
| EPL | 1 | 3 | 0 / 1 / 0 / 2 |
| MLB, WNBA, NFL, UCL | 0 | 0 | Inactive today |

CBB's newcomer/no-wager card owns the three unpriced slots. EPL Double Chance
is separately present under its existing monitor-only policy. The generic
source-chain audit finds zero critical failures; its future-game missing-price
warnings are not today's missing-price count or a certificate of prediction
quality. The separate DB audit confirms all nine NBA and all three NHL games
have all three stored markets, exact current prices and no locked rows at
capture. NFL/CFB weekly snapshot counts must not be presented as today's count.

The policy replay uses later independently captured **stored decision inputs**,
not the earlier aggregate board capture. Their counts differ as the normal
writers advance. It excludes all already locked rows, uses no game outcomes,
performs no fit, calls no provider and writes no production state. The existing
CBB latent law, full native receipt and exact offered quotes are reused. NBA's
R28 grades reproduce on all 27 exact captured inputs before comparison.

| Replay | Markets | Before Best / Lean / Watch / No Play | After | Promotions / demotions |
| --- | ---: | --- | --- | --- |
| CBB | 174 | 1 / 36 / 99 / 38 | 1 / 63 / 79 / 31 | 27 / 0 |
| NBA | 27 | 1 / 5 / 21 / 0 | 1 / 6 / 20 / 0 | 1 / 0 |

CBB promotions comprise 20 Moneylines, three Spreads and four Totals. Its
existing 37 actionables are retained; one Best remains one Best. NBA's added
Lean is LAL Moneyline at -146, 56.5438% final probability and **-4.7276%**
offered EV on this input. That negative EV remains negative in its bound
confidence-price assessment. Its source posture is preserved, and a synthetic
same-pick corroborated opposition case still demotes to Watch. Better real price
and stronger final confidence retain their tested Best promotion paths.

All CBB scores, selections, win/loss/push probabilities, prices and nominal EV
match the prior decision within 1e-10, with exact selected-side/price identity.
Stored input payloads remain byte-exact after replay. NBA calls only the pure
grade policy on captured inputs: it cannot change any forecast or quote.
Negative-value ordinary Watch/No Play lanes remain exact unless the new
confidence path itself qualifies. Impractically small CBB returns remain held
below Lean by the existing declared risk policy. No count or Under/Over target
was used to select the policy; the Total-side concentration is unchanged and
belongs to the concurrent forecast investigation.

## Remaining sport review and limits

- CFB has genuine same-book movement resistance and mixed current context on
  several high-probability Moneylines. USF's positive-EV Watch is therefore not
  a missing-price or blanket negative-value failure; the Total and Spread remain
  independently eligible. Current ARIZ/UNM quote disagreement and actual source
  response remain visible. No generic split bonus or confidence-only overwrite
  is applied over that sport's released causal/source policy.
- NHL's three-market final joint law and source receipts remain the authority.
  The high-probability puck-line watches and mixed-book Moneyline are governed
  by NHL's separate market-confidence/edge policy. This audit identifies that
  sport-specific difference; it does not claim the CBB 55% product boundary is
  newly validated for hockey or erase a conflicting source path.
- EPL's current Match Result is below 50% and BTTS below its active 53%
  monitoring floor. Its Total remains Lean. EPL already has a separately
  qualified nonpositive-value winner-confidence exception; UCL has a paired-vig
  movement-confirmed confidence lane. Their authorities are not the World Cup
  compatibility grader.
- Inactive MLB/WNBA runtime constants match the registry before inspection.
  Their existing qualified value/confidence exceptions and public-split
  authority boundaries remain intact. No current-day prediction-performance
  claim can be made for a sport with no current games.

This functional policy test cannot establish improved future accuracy, complete
knowledge of every market event, or accuracy of CBB's fitted confidence tails.
Evaluate future locked results by their actual model, grade release and lock
time. In particular, do not pool CBB R1 results with the concurrently developed
Total-head model and describe the blend as the current forecast's accuracy.

## Runtime, locking and rollback

The new CBB confidence arithmetic reuses the existing risk scenario's win/loss
calculations. It introduces zero GP predictions, fits, calibration passes,
provider requests or DB loops. Previously negative-EV candidates may now need
the same bounded eight-scenario assessment already used by value candidates;
the per-game evaluator still shares its scenarios across all three markets.
The existing 540-second route and 600-second sport lease remain unchanged.

Tests exercise negative-EV confidence Leans through the real CBB member writer,
lock, member reader and tracking serializer with in-memory storage. An existing
R10/R9, R8/R7 or R7/R6 lock cannot be replaced by the new candidate. New confidence
receipts independently recheck their scalar qualification on publication;
JSONB key order cannot change it. NBA's old R28 Watch and release remain exact
when a current R29 dynamic card would be Lean. Missing, stale, future,
cross-book, cross-line, cross-capture or conflicting exact quotes cannot create
the new qualification.

Rollback future qualification through a new versioned policy while retaining
readers for R11/R10 and NBA R29 stored decisions. Do not deploy an older decoder
that cannot recognize new confidence Leans. Retain every new lock's original
payload and release; never recompute it with the rollback policy. Publication must stop on a mixed grade tuple, missing current markets,
unexpected demotion, lock mutation, writer overlap, publication failure or
unexplained runtime increase. Build and test success alone are not live proof.

## Verification status

The mandatory `npm run verify:model-change` completed successfully on the first
candidate. The final run includes the new confidence-grade test in preverify.
The focused CBB/NBA forecast, grading, price-reference, evidence-codec, causal
market-consequence, member/lock and tracking tests pass. Type checking and the
isolated production build are checked separately. Publication and live proof
are pending; this document must not be read as a deployment claim.

## Fresh production-base reconciliation

PR #1048 merged as `6b129bb07c7ae1d5dc64d1f8718b65b3a3fee416`. Its tree
`be9837e20a3517e3fbd387d2a8c6128c858b385c` is exactly the reviewed CBB
PR head. Every overlapping code/document hunk was reconciled, retaining the
economic Total, raw Margin and R7 covariance/private-artifact bindings. No production or shared worktree was touched.

The candidate identifiers advance beyond the merged release: CBB decision and
interpreted decision R11, grade R10, publisher R51, adapter R34, tracking R37.
R7 model/calibration/evidence and engine remain unchanged. Stored R10/R9
decisions remain readable under R7; R8/R7 and R7/R6 remain bound exclusively to
their original R1 manifest. New confidence semantics are admitted only for the
new decision release. The lock integration tests cover current negative-EV
Lean publication, earlier R7 lock precedence and both R1 legacy cohorts.

The 174-market CBB counts above describe the frozen R1 law only. They are not
a forecast of the R7 board; a new R7 same-input comparison and natural-writer
verification are required before the final deployment claim. Full model gate,
affected focused tests, build/types and integration safety are rerun against
the actual merged production base.

## Final R7 same-input result

After the 18:58 UTC existing leased refresh completed, all 58 unlocked current
contextual game records contained the genuine R7 model and R10/R9 decision/grade
family. Captured member clocks span 19:05:16–19:05:37 UTC. The exact replay at
19:06:58 uses their stored final law, interpretation, target prices and declared
risk context. No GP model prediction, fit, provider call or production write
is made. A release guard rejects mixed-model cohorts; a full input hash and
source-clock bounds identify this comparison independently from the earlier R1
cohort. Total variance compatibility uses its native trend posterior, never an
invented legacy source-location variance.

| R7 core market | Before Lean / Watch / No Play | After | Promotions / demotions |
| --- | --- | --- | --- |
| Moneyline | 2 / 25 / 31 | 23 / 7 / 28 | 21 / 0 |
| Spread | 8 / 47 / 3 | 9 / 46 / 3 | 1 / 0 |
| Total | 13 / 45 / 0 | 22 / 36 / 0 | 9 / 0 |
| All 174 | 23 / 117 / 34 | 54 / 89 / 31 | 31 / 0 |

There are zero new Best Angles. Scores, sides, probabilities, push refunds, exact
prices and nominal EV match, and the original stored input payloads remain exact.
The NBA frozen R28 comparison independently remains one promotion/zero demotions
over 27 markets. A 39.3-second local R7 grading replay includes every three-market
law and risk assessment; it is not a hosted writer-duration guarantee.
`docs/audits/2026-11-06-confidence-led-r7-impact.json` records these counts, release
and input hashes. No count target selected the rule or changed any forecast.

The latest-main full model gate, isolated production build and TypeScript pass.
Focused collector tests remain 148/148, lossless batching/response-clock tests
pass, and the real captured 42 R1 locks/126 tracking rows remain exact in the
no-IO reader/writer replay. Clean integration safety passes against 6b129bb0.
Protected PR checks and actual production/normal-writer proof remain required.
