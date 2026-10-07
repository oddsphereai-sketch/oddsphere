# CFB held-price T-60 accuracy lock

## Scope

This operational release changes only the immutable lock/tracking classification for a complete
CFB T-60 forecast whose exact-price markets are all held because a canonical target quote is not
available. It changes no score, probability, predicted side, line, price, grade, actionability,
stake, provider request, cadence, member copy, label, or layout.

## Production incident and evidence

Southern Miss at Troy was scheduled for `2026-10-07T00:00:00Z`. The sole CFB forward-evidence
writer captured a complete on-time T-60 payload at `2026-10-06T23:10:04.623Z` (10.077 minutes
after the nominal boundary). The payload contained all three published directions—Troy
Moneyline, Southern Miss +9.5, and Under 51.5—with no model-input health hold. Exact-price
decisions were held only because the permitted target quote was unavailable.

The existing accuracy-lock predicate recognized the same complete no-economics tuple only when
the entire market anchor was unavailable. It therefore left this valid T-60 card marked missed
and delayed its accuracy-only tracking recovery until kickoff. The existing recovery path then
inserted all three rows idempotently with `locked_at=2026-10-06T23:10:04.623Z`, proving the
forecast tuple itself was complete and immutable.

## Repair

The accuracy-lock predicate now also accepts a complete current-release T-60 payload when:

- publication is enabled and exact-price tracking is disabled;
- all three finite directional outlooks and required Spread/Total lines are present;
- there are zero evaluated bets and exactly three held markets;
- there are no model-input health holds; and
- the authoritative forecast completed the released sport-specific market reader.

The lock remains accuracy-only No Play tracking. It cannot reconstruct a sportsbook price,
market probability, edge, EV, grade, actionability, or stake. Any model-input health failure
continues to fail closed. Existing immutable rows are never rewritten.

## Board impact and rollback

On identical input this is zero side changes, zero score/probability changes, zero promotions,
zero demotions, and zero actionable-count change. It advances only the lock/tracking lifecycle
from post-kickoff recovery to the existing T-60 writer run. Roll back writer r99, fixture r74,
snapshot r34, reader r19, and tracking record r36 together to the preceding r98/r73/r33/r18/r35
set; retain every immutable tracking row.
