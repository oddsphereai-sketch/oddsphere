# CFB holistic confidence shadow result

Date: 2026-09-04  
Candidate: `cfb_holistic_confidence_shadow_2026_09_04_r1_continuous_evidence`  
Status: shadow-only; not wired to the production writer

## What was tested

The frozen candidate replaces the incumbent collection of price, EV, edge, and absolute-line
promotion vetoes with one continuous confidence score. It retains the real evaluated quote and
exact-price EV in a separate `bet` / `shop` execution state. Integrity and availability holds remain
outside the scorer. The audit selects the latest complete stored pregame tuple for each game and
uses only evidence captured no later than that tuple.

Commands:

```bash
npx tsx scripts/test-cfb-holistic-confidence-candidate.ts
npx tsx --env-file=.env.local scripts/operator/audit-cfb-holistic-confidence-candidate.ts --date=2026-09-03
npx tsx --env-file=.env.local scripts/operator/audit-cfb-holistic-confidence-candidate.ts --date=2026-09-04
npx tsx --env-file=.env.local scripts/operator/audit-cfb-holistic-confidence-candidate.ts --date=2026-09-05
```

## September 3 diagnostic board

The ET-day cohort contains 11 games and 28 complete markets. The incumbent distribution is 2 Best
Angles / 4 Leans / 17 Watchlists / 5 No Plays. The shadow distribution is 6 / 11 / 6 / 5. There are
13 promotions, 6 demotions, and zero side changes. Seventeen rows have Best Angle/Lean confidence;
11 of those have non-negative exact-price EV and six are `shop` rather than executable wagers.

The post-freeze settled diagnostic is mixed and cannot authorize production: candidate Best Angles
were 4-1 with one pending and candidate Leans were 4-5 with two pending. The eleven confidence-tier
rows whose stored quote was `bet` were 3-6 with two pending, while confidence-only `shop` rows were
5-0 with one pending. These small, outcome-exposed cohorts reinforce the semantic distinction but
are not independent validation and must not be used to retune the frozen score.

By market, the shadow has 7 Moneyline promotions and no Moneyline demotions, 5 Spread promotions
and one Spread demotion, and one Total promotion with five Total demotions. This is a material
semantic board change, not a safe hotfix.

Massachusetts +29.5 moves from Watchlist to Lean with a 55.8779 confidence score. Its 53.4796 model
score receives +2.125 from the exact/half-point-adjacent Circa +17 money-ticket gap and +0.2734 from
same-book line/price movement. Its real BetRivers -109 quote and +2.5434% EV remain attached and set
execution to `bet`; neither the 29.5-point line nor missing the former 3% EV cutoff can veto the
confidence grade. The T-60 evidence row itself remains correctly held for capture lateness and is
not rewritten.

The same continuous behavior also demotes Akron +27.5 from Watchlist to No Play: its 53.0531 model
score receives -3.8234 points from aligned Circa, public, and movement resistance. UAB +25.5 moves
from Watchlist to Lean because strong Circa and movement affirmation outweigh lower-authority public
resistance. These paired cases prove the candidate is not a large-underdog promotion rule.

## Forward-board impact

- September 4: 8 games / 21 markets; incumbent 1/4/12/4 becomes shadow 5/8/4/4. Nine promotions,
  four demotions, 13 confidence actionables, 9 executable actionables, and 4 confidence-only Shops.
- September 5: 63 games / 159 markets; incumbent 18/28/76/37 becomes shadow 42/50/45/22. Sixty-five
  promotions, 44 demotions, 92 confidence actionables, 54 executable actionables, and 38
  confidence-only Shops.

The large forward-board movement is expected from changing the meaning of Best Angle/Lean from
price-qualified wager grades to forecast-confidence grades, but it requires explicit product/UI,
tracking, and release coordination. Heavy Moneyline favorites can become high-confidence Best
Angles while remaining `shop` at an unattractive quote; presenting those two labels without a clear
execution distinction would be misleading.

## Decision

The shadow validates the requested mechanics and the UMass behavior, but it is not yet publishable.
It intentionally changes many labels, and the September 3 outcomes cannot serve as independent
validation because they helped identify the defect. The candidate stays shadow-only until the
confidence/execution UI contract, release-pure forward evaluation, and sport-wide tracking semantics
are complete. No production grade, prediction, stake, writer, provider call, or locked row changes in
this checkpoint.
