# Oddsphere sharp market-reading standard

Status: product and model-audit contract.

Date established: 2026-10-09.

## Product goal

Oddsphere combines an independently owned sport model with a source-aware market reader to produce one
coherent final score distribution, prediction, probability, exact-price decision, and grade.

The market reader is not a display layer, a universal market weight, or an instruction to follow every
move. Its job is to distinguish information from noise, decide whether the market confirms, resists, or
corrects the independent opinion, and determine whether value still exists at the number and price a
member can actually bet.

A successful reader must improve the joint product across four dimensions:

1. prediction quality, including Moneyline, Spread, Total, and upset awareness;
2. probability quality, measured by calibration, Brier score, and log loss;
3. wagering quality at the exact available quote, measured separately from prediction accuracy; and
4. useful but selective product coverage, without manufacturing action or flattening a healthy board.

No one dimension may silently substitute for another. A closing line can be a better forecast while no
longer offering a good bet. A high-hit-rate smaller board can still be an unacceptable product if it was
created by unjustified blanket demotions. A populated board is not acceptable if its edges are synthetic.

## Shared evidence contract

Every sport adapter must preserve these identities before interpreting evidence:

- exact event, league, market, side, line, and regulation/full-game scope;
- sportsbook and source class: named sharp/reference book, retail book, exchange, or multi-book public
  consensus;
- provider observation time, source update time when available, evaluation time, and game start time;
- opening, prior, current, and T-60 observations without reconstructing a missing earlier state from a
  later quote;
- complete same-line two-sided prices, raw implied probabilities, a versioned vig-removal method, and
  explicit push treatment for no-vig probability; and
- evaluated-target exclusion so a sportsbook cannot validate the quote selected from that same book.

Missing, stale, future-dated, cross-event, cross-book, cross-line, or incomplete evidence is unavailable.
It is never silently converted to neutral agreement.

### Information lineage and clock integrity

Every input must identify whether it is independent, market-derived, or derived from another input already
present in the reader. The independent model must disclose any direct or indirect market features so the
same market belief is not counted once upstream and again by the market reader.

Provider event time, provider quote time, local receipt time, evaluation time, lock time, and scheduled
start time remain separate fields. The audit measures clock skew, polling latency, deduplication, source
outages, and quote age. A quote first received after the boundary cannot be backdated into the decision,
even if its provider timestamp is earlier. Raw observations or immutable hashes must remain reproducible
enough to prove what the system could actually know at the time.

### Quote lifecycle, opening identity, and tradability

“Opening” is not one universal object. A sport adapter must distinguish the first market-wide opener, each
book's first posted quote, the first quote the product actually observed, and a reopening after suspension.
It must never compare one book's opener with another book's current quote and label the result same-book
movement. Provider corrections, duplicate snapshots, stale/off-market outliers, suspended markets,
reopened markets, obvious bad lines, and quotes that could not realistically be accepted are separately
flagged. A displayed but suspended, rejected, or stake-limited quote cannot become executable backtest
value merely because it appears in a feed.

## Evidence channels that must remain distinct

### Number movement

Spread or Total line movement is the change in the posted number on one continuous sportsbook trail.
Crossing a key number, changing favorites, or moving multiple points can be more meaningful than an equal
raw move elsewhere, but the sport adapter must predeclare its key-number logic.

### Price movement

Odds movement at the same number is distinct from line movement. A move from -105 to -125 at -3 is not
the same observation as a move from -3 to -3.5. When the number changes, the reader must not attribute the
entire price change to demand for one side without line-aware normalization.

Prices on different Spread or Total numbers do not form a two-sided no-vig pair. If same-line comparison
is unavailable, a sport-owned line-aware distribution may translate between numbers, but the translated
probability must remain labeled rather than represented as observed consensus.

Two-sided hold and vig shape are retained through time. A selected-side price change can reflect a change
in the book's margin or asymmetric shading rather than the same-sized change in fair belief. The reader
therefore decomposes, when data permit, fair-probability movement, hold movement, number movement, and
side-specific shading instead of treating raw American-odds change as one signal.

### Cross-book consensus and disagreement

A single book may lead, lag, shade, or correct an error. Multi-book agreement can corroborate a move;
book disagreement can indicate stale prices, price discovery, or uncertainty. Averaging books without
preserving identity destroys the sequence and is not allowed.

