# NFL published percentage rounding and substantive market spot checks

Starting base: `b1d24d4718fdaba8be22f6e7b86546e130234c0c` (PR922).
Dedicated branch: `codex/nfl-rounded-source-pressure-20261102`.

Integrated production base: `69e5499618ac46582f83e3312b200da7a228a67a`
(owner-directed PHI tracking recovery PR923). Both registry/safety sections remain;
every incoming writer hunk was reviewed. Its explicit operator-only original-tuple
recovery, idempotence checks and insert-only historical game handling are retained.
No recovery option is passed by the normal refresh or this source-input repair.
Affected full/focused/build checks are repeated on the combined base before merge.

## Defect and bounded repair

The November2 10:51AMET read-only source check received CHI@SEA Circa moneyline
money86/14 and tickets43/58, timestamp15:40:08.361Z. Published whole-percent rounding
can total101. The generic provider parser accepted this pair but the NFL named
source-reaction qualifier required effectively exact100 and discarded its bound
moneyline flow as incomplete. The raw percentages were present.

Retain original published values. Admit only complete bounded whole-number pairs
whose sum is99,100 or101; exact complementary decimal inputs retain prior behavior.
Larger discrepancies, unsupported inconsistent decimal pairs, null/nonfinite/out
of range inputs remain invalid. A newly admitted rounding pair cannot establish
pressure from a nonzero gap of only one point; exact100 inputs keep their existing
direction behavior. Every event/book/own-contract, exclusion, prior-pair, freshness,
conflict and pregame requirement remains. No inferred percentage, source timestamp,
probability bonus, score offset, grade threshold or new provider request.

Release family: writer106, collector32, model50, calibration49, decision58,
grade policy58, member55, runtime16, fixture71, snapshot63 with
`2026_11_02_*_published_rounding_pressure`; source reaction3. Innovation3,
posture3, qualification2 and all independent/transport mathematics remain.
The exact preceding r62/r70/member54/decision57 remains readable. No existing
locked, historical failed-slot or tracking record is changed or reconstructed.

## Market interpretation spot check

The authentic PHI@WSH November1 23:06Z pregame record had PHI+6 at BetMGM and
Circa spread money64%/tickets44% on PHI. Its older r52 reader retained Best Angle.
However, the physical books' sequence matters: Circa moved from PHI+6.5 in the
morning to+6 then+5.5, and Pinnacle's late PHI+6 price strengthened from+101 to-112.
Thus the retail quote alone does not establish a contemporaneous broad market
move against PHI. Price/line chronology cannot be replaced with bookmaker-intent
claims. The old model did apply a Washington-directed net episode: independent
PHI21.557/WSH20.828 became PHI20.879/WSH21.159, even while PHI+6 stayed Best Angle.

The exact22:26Z Circa split can now bind to its prior22:15Z same-event/contract
pair. Subsequent held prices provide resistance to PHI's money pressure. An
isolated invocation of the current conviction layer with original probabilities,
prices and grades held fixed tempers that Best Angle to Lean. This demonstrates
the context interpretation, not a reconstructed historical public prediction or
full counterfactual backtest. Yesterday's records remain untouched; the owner is
handling the separate failed lock in another chat.

For the current CHI@SEA release, all3 stored final-law receipts survive database
transport, all6 comparable executable offers have valid own request/receipt
windows, injuries/public/sourced splits and odds are present, no reader-contract
findings or health holds. At10:39AMET: SEA ML No Play60.7% at-170; SEA-3.5 Watchlist
52.4% at+100; Under46.5 Lean62.0% at-110. The latter correctly reflects a fresh
Pinnacle Over buyback while preserving the net Under prediction. These are separate
winner/cover/total contracts from one coherent projected score, CHI19.3/SEA23.4.

## Verification and publication

Focused source-rounding, source-clock/contract, promotion, locked fixture and
reader predecessor tests pass. Full model safety, NFL suite, TypeScript, build,
same-input current board impact and clean integration safety are required before
the protected PR merges. Live release, writer, data coverage, snapshot/reader
parity and historical immutability must be verified after deployment.

Private spot-check evidence:
`/private/tmp/nfl-20261102-spotcheck-1546-market-review.json`,
`/private/tmp/nfl-20261102-spotcheck-1546-eagles-conviction.json`,
`/private/tmp/nfl-20261102-spotcheck-1546-live-proof.json`.
Final no-write capture completed `2026-11-02T16:00:36.836Z` in60.136s, with
3 evaluated markets, zero health holds/reader findings and13 exact historical
cards. Current identical-law policy comparison is0 promotions,0 demotions and
no new No Plays: SEA ML No Play60.95%(-170), SEA-3.5 Watchlist52.63%(+100),
Under46.5 Best Angle62.35%(-110). This differs from10:39AM's Total Lean because
the authentic15:45:26Z Pinnacle path has returned to a current Under direction,
not because the rounding fix changed grade floors. The Under has explicit
source/execution confirmation with valid post-move offer request/receipt windows.

The read-only same-history/base comparison at16:02:25Z proves old qualification
rejects the actual43/58 ticket pair and new qualification retains its exact raw
86-money/43-ticket home pressure. Adding only that flow leaves the numeric
forecast exactly unchanged: the Circa quote held, so no invented move is applied.
Grade comparison on that same final law is unchanged. Evidence:
`/private/tmp/nfl-20261102-r106-qa.json` and
`/private/tmp/nfl-20261102-r106-flow-comparison.json`.

Focused NFL production suite, full `verify:model-change`, standalone TypeScript,
webpack build, diff checks and clean integration safety passed on the exact
starting base. Hosted PostgreSQL proof remains a pre-merge requirement.
Publication and post-merge live proof pending. No realized predictive improvement is claimed.
