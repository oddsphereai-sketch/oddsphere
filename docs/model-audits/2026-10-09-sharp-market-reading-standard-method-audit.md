# Sharp market-reading standard and method audit

Status: independent outside-review pass complete; documentation and read-only audit scope only.

Date: 2026-10-09

Audited contract: `docs/sharp-market-reading-standard.md`.

## Verdict

The standard is suitable as the shared goal for sport-by-sport audits after the revisions below. It does
not define one universal market weight, sharp-book label, movement threshold, split threshold, or flip
rule. It defines the questions, evidence identities, evaluation gates, and product safeguards that every
sport adapter must answer with its own chronological evidence.

The standard is intentionally stricter about truthful evidence than about predictive magnitude. Wrong
event/book/line/time identity is a hard failure. Valid signal magnitude is normally continuous or tapered.
The final prediction changes side only when the coherent probability distribution crosses the outcome
boundary, while its probability and exact-price grade preserve whether that change is weak or strong.

## Audit checklist

| Area | Result | Required behavior |
| --- | --- | --- |
| Product objective | Pass | Joint prediction, calibration, exact-price value, upset awareness, and useful coverage; no single metric substitutes for the others. |
| Sport specificity | Pass | One shared evidence contract with separate thresholds, mappings, and validation for every sport and market. |
| Evidence identity | Pass | Exact event, market, side, line, scope, book, observation/receipt/evaluation times, and target exclusion. |
| Quote lifecycle | Pass after outside review | Distinct market/book/first-observed/reopening identities; stale, suspended, corrected, and non-bettable quotes cannot masquerade as movement or value. |
| Vig and push semantics | Pass after revision | Same-line two-sided pairs, versioned vig removal, explicit push mass, and labeled line-aware translations. |
| Hold and shading | Pass after outside review | Fair-probability movement, hold changes, number movement, and asymmetric side shading remain distinguishable. |
| Signal separation | Pass | Number, price, same-book trail, opening-to-consensus displacement, splits, sequence, resistance, buyback, and cross-market evidence stay distinct. |
| Threshold behavior | Pass after revision | Integrity gates may be hard; predictive features require continuous/tapered treatment or demonstrated discontinuity and neighborhood ledgers. |
| Independent-model marriage | Pass after revision | Independent-only, market-only, active, and candidate views; information-lineage audit; no double-counting or recursive compounding. |
| Source independence | Pass after revision | Raw book count and effective independent source count; copied/shared feeds cannot manufacture corroboration. |
| Originating market | Pass after outside review | Main, alternate, exchange, derivative, and correlated-market moves retain origin; mechanical repricing is not new corroboration. |
| Market state and news | Pass after revision | Time-to-start and verified news sequence are preserved; unobserved limits/liquidity cannot be claimed; news already in the model is not new corroboration. |
| Splits | Pass after revision | Provider denominator/methodology and missingness are explicit; money-minus-tickets is not synonymous with professionals. |
| Probability quality | Pass after revision | Proper scores, calibration diagnostics, distribution scoring, and uncertainty accompany side accuracy. |
| Backtest integrity | Pass after revision | Candidate registry, chronological confirmation, clustered paired uncertainty, ablation, interactions, placebo tests, and multiplicity control. |
| Execution realism | Pass after revision | Exact simultaneously available quote, availability window, no-vig/target exclusion, fixed-stake economics, and separate stake policy. |
| Book intent | Pass after outside review | A move is not presumed to balance action or reveal informed money; intent remains latent unless supported by observed fields and validation. |
| Upset awareness | Pass | Precision/recall and margin/probability consequences; no quota for underdogs. |
| Board usefulness | Pass | Continuous coverage reporting plus explicit governance review for severe contraction; no quota-driven threshold tuning. |
| Coherence and locks | Pass | One joint distribution; immutable locked payloads and reader precedence. |
| Operations | Pass after revision | Per-market monitoring, data-versus-model incident classification, complete-family rollback, and live verification. |

## Gaps found and closed in this audit

The first standard already covered the core market-reading semantics but left several controls implicit.
This audit makes them mandatory:

1. Provider quote time and local receipt time are distinct, preventing late-arriving evidence from being
   backdated into a lock.
2. The independent model receives an information-lineage audit so upstream market information cannot be
   double-counted downstream.
3. Sportsbook breadth is adjusted conceptually for common feeds, operator families, and lead/follow
   dependence instead of treating every logo as an independent vote.
