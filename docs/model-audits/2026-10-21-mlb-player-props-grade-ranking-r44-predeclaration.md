# MLB Player Props grade-ranking r44 predeclaration

Date: 2026-10-21
Base: `c9098cdc3d98ee660a41a9869e4be09e0189af28`

## Scope

The active complete release is `mlb_props_2026_09_21_r43`. This candidate may
change only the relative Best Angle / Lean label on already-actionable,
unlocked MLB Player Props rows. It may not change a side, projection,
probability, price, edge, EV, stake, provider request, writer, cadence, lock,
settlement, member copy, or historical record.

The candidate release, if it passes, is
`mlb_props_2026_10_21_r44`.

## Frozen problem statement

Release-pure r43 tracking has 683 settled actionables at 412-271, but its grade
ladder is inverted: Best Angles are 20-23 while Leans are 392-248. The top
label is therefore not identifying the strongest predictive lane even though
the actionable board as a whole remains more right than wrong.

Candidate selection is limited to a market-level reranking that is already
supported by the predeclared r42 chronology and can then be checked against
r43 forward results:

- r42 selection: Runs Scored Under at the existing Best Angle price floor is
  51-28; untouched r42 confirmation is 44-17.
- r43 forward: the same lane is 50-27.
- HRR Under Best Angles are 6-7 in r42 confirmation and 8-12 in r43.
- Pitcher Strikeouts Over Best Angles are 4-5 in r42 confirmation and 6-9 in
  r43.

## Candidate and gates

1. An unlocked Runs Scored Under Lean at American odds `-200` or better may be
   promoted to Best Angle.
2. An unlocked HRR Under or Pitcher Strikeouts Over Best Angle is reranked to
   Lean. The play remains actionable at the same one-unit stake.
3. Existing exact-price, freshness, lineup, research, projection-side,
   target-excluded market, and price-confidence gates retain precedence.
4. Locked rows must be byte-for-byte unchanged by the new policy.
5. Tests must prove zero change to side, projection, probability, price, edge,
   EV, and units, plus the exact paired grade movements and locked precedence.

This is a ranking correction, not a count target. The number of Best Angles is
an output of qualified rows, not a quota.
