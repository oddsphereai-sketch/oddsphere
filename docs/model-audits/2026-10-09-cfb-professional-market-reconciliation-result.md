# CFB professional market-reconciliation audit — candidate result

Status: audit complete; the owner-approved support-aware joint Moneyline/Spread implementation is
complete and is the production publication candidate. Publication and post-merge live verification
remain mandatory before it may be called live.
All database work was read-only. No locked projection, pick, grade, price, stake, or evidence payload
was rewritten.

## Decision standard

The CFB reader is not a generic market weight. It evaluates a target-excluded sequence: opening and
current lines, paired prices and no-vig probabilities, named-sharp versus retail paths, leadership,
reversals/buyback, persistence and timing, line/price disagreement, key-number crossings, public and
named/fallback money-ticket splits, split change, and the Moneyline/Spread relationship. Missing
splits mean unknown; they neither confirm nor resist. The independent football PMF is the starting
opinion, while market evidence may confirm it, move the score within the same side, or reverse it.

The audit rejected generic line following, generic reverse-line movement, automatic named-book
following, automatic key-crossing flips, price-before-line flips, and one universal cross-sport
coefficient. Those signal families were tested, not silently omitted.

## Genuine defects found and closed

1. The complete reader was stacked on top of a legacy split arbitration without being told how far
   that layer had moved from the independent model. Missouri State at Western Kentucky exposed the
   failure: the independent forecast favored Western Kentucky by 8.59, while the released legacy
   layer reversed it to Missouri State by 10.85. The final was Western Kentucky 34–13.
2. The reader discarded otherwise valid split differences below fixed 8pp/10pp cutoffs. The candidate
   removes those cliffs and retains money share, ticket share, their signed difference, and change as
   separate continuous evidence.
3. A spread-only legacy routine could reverse the outright winner in the smallest-spread state. The
   candidate prevents that inherited shortcut in the empirically stable Moneyline-dominant band,
   then lets the complete joint reader evaluate the Moneyline/Spread path and make a coherent reversal
   when the full evidence warrants it. The common half-point line ladder was audited around the band;
   broader restoration introduced additional harms and was rejected.
4. The reader now receives the active-versus-independent legacy shift, both market distances, and
   whether the legacy layer changed the Moneyline or Spread side. This lets it learn confirmation,
   useful resistance, and harmful overreaction instead of blindly stacking another correction.
5. Final review found that a valid Total flip could mechanically reflect the entire independent edge
   even when the active projection was farther from the market than any chronologically evaluated flip.
   The support-aware candidate keeps full reflection throughout the observed 3.6759-point active-to-
   market range. Beyond it, reflection authority decays continuously toward the fitted posterior and
   bounds only the extrapolated edge, not the side decision. This preserves every validated correction,
   harm, and board action while reducing unsupported extrapolation. On the exact stored-input board,
   the two largest Total shifts fall from 27.40 to 18.83 points and from 19.24 to 14.46; the remaining
   movement is required to cross market totals that sit 10.04 to 15.58 points from the independent model.

## Chronological result

The rolling evaluation contains 218 eligible games: 119 development, 94 confirmation, and five
opened micro-holdout games. Against the incumbent released forecasts:

| Measure | Incumbent | Candidate |
| --- | ---: | ---: |
| Moneyline | 165–53 | 168–50 |
| Spread | 71–59–3 | 73–57–3 |
| Total | 73–66 | 82–57 |
| Margin MAE | 12.5552 | 12.3108 |
| Total MAE | 13.0860 | 12.7345 |

The candidate makes 22 corrections and eight harms across directional Moneyline, Spread, and Total
outcomes: net +14 wins. Moneyline is four corrections and one harm; Spread two and zero; Total sixteen
and seven. The zero-harm version was rejected because minimizing changes was not the objective.

Among 133 games with a usable spread, 29 were actual underdog wins. The incumbent called seven
underdogs and was right twice (28.6% precision, 6.9% recall). The candidate calls eight and is right
four times (50% precision, 13.8% recall). On 25 short-spread games, it moves from zero correct upset
calls to two. This is improved upset awareness, not an instruction to force an underdog quota.

Historical locked payloads do not retain the complete PMF or a guaranteed executable opposite-side
quote for every candidate flip. Brier/log-loss and exact-price ROI for those flips are therefore not
claimed or reconstructed. That limitation is preserved rather than papered over.

## Final joint Moneyline/Spread challenge

