# NFL no-weight coherent candidate r6 — frozen predeclaration

Date: 2026-10-15

Status: research-only full-product replay; no production or locked-record writes.

## Frozen independent architecture

- Margin: the r5 provider-play Extra Trees head. It retained the play-quality
  inputs that are reproducible from the paid provider and recorded 53–25–1
  Moneyline with 9.41 margin MAE on the opened 79-game 2026 replay.
- Total: the r2 dynamic scoring-state Total head. It had lower 2026 Total MAE
  than either the r1 or r5 direct Total head.
- Home and away expectations are reconstructed coherently from one margin and
  one Total.

The combination is frozen before scoring the exact paid-score locked cohort.
That cohort has already been inspected in prior architecture work and is not an
untouched holdout; it is a release-pure diagnostic.

## Market-reader relationship

There is no market weight, blend, anchor average, or continuous pull toward a
betting line. The independent score is completed first. The stored qualified
reader may then make only these existing categorical corrections:

1. a winner correction when cross-market winner coherence is explicitly
   `authorized`;
2. a Spread correction only under `professional_market_*` authority; and
3. a Total-direction correction when the existing Total authority is
   `available`.

Each applied correction is made by reflecting the corresponding independent
margin or Total across the evaluated boundary, after which home/away scores are
rebuilt. Corrections, harms, unchanged games, point error, direct sides, and
3-/6-point improved lines must all be reported.

No cohort result may change the above policy. Production remains unauthorized
until provider feature parity, portable runtime parity, release/version work,
board-impact reporting, focused and full model tests, integration safety,
owner approval, and live proof are complete. Existing locks remain immutable.
