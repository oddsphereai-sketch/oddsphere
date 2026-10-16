# NFL player props research offer-universe live audit

Date: 2026-10-16

Mode: bounded read-only provider replay; no persistence

## Result

The additive archive contract passed its focused timing, exact-price, alternate-line, limit, checksum, immutability, idempotency, failure-isolation, writer-ordering, and zero-provider-dependency tests. It remains internal and cannot publish a prediction, grade, stake, or member row.

The live Week 7 provider check at `2026-10-16T10:55:03.355Z` did **not** pass a data-availability gate:

| Item | Result |
|---|---:|
| Scheduled games | 14 |
| BALLDONTLIE requests | 29 |
| SharpAPI requests, including the existing conditional reference lane | 18 |
| Normalized retail observations | 0 |
| Normalized reference observations | 0 |
| Exact offers | 0 |
| Six-family archive rows | 0 |
| Persisted rows | 0 |

BALLDONTLIE returned an empty player-props board. SharpAPI's generic catalog reached its bounded page ceiling before producing an in-slate offer, and the Pinnacle/NoVig reference queries also produced no normalized in-slate observations. Therefore there were no books, lines, side prices, or provider timestamps to validate for Passing Touchdowns, Longest Pass, Longest Reception, Longest Rush, Field Goals Made, or Kicking Points at that hour.

## Decision

Keep the archive implementation eligible for an internal capture release because it adds no provider calls and is the mechanism needed to stop losing future exact-offer evidence. Do not expose any of the six markets. Data availability remains a fail-closed runtime fact: an empty provider board produces zero archive rows and zero new market authorization.

The next scheduled writer cycles can capture provider openings and T-24/T-6/T-60 observations once the existing feeds actually post them. The archive accepts both the retail exact board and only those source-aware reference offers fetched in the same writer cycle; it never promotes a retained stale reference cache into a new landmark.

Storage for the empty validation envelope was 370 JSON bytes and 225 gzip bytes, against hard ceilings of 48,000,000 and 4,000,000 bytes. The live audit itself performed no database write.

The per-family provider matrix is recorded separately in
`docs/model-audits/2026-10-16-nfl-player-props-provider-family-availability.md`.
