# Locked prediction-market chart continuity

Base: `6c7c805e620e2c3013c8d2cae5042914a46e22ae`.
Owner report: locked JMU -19.5 prediction-market comparison was empty.

## Root cause verified against stored production receipts

JMU/Troy, event 458441, locked at 2026-10-29T22:30:49.465Z.
The immutable DraftKings -19.5 trail already contains -112, -108, -110,
and the locked -110 endpoint. The previous -110 observation was at
2026-10-28T22:30:03.750Z: 24 hours and 45.715 seconds before lock.
The legacy rolling 24-hour chart filter discarded it and every earlier
point, leaving just the endpoint at 22:28 on October 29. The exact eligible
pre-lock Kalshi spread receipt ended at 18:30:49.995Z. The resulting
one-point sportsbook trail had no overlap with Kalshi, so no graph drew.
Its auxiliary book archive was Circa, not DraftKings, and correctly could
not replace or be spliced into the stored DraftKings trail.

## Repair and invariants

- Only when an actual eligible pre-lock chart receipt exists, render all
  exact observations already stored in the immutable public tracker payload.
  Keep the same book, side, threshold, price, original timestamp and endpoint.
- Existing locks without a valid pre-lock receipt keep their legacy behavior.
  No retrospective provider download or reconstruction of missing evidence.
- Future auxiliary captures use the actual public tracker book and retain
  its published history even if optional provider backfill is unavailable.
  Internal sharp-book preference cannot override that displayed source.
- Prioritize that public book's optional opening backfill inside the existing
  discovery/history cycle and daily request limits. Held forecasts can supply
  history direction, as the existing display selector already permits.
- Preserve exact-contract/nearby-contract distinction and the shared real
  overlap window. No post-lock values, false matching handicap, or synthetic
  quote receipts are introduced.
- No model, grade, pick, probability, price, stake, split, reader decision,
  writer, lease, model release, or locked database payload changes.

## Verification before publication

Read-only production replay at 2026-10-30T02:02:47.291Z examined current
snapshots across eight supported sports (207 retained game DTOs). All source
payloads remained byte-for-byte unchanged. Existing valid shared locked
charts were preserved: NFL 2/2, NBA 9/9, NHL 33/33; CFB improved 4 to 6.
Recovered JMU spread has four exact DraftKings observations and 271 Kalshi
points, with one common chart window from October 28 19:15:03.149Z through
October 29 18:30:49.995Z. North Texas moneyline also recovered. Missing
historical/provider evidence is not invented to fill remaining legacy gaps.

All 13 prediction-market test scripts pass, including the exact JMU failure
fixture, full older stored history, both rendered source paths, shared guide
boundaries, same-book capture for CFB/NFL/NBA/NHL/WNBA, locked writer identity,
legacy precedence, and rejection of post-lock receipts/quotes. TypeScript and
the full `npm run verify:model-change` suite pass. The optional local PostgreSQL
proof is skipped when its URL is absent; the existing CI proof remains intact.
New focused CI runs the whole prediction-market regression suite on relevant PRs.

Rollback is a code revert of this display-only patch, never a locked-row rewrite.
