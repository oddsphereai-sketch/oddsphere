# UCL exact-contract movement and original quote clocks

Starting base: `dbccb90b3e3561ffbe759f878f60464fefda80bc` (PR961).

The owner requested immediate actual market-reader repairs and independent AI
spot checks. Two independent read-only reviewers confirmed the source-native
repair and identified these further functional defects, without new provider
calls or retrospective outcome tuning.

`binaryMovement` used stored totals of any line as an opening2.5 probability,
and could use a capture newer than the current pair's original quote. Either
could falsely invent resistance and veto an otherwise qualified correction.
The reader now requires the exact contract (Total2.5 or line-free BTTS), same
physical book, complete nonconflicting capture, valid American prices and
plausible two-way hold. Its baseline receipt must strictly precede both current
outcomes' original clocks. Identical duplicate rows remain idempotent; a
conflicting capture is quarantined without suppressing later genuine history.
Legacy history does not acquire a guessed native provider identity or causal
money-flow claim. Static consensus remains a separate input.

The current Owls adapter stamped every UCL market with the book timestamp.
Four actual DraftKings H2H markets in the frozen18-game receipt have older
explicit market clocks, by4–16 seconds. UCL now preserves and validates the
explicit market clock; book time is used only when market time is absent.
An invalid/stale/future explicit market clock cannot be freshened by its book,
and a fresh explicit market clock is not discarded because unrelated book
metadata is unusable. EPL's existing source path remains unchanged.

Release family: model R15, calibration R18, outcome R8, score R6, member R13;
current-provider source R4. Equations, probability/grade floors, source-count
policy, stakes, jobs, request ceilings and the sole leased soccer writer remain
unchanged. Exact retained locked payloads take precedence over new semantics.

Tests reproduce both false-veto directions and genuine resistance, foreign
whole/quarter lines, mixed contracts, later/equal original clocks, invalid
prices/hold, conflicting duplicates and recovery from a later genuine baseline.
The actual receipt exercises all four clock differences and the complete native
identity regressions. Existing symmetric Lean/Watch/NoPlay rules and writer/
reader lock contracts remain tested; no promotion or demotion rule is added.
These are evidence correctness repairs, not an accuracy claim. At the frozen
native source, no binary market reaches the existing three-alternative policy;
therefore its newly corrected history veto cannot change those source-only
binary outcomes. Full normal production board impact is verified separately.

Known separate product limitations remain explicit: native main Total contracts
are commonly3/3.25/3.5 and cannot be relabeled2.5; the existing reader/persistence
only accepts2.5, the binary consensus gate can leave received evidence unused,
and the current grade policy has no Best Angle branch. A future settlement-aware
main-line inference/grade policy is a separate change, not smuggled into this fix.

Publication requires focused/full safety, TypeScript/lint, production build,
fresh-main overlap/ancestry, protected PR and exact remote tree checks. Verify
normal live releases, source prices, forecasts/grades and216 prior locked
records×40 immutable fields after publication. Do not overwrite a lock or
force a forecast flip for variety or a deadline.
