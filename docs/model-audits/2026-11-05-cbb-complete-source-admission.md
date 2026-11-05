# CBB whole-board source admission audit

Starting base: `ac13d4e11d3386819c5a4621db5161474497971c`.

The owner rejected the R36 populated-card result as complete Daily Edge coverage
and clarified scope: every game involving a verified Division I program, including
lower-division opponents. This repair addresses demonstrated source admission
and date-window defects, plus the observed history-query timeout. It does not claim the separate cross-division strength
or extreme-probability problem is resolved.

## Actual source findings

A read-only November 5 capture at 14:15:18 UTC contained 401 Owls book-event rows
(52 participant/start pairs). The matching audit used all 419 actual seven-day
fixtures, not only the three reported games. It found exact source spellings
`Jax State`, `N Illinois`, `Penn` and `California Polytechnic Mustangs` that did not
join to their verified schools. The fixture regression retains the actual native
prices, lines, bookmakers, timestamps, source events and named splits. The shared
collector/writer matcher now admits 90 coherent quote contracts and 32 split rows
across the four affected fixtures. Jackson State, Illinois State, Penn State,
California and other wrong schools remain distinct. Reversed orientation remains
supported; wrong-time and wrong-school quotes remain rejected.

The same audit found the final seven-day UTC capture ended too soon. The original
publisher requested UTC November 4–11, although late November 11 ET games occur
on UTC November 12. The raw source contains 67 November 11 ET fixtures while the
R36 board had 18. The existing two bounded fixture batches now also request the
following UTC day and then apply the unchanged exact seven-ET-day filter. The
actual-source publisher regression proves a late final-day game gets a forecast,
without adding a writer, provider endpoint, third batch, lock change or placeholder.

Direct current Owls odds/splits reads contained none of the three originally
reported lower-opponent matchups. BDL's exact-game-ID odds request returned zero
rows with no next cursor; stored DraftKings data also contained none. Those
results establish absence in these checked sources, not proof about every provider
or a license to synthesize sportsbook lines. Other missing-source and statistical
input cases must not be relabeled as name-matching failures.

## Model and lock boundary

Publisher R37, incumbent market-model R20, receipt R16, tracking R23, canonical
history R3 and the explicit identity
releases version the input admission change. Old R19/R15 anchors remain compatible.
No numerical score equation, grade policy, market consequence, freshness limit,
selected contract, writer lease, cadence or locked-reader rule is changed.

A fixed canonical-input functional comparison covers 43 games /129 markets:
68 Leans, 61 Watchlists, zero score/side changes, promotions or demotions. This
proves canonical semantics remain unchanged; actual newly admitted raw inputs
may appropriately change future unlocked market reads. It is not an accuracy
backtest or current-board performance claim.

## Unresolved input issues — not covered by this operational repair

The 22 November 5 cross forecasts are explicitly held by the forecast-only policy,
not evaluated by the incumbent D1 numerical reader or grade policy. Their extreme
normal-tail probabilities are not an established 99.9% reliability level.
Seventeen opponents have actual D1-cross history after including the current
training receipt; five do not: Kalamazoo, King's PA, Central Bible, Arkansas–
Monticello and Centre. Primary official prior-season statistics exist for these
schools. At least 16/22 lower opponents have verified full official team/opponent
box totals that the present cross model does not ingest.

These same-level statistics need a learned, tier-aware bridge into D1-relative
offense/defense/tempo with parameter and prediction uncertainty. Raw PPG cannot
be substituted for D1 efficiency. The 229 selected D1-home cross wins do not
identify the extreme upset tail; a broader cross-game corpus and measured tail
uncertainty are separate work. Do not remove the existing holds or claim a full
model improvement merely because source matching succeeds.

Grace University is a first-year California program according to Southern Utah's
official preview; its verified current Utah Tech box already enters the training
receipt. Do not join its provider `Lancers` label to Grace College or an older
university to fabricate prior-year history. November 4 locked public records
remain unchanged.

## History and release migration proof

The full 414-game in-memory publication reproduced an eight-second PostgreSQL
statement timeout in the filtered price high-water query. The existing V57
service-only STABLE event-indexed maximum returned in 781ms. CBB now reuses that
maximum only as an upper bound, retaining every original event, league, provider,
book, fetched-at and inserted-at filter on the actual pages. Professional and
retail contexts retain separate budgets; both reuse one watermark. A bounded
final probe proves completion when a broader watermark lies outside an exact row
cap. A missing-function rollback retains the prior filtered lookup. No migration,
retention change or extra collector is added.

The subsequent complete in-memory writer finished in 13.6 seconds at 448.6MB
maximum RSS with no price/split history warning. It published 414 complete cards;
four source-incomplete future fixtures remain internal. This was zero production
writes and zero provider calls using saved source payloads. The current 4.51MB
JSON board now uses a lossless streamed response with negotiated gzip; a 500-copy
actual member-payload test proves every serialized field survives exactly for
both gzip and identity clients, with unchanged private-cache headers. No card or
evidence is removed to fit the buffered function limit.

Independent review identified and corrected an R19 locked-release allowlist gap
introduced by the R20 constant bump. A captured real R19/R15 member payload is
frozen only in a local harness; R23 tracking retains exact old identifiers,
validates its receipt, remains idempotent and the writer/reader preserve its
bytes. New R20 tracking has a distinct model label.
