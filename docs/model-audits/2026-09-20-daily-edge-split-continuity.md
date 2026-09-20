# Daily Edge split continuity repair — 2026-09-20

This is a display/data-continuity repair. It does not change predictions,
probabilities, grades, promotions, stakes, tracking, or model releases.

## Production evidence before the repair

- SharpAPI `/splits`: NFL 0 rows; NCAAF 2 rows for one matchup; MLB 4 rows,
  including complete Circa/DraftKings pairs for one matchup and incomplete
  BetMGM tickets-only rows for two matchups.
- The current CFB member snapshot exposed only one split market for the
  matchup whose provider rows contained complete moneyline, spread, and total
  pairs.
- Durable DraftKings Network snapshots retained complete rows for two NFL,
  two MLB, and three WNBA events. Exact-match dry runs proved those rows match
  the corresponding member boards.

## Repair contract

- One cached, bounded SharpAPI request per sport at the shared Daily Edge
  response boundary; never one request per card.
- Exact sport, date, away-team, and home-team identity is required.
- Each displayed market requires complete, complementary handle and ticket
  percentages for both sides.
- Current complete book priority is Circa, DraftKings, then BetMGM.
- A non-empty provider response is stored in `lab_response_snapshots`.
  An empty/error response cannot overwrite the last verified snapshot.
- Last-known-good maximum age is eight days for weekly sports and 36 hours for
  daily sports. Rows older than their 15-minute freshness window remain
  visibly stale rather than masquerading as current.
- The SharpAPI and DraftKings Network reads execute concurrently, keeping the
  cold-path deadline bounded by the slower existing source rather than adding
  the two timeouts together.

## Verified board impact

- CFB live dry run: Liberty at Coastal Carolina improved from one split market
  to three complete Circa-priority markets.
- MLB live dry run: seven games retained or gained complete named-book split
  panels; incomplete tickets-only rows remained withheld.
- NFL live dry run: SharpAPI still returned zero rows. The retained
  DraftKings Network snapshot populated all three markets for two open games;
  two locked games retained their previously captured Circa panels.

Focused split tests, CFB production contracts, NFL member fixture contracts,
Daily Edge presentation contracts, ESLint, and TypeScript validation passed.
