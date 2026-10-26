# NBA player-props component and market-reader repair predeclaration

Date: 2026-10-26  
Status: predeclared, select-only audit; not production authority

## Owner direction

Player-prop accuracy is the product objective. Points, rebounds, assists, and
their combination markets must be diagnosed as connected forecasts rather than
independent labels. Market evidence may confirm or correct an independent side,
but it may not be used as a generic cross-market rule or as a substitute for a
coherent component forecast. The member surface, copy, labels, and layout are
out of scope.

## Immutable inputs and diagnosis

The candidate will be evaluated only from stored point-in-time features,
target-book-excluded pre-lock quotes, immutable tracking rows, and official box
scores. Existing locks are diagnosis-only and may never be rewritten.

The release-pure October 22-25 inventory contains 2,500 settled decisions:

| Market | Active final | Independent | Target-excluded 2 pp replay |
|---|---:|---:|---:|
| Points | 50.8% | 52.6% | 53.3% |
| Rebounds | 48.7% | 49.3% | 57.5% |
| Assists | 60.2% | 56.7% | 60.4% |
| Threes | 54.9% | 54.9% | 56.5% |
| Points + Rebounds + Assists | 53.6% | 56.3% | 54.6% |
| Points + Rebounds | 58.2% | 58.2% | 54.1% |
| Points + Assists | 57.0% | 56.2% | 51.6% |
| Rebounds + Assists | 49.4% | 51.8% | 55.4% |

The active frozen runtime also permits different latent rebound centers for the
standalone and combination markets. A separate coherence audit found 105 side
disagreements between a stored combination center and the sum of its stored
components. This is evidence of a component-authority gap, not permission to
replace the historically stronger Points + Rebounds head with a naive sum.

## Predeclared candidate

The first candidate changes only future-unlocked forecast arbitration:

1. Rebounds and Rebounds + Assists use the existing independent center, then
   permit a categorical side correction when genuine
   target-book-excluded consensus is at least two percentage points from 50%.
2. Assists retains its active FanDuel-confirmed two-point policy because its
   current release is healthy.
3. Points, Threes, Points + Rebounds + Assists, Points + Rebounds, and Points +
   Assists retain their active policies. The first exact-runtime rehearsal found
   that changing Points lost three net decisions and therefore rejected that
   broader candidate before release.
4. A correction mirrors only the independent distance across the offered line;
   it does not blend the projection toward the market or manufacture a fixed
   nudge.

This candidate deliberately does **not** force one generic rule onto every
market. A later shared-latent-component model may replace the independent heads
only after it preserves or improves each standalone and combination holdout.

## Acceptance gates

The candidate may advance only if all of the following pass:

- direction accuracy improves overall and in Rebounds;
- Rebounds + Assists does not regress;
- Points + Rebounds and Points + Rebounds + Assists do not inherit the harmful
  blanket two-point rule;
- projection MAE is not materially worse overall;
- every changed final side remains coherent with its final projection;
- actionable demotions are paired with tested promotions and board counts are
  reported; a hidden flatter board is rejected;
- the current unlocked board has complete finite projections and prices;
- locked writer and reader precedence remain byte-for-byte unchanged;
- the sole writer and shared NBA prediction-pipeline lease remain authoritative.

## Rejection and rollback

Reject the candidate if improvement depends on post-lock evidence, target-book
leakage, blended releases, a generic Under bias, or a single favorable slate.
If released, rollback applies only to future-unlocked generation. Existing
locked projections, sides, probabilities, grades, prices, and evidence remain
immutable.
