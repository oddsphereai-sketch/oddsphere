# CFB independent public prediction r29 result

## Outcome

The candidate advances. The football-only joint PMF is again the sole public
prediction source. The previous market-anchored score remains stored only as
shadow market context and is no longer rendered as an OddSphere score, winner,
Spread prediction, or Total prediction.

This removes the live SJSU-USC contradiction: the independent score mean is
SJSU 16.1-39.4 USC, and the identical-line Total prediction and exact-price
Best Angle are both Under 61.5. Hawaii-Stanford now publishes the independent
Hawaii winner/score direction; its exact-price Moneyline side remains Hawaii,
while Moneyline and Spread may still receive different grades because their
prices, fair probabilities, EV, and thresholds are separate contracts.

## SELECT-only current replay

- Evidence rows read: 332; provider calls: 0; writes: 0.
- Slate: 38 games / 114 markets.
- Exact tuples before/after: 27 / 27.
- Grades before/after: 3 Best Angles, 2 Leans, 10 Watchlists, 12 evaluated
  No Plays; 87 price-unavailable markets.
- Tuple changes: 0; promotions: 0; demotions: 0.
- Coherence: 38/38 games pass; zero fatal same-line direction conflicts.
- One MEM-UNLV Spread mean/PMF cross is 0.1142 points from -4.5, inside the
  frozen 0.25-point discrete-score quantization zone. The full PMF direction
  remains authoritative at an effectively on-line mean.
- Sharp split identity: 2/38 strict matches; unmatched rows remain hidden.
- Hawaii and SJSU use one public independent forecast; SJSU Total prediction,
  line, and Bet side are identical.

## Release behavior

For an evaluated market, the member prediction now uses `independentProbability`
at the exact target book line and must match the exact decision side selected by
that PMF. The calibrated Bet probability, consensus fair probability, EV, and
grade are unchanged and remain separately labeled. For an unavailable market,
a fresh contextual-line PMF prediction may remain visible without acquiring a
price or grade. Missing context still uses the explicit prediction-unavailable
copy rather than raw projected margin or total.

Writer release `cfb_forward_evidence_writer_2026_08_28_r20_independent_public_prediction`
adds a fail-closed independent-PMF gate before the sole append. Member release
`cfb_v1_member_release_2026_08_28_r17_independent_public_prediction`, fixture
`cfb_v1_member_fixture_2026_08_28_r21_independent_public_prediction`, public
outcome contract `cfb_independent_public_outcome_contract_2026_08_28_r29`, and
shared presentation r16 identify the changed publication boundary.

## Invariants

The exact-price model and policy releases, sportsbook tuples, probabilities,
EV, grades, stakes, lock/tracking behavior, movement, splits, provider budgets,
weekly slate, and sole `prediction_pipeline:cfb` lease are unchanged. No reader
override, Toss-Up, fabricated price, or cross-market hold was added.
