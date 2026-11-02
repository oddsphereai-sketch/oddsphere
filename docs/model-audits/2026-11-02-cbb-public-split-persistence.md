# CBB public consensus record continuity

Starting base: `baf5f9234c9dc1ec89cd2977c0861a517937cfb8`.

R9 preserves qualified named-book splits. The public-consensus lane was still
attached only in unlocked readers, so a future lock could lose captured public
evidence. Publisher r10 reads the same Playbook observation store once per
writer, scoped to unlocked candidate IDs and a 30-minute receipt window. The
existing 12,000-row/500-row-page bound refuses partial pagination. Source book,
type and league filters keep consensus separate from named-book splits. This
adds no provider call, schedule, alternate writer or new lease.

The existing pure public-pair resolver prepares DTO sections on the already
computed real candidate previews. Source clocks cannot be later than receipt,
and receipt cannot exceed the model cutoff. Both axes must be complete and
complementary; fractional source values become member percentages exactly once.
The sole writer persists those exact sections alongside named-book evidence.
If a source read omits a still-valid prior section, its original observation
may survive under the same age/quality rules. No timestamp is renewed.

Future locks freeze their existing published DTO, including both lanes.
Existing locked payloads return before enrichment and are never reconstructed
or augmented. The r2 stored schema stays compatible with older deployments.
Grade r2, board r5, forecasts, uncertainty, prices, selected sides, grades,
stakes and actionable counts remain unchanged; promotion/demotion impact 0/0.

At 16:42 UTC, a current-data read-only replay finds 908 existing source rows
and restores public consensus on 228 previously empty market panels. All 348
decision tuples and both locked payloads remain unchanged. A real improved
game (10882488) persists the exact source section through an in-memory writer.
The bounded bulk read takes 739 ms locally; the pure merge takes 163 ms. There
are zero provider requests or external writes in this proof.

Validate source/receipt/age/axis guards, original clocks, percentage units,
temporary omission, both-lane future-lock freezing, existing lock precedence,
source-data no-write replay, full model safety, affected tests/build/TS/lint,
clean latest-main protected PR and normal scheduled writer/live reader proof.
Rollback publisher r10 while retaining the r2 schema and every immutable lock.