Sportsbooks are not automatically independent observations. Books may share feeds, copy a leader, belong
to one operator family, or update from the same news. Consensus breadth must report both raw book count and
effective independent source count. A duplicated or follower-heavy board cannot manufacture corroboration.

### Named-book sequence

Named/reference books may receive greater authority only when the sport adapter validates that hierarchy.
A qualified sequence records who moved first, whether other books followed, persistence, reversals, and
buyback. A final snapshot alone cannot establish lead/follow behavior.

The reader also records the likely originating market. A Moneyline, Spread, Total, exchange, alternate
line, derivative, or related player market can move first and be copied elsewhere. A follower in a
correlated market is not independent confirmation until the sport adapter demonstrates incremental
information beyond the origin. Mechanical repricing, arbitrage alignment, middling, and position buyback
can create real movement without expressing a new terminal-outcome opinion.

### Money and tickets

Money-minus-ticket divergence is a source-specific order-flow observation, not automatic proof of
professional money. The reader must preserve which source supplied it, book count or sportsbook identity,
line match, freshness, and both complementary sides. Public multi-book consensus and a named-book split
are separate evidence families. A raw gap cannot independently earn “sharp” authority unless that exact
sport/market relationship is chronologically validated.

Percentages, counts, and volume are different evidence. A 70% handle share does not reveal whether the
market received $7,000 or $7,000,000; a 30% ticket share does not reveal the number of bets or their size
distribution. When available, the reader stores absolute handle, ticket count, incremental handle/tickets
between observations, average/median bet size or disclosed size bands, and arrival velocity. When those
fields are unavailable, it may describe only relative share and may not claim that “a lot of money,” one
large wager, or a wave of professional wagers arrived.

The split provider's denominator, included books, sampling interval, update method, and definition of
money and tickets must be recorded when available. A change in provider methodology or participating book
mix is a regime change, not ordinary drift. Missing splits may be nonrandom—for example, thin or low-
profile markets—and audits must compare covered and uncovered games rather than treating missingness as
representative.

### Reverse-line movement and resistance

Reverse-line movement exists only when a verified ticket majority and a coherent same-book movement run
in opposite directions. Heavy money with no move, adverse price movement, a stalled key number, or buyback
may indicate resistance, but each is a different pattern. The reader records the pattern before deciding
whether it is informative for that sport and market.

Every sport adapter must be able to represent, without presuming the winner, at least these reaction
states: flow and number/price move together; money and tickets disagree and the market follows either
side; heavy relative share with no response; price changes while the number holds; the number changes
after price pressure; a move occurs against both reported shares; books disagree; and an initial move is
bought back. Magnitude, elapsed time, source, line location, and later follow-through remain attached.
The adapter then validates which states confirm, resist, correct, flip, or remain neutral for that exact
sport and market.

### Market state, limits, and external news

The same move can mean different things at a low-limit opener, after limits rise, after an injury or lineup
announcement, or in a mature market near lock. Each adapter must preserve time-to-start and available
market-state proxies. It must not claim high limits, liquidity, or professional action when those fields
are not observed.

Known injury, lineup, weather, roster, rest, and news timestamps are causal context, not automatically a
separate market signal. If the independent model already consumes the information, the market response may
measure residual disagreement but cannot count the same news as independent corroboration. A move that
precedes verified public news, one that reacts to it, and one that reverses after it are different sequences.

A sportsbook quote is not assumed to be a market-clearing forecast or a command to balance equal action.
Books may express their own belief, shade predictable demand, manage exposure, copy another market, or
change hold. Because the cause is usually latent, the reader infers authority from reproducible sequences
and outcomes rather than assigning intent from the direction of one move.

### Cross-market evidence

Moneyline, Spread, and Total are linked but not interchangeable. On a short spread, Moneyline price and
Spread direction may jointly indicate a winner change or upset while disagreeing on margin. A Total move
can change both team scores without choosing a winner. Cross-market evidence may authorize a larger score
change only through a predeclared coherent mapping; it cannot leave the score, pick, and probabilities in
conflict.

## Standard interpretation states

Every game/market read must resolve to one of these states, with its evidence and reason stored:

- `unavailable`: required identity, chronology, freshness, or source breadth is missing;
- `neutral`: valid evidence exists but is flat, weak, or mutually offsetting;
- `confirm`: qualified market evidence supports the independent side;
- `resist`: market evidence weakens the independent side without validating the opposite side;
- `correct`: qualified evidence changes the Spread or Total direction while preserving the outright
  winner when appropriate;
