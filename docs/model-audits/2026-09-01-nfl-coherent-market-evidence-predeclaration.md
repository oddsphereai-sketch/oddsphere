# NFL coherent market-evidence predeclaration

Date: 2026-09-01
Starting production base: `3c114e3c0b696cdafbbd831f3fef8d2746a0a507`
Owner authorization: production NFL Moneyline, Spread, and Total model change explicitly authorized before implementation

## Problem and invariants

The NFL writer currently publishes a mixture of PMF-derived outcomes, a separate Moneyline tuple, and post-PMF Spread/Total residual corrections. Current/opening movement is stored but does not participate in the authoritative score distribution. The result can disagree across projected score, final side, probability, exact-price grade, and the explanatory evidence.

The candidate must produce one authoritative forecast from the independent football projection, current and opening prices, same-book movement, the trained Spread/Total residual heads, Circa splits when strictly available, public splits, quarterback/injury availability, and the exact evaluated quote. It must preserve the weekly slate, portable regular-season runtime, one writer and sport-scoped `prediction_pipeline` lease, quarterback substitution and injury safety behavior, T-60 locks, official tracking, member reader precedence, and existing UI/copy.

Circa remains the primary split authority. Public evidence never substitutes for Circa. Missing or stale evidence is neutral and cannot hold, flatten, or invent a signal.

## Frozen candidate semantics

- Use a strict same-book, correctly ordered, pre-evaluation opening-to-current trail. Invalid or mismatched trails contribute zero.
- Keep the current market at its established 75% forecast weight. Movement is only a bounded 25% complement and is capped at 0.75 score points.
- Move the existing Spread/Total residual calibration upstream into the score distributions instead of applying post-PMF logits. Use 50% of the residual-head logit adjustment; the full adjustment is rejected because it produced excessive actionability and more than a five-point team-score transition in the current-board replay.
- Combine Circa, public, and same-book movement after that calibrated football/market core and before the final PMF. Secondary evidence cannot reverse a nonzero Circa direction.
- Reject an evidence-driven direction crossing when the proposed final advantage is below 2.5 percentage points and there is neither Circa support nor same-direction public/movement corroboration. Keep the calibrated core unchanged in that case. Strong coherent evidence may reverse it.
- Derive decimal expected scores, Moneyline/Spread/Total sides and probabilities, representative score, exact-price EV, and grade from the final PMFs. Do not round or quantize distribution shifts.
- Keep Moneyline prediction and exact-price value selection distinct but coherent. If the final PMF crosses 50%, the predicted winner and expected-score direction must flip together before grading that side. If an exact-price underdog remains below 50%, it may oppose the predicted winner only when its own positive price, at least two target-excluded comparators, at least 2% EV, and at least 2pp consensus edge qualify it independently. Weakening the forecast favorite to No Play cannot manufacture an opposite-side bet.
- Preserve target-excluded same-line/same-market comparison economics. Do not relax price, EV, edge, comparator-depth, or adverse safety rules to fill the board.

## Success criteria

- Score means, PMF probabilities, and displayed prediction agree on the forecast winner. Any evaluated Moneyline bet that differs from that prediction must be a separately qualified sub-50% underdog value tuple carrying its own probability, exact quote, EV, edge, and grade.
- Tests cover strict movement identity/timing, missing evidence neutrality, Circa priority, weak reversal rejection, strong forecast-side reversal reachability, qualified sub-50% underdog value, unqualified-opposite rejection, fractional precision, exact-price economics, promotions, demotions, locks, and official tracking.
- The read-only Week 1 replay reports grades and actionability by market, promotions, demotions, side changes by evidence stage, missing/stale evidence states, exact-quote changes, and maximum projected-score impact.
- The candidate must materially reduce the initial 22/48 side-change transition and must not reduce the 13-actionable board without a comparably tested promotion path.
- Focused NFL tests, typecheck, `npm run verify:model-change`, clean latest-main integration safety, protected PR checks, deployment, natural writer refresh, lock integrity, tracking, and signed-in live QA are required before completion.