The final outside-in review found one remaining modeling gap: the margin reader used Moneyline price
movement, but did not explicitly model Moneyline money share, ticket share, split change, or their
agreement/resistance with the Spread split and Spread movement. Those features were added to the
read-only tournament and tested under the exact production path: the same strictly-below-2.5 legacy
near-pick'em guard, the same fixed lambda and evidence authority, and the same Total reader.

The support-aware baseline and clean joint reader have identical directional results, intervention
counts, and upset calls: Moneyline 168–50, Spread 73–57–3, Total 82–57; four Moneyline corrections and
one harm, two Spread corrections and zero harms, and sixteen Total corrections and seven harms. The
joint reader lowers margin MAE from 12.3108 to 12.2948 and team-score MAE from 9.1910 to 9.1878. Its
confirmation Moneyline/Spread records remain 62–32 and 38–27–1, and its five-game opened micro-holdout
remains 4–1 and 3–1. The date-cluster bootstrap estimates a positive margin-MAE reduction in 97.82% of
resamples; the 95% interval is 0.0111 to 0.8252 points. This is uncertainty evidence, not a promised
future return.

More aggressive versions were rejected. Letting the development block choose stronger joint authority
produced 24 Spread flips (13 corrections, 11 harms) and worsened Moneyline to 164–54. The maximum-detail
book/timing/key-cross version lowered average margin error but worsened Moneyline to 162–56 and Spread
to 70–60–3. Per-book leadership, price-before-line sequencing, exact move timing, key crossings, and
buyback therefore remain observed audit context; they do not receive unvalidated automatic projection
authority. This is deliberate evidence calibration, not omission or generic threshold following.

The approved production change is consequently narrow: retain separate Moneyline money, tickets,
gap, and acceleration features; combine them continuously with Spread splits and price/line movement;
let agreement strengthen and disagreement resist the posterior; keep missing splits neutral; and keep
the already validated authority level. It does not authorize the rejected aggressive or maximum-detail
variants.

## Product and safety behavior

- Margin and Total changes are applied to the joint score PMF before scores, probabilities, sides,
  and grades are derived, so the prediction and projected score remain aligned.
- Total preserves full conviction only after the continuous posterior crosses the market side and
  remains inside chronologically observed projection support. Beyond support, a continuous decay
  contains projection extrapolation without vetoing the evidence-driven flip. A static line by itself
  has no authority.
- Missing SharpAPI splits do not disable the reader. Book movement, paired prices, no-vig movement,
  public evidence, and the independent-versus-market relationship continue to work.
- The final exact stored-input board replay covers 81 games with zero runtime/artifact mismatches and
  zero negative scores. The all-81-game same-current-runtime A/B moves Best Angle plus Lean counts from
  138→139: Moneyline has two actionable promotions, Spread has one actionable demotion, and Total has
  no net actionable change. Fourteen Moneylines, 24 Spreads, and 31 Totals remain actionable without
  eligible split evidence. The separate stored-release parity lane remains release-scoped; older stored
  releases remain immutable and are not mislabeled as current-runtime parity.
- The sole `prediction_pipeline:cfb` lease, writer path, T-60 lock priority, and immutable reader
  precedence remain unchanged.
- Publication requires focused tests, exact current-board zero-write replay, board-shape reporting,
  `npm run verify:model-change`, integration-safety verification on latest `main`, a pull request,
  explicit owner approval, and post-merge live release/cron/coherence verification.

The repository-wide model-change verifier, the complete CFB production suite, focused target-
exclusion/no-split tests, and TypeScript all pass. A fresh-provider writer replay remains pending
because the local audit environment does not contain a Playbook credential; the writer failed closed
before making a candidate claim. That exact fresh grade replay is a publication gate, not a reason to
weaken source requirements or insert a dummy credential.

## Research alignment

The result is consistent with evidence that intraperiod movement can improve forecasts while simple
reverse-line movement and mechanical following are not stable standalone edges:

- [Informed trading in college football betting markets](https://ideas.repec.org/a/taf/apfiec/v15y2005i3p143-152.html)
- [Reverse line movement in college football totals](https://ideas.repec.org/a/spr/jecfin/v43y2019i4d10.1007_s12197-019-09479-3.html)
- [College football bettors and the wisdom of crowds](https://dialnet.unirioja.es/servlet/articulo?codigo=7186574)
- [Intraperiod line changes and forecast accuracy](https://onlinelibrary.wiley.com/doi/abs/10.1111/0022-1082.155346)
- [Joint team-total and point-spread information for predicting college-football scores](https://doi.org/10.1177/15270025221148991)

The reproducible read-only audit is
`scripts/operator/audit-cfb-2026-sharp-sequence-tournament.ts`.
