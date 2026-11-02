# NFL source-qualified reader and grade repair — November 2

Starting production base: `9876c3dd99539b1302c7617765d22fe0e8976fed`.
Branch: `codex/nfl-source-qualified-grades-20261102`.
The owner requested that confirmed functional gaps be repaired and grades properly
qualified, with forward outcome evaluation rather than another fitted tournament.
This document freezes the policy before the current-slate comparison.

## Bounded changes

1. Separate captured reference books from executable quotes. Fresh, intact,
   same-event, exact-contract, target-excluded Pinnacle/Circa pairs may qualify an
   executable retail offer. Capture-only books never become execution books.
2. Preserve splits at their own source contract as timestamped pressure/reaction
   context even when their line differs from the member's offer. They cannot
   supply the probability for a different contract. Public and named pressure
   retain distinct provenance. No money/ticket percentage becomes score points.
3. Read the economic path, including number/juice compensation, partial/full
   buybacks, reversals and resumed support. Current aligned paths or an actual
   post-flow price reaction can adjudicate older opposed episodes. An unresolved
   fresh adverse buyback can temper Best Angle to Lean; it never creates No Play.
   The selected same-book ML/Spread and separate Total still produce one law.
4. Replace the signal-accounting qualification boolean with a market-specific
   receipt bound to the event, clocks, source interpretation and final law hash.
   Accounting completion alone is not forecast qualification or calibration.
5. Use the existing Spread Best Angle modeled-confidence minimum, 59%, for all
   three strongest-grade categories. This is a common product-tier definition,
   **not** a newly fitted probability model or a demonstrated 59% actual win rate.
   Existing EV, exact-price reliability, edge, price and cushion gates remain.
   Otherwise qualified lower-confidence positive-edge bets can remain Leans.
6. Reconcile a near-pick'em law whose expected margin contradicts its inferred
   winner. Preserve inferred conditional ML and Spread probabilities while
   projecting the distribution mean into the same winner half-space. Keep the
   strict coherence validator. Numerical solver tolerance is not a player or
   score handicapping adjustment.
7. Failed future T-60 attempts do not consume the unique final-lock slot. Retry
   only inside the original cutoff plus 20-minute legal window. Any actual stored
   locked decision takes precedence, including partial legacy records. Preserve
   previous published locked DTOs opaquely and exclude failed attempts from member
   fixture authority. Never turn Philadelphia's historical failed lock into a pick.

## Frozen verification and qualification contract

- Test promotions and demotions for ML, Spread and Total, execution/reference
  separation, exact-event/source-clock handling, same-endpoint differing paths,
  resumed support, off-target split context, probability/score coherence, retry
  boundaries and exact historical locked reader precedence.
- Report current candidate board counts and matched-law grade-only impact
  separately. Older capture timestamps are not a causal baseline. Outcomes from
  Sunday are diagnosis, not selection labels or a new performance claim.
- Sunday tracked results span releases. Five Best Angle totals went 1–4, including
  three new r55 totals going 0–3. This is insufficient to establish true rates or
  to tune parameters. The 59% tier rule does not remove the 60.19% losing NE Under.
- Do not modify probabilities solely to improve grade eligibility. No forced
  market quotas, blanket source votes, invented executable prices, extra provider
  request, independent writer, production shadow, lease or lock-time change.
- `prediction_pipeline:nfl` remains the sole writer lease. Keep cron ownership and
  provider budgets. Run focused NFL checks, `npm run verify:model-change`, TypeScript
  and build. Integrate latest main, check overlapping work, protected PR only.
- Before publication freeze all existing lock IDs/hashes and published locked
  DTOs. After merge verify deployment/release, normal writer, reader, health,
  source coverage and next scheduled run. A historical incomplete Philadelphia
  tuple remains an explicit historical exception, never silently filled or hidden.

## Release tuple

Writer104 / collector30 / model48 / calibration47 / decision56 / grade56 /
member53 / runtime14 / arbiter29 / innovation2 / posture2 / joint-law4 /
fixture69 / snapshot61, all dated `2026_11_02` with the source-qualified suffixes
in exported runtime constants. Schema r6 and stored historical hash semantics
remain unchanged. This supersedes r103 only for unlocked and future decisions.

