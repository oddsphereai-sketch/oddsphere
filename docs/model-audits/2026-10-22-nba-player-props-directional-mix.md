# NBA player props directional-mix audit

Date: 2026-10-22  
Status: read-only diagnosis; no model, grade, line, price, or locked-row change

## Question

Determine whether the first live member slate is merely displaying a credible
set of Under forecasts or whether the product is defaulting to Unders instead
of making predictive, market-specific decisions.

## Current slate

The stored two-game member snapshot contains 154 decisions. The final board is
45 Overs and 109 Unders (70.78% Under). The 12 Best Angle/Lean decisions are two
Overs and ten Unders (83.33% Under).

The independent model is also 45 Overs and 109 Unders. Market arbitration flips
40 individual decisions, but those flips are balanced: 20 Over-to-Under and 20
Under-to-Over. The final aggregate skew therefore originates in the independent
slate projections, not in a one-way market-reader rule.

## Release-pure historical comparison

The immutable active-runtime parity block contains 2,771 settled decisions:

- all decisions: 1,245 Overs and 1,526 Unders (55.07% Under);
- actionable decisions: 69 Overs and 87 Unders (55.77% Under);
- actionable Overs: 41-28 (59.42%);
- actionable Unders: 49-38 (56.32%).

The live slate is therefore much more Under-heavy than the release-pure
historical mix. The historical evidence does not support a blanket Under rule:
actionable Overs were both common and more accurate than actionable Unders.

## Decision

Do not force a 50/50 board or flip rows merely to improve visual balance. That
would be an outcome-agnostic model change. Preserve the current predictions
while recording the first live slate as an early-season directional-integrity
check. Settlement must be evaluated by release, market, side, independent side,
and market-arbitrated side before any projection or grade behavior changes.

The reusable operator audit is
`scripts/operator/nba/audit-nba-player-props-current-side-mix.ts`. It reads only
stored snapshots and an optional immutable parity artifact; it makes no
provider call or database write.
