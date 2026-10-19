# MLB trusted Total scope recovery — 2026-10-19

## Authorization and scope

Daniel Mengel directed Oddsphere to repair the MLB price gap rather than accept
an operational No Play or relax the customer-facing sportsbook policy. This
change is future-unlocked only. It does not change the MLB forecast,
probability, side, score, grade thresholds, stake, provider hierarchy, writer,
lease, cadence, copy, layout, tracking, or any stored lock.

Starting production base: `5f5f673382dbb3260bdce3267cb919001246a160`.

## Confirmed defect

On the October 19 Cleveland–Tampa Bay postseason game, the generic SharpAPI
event response contained only a complete Sportzino Total at 6.5. Sportzino is
deliberately absent from `BOOK_PRIORITY` and cannot supply a customer-facing
evaluated price. The provider therefore retained correct fail-closed behavior,
but its recovery predicate incorrectly treated the presence of *any* main
Total row as complete coverage and skipped the existing market-scoped
`total_runs` request.

A bounded, read-only request against that exact provider event proved that the
market-scoped endpoint simultaneously held approved complete pairs, including
BetMGM Over 6.5 -140 / Under 6.5 +105, Pinnacle Over 6.5 -124 / Under 6.5
+108, FanDuel Over 6.5 -128 / Under 6.5 +104, and Circa Over 7 -105 / Under 7
-115. The gap was therefore pagination/scope suppression, not absent market
inventory.

## Released correction

The existing bounded provider path now suppresses its market-scoped Total
request only after the generic response contains a complete approved-book,
same-line Over/Under pair with both American prices. An untrusted pair, a
one-sided row, a cross-line pair, an alternate line, or a missing price cannot
satisfy that predicate. The same predicate owns both advertised and
speculative event-bucket paths. The existing 100-call invocation ceiling,
event identity checks, alternate-line filter, row mapper, sole
`prediction_pipeline:mlb` writer, and per-book atomic line replacement remain
unchanged.

Market input identity advances from
`mlb_market_input_snapshot_v3_current_line_pagination_2026_09_08` to
`mlb_market_input_snapshot_v4_trusted_total_scope_recovery_2026_10_19` for
future unlocked computations. Every existing locked payload retains exact
reader precedence and its original release tuple.

## Required proof before publication

- Pure provider regression: a complete Sportzino Total still triggers the
  targeted request and recovers the complete BetMGM pair.
- Existing multi-bucket, pagination, deadline, line-writer, prediction-record,
  and lock-safety suites remain green.
- `npm run verify:model-change`, TypeScript, and lint remain green.
- A zero-write current-board rehearsal reports exact before/after sides,
  grades, promotions, demotions, and actionable counts.
- Latest-main integration safety and protected pull-request checks pass.
- Post-deploy proof confirms the live market-input release, sole writer/lease,
  approved exact-price coverage for a future unlocked MLB Total when provider
  inventory exists, reader tuple coherence, and unchanged locked payloads.

Rollback restores the v3 recovery predicate for future unlocked refreshes.
Rollback must not rewrite, reinterpret, or relabel a v4 lock.

## Zero-write result

The October 19 production-input rehearsal fetched 68 canonical provider rows
in nine bounded calls and recovered 12 complete approved Total rows across
BetMGM, BetRivers, Circa, 1xBet, Pinnacle, and FanDuel. The authoritative
writer comparison changed only the Cleveland–Tampa Bay Total price from the
unapproved Sportzino context price of -133 to the approved Pinnacle price of
-122. The pick remained Over, the grade remained Watchlist, and edge moved
from -4.7 points to -2.6 points. Board counts remained two No Plays and one
Watchlist; promotions, demotions, and actionable counts were 0 / 0 / 0.

The audit performed zero writes. Its 1,000-row bounded locked-record sample
retained the identical SHA-256 fingerprint before and after the rehearsal:
`7ffba253b090b738513e0b67df2ffbabe28836375cb987b29a16babc51473a3f`.

Prepublication verification passed the 36-case targeted multi-bucket provider
suite, the 390-case prediction-record writer suite, speculative-bucket and
pregame-deadline safety suites, TypeScript, focused lint, and the complete
`npm run verify:model-change` gate. The full gate initially exposed an already
stale CFB source-shape assertion: the member reader had retained the required
Expected-score semantics while adding the explicit `illustrativeSample`
condition. The test-only assertion was updated to the current equivalent
expression; the CFB production contract and then the full model-change suite
passed without a CFB runtime change.
