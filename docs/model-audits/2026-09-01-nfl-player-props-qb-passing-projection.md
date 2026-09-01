# NFL Player Props QB Passing-Yards Projection Repair

Date: 2026-09-01  
Status: production candidate; no provider, cron, writer, or database mutation was used for this evaluation.

## Chronological projection result

The exact-price 2025 quarterback passing-yards cohort uses the existing training-through-2024 artifact and deduplicates player/game observations before scoring.

| Window | Rows | Incumbent MAE | Incumbent bias | Market-line MAE | Candidate MAE | Candidate bias |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| Selection, before 2025-11-01 | 207 | 70.34 | -27.61 | 53.23 | 53.56 | -1.21 |
| Confirmation, from 2025-11-01 | 237 | 70.02 | -31.09 | 54.35 | 54.73 | -0.70 |

The candidate is not claimed to beat the mature closing market. It repairs a severe negative projection bias while retaining 10% independent recent-role context instead of copying the line. The improvement repeats in the untouched later confirmation window. No outcomes were used to choose Week 1 sides or grades.

## Frozen Week 1 board result

Inputs:

- exact offer board SHA-256 `32528c7cbecdcc50ab43975f304820d1fa8e1e56e9d6948a03ce6dd1d8cfe4e4`
- incumbent board SHA-256 `ec51079c6156f06524e32b2756192742c1553f9c72e8ac3b80235103d32c009e`
- provider observation SHA-256 `8da56148510ad9edf7ff4cbb3e39be9b16077c9b7796036f66cf191c07f4edb3`
- inference context SHA-256 `a767c997e877832cfc703414656286d6029c61ddfc2af5fa9386ab391160a460`
- candidate board SHA-256 `bb51cb012fb1a52239ff53e8e705cb2228258c3a170b3d2b662e43ab808c5a94`

The 1,040-row board contains 122 quarterback passing-yards outcomes and 918 other outcomes. All 918 non-passing rows are byte-identical to the incumbent decision rows.

| Grade | Incumbent whole board | Candidate whole board | Delta |
| --- | ---: | ---: | ---: |
| Best Angle | 4 | 4 | 0 |
| Lean | 23 | 23 | 0 |
| Watchlist | 77 | 80 | +3 |
| No Play | 879 | 876 | -3 |
| Held | 57 | 57 | 0 |
| Actionable | 27 | 27 | 0 |

Passing yards changes from 1 Watchlist / 121 No Play to 4 Watchlist / 118 No Play. Four independently supported, positive exact-price Over signals become Watchlist: Cam Ward 201.5, Geno Smith 203.5, Lamar Jackson 217.5, and Bryce Young 206.5. The incumbent Brock Purdy Under 245.5 Watchlist is correctly demoted because its old signal came from the implausible 166-yard projection and current movement is adverse. This is four promotions and one demotion, net +3 Watchlists, with zero new action grades and zero stake changes.

The passing projection range moves from an implausible 35.11–253.30 yards to 188.16–278.35 yards. Each Watchlist retains its target sportsbook, exact line and price, target-book-excluded translated benchmark probability, positive offered-price EV, and movement state. A different-line benchmark is capped at Watchlist; Lean/Best Angle still require the unchanged same-line independent action gate.

## Load, authority, and failure behavior

Provider calls change by zero. Database reads/writes, tables, cron schedules, snapshot size bounds, settlement limits, and the 48-call collection ceiling are unchanged. The existing `nfl-forward-evidence` endpoint remains the sole writer under `prediction_pipeline:nfl`; publication remains atomic and preserves the last coherent snapshot on failure. Locked and settled rows remain immutable.

Rollback triggers are mixed current-slate release identifiers, any changed non-passing decision, an actionable-board collapse, missing exact prices presented as normal evaluations, writer/reader failure, lease conflict, or member/stored tuple incoherence.
