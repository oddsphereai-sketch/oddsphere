# Market opposition repair — bounded production scope

Owner request: repair NFL, CFB and NBA market reading in the actual production
paths. Starting remote main: 95b9e7f35afa99ea6997ea091b30d22e859c00b5.
Own branch/worktree: codex/market-opposition-repair-20261031 at
/private/tmp/oddsphere-market-opposition-repair-20261031. Shared checkout untouched.

First implementation is NBA's confirmed reader-to-grade disconnect, not a new
score model or a claim that all three sports are repaired. NFL's reflection/
fallback and CFB's distinct calibrated reader require their own path-specific
changes and cannot inherit basketball authority merely from a shared idea.

Current NBA model/marriage/grade: r24/r25/r15. One existing prediction_pipeline:nba
writer, cadence, provider budget and locked precedence remain authoritative.
No new provider request, independent timer/writer, SQL, fit or outcome-driven
model selection. Old locked snapshots retain byte-exact precedence. NFL and
CFB live releases are unchanged by this NBA stage.

Observed TOR–ORL Oct30, external401909281: the stored r24 model predicted TOR by
8.7433 and left both ML−210 and Spread−5.5−110 at Best Angle. A book_disagreement
read remained unavailable despite stored named-book opposition. This is a
reader/grade plumbing case, not evidence of bookmaker intent or proof that an
ORL flip would have been correct. The original lock is not regraded or rewritten.

Repair contract: preserve the full incumbent reader, score, probability, pick,
price selector and economic grade calculation. Separately carry fresh stable
target-excluded named-book opposition to the grade owner, even when a mixed
market cannot qualify a forecast correction. An otherwise eligible Best Angle
with this opposition becomes an actionable Lean at its SAME probability and
price. No Lean, Watchlist, No Market or Held is promoted or demoted; no new
probability/confidence is manufactured. Supporting-only/missing/ambiguous
observations do not create promotions or erase opposition.

Use existing NBA chronology, persistence and meaningful-move definitions.
Spread/Total number movement with opposite-sign no-vig-price movement is
explicitly conflicting/unknown, not assumed to have the raw-number economic
direction. Missing or stale evidence is not an opposing observation. ML and
Spread remain distinct: cover resistance cannot by itself identify a losing
outright favorite. Public handle or named-book handle does not identify bettors.

Qualification is finite: actual stored TOR–ORL source/grade reproduction, stale/
future/excluded/price-compensated/missing/supporting/reversal negatives,
same-input current-board comparison through the production pipeline, unchanged
forecast/price/actionable invariants, both lock-writer and lock-reader tests,
focused/full checks and independent invalidation review. Required board impact:
zero actionable promotions, zero actionable demotions, zero net actionable
change; report Best Angle-to-Lean transitions separately. This is an uncertainty
classification repair, not a demonstrated accuracy gain. Reject any unexpected
forecast, quote, actionable or locked-record change.

Before publication: version affected NBA model/marriage/grade and the new
posture contract, update release registry, fresh-main integration/overlap proof,
protected PR checks, remote/local tree parity. Verify live releases, the sole
writer/lease, coverage, member/tracking coherence and next lock cycle before
calling this stage live. No claim of complete market coverage follows.

Provider-attestation correction before publication: legacy trails merge sources
by sportsbook and discard provider/run lineage. New posture evidence instead
uses the same pair/trail computation on distinct provider/book/event/run lanes,
requiring complete unique pairs and no contradictory provider lanes for a book.
The incumbent mixed-provider forecast path is NOT silently changed by this
grade-only stage. r1/r2 endpoint-only audit receipts do not prove this contract;
they remain unchanged and superseded. r3 reuses the frozen17 game records,
reads complete named-book chronology with stored provider/run IDs before each
original cutoff, and uses the exact production attested-trail builder.
This bounded recovery permits40 SELECTs/16MiB/3,000 rows per game, no new
provider requests, outcomes or DB writes. It neither changes the original
records nor reclassifies the seven open records as historical locks.

## Actual retained-input result (r3)

Provider-attested production-builder comparison:17 unique games/51 markets,
10 locked games and7 unlocked. All incumbent grades reproduce exactly from
the stored grade inputs. Source recovery used25 SELECTs/4,155,846 raw bytes.
Earlier r1/r2 used35 SELECTs/591,795 bytes combined and are superseded, not
rewritten. Total successful DB calls in these three executions=60; raw
response bytes=4,747,641. Paid-provider calls, fits, outcome labels, DB writes,
prediction updates and lock mutations=0.

The30 locked-market historical hypotheticals change Best Angles7→3 and
Leans4→8. TOR–ORL ML/Spread, CHI–BOS Spread and IND–MIA Spread are the four
transitions. They are NOT corrections/replacements of those actual locks.
The21 unlocked markets retain2 Best Angles/3 Leans with zero grade change at
their original retained cutoffs. Both strata have zero actionable promotions,
zero actionable demotions and identical all-actionable counts, picks, prices,
probabilities and effective confidence. No accuracy/ROI gain is inferred from
this classification-only comparison. It is not a whole-writer raw-input replay.

TOR's attested Circa Spread movement remains opposition. Pinnacle's Spread
number/endpoint-price changes are explicitly conflicting rather than blindly
counted as a second independent agreeing vote; its ML price lane opposes TOR.
The model may remain a favorite while cover evidence resists it. This is not
a rule to follow/fade every favorite or to flip to the eventual winner.

Private receipt root: /private/tmp/oddsphere-nba-opposition-evidence-ISrlzE.
Source r3 SHA256685b5a6011eb5c1dbf6e5fbe624e2e6dcaa603c9fb7f7c04969b5dc8475923d1.
Comparison r3 SHA2568e18dfb5b12ce33747e50a88b998547c05e33285f21127e1fa56c8b8209b94d4.
The runtime operator's URLSearchParams type spelling was corrected after its
first execution; that does not change the returned receipt into an execution
of later code. r3 is the provider-attested execution; r1/r2 are not qualification.

## Verification and remaining boundary

TypeScript, focused lint (one pre-existing unused _quickRead warning), targeted
reader/grade/production-assembly tests and lock-reader/writer lifecycle suites
pass. The full model-change suite passes with the new288 paired-grade cases
included. The tests additionally cover mirrored home-underdog/away-favorite
roles, compensated prices, provider/run/event/duplicate/unknown-provider
negatives, a posture-bearing unlocked recomputation losing to an exact legacy
lock, and unchanged scores/picks/probabilities/quotes/effective confidence in
the production candidate→intelligence→grade→member-signal path. PostgreSQL
proof remains explicitly skipped because MARKET_BRAIN_POSTGRES_URL is unset.

A bounded independent reviewer found no remaining specific invalidator in this
first-stage uncertainty path after the provider fix. This is NOT endorsement
of full forecast repair. The larger requested score-response/Spread-crossing/
ML-winner-authority work is still unresolved. A half-point change and mixed
ML quotes do not uniquely identify a corrected score, cover probability or
upset probability; no new calibrated mapping was invented here.

Remote main recheck remains95b9e7f3. GitHub connector protection lookup returns
403 (integration lacks administrative visibility); branch-protection and
strict up-to-date enforcement therefore cannot yet be confirmed for merging.
No bypass is authorized. Existing open research/governance PRs touching the
release registry must rebase/reconcile before either merges. Do not claim this
candidate, let alone the complete reader, is live or launch-ready from local
tests. No change to NFL/CFB or broader NBA forecast authority is in this branch.
