# EPL public locked-payload precedence — October 31, 2026

Starting base: `4919d9fdd37174f4135ec0b04c1bca81e12dedb3` (PR #894).

Before the first eligible EPL publication, a zero-provider-call, zero-write
preflight combined the frozen source response with the production immutable DB
cohort and the actual snapshot-writer precedence function. The verified-DB bypass
preserved prices and the soccer projection but replaced the already public
Chelsea–Manchester United card's `breakdown`, `generatedAt`, `predictions` and
`soccerAvailability`. This violates the owner's locked-record immutability rule.
No correction/replacement of those stored public fields is authorized.

Member lifecycle r8 removes that bypass. An existing locked public payload retains
all wager/prediction/evidence fields exactly, including legacy or apparently corrupt
values. Only the incumbent explicitly allowed official fixture/result metadata
may update. An absent/unlocked public card may still acquire its first lock from
the verified immutable DB cohort. Existing DB records are never changed.

Model/calibration remain r23/v28. There are zero changes to unlocked forecasts,
probabilities, sides, prices, grades, stakes, provider calls, budgets, cadence or
writer leases. The shared helper's ordinary/UCL behavior is unchanged because
the bypass was only exercised by EPL's verified-ID option.

Regression coverage reverses the former unauthorized corrupt-lock correction
test: even an exact verified DB tuple cannot replace an existing public value.
It also proves preservation of markets, projection, predictions and breakdown,
and that neither input payload is mutated. The real stored-cohort preflight must
return no changed locked wager/evidence fields before the live refresh.

Required checks: focused EPL immutable-lock and shadow suites, full model-change
verification, TypeScript, focused lint, production build, clean current-main
integration and protected PR/tree proof, then live publication/release/quote-age/
coverage and exact locked-field comparison. Rolling back r8 would restore the
forbidden replacement behavior; preserve all stored locks during any rollback.
