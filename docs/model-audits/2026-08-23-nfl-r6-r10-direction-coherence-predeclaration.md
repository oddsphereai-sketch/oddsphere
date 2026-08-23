# NFL r6 value / r10 outcome direction coherence predeclaration

Date: 2026-08-23

## Scope

This protocol evaluates one structural eligibility rule before it is added to the NFL member
decision writer. It does not change the qualified r10 discrete joint score distribution, its
moneyline/spread/total probabilities, the r6 exact-price probability head, the single leased
writer, the T-60 boundary, or any stake.

The proposed rule is frozen as follows:

- an r6 exact-price moneyline candidate may receive `Lean` only when its selected team is also
  the conditional winner (home versus away, excluding regulation tie mass) from the qualified
  r10 joint score PMF;
- an r6 candidate selecting the opposite team is not relabeled or reader-side flipped; it is
  ineligible for action and the public `No Play` forecast side comes from r10;
- a qualifying underdog can still be a value Lean when its r10 win probability is below 50%
  only if it is the r10 conditional winner. The guard is about model-direction coherence, not
  favorite status or price size;
- true price, identity, or availability failures remain `Held`; normal projected-QB context is
  not an automatic Hold;
- spread and total remain r10 forecast sides with `No Play` Bet grades because their separate
  exact-price action lanes have not qualified.

## Frozen reporting

Reconstruct the existing uncapped r6 exact-price action cohort exactly. Report baseline versus
guarded counts, record, units, ROI, mean normalized CLV, and positive-CLV frequency separately
for 2024 and 2025 and pooled. Report the current authoritative Week 1 promotions/demotions and
final board count without tuning the rule to that count.

The 2024/25 rows have been inspected by prior r6 research, so this is a structural coherence
audit rather than a pristine new alpha discovery. The guard may ship only if both seasons remain
profitable, pooled ROI does not deteriorate, pooled mean CLV stays positive, and the current
board remains selective rather than empty.

## Failure behavior

If the guard fails those conditions, retain the r6 value model as labeled internal context and
do not publish a direction-conflicting Lean. Never alter the r10 representative score to agree
with a bet side, and never hide that value and outcome probability heads are distinct.
