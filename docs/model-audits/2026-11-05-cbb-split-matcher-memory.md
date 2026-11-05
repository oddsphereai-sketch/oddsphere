# CBB full-slate split matching: native-memory repair

Starting base: `48fc589f37272cd0640e59092e10ecec4665815b`.

The November 5 13:02 and 13:17 UTC normal writer invocations timed out at
300 seconds before member publication. The prior R33 board and all 148 existing
locked member payloads remained intact. PR #1020 adds fixed stage/elapsed logs to
the existing route and publisher without changing forecasts or provider work.

A strict read-only Node reproduction with saved fixtures/prices and existing
stored evidence reached its first deliberately blocked member write in about
15 seconds. This does not reproduce the production environment or its provider
latencies, and must not be reported as a successful live publication.

A separate full-slate resource reproduction isolated a concrete defect:
`decisionSplitContext.monthDay` constructed an ICU timezone formatter for every
source/fixture comparison. The captured 480-fixture / 128-source-game batch
peaked at 2,714,784 KB RSS locally, above the 2 GB production allocation. Native
ICU allocations do not produce proportional V8 heap pressure. Reusing one
immutable formatter with identical locale/options reduces the focused batch to
170,080 KB in the author run and 153,376 KB in independent review.

The fixture is the existing durable DraftKings public-data cache (feed clock
13:15:26 UTC, decision clock 13:17:33 UTC), plus the saved actual 480 provider
fixtures. This is a retrospective resource and semantic comparison, not a
point-in-time prediction evaluation. It makes no provider calls or production
writes. Both implementations produce exactly 40 matched games / 100 split rows,
with output SHA-256:
`be0cf6cee356e915df86bd3e2039aa8d3ee5b3662743825b2166a6c7628558ad`.

The regression verifies that exact pre-repair output, plus bounded ICU formatter
construction during the entire batch. This avoids flaky RSS/time assertions while
preventing the repeated native allocation. It is part of the existing full-D1
focused test and mandatory model-change gate.

The broader read-only publisher still peaked at 1,845,008 KB after the first
fix. The same native-allocation defect also existed in shared slate-date/hour
helpers, the DraftKings source-date matcher and the CBB card's two ET time formatters. R36 reuses those immutable
formatters too. Date results are never cached. All sports' timezone/DST/midnight
and board-roll outputs are compared against the original options; repeated
formatting must allocate at most four timezone formatters. Existing full-D1
reader/writer tests retain byte-exact locked payloads.

The final mutation-blocked full publisher profile reaches its first member
write in 10.34 seconds at 379,792 KB peak RSS. It uses saved provider fixtures
and current stored evidence; it still does not prove external-provider latency
or successful production publication. Date formatting regressions additionally
cover the shared DraftKings source-date fallback and invalid-date behavior.

Only publisher R36 advances. Independent/model/grade/adapter/quote/tracking
semantics remain those already reviewed for R35. No input or market signal is
removed. There is no promotion/demotion, score, probability, side, price or stake
change from this resource fix. The existing sole writer, sport lease, provider
budgets and normal cadence remain authoritative. Locked readers/writers are not
changed; the full-D1 immutability regressions still apply.

Before declaring the issue fixed, verify the deployed R36, normal refresh
completion, all 65 November 5 complete cards including the three reported games,
actual production reader behavior, and the unchanged hashes of all 148 existing
locks (10 from November 4). A successful offline resource test alone is not proof
that every production wait has been resolved.
