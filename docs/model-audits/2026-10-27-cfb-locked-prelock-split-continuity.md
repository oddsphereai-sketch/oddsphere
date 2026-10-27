# CFB locked pre-lock split continuity

Date: 2026-10-27  
Owner direction: restore the missing WKU–Delaware Sharp Book Splits without corrupting the locked
CFB card or allowing values to disappear at T-60.

## Incident evidence

- The current Owls CFB feed still contains the exact Delaware Blue Hens at Western Kentucky
  Hilltoppers event.
- Owls/Circa captured complete Moneyline, Spread, and Total money-plus-ticket pairs at
  `2026-10-27T21:44:55.596Z`.
- The authoritative card locked at `2026-10-27T22:00:15.640Z`.
- The compact locked fixture contains the three healthy writer decisions but no stored
  `sportsbookSplits` section. Its existing review flag records the preceding SharpAPI event omission.
- The shared display overlay skipped every locked card, so it could not render the separately
  persisted pre-lock Owls observation.

## Bounded correction

The default overlay still skips locked cards. Only the authenticated CFB reader opts into missing-
field reconstruction, and the candidate row must satisfy all existing exact sport/date/team,
orientation, completeness, complement, and named-book gates plus these additional constraints:

1. `lockState` is locked and `lockedAt` is valid.
2. Both the response-boundary and writer-owned sharp sections are absent.
3. The market-specific Owls observation timestamp is less than or equal to `lockedAt`.
4. The result is marked `locked_prelock_reconstruction`, keeps the proof timestamp, and is rendered
   as `Pre-lock evidence` / `Captured before lock`.
5. The result is never mirrored into the locked recommendation decision or market reader.

An existing locked sharp section retains exact precedence. A post-lock observation returns zero
populated markets. No database row is changed.

## Production rehearsal

The read-only rehearsal against the live CFB compact snapshot and durable Owls feed produced:

- exact game: `cfb-457767`, `DEL@WKU`;
- matched games: 1;
- populated presentation markets: 3;
- Circa timestamp: `2026-10-27T21:44:55.596Z` for all three markets;
- Moneyline: DEL 96% money / 40% tickets; WKU 4% / 60%;
- Spread: DEL 3% / 41%; WKU 97% / 59%;
- Total: Over 44% / 53%; Under 56% / 47%;
- locked decision JSON unchanged: true.

## Impact and rollback

Predictions, sides, probabilities, projections, exact prices, grades, actionability, stakes, locks,
tracking records, stored evidence, writers, schedules, provider calls, and leases are unchanged.
Promotions, demotions, and actionable-count changes are zero by contract.

Roll back presentation r30 if a post-lock observation is displayed, a non-exact game matches, an
existing locked section is replaced, the pre-lock label/timestamp is absent, or any locked decision
field changes.
