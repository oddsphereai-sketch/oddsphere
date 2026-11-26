# NFL player props Anytime TD economic-ledger predeclaration

Date: 2026-10-15
Status: frozen before calculating payout-weighted results; research only

## Question

The complete Week 5 Anytime TD board went 11-34, but hit rate alone cannot identify economic
quality in a plus-price rare-event market. This audit determines whether the released lane is
economically weak, probabilistically miscalibrated, both, or neither, using the exact prices and
probabilities stored at lock.

## Frozen measurements

The audit uses the 45 canonical-main-line Week 5 Anytime TD rows from the immutable private board.
It will report separately:

- hit rate and average locked-price break-even probability;
- flat one-unit realized return and ROI at each exact locked American price;
- released raw, target-excluded no-vig market, and final Brier/log loss, calibration, and AUC;
- locked final probability minus no-vig market probability, locked probability minus price-implied
  break-even, and exact expected value;
- performance by stored grade, positive-EV subset, and top 5/10/20 ranks by locked EV and edge;
- the already frozen market-independent fixed-ensemble challenger on the same 45 rows, with the
  released 20% market-residual transform applied only as a separate comparison; and
- same-book CLV only where a matching `t60_lock` observer row exists for the exact game, player,
  sportsbook, and yes price. T24 or cross-book substitutions will not be called closing prices.

No hit-rate cutoff is imposed. No short-price filter, price cap, rank count, grade rule, candidate
probability, or calibration map may be chosen after viewing settlements. Stored locks remain
unchanged, and this audit cannot authorize production.

## Classification rule

- `economically_weak` means the exact-price portfolio or its intended eligible strata have
  negative realized units inconsistent with the model's positive expected-value claims.
- `probabilistically_miscalibrated` means proper scores/calibration materially fail on the exact
  board relative to outcomes and the no-vig reference.
- Both labels may apply independently. Hit rate is descriptive and cannot assign either label by
  itself.
