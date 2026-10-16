# NBA member market-evidence display audit — 2026-10-16

## Scope and authority

This change repairs the NBA member reader only. It exposes the already-loaded,
source-qualified market evidence that the professional reader consumed. It does
not change a projection, pick, probability, grade, stake, tracking tuple,
market-reader rule, writer, release identifier, refresh job, or lease.

Locked game DTOs retain exact stored precedence. New market-evidence fields are
constructed only for unlocked games and are not attached when the adapter has no
unlocked evidence object.

## Public consensus

Playbook `multi_book_consensus` is the sole public-consensus source. A row is
renderable only as a complete two-sided capture for the exact game and market,
with both ticket and money percentages present and each pair summing to 100%
within tolerance. No sharp-book row can enter the public panel.

The 2026-10-16 rolling NBA board contained 16 games and 48 game-market cells.
All 48 cells had a complete coherent Playbook pair. This audit grants display
authority only. NBA public splits remain ineligible to change model output or
grades pending immutable forward validation.

## Sharp-book hierarchy

The separate member panel follows one silent source hierarchy:

1. A complete current Circa pair.
2. If Circa is absent, a complete DraftKings or BetMGM pair, choosing the newest
   complete approved fallback.
3. If Circa is retained but stale, a newer complete fallback may fill the panel.
4. When complete current Circa data resumes, it automatically reclaims priority.

Every displayed pair must come from one provider, one named book, one ingestion
capture, one game, and one market. Partial sources are never mixed. The member
label remains `Sharp Book Splits`; the selected book is retained only as internal
provenance.

On the audited board, 22 of 48 game-market cells had a complete named-book pair,
all via DraftKings because no complete current Circa pair was present. Five cells
had partial named-book data and 21 had no named-book snapshot yet. Those cells
render honest limited/pending copy rather than relabeling Playbook as sharp data.

## Price and line movement

Selected and opposing price trails use the same named sportsbook. Spread and
Total point-line history remains separate from price history. Current-only rows
may render as current quotes, but they cannot manufacture an opener or a move.
The audited board exposed selected and opposing trails for 45 of 48 markets.

## Verification

- `scripts/test-nba-member-market-evidence.ts`
- `scripts/test-nba-splits-provenance.ts`
- NBA professional reader, candidate, display-separation, coherent-price,
  rolling-slate, site-wiring, and locked-snapshot tests
- `scripts/test-daily-edge-experience.ts` (216 passed)
- `scripts/test-lab-daily-edge.ts` (252 passed)
- TypeScript `--noEmit`
