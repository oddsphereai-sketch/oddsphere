# CFB release-wave completeness r37

Status: owner-authorized production correctness repair.

## Incident

The October 7 r36 writer stored 88 valid current-release rows and their paid Sharp/CFBD display
context. Its payloads nevertheless declared a 89-game wave because the generalized weekly lifecycle
also retained the already-final USM-Troy game for tracking. That completed game correctly had no new
prediction capture. The member completeness gate therefore rejected the valid 88-row wave and
published a new r36 snapshot envelope around the preceding r35 board. Provider ingestion was live;
the member publication boundary was not.

## Frozen repair

For a brand-new release, the completeness denominator is the unique set of games with an actual
capture plan. On later runs, it is the union of games already represented by the current release and
newly planned games. This has three required consequences:

1. a retained terminal game from an older release cannot inflate a new wave;
2. a partial refresh cannot shrink an established wave and a newly scheduled game is added once;
3. a genuine per-game capture failure remains absent from the union output but present in the planned
   denominator, so publication still fails closed.

No prediction equation, probability, side, projection, price, grade, stake, promotion/demotion rule,
provider hierarchy, request budget, writer schedule, lease, lock, tracking definition, member copy,
label or layout changes. The r29 sport-specific market reader and r41 decisions remain authoritative.
The r36 exchange/fallback behavior remains unchanged: valid paid context is retained and displayed,
but excluded from consensus, canonical anchors, exact-price grades and movement arbitration.

## Acceptance contract

- The current release must publish all 88 active capture rows and the compact member snapshot must
  consume r37 rather than a previous-release fallback.
- FBS paired Moneyline/Spread/Total coverage and every existing actionable grade must remain intact.
- FCS line-specific predictions must carry through wherever r36 already captured a verified provider
  line; missing provider lines remain unavailable and are never fabricated.
- Provider/book identity must remain stable across opening, prior and current observations. Temporary
  provider omission must retain the last verified same-book observation. Isolated off-market prices
  remain available context but cannot become the representative quote when the coherent multi-book
  cluster rejects them.
- Promotions and demotions attributable to this publication-count rule are both zero. Any board
  difference from the older fallback is the already-versioned r36 evidence becoming visible, not a
  new prediction or grade rule.
- The sole `prediction_pipeline:cfb` lease, immutable T-60 locks and official tracking rows remain
  unchanged.

## Rollback

Roll back evidence/member/writer/fixture/outcome/snapshot/reader r37/r51/r104/r77/r67/r37/r22 to
r36/r50/r103/r76/r66/r36/r21 together. Never rewrite an existing lock or tracking record.