- `flip`: qualified evidence changes the outright winner or creates an upset call;
- `conflict`: material evidence families disagree, requiring reduced authority or a stand-down; or
- `buyback`: an earlier move reversed materially, so the final snapshot cannot be treated as persistent
  one-way information.

The public prediction remains complete when evidence is unavailable. Missing market evidence cannot erase
the independent projection; missing exact-price evidence can hold the bet grade while retaining the pick.

## Evidence authority ladder

Each sport and market must populate its own thresholds and demonstrated performance, but it must use the
same ladder:

1. **Tier 0 — unavailable/no authority.** Preserve the independent projection.
2. **Tier 1 — isolated context.** One valid movement, price lean, or split family may make a bounded score
   or confidence adjustment only if that effect is validated; it cannot receive a “sharp money” label.
3. **Tier 2 — corroborated evidence.** Two genuinely independent families agree, such as same-book
   movement plus line-matched splits, or selected-book movement plus target-excluded named-book consensus.
4. **Tier 3 — sequenced authority.** A validated named-book lead, persistent follow-through, no material
   buyback, and no fresh opposing veto can authorize the sport adapter's largest tested correction or flip.

Counting the same underlying quote in two derived metrics does not create two evidence families.

Authority is dynamic. A sportsbook is not permanently “sharp” by reputation alone. Lead rate, follower
response, stale-quote rate, prediction calibration, and incremental correction/harm must be monitored by
sport, market, season, time-to-start, and market profile. A source loses elevated authority when current
chronological evidence no longer supports it.

## Threshold and boundary method

Thresholds are not all the same. Every sport adapter must identify each threshold as one of these types:

1. **Integrity gate.** Exact-event identity, chronological ordering, complete two-sided prices, no future
   information, and evaluated-target exclusion are hard pass/fail requirements. Evidence that fails one
   cannot be partially trusted.
2. **Coverage gate.** Minimum sportsbook breadth, freshness, or follower count determines whether a claim
   such as consensus or lead/follow is supportable. Passing the gate makes the signal eligible; it does
   not make the signal automatically strong or correct.
3. **Predictive-strength feature.** Move size, price change, split gap, persistence, reversal, book count,
   and model/market disagreement should be continuous, monotone, or empirically defined bands whenever
   the data support it. A value immediately below a convenient cutoff must not become zero while an
   almost identical value immediately above it receives full authority unless a real discontinuity is
   demonstrated.
4. **Decision boundary.** A final side necessarily changes when the coherent distribution crosses the
   relevant event boundary: 50% for a binary winner, the posted Spread, or the posted Total. Spread and
   Total adapters must specify whether selection uses full probability with explicit push mass or a
   push-excluded normalization; those conventions cannot be mixed. The boundary chooses the side; it does
   not manufacture confidence or an actionable grade.

Independent weak evidence can accumulate when its sources are genuinely independent. Two corroborating
signals that each fall just below a legacy one-dimensional cutoff must be evaluated jointly rather than
both discarded. Conversely, several transformations of one quote remain one signal regardless of how many
nominal thresholds they cross.

A discrete predictive threshold is permitted only when selection data demonstrate an actual change in
outcomes or calibration near that boundary and chronological confirmation preserves it. Every proposed
threshold must publish:

- sample counts and outcomes immediately below and above it;
- sensitivity at reasonable lower and higher alternatives;
- whether the response is monotone or unstable;
- calibration, correction/harm, and board impact for those alternatives; and
- a ledger of decisions that change solely because the observation moved across the boundary.

When adjacent thresholds perform similarly, prefer a continuous or tapered response. When data are too
sparse to estimate one, retain the observation as context, use conservative uncertainty, and do not call
the cutoff “sharp.” Thresholds cannot be tuned to the opened loss ledger or adjusted merely to reach a
desired number of plays.

Near a prediction boundary, the product still publishes the coherent side and score, but labels its true
probability rather than pretending the side is a high-confidence flip. Exact-price actionability remains
downstream. Optional hysteresis may stabilize repeated unlocked refreshes around a display or grade
boundary, but it cannot alter immutable locks or conceal the underlying continuous probability.

## Marriage with the independent model

