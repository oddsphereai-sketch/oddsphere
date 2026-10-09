# CFB The Odds API live continuity — writer r108

## Scope

This is an operational continuity repair. It does not change the CFB independent forecast,
market-reader coefficients, side, score, probability, grade, stake, member copy, layout, lock
boundary, or tracking tuple.

## Live read-only finding

At `2026-10-09T18:25Z`, the active board contained 86 games and all 86 had verified paired
Moneyline, Spread, and Total markets. The paid FCS fallback contributed complete paired markets to
26 games; 25 had a retained operational opening from The Odds API and one had a retained verified
CollegeFootballData opening. Twenty-five of the 26 games had more than one distinct stored quote
state. The account header retained 12,435 credits.

The audit also found two continuity defects:

1. A 25-game market-history projection still intermittently exceeded the database statement
   timeout. The `18:24Z` writer failed before reaching provider collection.
2. The request budget combined historical-opening calls with current-price calls. A 60-credit
   historical recovery could therefore postpone the due hourly current pull, and a game with a
   valid non-The-Odds-API opening could remain eligible for repeated historical recovery.

## Repair

- Preserve the identical ordered, bounded, release-compatible history query, but partition it into
  ten-game batches.
- Record current-price and historical-opening request counts independently while retaining the
  aggregate counter for compatibility.
- Base the hourly live-price cadence only on current-price requests.
- Stop transition-only historical recovery after any verified operational opening exists, or after
  one recorded historical attempt when the archive has no matching event.

Locked rows remain immutable. Last-known-good paired quotes remain visible until a fresher verified
quote silently replaces them. No member-facing labels or copy are added.

## Rollback

Revert writer r108 to r107 and restore the 25-game history partition plus the aggregate cadence
counter. Do not rewrite any locked snapshot or tracking result.
