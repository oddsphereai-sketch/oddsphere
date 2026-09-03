# WNBA v1.4 cross-market contradiction addendum

Date frozen: 2026-09-03 ET

Base: `35c42abd089038707000b00ffbf15deeb5d4915a`

Parent declaration commit: `72be8a5931fc8bb94b80f26679907261413fcdee`

This addendum is committed before the contextual regime behavior below is
implemented and before any outcome query. It amends only the v1.4 candidate's
predeclared market-quality arbitration; it does not add a fitted coefficient,
winner-sign override or grade quota.

## Frozen contextual regime check

Before constructing the final margin posterior, resolve the deterministic
evaluated Moneyline and Spread targets from the independent sport distribution,
exclude those fixed books, and determine whether each target-excluded market has
the already-required complete-pair, freshness, skew, book-breadth and independent
source-family qualification.

When both markets qualify, the market story is `cross_market_contradictory` if:

- the target-excluded Moneyline plurality and target-excluded Spread-implied
  winner point in opposing directions; or
- the existing Spread 25/75 desired mean and the target-excluded Moneyline
  plurality have opposing nonzero signs.

In that regime, reject market authority as a whole. The final Moneyline/Spread
distribution is the exact independent sport distribution: independent mean,
variance and sign probability. Total remains the same independent sport-model
Total distribution. Genuine evaluated complete-pair quotes remain available only
for downstream break-even, expected value and grade economics; their absence does
not flatten an otherwise positive independent edge.

When the qualified Moneyline and Spread regimes do not contradict, retain the
parent declaration exactly: one existing dynamic target-excluded Moneyline
interpretation, the existing qualified target-excluded Spread 25/75 mean, and one
maximum-entropy distribution satisfying both constraints. Missing, incomplete,
tied, singleton, stale, skewed or correlated alternatives remain identity-neutral.

## Frozen assertions

Synthetic tests must prove:

1. the adversarial opposing-regime fixture returns the exact independent
   probability, margin, Total and algebraic decimal scores without Hold/0.5;
2. exact evaluated quotes remain downstream and can still produce positive or
   negative EV grades in fallback;
3. non-conflicting qualified favorite and underdog regimes retain the single
   dynamic market interpretation and may legitimately retain or flip a side;
4. price perturbations that preserve the fixed evaluated identity/line have zero
   forecast effect;
5. ML probability, Spread CDF, expected margin and displayed decimal scores come
   from one distribution in both retained-authority and independent-fallback
   regimes; and
6. existing exact-price gates still exercise both promotion and demotion paths.

The authentic WNBA board remains the empirical gate. Zero scheduled games remain
no-op health only and cannot qualify this candidate for publication.