The independent model remains separately stored and auditable. The market reader receives it as the
starting opinion and must follow these rules:

- Agreement may preserve or increase conviction only through a calibrated confirmation path.
- Disagreement first creates resistance. It becomes a correction or flip only when the sport/market's
  authority gate is satisfied.
- A contrary market side never inherits confidence merely because the independent model was confident on
  the opposite side.
- A market-created side receives probability from a validated market-signal calibration or coherent
  target-excluded price/line distribution, not from mirrored independent confidence.
- Every score adjustment starts from the immutable independent base on each refresh. Market effects never
  compound recursively.
- One final joint distribution must own expected scores, representative score, winner, Spread, Total,
  probabilities, and downstream exact-price grades.
- No reader-only side, probability, or grade patch may contradict the writer-owned joint distribution.

Every candidate must be compared on the same rows against four reproducible views: independent-only,
market-only, active production marriage, and candidate marriage. The market reader qualifies by
incremental value conditional on the independent opinion—not by a standalone market record that may only
repeat the favorite baseline. Agreement and disagreement cohorts are reported separately, including how
often resistance, corrections, and flips help or harm.

Ablation removes one evidence family at a time; factorial tests isolate interactions such as movement plus
splits or Moneyline plus Spread. If only the full bundle improves, the audit cannot attribute the gain to
one component. Evidence strength and uncertainty must propagate into the final distribution rather than
being discarded after a categorical label is assigned.

### Reference computation architecture

The preferred implementation, when sample size supports it, is a chronologically fitted residual reader:

1. normalize each valid evidence channel into signed, line-aware features while retaining source identity;
2. attach market-state context such as time-to-start, source class, market profile, verified news timing,
   missingness, and effective independent source count;
3. estimate on selection data how that evidence changes the independent model's margin, Total, or outcome
   residual and uncertainty, using shrinkage or a monotone calibrator where appropriate;
4. create out-of-fold market-only estimates and combine correlated evidence once rather than summing
   labels or weights;
5. apply the estimated residual once to the immutable independent distribution and propagate uncertainty;
6. derive every score, side, and probability from that final joint distribution; and
7. evaluate the separately selected exact quote downstream.

This is an architecture, not permission for one cross-sport fitted model. A rule-based adapter remains
acceptable when data are sparse, but its response must be tapered or boundary-tested, its interactions
predeclared, and its authority limited to what chronological evidence demonstrates. Universal weights,
after-the-fact caps, and hand-tuned loss fixes do not satisfy the standard.

## Upset-awareness standard

Upset awareness is an explicit evaluation dimension, not a mandate to pick more underdogs.

Each sport audit reports:

- actual upsets under the frozen market-favorite definition;
- predicted upsets, caught upsets, false calls, precision, and recall;
- qualified market-created upset calls versus independent upset calls;
- short-spread Moneyline/Spread interaction; and
- whether an upset correction improved margin error and probability quality, not just winner count.

A winner flip requires Moneyline-specific corroboration. Spread evidence alone may change cover direction
or compress a margin without automatically changing the winner.

## Prediction versus bet standard

The forecast and the wager are evaluated separately:

- Movement toward a side can improve the forecast while removing the attractive earlier number.
- Current target-excluded consensus estimates the market's present belief; it does not prove value at an
  identical current quote.
- A bet grade requires the frozen final probability, the exact offered line and price, target-excluded
  comparison breadth, and the unchanged sport-specific EV/edge/cushion gates.
- Price shopping may reveal a lagging actionable quote even when the consensus number is efficient.
- Closing-line value is a diagnostic, not a substitute for settled outcomes or probability calibration.

Backtests must use a quote that was actually available at the simulated decision time, with its exact
line, price, book, observation/receipt time, and realistic availability window. They may not assume the
best price across observations that were never simultaneously bettable. Report fixed-stake units and ROI
separately from forecast scores; if nonzero staking is ever enabled, bankroll risk, limits, void/push
rules, correlation between positions, and stake sizing require a separate versioned policy.

## Anti-flat-board and product-coverage gate

Board size is an acceptance metric, not a quota and not a tuning target.

For every current-board replay, report by market and grade:

- prior and candidate Best Angles, Leans, Watchlists, No Plays, and Holds;
- promotions, demotions, retained actionables, and net actionables;
- which evidence tier owns every promotion or demotion; and
- coverage lost to missing data separately from plays removed by model judgment.

