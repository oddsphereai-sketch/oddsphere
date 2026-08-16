# MLB sharp-split ingestion incident — r49

## Release

- Decision: `mlb_daily_edge_decision_2026_08_16_r49`
- Projection, probability, calibration, grade, action, and price rules: unchanged from r48
- Scope: MLB Moneyline and MLB Total SharpAPI split ingestion only

## Incident

On August 16, SharpAPI returned 15 current MLB `/splits` events, and every
provider event ID carried the requested `2026-08-16` date. The ingestion guard
rejected all 15 because the same 15 matchup pairs also appeared on August 15,
which is normal during consecutive MLB series. The former gate required the
current slate matchup count to be strictly greater than the previous slate
count, making complete coverage impossible whenever both dates shared the
same series matchups.

Pre-fix dry-run evidence:

- current provider rows: 15
- current-slate matchup matches: 15/15
- previous-slate matchup matches: 15/15
- accepted SharpAPI observations: 0
- MLB Moneyline sharp percentage coverage: 0/15
- MLB Total sharp percentage coverage: 0/15

## Repair and safety boundary

The repaired gate retains the 70% current-slate matchup floor. When current
and previous matchup counts tie, it additionally requires at least one
parseable provider event date, zero event-date mismatches, and exact agreement
with the requested slate date. A payload with the wrong event date or less
than 70% current matchup coverage remains rejected.

Rejected non-empty payloads now emit an operational error instead of a silent
zero-observation result. The Daily Edge health monitor elevates missing MLB
Moneyline or Total sharp context from medium to high severity, causing the
scheduled health job to report a partial/error state instead of declaring the
reader fully healthy.

The scheduled production path uses `pregame-sweep?lockOnly=true`. The former
implementation refreshed lines and legacy sharp signals before an entering
T-60 lock but skipped Market Intelligence v2 whenever `lockOnly` was true.
r49 removes that exception: collection runs only when at least one game enters
the lock window, and it runs before the final T-60 model pass and lock write.
This preserves the targeted cadence while guaranteeing that available MLB
Moneyline and Total sharp pairs are present in the immutable lock package.

## Board impact

This release does not add a promotion, demotion, flip, stake, or price rule.
It restores a contracted input that existing versioned rules already consume.

The 2026-08-16 current-slate comparison covered all 30 MLB Moneyline and Total
decisions. Best Angles remain unchanged at 3, so the repair does not flatten the
premium board. The complete grade counts move from 3 Best Angle, 4 Watchlist,
16 Market Aligned, 4 Lean, and 3 No Play to 3 Best Angle, 1 Watchlist,
12 Market Aligned, 10 Lean, and 4 No Play. Thirteen lower-tier decisions change:
two promotions out of No Play, two demotions into No Play, eight other
lower-tier reclassifications, and one Moneyline side change from a Watchlist
home pick to an away Lean. These changes are caused by restoring the missing
current market evidence; no prediction formula, threshold, stake, or grade rule
changes in r49. No r49 row may be described as r48 performance.

## Rollback

Rollback is the r48 identifier and former matchup-only alignment gate. Because
that gate deterministically rejects consecutive-series slates with equal
matchup coverage, rollback is safe only if SharpAPI stops providing reliable
event dates and the reader is intentionally returned to a fail-closed,
sharp-context-unavailable state.
