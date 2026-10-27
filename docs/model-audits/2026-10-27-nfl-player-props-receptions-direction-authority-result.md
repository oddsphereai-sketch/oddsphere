# NFL player-props Receptions direction-authority result

Date: 2026-10-27
Starting production base: `3084ed45545ba8655b65b3e249993a4bb53dc0d1`

## Outcome

The candidate qualifies for future-unlocked NFL Receptions forecasts. It does not introduce an
Over quota or a generic anti-Under adjustment. The independent Receptions projection keeps
directional authority; target-book-excluded market evidence remains probability, coherent decimal
projection, exact-price, movement, and grade evidence while it stays on that independent side.
Every other prop market is numerically unchanged apart from its release identity.

## Exact chronological replay

The replay uses the exact locked canonical member lines from the current r32 model family. Week 6
is the selection block and Week 7 is the later confirmation block.

| Block | Incumbent | Candidate |
| --- | ---: | ---: |
| Week 6 predictions | 96-83 (53.6%) | 107-72 (59.8%) |
| Week 7 predictions | 98-64 (60.5%) | 97-65 (59.9%) |
| Combined predictions | 194-147 (56.9%) | 204-137 (59.8%) |

Combined Brier improves `0.24653` to `0.24278`; projected-reception MAE improves `1.52625` to
`1.50258`. Direction mix changes from 147 Overs / 194 Unders to 143 / 198. This is an accuracy
repair despite producing four fewer Overs.

The unchanged downstream grade formula was also reconstructed on the exact archived offers. Its
candidate actionables are 26-18 (59.1%) combined versus 5-4 (55.6%) incumbent. Week 6 is 19-9
candidate versus 3-1 incumbent; Week 7 is 7-9 candidate versus 2-3 incumbent. That confirmation
week remains noisy and is not represented as proof of a 60% actionable floor. It does show the
candidate expands the replayed sample while improving the combined actionable hit rate. The
individual chronological blocks are not presented as proof of a guaranteed accuracy floor. No new
grade threshold, quota, ranking rule, or direction preference is introduced by this release.

## Current unlocked board impact

The read-only Week 8 replay used the live r48 member snapshot generated at
`2026-10-27T19:29:26.407Z`.

| Metric | Incumbent | Candidate |
| --- | ---: | ---: |
| Total exact decisions | 520 | 520 |
| Best Angle | 0 | 2 |
| Lean | 12 | 10 |
| Watchlist | 27 | 27 |
| No Play | 481 | 481 |
| Total actionables | 12 | 12 |

There are seven Receptions forecast-side changes, two promotions, and two demotions. The board does
not flatten or expand. The two promotions are Overs and the two demotions are incumbent Unders, but
that is a consequence of the specific current offers; the full historical candidate becomes
slightly more Under, not more Over.

## Safety and rollback

- Locked rows retain the exact stored payload and reader precedence.
- Provider calls, query count, cadence, UI, copy, labels, sole-writer topology, and the shared
  `prediction_pipeline:nfl` lease are unchanged.
- The release is versioned across artifact, model, calibration, decision, runtime, board, member,
  lifecycle, writer, and tracking contracts.
- Read-only audit entry points:
  `scripts/operator/audit-nfl-player-props-market-arbitration.ts` and
  `scripts/operator/audit-nfl-player-props-receptions-release.ts`.
- Rollback applies only to future-unlocked evaluation. Never rewrite a prior locked record.