A candidate is presumptively held for explicit owner review when it:

- takes a market with existing actionables to zero;
- removes more than half of all current actionables;
- produces only demotions with no tested confirmation/promotion lane;
- increases No Plays primarily through missing or misclassified evidence; or
- improves headline hit rate only by shrinking to a tiny, unrepresentative subset.

The response to a failed gate is to diagnose missing authority, bad evidence identity, or an invalid
integration rule. Thresholds may not be loosened merely to refill the board. A genuinely sparse market may
still produce a sparse board, but that requires explicit evidence and owner acceptance.

The half-board and market-to-zero rules are governance review triggers, not claims of predictive
discontinuity. Coverage is also reported continuously per game, market, and slate size. A candidate does
not pass merely by staying one play above a trigger, and it does not fail solely because a genuinely empty
market crosses one; the evidence, reason, and owner decision remain explicit.

## Required sport-specific adapter

No sport is complete until its adapter documents:

1. eligible markets and settlement scope;
2. lock/evaluation times, receipt latency, and the observations available by each boundary;
3. source hierarchy, effective source independence, target-exclusion rules, and authority monitoring;
4. line, price, key-number, market-state, news-sequence, persistence, reversal, and buyback definitions;
5. split sources, identity, freshness, and validated signed relationships;
6. evidence-tier construction and conflict/veto precedence;
7. Moneyline/Spread/Total or related-prop cross-market mapping;
8. independent-model information lineage plus confirmation, resistance, correction, and flip rules;
9. score/probability reconstruction and coherence checks;
10. exact-price actionability and grade rules;
11. upset-awareness definition and metrics;
12. candidate registry, historical selection, chronological confirmation, uncertainty, and falsification;
13. current-board promotion/demotion and coverage impact; and
14. release identifiers, one writer/lease, monitoring bands, immutable-lock reader precedence, and rollback.

The adapter must additionally make quote lifecycle, opening definition, tradability, hold/vig change,
originating-versus-derivative market, and observed-versus-inferred liquidity explicit inside the relevant
fields above. These are required semantics, not optional generic context.

Thresholds and weights are sport/market owned. NFL key-number behavior cannot be copied to college
basketball; MLB moneyline split findings cannot activate an NBA spread rule; a player-prop market needs
player/line/exact-role identity that a game market does not.

## Required evaluation package

Before a model-changing publication:

- predeclare the candidate before opening outcomes;
- use release-pure rows and evidence captured no later than the evaluated/locked timestamp;
- separate selection, chronological confirmation, and opened diagnostics;
- register every materially tested candidate and parameter family, including rejected variants, so the
  winning backtest is not presented as if it were the only test;
- compare the exact stored decision with the counterfactual candidate decision;
- compare independent-only, market-only, active marriage, and candidate marriage on identical rows;
- run component ablations and predeclared interaction tests;
- publish the full loss ledger and a matched-win ledger, not only aggregate accuracy;
- report direction accuracy, Brier, log loss, calibration, score-axis MAE/RMSE, exact-price units/ROI,
  grade monotonicity, upset precision/recall, and uncertainty;
- include calibration intercept/slope or reliability bins where sample size permits and CRPS or another
  proper score for a released score distribution;
- use paired uncertainty with game/week/season clustering appropriate to the data; report denominators and
  intervals rather than treating correlated markets from one game as independent rows;
- report season, market, favorite-size, time-to-start, source, evidence-coverage, and relevant market-
  profile slices without promoting a rule from a favorable slice alone;
- compare covered and missing-evidence populations and disclose survivorship, cancellation, stale-quote,
  and settlement exclusions;
- report corrections, harms, promotions, demotions, retained actionables, and side changes by evidence tier;
- publish threshold-neighborhood ledgers and lower/base/upper sensitivity for every predictive cutoff;
- run falsification checks such as timestamp-shifted, source-shuffled, or direction-permuted evidence when
  feasible; a pipeline that finds similar value in placebo evidence is not learning a credible market read;
- replay the current board with zero writes;
- prove a promotion/confirmation path alongside every demotion rule;
- preserve every locked payload and its reader precedence; and
- pass the repository model-change, focused sport, integration-safety, protected-PR, and post-deploy
  verification contracts.

