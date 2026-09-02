# MLB FI forward named-book evidence capture

Date: 2026-09-02

## Scope

Phase A adds forward-only diagnostic provenance to the existing MLB
first-inning named-book market baseline. The schema identifier is
`fi_named_book_evidence_capture_v2`.

The capture is bounded to the fixed supported named-book universe: three sharp
books and fifteen retail books, for at most 18 deterministic per-book records.
It persists the exact current no-vig pair, source class, evaluation-book
identity, target-exclusion identity, and any coherent same-book opening
context already consumed by the incumbent path.

## Timestamp truth

An incumbent-accepted current pair is explicitly marked either
`timestamped_fresh` (with older-side age in minutes and pair skew) or
`accepted_missing_timestamp`. The latter remains accepted only because the
pre-existing v5 compatibility rule accepts a missing `fetched_at`; it is not
fresh timestamp evidence and carries null age/skew/observed-at values.

For supported named books with no incumbent-accepted current pair, the capture
contains one bounded diagnostic exclusion record. Its reason identifies stale,
future, invalid timestamp, greater-than-two-minute pair skew, or one-sided/
invalid-price eligibility failure. This is book-level provenance, not a
complete per-row history: an excluded older or alternate row is not emitted
when the same sportsbook has an accepted current pair.

## Behavioral boundary

This capture adds no market eligibility, posterior, decimal projection, side,
grade, price, stake, writer, lease, provider, route, database-schema, or
reader behavior. The current v5 forecast consensus and exact evaluation quote
are unchanged. Focused fixtures prove accepted missing timestamps preserve the
incumbent directional probability, projected first-inning runs, pick, and
grade, while stale/future/invalid/skewed evidence preserves the incumbent
no-market outcome.

The records are forward-only diagnostic evidence. No historical rows are
backfilled or relabeled, and this behavior-neutral capture does not bump an
MLB model or registry release.
