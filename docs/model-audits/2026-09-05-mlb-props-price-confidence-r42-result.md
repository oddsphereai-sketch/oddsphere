# MLB props price-confidence balance r42 — frozen result

Date: 2026-09-05

The policy was declared before the current production snapshot was compared. The audit is
SELECT-only and uses `scripts/operator/audit-mlb-props-price-confidence-r42.ts`.

## Identical-input impact

- September 5 snapshot `64a3758e-db3c-4ba3-90e6-6e7106af4430`, r41, 5,963 rows:
  23 Best Angles / 85 Leans become 6 Best Angles / 94 Leans. Seventeen rows change: nine Best
  Angle-to-Lean and eight Best Angle-to-Watchlist.
- September 4 snapshot `c5fc39e9-6b73-4307-a561-2e41fe10f437`, r41, 1,219 rows:
  9 Best Angles / 3 Leans become 5 Best Angles / 7 Leans. Four Best Angles between -205 and -250
  become Leans.
- No row becomes No Play. No prediction, side, probability, projection, quote, book, line, edge,
  EV, or category changes. Milestone offers and locked rows are unchanged. No stake amount changes;
  Watchlist rows carry the existing zero-unit contract.

The September 5 demotions include ordinary two-way Best Angles at -204 through -500. Exact -200
remains eligible for Best Angle and exact -400 remains eligible for Lean; worse prices receive the
next graduated ceiling.

## Rollback

Return `MLB_PROPS_MODEL_RELEASE_ID` to r41 and remove the post-coherence price-confidence transform.
Never rewrite an r42 canonical snapshot, member snapshot, game lock, or tracking record.
