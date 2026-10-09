# OddsSphere professional market-reading certification standard

Status: mandatory audit contract for every Daily Edge and Player Props model.

Date: 2026-10-09

## Purpose

This contract defines what OddsSphere means by a professional, prediction-bearing market reader. It
prevents a safe implementation, an attractive market narrative, or one favorable aggregate from being
mistaken for a complete market-reading product.

Every model audit has two layers:

1. this common certification, which is identical across products; and
2. a sport-and-market profile, which defines the relevant scoring unit, key numbers, market relationships,
   liquidity hierarchy, timing windows, and settlement rules for that exact model.

A generic cross-product rule may not replace the sport-and-market profile. A sport-specific rule may not
waive the common certification.

## Governing product objective

OddsSphere optimizes the **final combined forecast**, not the independent model or market reader in
isolation. The independent model supplies an original opinion; the market reader may confirm it, move it,
or reverse it. One final distribution must then own the displayed score or projection, prediction side,
probability, price evaluation, grade, and stake.

Among candidates that satisfy evidence integrity, target exclusion, time safety, lock immutability, and
forecast coherence, production selection favors the candidate with the greatest defensible **net
predictive value**. Net predictive value includes additional correct sides minus newly created wrong
sides, exact-price return, probability accuracy, projection error, actionable-grade performance, upset
recognition, and useful board coverage. It is not synonymous with zero retrospective harms.

A candidate may lose some decisions and still be superior when it corrects materially more decisions,
improves the final forecast, and does not create unacceptable calibration, price, stability, or board
damage. Conversely, a zero-harm candidate does not win automatically when it achieves that result only by
changing almost nothing. The audit must expose both the gain and the cost.

## Required audit populations

The audit must keep these populations separate:

- **market-only history**: every locked event with honest pre-lock market history, regardless of the
  independent-model release;
- **historical combined product**: market evidence joined only to the independent release that actually
  existed at that lock;
- **current-release replay**: the proposed reader joined to the current independent release on a frozen,
  chronologically eligible population;
- **current board, zero write**: exact production inputs evaluated without changing storage;
- **unavailable history**: events that cannot be reconstructed honestly, reported as unavailable rather
  than silently excluded or backfilled with later evidence.

Opened retrospective evidence can diagnose and generate hypotheses. It is never labeled an untouched
holdout. Results are reported by release, week or time segment, and evidence-coverage regime before any
overall number.

## Evidence certification

For every observation that can influence a prediction, the audit must prove:

1. exact event, market, side, sportsbook, number, both prices, provider observation time, and capture time;
2. no-vig probability and hold calculated from the same two-sided quote;
3. opening, intermediate observations, lock quote, first material move, last economic move, reversals,
   buyback, persistence, and stale or missing intervals;
4. source identity for every split, including whether it is public consensus, a named book, retail book,
   unknown book, or exchange-derived;
5. ticket and money percentages are not converted into bet counts, handle dollars, bet size, limits, or
   bettor identity when those denominators are unavailable;
6. book authority is based on the sportsbook that actually supplied the observation, never the API or
   vendor name that transported it;
7. target-book exclusion is rebuilt for the exact evaluated book family and prevents target leakage;
8. immutable lock precedence: no evidence observed after the member lock can affect that locked forecast.

Missing required evidence is a product/data finding. It does not become a neutral pass.

## Signal-family certification

Each model must score all captured signal families separately before testing combinations:

- same-book number movement;
- same-book price movement at a constant number;
- combined number-and-price movement;
- hold movement and possible margin-only changes;
- named-book lead and subsequent follower order;
- multi-book direction, breadth, dispersion, outliers, stale books, and disagreement;
- money-minus-ticket gap by its actual source class;
- ticket majority separately from money-minus-ticket gap;
- reverse line movement, flow resistance, price-against-flow, named-versus-retail disagreement, reversal,
  and buyback;
- opening-to-lock magnitude as a continuous value and in neighborhoods around every proposed boundary;
- timing from first move, named-lead completion, last economic move, or reversal to member lock;
- related-market agreement and conflict;
- known injury, lineup, weather, limit, or news timing only when it was actually captured before lock.

Every family reports coverage, source counts, missingness, W-L-push where applicable, exact-price units,
probability scoring where applicable, uncertainty intervals, timing bins, magnitude neighborhoods, and a
row-level ledger. A high hit rate on a tiny selected subset is descriptive evidence, not automatic authority.

## Two questions that must never be conflated

Every movement signal is evaluated for both:

1. **information quality** — did it improve the market estimate relative to the opener or correctly move
   toward the realized outcome?; and
2. **actionable residual value** — after the move was incorporated, did the indicated side still beat the
   exact quote available at the member lock?

A move can be informative but fully priced. It can also overreact and create value on the opposite side.
OddsSphere may not follow a signal merely because the move was directionally intelligent.

## Interaction with the independent model

For each historical independent release, the audit must separately identify:

- confirmation: market and independent forecast agree;
- contradiction: market evidence opposes the independent forecast;
- correction: acting on the market would repair a losing independent side;
- harm: acting on the market would replace a winning independent side;
- abstention or demotion: conflict or uncertainty reduces actionable confidence;
- promotion: corroboration creates a genuinely actionable opportunity;
- winner reversal: related winner markets jointly support changing the outright winner;
- projection movement: the score or point projection changes enough to remain coherent with the final side.