## Verification results

The isolated candidate integrated `ac287925b441895d2fa2524135ae1cd8b44e12bc`
(PR916) without overlapping implementation hunks. The focused NFL suite,
`npm run verify:model-change`, webpack production build and the new NBA member
evidence test pass. Standalone TypeScript identified a preexisting partial test
fixture in PR916; its active owner is correcting that in PR917 before this release.
Local PostgreSQL proof is unavailable because `MARKET_BRAIN_POSTGRES_URL` is unset;
the required hosted PostgreSQL PR check remains mandatory.

Three external AI reviewers examined source contracts, chronology/posture and
lock/publication continuity. Their concrete findings were repaired and exercised:
an attested pre-flow pair must remain the actual baseline even with only one later
change; whole-law physical rejection must propagate unavailable qualification;
ML-only or Spread-only consequences identify the shared margin law in both
receipts; fresh held buybacks retain their original continuing resistance state.
No failure receipt masquerades as a successful independent fallback.

The no-write current CHI@SEA capture at `2026-11-02T13:28:19.199Z` produced all three
exact market tuples, no reader contract findings and no health holds. Pinnacle
history was available across all three markets; own-contract Circa/public pressure
was retained with original clocks. It proposed one Best Angle, one Watchlist and
one No Play, with a coherent SEA23.3135–CHI19.3289 score. This is a current candidate
snapshot, not a final lock or wager recommendation. Provider calls remain the
existing collector calls, and no payload, tracking row or member snapshot was written.

A separate frozen-input qualification diagnostic used 12 complete stored game
forecasts (36 markets), the r103 grader and the candidate grader on identical final
score distributions and offered quote sets. It did not rerun independent inputs
or fit to outcomes, and it never rewrote any lock:

| Market | Before BA / Lean / Watch / No Play | Candidate BA / Lean / Watch / No Play |
| --- | --- | --- |
| Moneyline | 1 / 1 / 1 / 9 | 1 / 1 / 1 / 9 |
| Spread | 0 / 1 / 8 / 3 | 1 / 1 / 7 / 3 |
| Total | 6 / 0 / 0 / 6 | 2 / 4 / 0 / 6 |
| All | 7 / 2 / 9 / 18 | 4 / 6 / 8 / 18 |

Actionables9→10: one Watchlist→Best Angle promotion (DEN+1 at retail−112, modeled
64.8083%, captured exact Pinnacle comparator), four Best Angle→Lean tier changes,
zero actionable→nonactionable demotions and no added No Plays. The four totals
had modeled confidence55.10%,56.32%,57.58%,57.66%. NE Under60.19% remains Best Angle
despite its subsequent loss. PMFs/scores were held fixed. One No Play Total contract
changed from CLE/PIT Over38.5 to Under39 because the candidate rejects the older
per-market source quote; therefore selected side/line/probability are not claimed
identical for that nonactionable case. This is grade/source qualification impact,
not a release-pure historical win-rate improvement.

Before publication, all13 historical T60 evidence rows and the published r60 fixture
were frozen read-only at `2026-11-02T13:34:48.210Z`. A real-data structural fixture
check preserves all13 historical public cards exactly (12 actual locked decisions
plus Philadelphia's historical open-held failed-final-slot card), retains the full
14-game board and invents no Philadelphia decision. The prior incomplete card is
accepted only with its matching raw expired empty final-slot evidence; future
failed attempts or an unrelated card cannot fill coverage. Complete odds coverage
for that historical game is not falsely reported.

Private evidence artifacts: `/private/tmp/nfl-20261102-grade-impact.json`,
`/private/tmp/nfl-20261102-r104-current-no-write.json`,
`/private/tmp/nfl-20261102-r104-prepublication.json`, and
`/private/tmp/nfl-20261102-freeze-proof.json`.
Publication and post-merge live proof remain pending; this document does not
certify deployment or predictive accuracy.
