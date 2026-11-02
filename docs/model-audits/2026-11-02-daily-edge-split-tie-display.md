# Daily Edge split-tie display correction

Starting production base: `f397cdb8360a3edf13ca6c5a06976e5f9fb62e0f`.
Separate branch `codex/split-tie-neutral-20261102`; the unqualified CBB model
candidate in PR938 is not part of this change.

Live source-owner report: WEB@ORST has exactly50/50 money and50/50 tickets at
the named book, yet the reader displays “Money → WEB” and cross-source sharp
direction. Both local leader helpers sorted equal values and selected the
first provider row. A tie therefore acquired an arbitrary direction.

One shared UI helper now returns a leader only for a unique published maximum.
Exact raw percentages, side labels, source clocks and stored signal stay exact.
Money and tickets remain separate axes: a ticket lead cannot become a money
label; absent/tied axes cannot produce “Sharp null”; source conflict requires
comparable money-versus-money or tickets-versus-tickets direction.

This is correction of derived presentation, not a stored-record migration.
There is no DTO, snapshot, writer, projection, probability, pick, grade, price,
stake, model input, provider call or cadence change. The helper has only UI
consumers. Legacy locked fields and stored qualitative source signals are not
recomputed, overwritten or suppressed. Existing source rows render unchanged;
only unsupported derived leader claims disappear. Independent read-only review
confirmed this distinction under the locked-record protocol.

Focused regression: `node --import tsx scripts/test-market-split-ties.ts`.
It covers two- and three-way ties, row order,0/0 and null values, genuine
unique leads, asymmetric money/ticket axes, source comparisons and immutable
frozen evidence. Existing CBB store tests cover writer immutability and reader
precedence; the production build, TypeScript and affected ESLint are required.

The broad historical `test-lab-daily-edge.ts` also reports a pre-existing source
string assertion (`hidden scroll-mt-4 sm:block`) absent on both baseline and
candidate, plus unavailable historical MLB API/database fixtures under local
network restrictions. It is not reported as green. The focused split tests
directly exercise the repaired shared display logic.

Fresh-main integration, clean integration safety, required protected-PR checks,
verified local/remote tree and affected live reader behavior remain publication
gates. No restored coverage or complete forecasting-health claim follows from
this display correction.
