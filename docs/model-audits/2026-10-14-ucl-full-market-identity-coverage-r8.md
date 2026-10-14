# UCL full market identity coverage r8

Date: 2026-10-14

Status: production candidate.

## Defect

The Sharp UCL event catalog had complete full-game boards for the current
slate, but the UCL identity matcher did not recognize several ordinary team
name variants. PSG at Manchester City, Porto at Real Betis, AEK Athens at
Shakhtar Donetsk and Stuttgart at Slovan Bratislava therefore failed before
their odds were requested. The resulting member cards incorrectly held Total,
Double Chance and BTTS markets even though the provider had current prices.

## Repair

Add explicit bidirectional aliases for the observed provider/team identities.
The strict exact-or-explicit-alias contract remains in force; arbitrary
substring matching is still prohibited. The existing provider, four-market
request path, recovery budget, writer, lease, cadence and publication gate are
unchanged.

The grade/calibration identifier advances because restoring an exact quote can
turn a held market into an ordinarily graded market. The model and every grade
threshold remain unchanged.

## Live read-only evidence

- Fixtures: 9/9 matched to canonical full-game events.
- Selected current prices: 36/36.
- Complete outcome prices: 90/90.
- Held markets: 0.
- PSG-Manchester City BTTS: 18 normalized rows from nine named books, with
  complete Yes and No outcomes.
- Full response: zero incoherent games and zero nonpositive-EV actionables.

Against the stored still-unlocked member board, the repair restores 13 market
tuples, changes no prediction side, promotes six ordinarily qualifying Leans,
and demotes zero actionables. This is restored input coverage, not a new grade
rule or a quota.

## Lock and rollback boundary

Already locked records and member cards retain their exact prior model,
calibration, price, prediction, grade and evidence payload. R8 applies only to
unlocked rows and future locks. Rollback restores the prior explicit alias map
and r7 calibration identifier while preserving every r8 lock unchanged.