The final projection, side, probability, price, grade, and stake must come from one coherent distribution.
A flipped side may not inherit the original side's confidence by mirroring it around 50 percent **without
an explicit calibration challenge**. The audit must compare the full-strength mapping with price-anchored,
shrunk, or otherwise evidence-supported alternatives and report probability, direction, projection, return,
upset, and board tradeoffs. Retaining magnitude is allowed only when that complete comparison supports it;
it is never justified merely because the side flipped. Any demotion rule must be paired with a tested
promotion rule, and both must report the exact board-count effect.

The audit must publish two separate comparisons:

1. **independent-to-final**, which measures the complete value and harm created by the full market-aware
   product; and
2. **incumbent-to-candidate**, which measures only the incremental effect of the proposed release.

An incremental comparison may not be presented as the total amount of market reading. A candidate that
adds four corrections to an incumbent that already makes twenty market-driven changes is a different
product from one that makes only four changes in total.

## Candidate-selection contract

Evidence validity and product safety are hard constraints. Predictive tradeoffs are selection criteria,
not automatic vetoes. Every candidate table must therefore report, by market and in total:

- side changes, corrections, harms, net corrections, and correction-to-harm ratio;
- final W-L-push and improvement over independent-only and the incumbent;
- exact-price units for every decision and for actionables;
- Brier score, log loss, calibration, score/projection MAE, and bias where defined;
- promotions, demotions, actionables, actionable record, and board-count change;
- upset precision and recall where an outright-winner market exists;
- results by chronological segment, independent release, evidence-coverage regime, source class, and
  meaningful sport-specific market state;
- row-level ledgers for every changed side or grade.

No universal maximum harm count or minimum change count is allowed. A nonzero harm count is acceptable
when the complete evidence shows greater net predictive value. A candidate must not be rejected merely
because a narrower rule has zero harms, and it must not be accepted merely because an aggressive rule has
the highest opened-sample hit rate. When candidates trade direction accuracy against probability,
projection, price, or board quality, the audit records the tradeoff and selects the Pareto-efficient option
that best serves the declared product objective.

Candidate selection is lexicographic:

1. reject any candidate with leakage, post-lock evidence, fabricated provenance, lock mutation, incoherent
   final outputs, competing writers, or materially unsafe operations;
2. among valid candidates, prefer positive and stable net predictive value over independent-only and the
   incumbent;
3. use probability calibration, exact-price return, projection error, chronological stability, and board
   utility to distinguish candidates with similar net side value;
4. prefer less unnecessary churn only when predictive value is materially equivalent—not as a substitute
   for predictive improvement.

The same selection contract applies to every OddsSphere model. Sport profiles determine which signals and
relationships are valid; they do not redefine success as safety or zero changes.

## Loss, upset, and conflict review

Aggregate metrics are insufficient. The audit must inspect every:

- authoritative model loss where qualified market evidence disagreed;
- market-signal loss and false-steam case;
- outright underdog win and near-pick'em game;
- disagreement between related markets;
- threshold near miss on both sides of a proposed cutoff;
- large move, key-number crossing, late reversal, and persistent no-response-to-flow case;
- prediction flip, correction, harm, promotion, and demotion generated by a candidate.

The ledger records what was knowable at lock, what the production reader did, what each candidate would
have done, the exact available quote, settlement, and whether the lesson is supported, ambiguous, or
unverifiable. Postgame explanation is not allowed to invent pregame knowledge.

## Sport-and-market profile

Before a model can pass, its profile must define:

- native projection unit and settlement unit;
- related markets that can corroborate or contradict one another;
- meaningful price and number movement scales;
- sport-specific key numbers or nonlinear regions;
- expected liquidity and book hierarchy by time window;
- lock time and which timing bins are operationally actionable;
- favorite/underdog or over/under asymmetries that require separate testing;
- market-specific probability and score-coherence rules;
- injury, lineup, pitcher, quarterback, weather, or role context available to that product;
- minimum board utility expected from promotions, confirmations, reversals, and demotions.

Thresholds are evidence-quality and decision boundaries, not declarations of truth. Every threshold is
audited continuously and with adjacent bands so that a signal just below a cutoff is not assumed different
without evidence.

## Certification outputs

Every completed model audit must deliver:

1. a data-coverage and provenance matrix;
2. standalone signal-family scorecards;
3. timing, magnitude, price-versus-number, and source-class analyses;
4. related-market interaction tables;
5. release-stratified independent-versus-market tables;
6. complete correction, harm, promotion, demotion, flip, upset, and conflict ledgers;
7. score/projection accuracy, probability calibration, exact-price units, and board-count comparisons;
8. rejected alternatives and why they failed;
9. a list of evidence the product does not collect and the consequence of each gap;
10. a zero-write current-board comparison and immutable-lock proof;
11. focused tests, full model-change verification, integration safety, release plan, rollback plan, and
    post-deploy verification plan.

## Pass states and definition of done

Each requirement is labeled **pass**, **fail**, or **unverifiable**. “Unverifiable” is not a pass and must
state whether the product can proceed safely without the missing evidence or whether new capture is
required before prediction authority is allowed.

A model is complete only when:

- every required output above exists and reconciles to row-level evidence;
- selected production behavior improves the declared predictive and product objective on the eligible
  evidence without hidden release blending or target leakage;
- corrections and promotions deliver positive net predictive value without unacceptable calibration,
  price, stability, operational, or board damage;
- final picks, probabilities, projections, and grades are coherent;
- every changed decision can be explained from evidence available at its lock;
- rejected candidates cannot remain reachable in the production path;
- the owner reviews the exact before/after candidate and explicitly approves publication;
- the protected release is verified in production after merge.

Passing this contract does not mean every bet wins. It means the reader uses every available input
truthfully, applies only evidence-supported authority, exposes its uncertainty, and can be audited without
changing the standard after seeing results.
