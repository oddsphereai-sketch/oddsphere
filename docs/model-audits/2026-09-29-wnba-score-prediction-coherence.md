# WNBA score / prediction coherence — 2026-09-29

## Scope and owner authorization

The owner reported that WNBA projected scores and predictions did not align and
authorized the repair without any member-facing copy, labels, or layout changes.
The repair is limited to the final WNBA margin distribution and its release
identifiers. The sole writer, shared `prediction_pipeline` lease, provider calls,
schedule, Total head, lock boundary, immutable locked records, and tracking
contract remain unchanged.

## Reproduction

The unlocked September 29 board contained two stored contradictions:

- MIN at NY projected MIN by 1.6045 points while publishing NY Moneyline.
- LV at IND projected IND by 0.2780 points while publishing IND -1.5.

The writer, rather than the reader, stored both contradictions. The v6
maximum-entropy sign tilt independently preserved an expected margin and a
Moneyline sign probability. Its displayed score decomposed the expectation,
while ML and Spread sides used separate CDF cuts.

## Rejected repair

Using the sign-tilted median as the displayed score would have made the surface
coherent without changing decisions, but the read-only release-era replay
rejected it: expected-margin versus median margin MAE was 11.1979 versus 11.3465,
team-score MAE was 16.5547 versus 16.5875, winner direction was 31/38 versus
28/38, and Spread direction was 24/37 versus 22/37. The release therefore does
not trade prediction quality for cosmetic agreement.

## Released rule

`wnba_v1_5_coherent_expected_margin` uses one normal margin distribution whose
center is the existing expected margin and whose variance is the existing WNBA
margin variance. Moneyline probability, Spread probability, projected-score
margin, Moneyline side and Spread side now come from that one distribution.
The expected Total remains the independent Total mean, so the score sum and
Total direction retain their preceding identities.

Target-excluded Moneyline evidence still enters once as market/value evidence
and contradiction context, and target-excluded Spread evidence still supplies
the qualified 25/75 expected-margin center. The evaluated book remains excluded
from its own fair-probability denominator. No new threshold, quota, hard score
limit, copy, label, or alternate writer is introduced.

## Release-pure replay and board impact

- Settled distribution games: 38.
- Expected-margin MAE: 11.1979; probability-implied margin MAE: 11.2952.
- Expected-margin winner direction: 31/38; preceding published direction: 28/38.
- Expected-margin Spread direction: 24/37; preceding published direction: 22/37.
- ML score/side coherence: 35/38 to 38/38.
- Spread score/side coherence: 35/37 to 37/37.
- Current board: NY ML Lean becomes MIN Watchlist; IND -1.5 Watchlist becomes
  LV +1.5 Watchlist; Total decisions are unchanged.
- Current actionables: 2 to 1, with one owner-approved demotion and zero
  promotions. The symmetric positive-edge/exact-price promotion rules remain
  active and structurally covered; no board-flattening threshold was added.

The one-demotion exception is explicit because preserving NY Lean would require
publishing the less accurate probability-median score or carrying the evaluated
price economics to the opposite team. Both would be incorrect. The owner had
already authorized a single accuracy-driven demotion and expressly prioritized
prediction accuracy over a flat-board avoidance rule.

## Verification and rollback

Run:

```bash
node --import tsx scripts/operator/audit-wnba-representative-score-coherence.ts
node --import tsx scripts/test-wnba-target-excluded-market-decision.ts
npm run verify:model-change
```

Rollback is the preceding v1.4/v6/v9 identifiers and sign-tilted final
distribution. Already locked records remain immutable under either release.
