# NBA Moneyline Best Angle evidence guard — result

Date: 2026-10-21

Status: implemented and verified on the candidate branch; not production until protected merge and
post-deploy verification

## Outcome

The candidate closes the difference between model value and actual market confirmation without
turning Oddsphere into a market-following model.

- A model probability above the current no-vig probability remains a value disagreement, not a
  market-support claim.
- Direct qualified Moneyline movement remains observational and cannot change a score or winner.
- The existing validated two-point multi-trail Spread correction remains the only reader path that
  can change the NBA winner.
- Qualified opposite-side movement can keep an otherwise eligible Moneyline at Lean instead of
  Best Angle when it is not strong enough to trigger that correction.
- Confirming movement cannot bypass any existing confidence, model-edge, positive exact-price EV,
  high-quality input, or verified-availability requirement.
- Public splits remain context-only and have no automatic grade or forecast authority.

## Exact same-input current-board report

The read-only rehearsal at `2026-10-21T16:50:35.014Z` covered 11 games and all 33 Moneyline,
Spread, and Total markets.

| Measure | Incumbent | Candidate |
| --- | ---: | ---: |
| Best Angles | 4 | 3 |
| Leans | 4 | 5 |
| Watchlists | 25 | 25 |
| Total actionables | 8 | 8 |
| Negative-model-EV Moneyline actionables | 0 | 0 |

There are zero Best Angle promotions, one Best Angle-to-Lean change, zero actionable promotions,
and zero actionable demotions. Scores, sides, probabilities, and selected prices change zero times.

The only changed row is CHA at BKN Moneyline:

- final pick remains CHA Moneyline at -106;
- model probability remains 82.98% and the target-excluded no-vig reference remains 51.59%;
- the direct Moneyline read is unavailable because it has only one qualifying named-book sequence
  amid disagreement;
- the Spread reader has a qualified persistent Brooklyn observation, but its named-book magnitude
  remains below the existing score-correction threshold;
- the winner therefore remains Charlotte while the grade moves Best Angle to Lean.

The two control cases remain correct:

- MIL at WSH remains a Moneyline Best Angle because the model value is accompanied by qualified
  persistent Pinnacle and Circa Moneyline movement toward Milwaukee, despite reverse public flow;
- UTAH at MEM remains a Memphis Moneyline Lean because the existing validated Spread correction
  already flipped the independent Utah winner to Memphis and the direct Moneyline read agrees.

This is the intended fade / flip / hold distinction: Milwaukee is a justified fade, Memphis is a
validated flip, and Charlotte remains a model-side Lean under unresolved sub-authority opposition.

## Releases and safety

- Model / prediction record: `nba_professional_unified_2026_10_21_r15_moneyline_evidence_grade`
- Market marriage: `nba_market_marriage_2026_10_21_r17_moneyline_evidence_grade`
- Grade policy: `nba_grade_policy_2026_10_21_r9_moneyline_evidence_guard`
- Internal reader remains
  `nba_professional_market_reader_2026_10_20_r6_structural_qualification`

The implementation includes a read-only legacy-grade audit hook and tests aligned direct
confirmation, opposing direct movement, fallback opposing Spread movement, validated-correction
precedence, legacy parity, and the rule that confirmation cannot lower the Best Angle confidence
gate. The focused grade, candidate, and professional-reader tests pass, and repository TypeScript
passes. The complete `npm run verify:model-change` gate passes with zero failures, and the production
Next.js build completes all 108 routes.

Locked member snapshots retain exact stored precedence and are never regraded. Roll back future
unlocked generation only on mixed release identity, a live impact outside the reviewed one-row
change, any score/side/probability/price change, any actionable contraction, or any locked-payload
change.
