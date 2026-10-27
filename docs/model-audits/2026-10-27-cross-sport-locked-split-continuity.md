# Cross-sport locked split continuity

Date: 2026-10-27  
Owner direction: stop the member-visible Owls Sharp Book Splits from disappearing as NBA, NHL,
CFB, and other supported Daily Edge games lock.

## Incident

The Owls provider feed remained healthy. The shared durable overlay kept only the newest row for
each event and sportsbook. After a game locked, the next provider refresh replaced its pre-lock
row with a post-lock row. The immutable reader correctly rejected that newer row, but no longer had
the earlier observation needed to fill a display field that had never been stored in the lock.
The separate continuity reader also skipped every locked game. The combined behavior removed the
Sharp Book Splits panel across sports as the slate entered lock.

## Correction

- The Owls durable feed retains up to 96 timestamped observations per event and book instead of
  overwriting the preceding row.
- Open cards still select the newest complete observation.
- A locked card may select only the newest complete market-specific observation at or before its
  immutable `lockedAt` timestamp, and only when both stored split fields are absent.
- Existing stored locked sections retain exact precedence. Post-lock observations fail closed.
- A restored section is marked `locked_prelock_reconstruction` and retains its proof timestamp.
- The reconstructed display section is not mirrored into a locked recommendation decision or the
  market reader, and it cannot alter a prediction, probability, evaluated price, grade, stake,
  lock, or tracking record.
- The same constraints now apply to the existing exact-game continuity snapshot on every supported
  Daily Edge sport, not only the CFB detail route.

Member presentation advances to
`daily_edge_member_presentation_2026_10_27_r31_cross_sport_locked_split_continuity`.

## Production-snapshot rehearsal

Read-only application of the candidate to the exact stored production payloads produced:

| Sport | Continuity games | Populated markets | Locked games restored | Post-lock rows admitted |
| --- | ---: | ---: | ---: | ---: |
| NBA | 4 | 12 | 3 | 0 |
| NHL | 11 | 33 | 7 | 0 |
| CFB | 48 | 106 | 0 | 0 |

The CFB DEL@WKU row was the event that exposed the defect. Its previously documented complete
Circa observation at `2026-10-27T21:44:55.596Z` was already overwritten by later polling before
this history-preserving release. The bounded post-deploy recovery operator restores that exact
documented observation to the Owls evidence snapshot without modifying the locked CFB fixture.
It validates the current Owls event identity and the `21:44:55.596Z <= 22:00:15.640Z` cutoff before
writing, and is idempotent.

Focused tests prove open-card newest-row selection, locked pre-cutoff selection after a post-lock
refresh, rejection of post-lock continuity, existing-lock precedence, and locked decision
immutability. Full `verify:model-change` completed with zero failures.

## Rollback

Roll back presentation r31 if an observation after lock is rendered, an existing stored section is
replaced, a reconstructed proof timestamp is absent, history grows beyond the per-event/book cap,
or any locked decision field changes. Preserve the append-only evidence and immutable locked
records during rollback.