4. Named-book authority must be re-earned by current sport/market/lead-time evidence rather than retained
   indefinitely by reputation.
5. Split-feed denominator and methodology changes, thin-market coverage, and other nonrandom missingness
   are evaluated explicitly.
6. Injury, lineup, weather, roster, and news timing is aligned with the quote sequence; a move is not called
   professional merely because it followed public information.
7. Independent-only, market-only, active, candidate, ablation, and interaction views separate incremental
   value from favorite repetition and component attribution.
8. Clustered paired uncertainty prevents Moneyline, Spread, and Total from one game—or many games in one
   week—from being treated as fully independent evidence.
9. Every materially tested variant remains in the candidate registry. Untouched confirmation or an
   explicit backtest-overfitting/multiple-testing adjustment is required after broad searches.
10. Exact-price backtests use a simultaneously available quote rather than hindsight price shopping.
11. Placebo evidence checks provide a falsification test for pipelines that may manufacture apparent edge.
12. Post-release source, evidence, probability, flip, grade, coverage, and calibration monitoring receives
   explicit rollback triggers.
13. Same-line no-vig construction and push-included versus push-excluded probability conventions are
   versioned so apparently similar probabilities are not silently compared under different semantics.
14. A reference computation path now turns source-aware evidence into a chronologically calibrated
   residual and uncertainty, applies it once to the independent distribution, and keeps exact-price
   grading downstream without imposing one universal cross-sport model.
15. The outside-review pass distinguishes the market-wide opener, book opener, first product observation,
    and post-suspension reopening so cross-book displacement cannot be mislabeled same-book movement.
16. Quote lifecycle and tradability now exclude suspended, corrected, stale, bad, or realistically
    unavailable quotes from executable evidence.
17. Hold/vig changes and asymmetric shading are separated from changes in fair belief when two-sided
    observations permit it.
18. Originating and derivative/correlated markets remain separate so copied, arbitrage-driven, or
    mechanical repricing cannot manufacture independent confirmation.
19. Bookmaker intent is not inferred from a move; belief, demand shading, exposure management, copying,
    and hold changes are competing explanations that sport-specific evidence must resolve empirically.
20. Percentage share, absolute handle, ticket counts, bet-size distribution, and arrival velocity are
    different fields; unavailable volume cannot be invented from percentages.

## What the standard deliberately does not decide

The shared contract does not decide that a 0.5-point move, 10-point split gap, two leading books, three
followers, or any other number is universally correct. It does not require small score moves, forbid large
flips, require market agreement, require underdog picks, or require a fixed number of plays. Those are
sport/market hypotheses that must win chronological testing and preserve a useful product.

It also does not guarantee profitability. A good forecast may be fully priced, and a profitable quote may
exist only briefly. Prediction quality, probability calibration, and executable wager value remain
separate reported outcomes.

## NFL implication

The NFL adapter now exposes rather than hides its remaining work: same-book movement versus opening-to-
consensus displacement, paid-score information lineage, effective sportsbook independence, quote receipt
latency, news-aligned sequences, continuous threshold alternatives, contrary-side confidence calibration,
Total authority, sparse split/sequence evidence, and numerical post-release monitoring bands.

Until those gaps clear their tests, the active r27 reader remains unchanged. The rejected October 9
candidate is evidence that better opened upset/score metrics cannot justify a two-play board or a weaker
Spread result.

## Research support

- Gneiting and Raftery's proper-scoring framework supports evaluating honest probability distributions,
  not only winner accuracy: https://doi.org/10.1198/016214506000001437
- Bailey, Borwein, López de Prado, and Zhu formalize the risk of selecting the best historical result from
  many backtests: https://doi.org/10.2139/ssrn.2326253
- Simon finds sportsbook forecast changes can overreact and need not improve monotonically:
  https://doi.org/10.1287/mnsc.2022.00456
- Krieger and Fodor show movement informativeness varies with the market's likely informed-trader profile:
  https://doi.org/10.1016/j.jeconbus.2013.04.002
- Fodor, Onuk, and Shank find that American-football key-number crossings can produce large demand changes
  without a return-predictability discontinuity: https://doi.org/10.1016/j.frl.2026.110193

## Completion condition

After the independent outside-review pass, no unresolved critical category is missing from the shared
governance contract. The shared standard is complete as a governance and research contract. An individual sport remains
incomplete until its adapter supplies the required evidence, calibration, uncertainty, board replay,
monitoring bands, and live verification. Updating the standard does not itself authorize or deploy a model
change.
