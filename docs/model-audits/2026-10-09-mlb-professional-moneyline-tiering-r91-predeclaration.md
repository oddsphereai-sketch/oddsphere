# MLB professional Moneyline tiering r91 — predeclaration

Date: 2026-10-09

## Scope and evidence status

This release is limited to the public grade assigned to future unlocked MLB
full-game Moneylines. It does not change the independent projection, selected
side, probability head, projected score, Total, first-inning model, price,
stake, provider cadence, sole writer, or `prediction_pipeline:mlb` lease.
Existing locked records remain immutable.

The 2026 archive was already opened during the owner-directed professional
market-reader audit before this candidate was fixed. It is therefore
diagnostic retrospective evidence, not a pristine holdout and not a promised
future hit rate. The candidate below is constrained by price arithmetic,
sport-specific market structure, existing released evidence gates, and
chronological stability; no outcome-tuned numeric search is authorized.

## MLB-specific research boundary

The release follows these research-supported constraints:

- Baseball Moneyline and Total markets are generally information-efficient;
  a public/sharp label or late move is not sufficient reason to reverse an
  independent forecast. See Gandar, Zuber, and Lamb (2001),
  <https://doi.org/10.1016/S0148-6195(01)00040-6>, and Brown and Abraham
  (2002), <https://doi.org/10.1177/152700250200300401>.
- Profitability must be evaluated at each actual price rather than a constant
  win-rate break-even assumption. See Gandar and Zuber (2004),
  <https://doi.org/10.1177/1527002503260564>.
- Information quality and release timing matter in MLB Totals; visible but
  lower-quality information can be incompletely or incorrectly incorporated.
  See Mills and Salaga (2018),
  <https://www.sciencedirect.com/science/article/pii/S138641811830079X>.
- A starting pitcher and an opener are different roles, so pitcher continuity
  cannot be inferred from a generic starter label. See MLB's official opener
  definition, <https://www.mlb.com/glossary/idioms/opener>.
- Baseball bet action can depend on sportsbook-specific listed-pitcher rules;
  a market move cannot silently change the contract being evaluated. See
  Betfair's baseball rules,
  <https://support.betfair.com/app/answers/detail/baseball-rules/>.

Operationally, r91 therefore continues to require target-excluded two-sided
prices, exact evaluated-book economics, same-book chronology, verified split
provenance when splits exist, neutral treatment when they do not, starter and
lineup continuity, and coherent selected-side projected scores. It does not
treat a split percentage or an isolated move as a universal sharp signal.

## Diagnosed grade mismatch

The incumbent `ml_tight_market_price_best_angle_v1_2026_07_20` sleeve was
44-30 but returned -0.057 units at its stored prices. Recomputed exact-price
economics show 70 of 74 rows below the offered break-even probability; those
70 rows went 40-30 and lost 2.799 units. The sleeve can remain useful
directional context, but its broad Best Angle label is not price-coherent.

The existing
`mlb_ml_confidence_value_context_lean_v1_2026_08_17` sleeve requires a
60%-plus selected-side probability, an offered-price edge no worse than -3
percentage points, a projected-score margin on the same side, observed
same-book directional movement, no public split conflict, no unresolved
regularization cap, and complete Moneyline data. It went 46-15 and returned
+9.795 units. Its chronological blocks were:

| Block | Record | Units |
| --- | ---: | ---: |
| Through 2026-08-31 | 12-2 | +4.056 |
| 2026-09-01 through 2026-09-18 | 23-8 | +4.577 |
| 2026-09-19 onward | 11-5 | +1.162 |

The model-plus-price-plus-projection-plus-market cohort is therefore stronger
than the market-price-only Best Angle sleeve, but r90 gives it only Lean.

The split-only neutral-consensus Best Angle sleeve was 5-3 but returned
-0.098 units. All eight rows were below their exact offered-price break-even
probability. Verified consensus can
still make a play actionable, but it cannot by itself justify the strongest
tier at a model-negative offered price.

## Fixed candidate

For future unlocked MLB Moneylines:

1. Promote the already-qualified confidence/value/score/market cohort from
   Lean to Best Angle. Do not widen any of its existing evidence gates.
2. Require non-negative exact offered-price edge before the tight-market-price
   sleeve can receive Best Angle. A row that passes the incumbent sleeve but
   has negative exact-price edge remains a Lean; its side, probability, price,
   projected score, and actionability are unchanged.
3. Apply the same Best Angle price-coherence rule to the neutral 70/70
   SharpAPI consensus sleeve. Negative exact-price rows remain Lean.
4. Do not add a Moneyline flip. The opened loss audit found that rows with both
   adverse movement and split conflict went 6-2 on the original side, while
   the opposite-side counterfactual went 2-6.

The candidate deliberately uses evidence composition instead of a single
movement threshold: independent probability, exact price, projected-score
direction, movement availability, split conflict, correction state, data
completeness, and release identity all retain separate roles. Missing splits
remain neutral and never become synthetic support.

## Acceptance

- Side, probability, price, and projected score changes: zero.
- Actionable-count changes: zero for every replayed row; this is tier
  arbitration, not board suppression.
- The confidence/value cohort must be positive in every declared chronological
  block.
- Negative-price tight-market and neutral-consensus rows must remain Lean,
  never disappear.
- Exact locked payloads must retain reader precedence.
- Focused tests, `npm run verify:model-change`, integration safety, protected
  PR checks, and post-merge live release/coherence proof are mandatory.

## Proposed release identifiers

- calibration: `mlb_public_calibration_v37_professional_moneyline_tiering_2026_10_09`
- decision: `mlb_daily_edge_decision_2026_10_09_r91_professional_moneyline_tiering`
- rule bundle: `mlb_daily_edge_rule_bundle_v76_professional_moneyline_tiering_2026_10_09`
- grade policy: `mlb_public_grade_policy_v60_professional_moneyline_tiering_2026_10_09`

Rollback restores r90/v75/v36/v59 for future unlocked rows only. No existing
lock may be rewritten, suppressed, or reinterpreted.
