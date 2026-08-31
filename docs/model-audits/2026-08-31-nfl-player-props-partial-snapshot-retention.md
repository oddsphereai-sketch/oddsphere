# NFL player-props partial snapshot retention

Date: 2026-08-31

## Scope and authority

- Sport/market: NFL player props, member publication completeness only.
- Sole writer: `app/api/cron/nfl-forward-evidence/route.ts` through `runNflPlayerPropsProductionWriter`, under `prediction_pipeline:nfl`.
- Changed releases: member snapshot r8 to r9; writer r9 to r10.
- Unchanged releases: distribution model r2, calibration r2, decision r3, runtime r3, board r6, tracking r5, and settlement r3.
- No provider, query, cron, model-input, probability, projection, side, grade, stake, lock, or tracking change.

## Production defect

A natural successful provider cycle published only four games and replaced a prior twelve-game coherent member snapshot. Member coverage fell from 320 exact-price reads at approximately 2:36 p.m. EDT to 128 at 3:36 p.m. EDT. The reduced snapshot contained 10 passing-yards side rows, representing approximately five quarterbacks, and 94 displayed player markets. This was not a UI filter or grade-filter effect.

The writer already preserved the previous snapshot when collection threw. It did not distinguish a complete successful response from a successful partial response. Reconciliation therefore dropped every prior unlocked row absent from the latest response.

## Frozen repair contract

For an unlocked prior decision absent from the current response:

1. Retain it only when no current decision exists for the same game, normalized player, market, and side.
2. Retain its complete prior exact tuple only while `evaluatedAt - observedAt` remains within the existing six-hour production quote-age limit.
3. Retain it only before T-60 and before kickoff.
4. Let any current row in the same outcome scope replace it, including a changed line, sportsbook, price, or economics.
5. Continue to expire stale rows and preserve the existing T-60/locked/tracking rules unchanged.

This permits current games to refresh while an omitted game or market retains a still-valid exact quote. It cannot manufacture a prop, extend the established freshness budget, duplicate an old line after a line move, or make an unavailable stale quote actionable.

## Board impact and rollback

The intended impact is availability restoration only: current decisions remain byte-for-byte authoritative, while still-fresh omitted outcomes no longer disappear during a partial cycle. Grades and actionable counts for retained rows are exactly their preceding published values; there is no promotion or demotion rule. Provider calls and database writes remain unchanged.

Rollback is member r8 / writer r9. Locked rows and immutable tracking records are unaffected by either direction.

## Verification

The focused production-contract regression covers:

- a successful partial response retaining an omitted still-fresh quarterback outcome;
- a current line move replacing the prior line without duplication;
- an omitted quote expiring at the existing freshness boundary;
- unchanged T-60 freeze, lock retention, tracking, closing-price, settlement, one-writer, and member-reader contracts.