Backtest selection risk is part of the result. When many variants are tried, an untouched chronological
confirmation set, shrinkage, or an explicit multiple-testing/backtest-overfitting adjustment is required.
An opened cohort may diagnose a defect or reject a candidate, but it cannot alone estimate future edge.

## Post-release monitoring and rollback

Each released reader defines monitoring bands before deployment for evidence coverage, source age, source
mix, line/price distributions, interpretation-state mix, score/probability shift, flips, upset calls,
promotions/demotions, actionable coverage, and settled calibration. Monitoring is segmented by sport and
market; healthy aggregate counts cannot hide one failed market.

Trigger conditions must distinguish provider/data incidents from model drift. A rollback returns future
unlocked decisions to the complete preceding release family, never rewrites locks, and never mixes old
probabilities with new grades. Unexpected source-methodology changes, clock violations, target leakage,
coherence failures, market-to-zero coverage caused by missing evidence, or materially adverse calibration
are stop conditions rather than invitations to tune live thresholds.

## Research basis

The standard deliberately does not assume that later or sharper-looking movement is always correct.
Published research supports three simultaneous facts: betting lines aggregate information, bookmaker
prices need not simply balance money, and intragame/intraweek movements can overreact or encode sentiment.
That combination requires source-aware sequences and sport-specific validation rather than blanket steam
following.

- Miller and Rapach (2013), *An intra-week efficiency analysis of bookie-quoted NFL betting lines in
  NYC*, found increasing information content across sequential NFL lines alongside sentiment-related
  inefficiencies: https://doi.org/10.1016/j.jempfin.2013.07.002
- Simon (2024), *Inefficient Forecasts at the Sportsbook*, found mostly reliable real-time forecasts but
  non-monotonic improvement and negatively autocorrelated overreaction in MLB line changes:
  https://doi.org/10.1287/mnsc.2022.00456
- Levitt (2004), *Why are gambling markets organised so differently from financial markets?*, showed that
  bookmakers may take positions and exploit bettor bias rather than mechanically balance both sides:
  https://doi.org/10.1111/j.1468-0297.2004.00207.x
- Shank (2022), *Information asymmetry in the NFL gambling market*, found that the interaction of bettor
  money and sportsbook response matters; movement direction alone did not have one universal meaning:
  https://doi.org/10.1016/j.jbef.2022.100758
- Krieger and Fodor (2013), *Price movements and the prevalence of informed traders*, found that college-
  basketball movement informativeness varied with market profile and likely informed-trader concentration:
  https://doi.org/10.1016/j.jeconbus.2013.04.002
- A 2026 American-football regression-discontinuity study, *Do economically meaningful quote differences convey private
  information?*, found large demand changes when Spreads crossed key numbers three and seven but no
  corresponding discontinuity in realized returns. Key-number contract value and bettor response therefore
  must not be mislabeled as automatic information authority: https://doi.org/10.1016/j.frl.2026.110193
- Walsh and Joshi (2024), *Machine learning for sports betting: Should model selection be based
  on accuracy or calibration?*, found calibration-based model selection materially outperformed accuracy-
  based selection in their NBA betting experiment. Oddsphere therefore evaluates probability quality and
  exact-price economics alongside side accuracy: https://doi.org/10.1016/j.mlwa.2024.100539
- Gneiting and Raftery (2007), *Strictly Proper Scoring Rules, Prediction, and Estimation*, established
  why proper scores such as Brier/log score evaluate honest probabilistic forecasts rather than only the
  selected side: https://doi.org/10.1198/016214506000001437
- Bailey, Borwein, López de Prado, and Zhu (2015), *The Probability of Backtest Overfitting*, formalized
  the risk of selecting a winning historical strategy from many tried alternatives. Oddsphere therefore
  preserves rejected candidates and requires chronological confirmation or an explicit multiplicity
  adjustment: https://doi.org/10.2139/ssrn.2326253

## Definition of done

A sport-specific market reader is done only when all fourteen adapter fields are documented, every active
input has a proven interpretation state and authority tier, every threshold is typed and boundary-tested,
the independent/final/market-only opinions are reproducible, the score and all predictions align, the
exact-price decision is downstream, upset and calibration metrics are reported, the current board passes
the anti-flatness gate, backtest-selection risk and source dependence are addressed, post-release monitors
and rollback triggers are defined, locked records remain immutable, and the deployed release is verified
live.
