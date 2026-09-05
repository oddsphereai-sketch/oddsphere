# MLB props price/confidence balance r42 — predeclaration

Status: outcome-blind production-candidate declaration. No outcome join has been run for this candidate.

## Trigger and scope

The r41 board is ingesting and mapping prices correctly, but accuracy-oriented Under sleeves can label
offers around -400 to -500 as Best Angle. That top-tier label does not communicate practical price
risk even when the forecast side is confident. This candidate changes only the final displayed grade
of an already-computed, unlocked MLB prop decision.

It does not change side, probability, projection, line, sportsbook, price, target-excluded benchmark,
edge, EV, units/stake, provider calls, supported markets, writer, lease, T-60 lock, settlement, or any
existing locked row.

## Predeclared behavior

- Keep the exact named-book price attached to every row.
- An ordinary two-way Best Angle worse than -200 is capped at Lean; worse than -400 is capped at
  Watchlist. A Lean worse than -400 is capped at Watchlist. These are graduated maximum tiers, never
  a No Play veto.
- Prices from -200 upward retain their model-owned grade. Positive-price milestone Home Run portfolio
  actions retain their separately validated portfolio contract.
- The cap runs after validated promotion and coherence logic so it cannot manufacture an action,
  change a forecast, or bypass data/integrity gates.
- Stake behavior is unchanged. A capped row cannot retain actionable units when its final grade is
  Watchlist.

## Acceptance gates

Report an identical-input board comparison with promotions, demotions, prices, market mix, and
actionable count. Pair the demotion path with tested retention boundaries at -200 and normal/plus
prices; no category may disappear. Run the focused MLB props tests and full model-change suite. Any
side, probability, projection, quote, EV, unsupported-market, lock, settlement, or provider-budget
change rejects the candidate. The authoritative writer remains `refreshMlbPropsBoard` under the
existing MLB prediction-pipeline lease.
