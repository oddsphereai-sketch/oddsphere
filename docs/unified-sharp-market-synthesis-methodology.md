# Unified Sharp Market Synthesis Methodology

Status: design and validation contract; not a production decision release  
Date: 2026-08-14  
Initial scope: MLB moneyline, full-game total, and first inning; WNBA moneyline, spread, and total after the MLB data contract is proven  
Production effect: none

## 1. Objective

Oddsphere must interpret the betting market as one time-aware system, not as a collection of
independent rules. For every candidate bet, it must answer:

1. What does the complete, vig-free market currently imply for both sides?
2. How did that view change, which books led the change, which books followed, and when?
3. Is the change plausibly new information, price discovery, public pressure, buyback, a stale
   quote, a limit/liquidity change, or ordinary noise?
4. What do each source's ticket and money splits add to that interpretation, given that they are
   samples rather than the whole market?
5. What independent matchup information remains after market-derived inputs are removed so the
   same evidence is not counted twice?
6. Do related markets corroborate the same causal story?
7. At the available price, is the selection a bet, merely the most likely winner, or neither?
8. How uncertain is the conclusion, and what genuinely new evidence would justify changing it?

The output is not “the best remaining bet” and must never manufacture quota-filling action. It is
a calibrated, auditable decision for each available market, with enough sensitivity to find real
opportunities and enough uncertainty awareness to avoid false confidence.

## 2. What established evidence supports—and does not support

The methodology rests on defensible market mechanics:

- High-limit, low-margin books can learn from informed order flow and use it in price discovery;
  their prices and leadership therefore deserve different treatment from isolated retail quotes.
  Circa describes this operating model directly, and recent market-structure research reaches a
  compatible conclusion. [Circa bookmaking philosophy](https://www.circasports.com/blog/circa-sports-bookmaking-philosophy),
  [Oxford Economic Papers](https://academic.oup.com/oep/article/78/1/90/8244336)
- Lines move for several causes, including injury/availability news, informed bets, and—especially
  in heavily recreational events—public money. Movement alone does not identify its cause.
  [Circa on line-movement causes](https://www.circasports.com/blog/from-the-experts-line-movement-causes)
- The informativeness of a move depends on market composition and context; magnitude is not a
  universal proxy for information. [Krieger and Fodor](https://papers.ssrn.com/sol3/papers.cfm?abstract_id=1987876)
- Bookmakers do not necessarily balance every book, so ticket or handle imbalance is not a direct
  estimate of true win probability. [Levitt](https://www.nber.org/papers/w9422)
- Mature MLB moneyline markets are difficult to beat after accounting for extensive strategy
  search, so multiple-testing control and untouched holdouts are essential.
  [Applied Economics MLB study](https://www.tandfonline.com/doi/abs/10.1080/00036846.2024.2364115)
- Probability quality must be judged by calibration and proper scoring rules, not hit rate alone.
  [Calibration in sports betting](https://arxiv.org/abs/2303.06021)

These sources do **not** establish a universal rule such as “70% money is sharp,” “a 10-cent move
is steam,” or “money greater than tickets means bet that side.” No universal numeric betting
threshold is treated as proven. Numeric effects must be estimated from Oddsphere's own
point-in-time data, separately by sport, market, book/source, time-to-start, and relevant
liquidity regime.

## 3. Non-negotiable distinctions

### 3.1 Operational gates versus betting evidence

Hard gates are appropriate only for data integrity and execution integrity:

- the event and teams resolve to the intended slate;
- observations occurred at or before the decision timestamp;
- both outcomes of a market are paired closely enough in time to remove vig honestly;
- timestamps, prices, lines, and sources are valid;
- a quote is not stale relative to the source-specific freshness policy;
- a starter/lineup status is not internally contradictory;
- the offered bet still exists at the stated price.

Movement, splits, model probability, projection differences, and price are continuous evidence.
They do not become true or false because they cross an arbitrarily chosen decimal boundary.

### 3.2 Winner selection versus bet selection

A team can be the most likely winner without being a playable bet. Every result must contain:

- selected side and probability distribution/range;
- vig-free reference probability;
- available execution price;
- maximum playable price;
- expected value distribution, not only a point estimate;
- uncertainty and evidence-quality state;
- public grade and reason trace.

### 3.3 Splits are order-flow samples, not truth

For every split source, retain provider, represented book or consensus pool, source type,
observation time, fetch time, number of contributing books when available, tickets percentage,
money percentage, and the matching price/line at that time. Never merge unlike sources into one
anonymous “public/sharp” number.

Money-minus-tickets can suggest differences in average wager size inside a source. It does not by
itself identify informed bettors. Its meaning depends on whether a credible price leader moved,
whether other books followed, when the observation occurred, and whether public news explains
the move.

### 3.4 Both sides are mandatory

Raw American-price movement on the selected side is insufficient. The engine must pair both
sides and calculate vig-free probabilities at each observation. This distinguishes:

- a genuine change in market probability;
- a hold/vig reshaping where both displayed prices change without equivalent fair-probability
  movement;
- a one-sided stale quote;
- a line-value change accompanied by price reset;
- an incomplete or internally incoherent market.

## 4. Canonical point-in-time market state

The synthesis input is one immutable state per game, decision timestamp, and release. Every field
keeps provenance; unavailable evidence remains null with a reason and is never silently replaced
by a different source.

### 4.1 Identity and decision clock

- sport, league, slate date, game ID, provider event IDs, away/home teams, venue;
- scheduled start, decision timestamp, minutes to start, lock timestamp if applicable;
- release IDs for projection, calibration, decision, rule bundle, grade policy, and writer;
- probable/confirmed starters, lineup status, and the timestamps of each status change.

Probable pitchers are valid inputs until confirmed starters replace them. An unpublished
confirmation alone does not erase usable probable-pitcher matchup evidence.

### 4.2 Full price surface

For every relevant sportsbook, market, side, and line value:

- American and decimal price;
- provider-observed and Oddsphere-fetched timestamps;
- book class: high-limit/sharp-reference, retail, exchange if supported, or unknown;
- source quality and stale state;
- opening, first observed, prior observed, current, and locked observations;
- paired opposite-side quote and pairing time gap;
- raw implied probability, overround, and vig-free probability;
- current best execution price and robust consensus reference;
- movement over event time and standard time windows.

The robust reference is formed from fresh, paired, same-line observations. A high-limit reference
and a broader consensus are retained separately; neither is silently substituted for the other.
Median/trimmed aggregation and explicit outlier handling prevent one bad quote from creating a
false edge.

### 4.3 Book leadership and propagation

From the full price paths, derive continuous features:

- first credible group to move: high-limit, retail, simultaneous, or indeterminate;
- change in vig-free probability for each book and book group;
- follower breadth and lag;
- agreement inside high-limit and retail groups;
- movement velocity and persistence;
- price dispersion and convergence;
- reversal/buyback path, including which group led each leg;
- whether the move occurred before or after a known information event;
- whether limits/liquidity are plausibly mature for that time-to-start bucket.

“Sharp move” is not assigned merely because a price changed. It requires a source-aware path that
is consistent with information leadership after stale/outlier and news explanations are handled.

### 4.4 Complete splits

For every available source and both sides:

- tickets and money percentages;
- source identity/type and contributing-book count when available;
- source-observed and fetched timestamps;
- first, prior, current, and locked values;
- 15-minute, 60-minute, and full-observation-window changes;
- persistence, acceleration, and money-minus-tickets path;
- paired price/line at each split observation;
- source agreement or disagreement without collapsing sources.

Complementary percentages may be derived only when the source contract guarantees a two-outcome
market and the observed side/event identity is valid. Derived values remain labeled as derived.

### 4.5 Independent matchup evidence

The matchup layer must be market-independent before combination. For MLB this includes, when
available:

- probable/confirmed starter quality, handedness, pitch mix, rest, workload, and opponent fit;
- bullpen quality, availability, fatigue, and handedness composition;
- offense quality and platoon profile;
- lineup quality and changes from expectation;
- defense, park, weather, travel/rest, and game-specific context;
- independent run and win distributions with input uncertainty.

If a production projection already incorporates market prices, the synthesis engine must either
consume its pre-market independent component or explicitly account for the dependence. It must
not count a market-blended projection and the same market price as two independent confirmations.

### 4.6 Cross-market evidence

Retain related moneyline, runline/spread, total, team-total, and first-inning paths where coverage
is legitimate. Cross-market signals help identify the cause of repricing:

- moneyline plus runline with little total change can indicate team-strength repricing;
- moneyline plus first-inning movement near starter news can indicate starter-specific repricing;
- total and both team totals can separate scoring-environment news from one-team news;
- an isolated move with no follower or related-market response is weaker evidence.

Correlated markets are not counted as independent votes. The engine models their shared cause or
down-weights redundant confirmation.

## 5. The sharp-bettor inference sequence

The production methodology follows this order for every decision timestamp.

### Step 1: establish a coherent tradable market

Resolve identity, remove observations from the future, pair both sides, remove vig, reject stale
or impossible rows, align line values, and produce source coverage/quality diagnostics. Missing
required state is a data-health finding, not an ordinary No Play.

### Step 2: form the market prior

Estimate the current fair-probability distribution from fresh paired quotes, retaining a robust
high-limit reference and broad consensus. Book-level uncertainty, dispersion, overround, and
timestamp skew widen or narrow the distribution. The market prior is generally strong; a model
must earn any material departure from it.

### Step 3: explain the path to the current price

Classify the evidence probabilistically across causal regimes rather than choosing a regime from
one cutoff:

- information-led price discovery;
- news-driven repricing;
- broad public/recreational pressure;
- sharp-led buyback or resistance;
- vig/hold reshaping;
- stale/outlier quote;
- low-information/noise;
- mixed/indeterminate.

Inputs include leader identity, follower breadth, timing, persistence, reversal path, dispersion,
split evolution, paired-side fair movement, and known information events. Output is a probability
over regimes plus the evidence supporting and contradicting each regime.

### Step 4: interpret splits inside the causal regime

Splits modify the regime probabilities and uncertainty; they do not select the bet directly.
Examples:

- heavy tickets plus retail-led movement and no high-limit follow is more compatible with public
  pressure than informed discovery;
- money/ticket divergence plus high-limit leadership and broad follow is more compatible with
  informative flow;
- lopsided splits with a resistant or opposite-moving high-limit market can indicate resistance,
  but requires price freshness and adequate time context;
- a late split jump after a confirmed lineup change is not independent evidence of sharp action;
- conflicting split sources increase uncertainty unless one has demonstrably better historical
  reliability in that exact context.

### Step 5: update with independent matchup information

Combine the market prior with the independent matchup distribution using a calibrated stacking or
Bayesian-style update that explicitly handles correlated inputs. The influence of the independent
layer is learned from out-of-sample residual value, not assigned by preference. Probable-pitcher
uncertainty is propagated, not converted to missing evidence.

### Step 6: test cross-market coherence

Evaluate whether related markets support the same causal explanation. Coherence can reduce
uncertainty; contradiction can identify a different causal story or widen uncertainty. Do not
blindly add correlated confirmations.

### Step 7: evaluate execution and value

Compare the posterior distribution with the actual available price and calculate expected value,
probability of positive EV, sensitivity to plausible model error, and a maximum playable price.
A correct-side opinion at a bad price remains non-actionable; a playable bet need not have the
highest raw win probability on the slate.

### Step 8: apply decision stability

Compare the new posterior and execution value with the prior published decision. A pick or grade
changes only when new material evidence changes the joint conclusion beyond its uncertainty and
the price remains playable. Stability is learned/validated as a switching-cost or state-transition
policy, not a rule that freezes picks and not a single movement cutoff.

Every change records the new evidence, prior state, posterior change, and exact reason. Favorable
and unfavorable movement are interpreted symmetrically; neither automatically forces a flip.

### Step 9: assign grade and stake

Grades represent different evidence strength and value distributions, not marketing quotas:

- **Best Angle:** strongest calibrated joint evidence and robust positive value at the current
  price, with no unresolved material integrity issue.
- **Lean:** positive, playable evidence with more uncertainty or less value than Best Angle, but
  still meeting out-of-sample actionability standards.
- **Watchlist:** plausible side or value thesis that is not yet sufficiently supported/playable.
- **No Play:** coherent market and model state with no qualifying bet.
- **Data Hold:** evidence required to evaluate the market is invalid or materially incomplete.

Best Angle versus Lean must be learned from monotonic held-out outcome/value strata and stability
tests. No tier is defined solely by a favorite price, model probability, split percentage, or move.
Stake is a separate, bankroll-aware layer based on conservative edge and uncertainty. It never
retroactively changes the predicted side.

## 6. Model form and anti-arbitrariness controls

The initial candidate should be an interpretable hierarchical ensemble, not an unrestricted
language-model judgment and not a hand-written scorecard:

1. data-coherence validator;
2. vig-free market-prior estimator;
3. causal-regime classifier;
4. independent matchup residual model;
5. calibrated stacker producing a probability distribution;
6. value/execution model;
7. grade and stability policy.

Continuous transforms or monotonic splines should replace unnecessary hard betting cutoffs.
Interactions are explicit—for example, movement magnitude × book leadership × time to start ×
follower breadth. Hierarchical shrinkage lets sparse contexts borrow strength without pretending
that MLB totals and WNBA spreads behave identically.

Integrity tolerances are derived from provider contracts, timestamp resolution, and measured feed
behavior. Betting parameters are selected only inside chronological training data, calibrated on
the next period, and evaluated once on untouched later periods. Every searched candidate and
family is counted for multiple-testing control.

## 7. Validation contract

### 7.1 Point-in-time replay

Reconstruct exactly what Oddsphere knew at each historical decision time. Do not use closing
prices, confirmed starters, later splits, outcomes, or repaired data that were unavailable then.
Use several decision clocks, including scheduled refreshes and lock, so the engine learns how the
same game evolves rather than treating each snapshot as an unrelated row.

Historical periods lacking both-side prices, complete source-aware splits, or timestamps cannot
validate the full synthesis engine. They can test only the components actually present. Such rows
must not be described as a full-system backtest.

### 7.2 Chronological evaluation

Use rolling train, calibration, validation, and untouched holdout windows, then repeat across
several origins. Report by immutable release and locked timestamp. Never blend superseded and
current releases as one model result.

### 7.3 Metrics

Report, overall and by sport/market/grade/price/time bucket:

- count, wins/losses/pushes, win rate, units, ROI, and drawdown;
- Brier score, log loss, reliability curve, calibration gap, and sharpness;
- closing-line value against a defined fresh sharp reference;
- predicted-positive-EV rate and realized return by probability/value decile;
- pick/grade flip frequency and the incremental result of flips versus retained decisions;
- source/data coverage and reasons for exclusion;
- promotions, demotions, net actionable-board effect, and market mix;
- uncertainty intervals clustered by game/date, not row count alone.

Accuracy is important but is evaluated relative to price and calibration. A 70% favorite can win
often and still be a bad bet; a lower-hit-rate plus-money portfolio can be profitable. Oddsphere
must show both user-facing win likelihood and actual betting value rather than conflating them.

### 7.4 Acceptance

A live candidate must:

- improve or preserve proper-score calibration versus the vig-free market and current champion;
- show positive held-out value or a defensible calibrated win-probability benefit for the grade it
  changes;
- be stable across chronological windows and nearby parameter values;
- survive source-ablation, stale/outlier, and news-timing tests;
- report all searched variants and correct for selection bias;
- pair every demotion with an evaluated promotion path and disclose board-count impact;
- preserve the single writer and shared `prediction_pipeline` lease;
- pass the repository's mandatory model-change verification and focused tests.

If it does not satisfy these conditions, it cannot alter live picks, grades, probability, stake,
or projections.

## 8. Current Oddsphere gap assessment

The repository already contains valuable pieces, but not the complete applied engine:

- `predictionRecordService.ts` freezes `lines_at_lock`, source-aware split rows, model context,
  and both-side selected-market odds. This is a useful substrate, not yet the canonical full state.
- `marketIntelligenceFeatures.ts` can derive temporal splits, sharp/retail group movement,
  leadership, breadth, agreement, velocity, and freshness. It is largely audit/research
  infrastructure and is not the authoritative public decision path.
- `predictionEvidenceBuilder.ts` assembles rich reader evidence, but several split fields are
  summarized/unknown and the object is organized around the existing selected pick rather than a
  complete side-neutral market surface.
- `marketIntelligenceInterpreter.ts` uses fixed movement/edge/friction thresholds and additive
  scores. It does not perform causal whole-market synthesis.
- `predictionMarketAnalyst.ts` is explicitly preview-only (`applied: false`) and cannot change
  production decisions.

Therefore prior narrow tests of selected-side movement or individual split patterns are component
audits, not validation of the requested sharp-bettor methodology.

### 8.1 Initial stored-history coverage baseline

The read-only `audit-unified-market-state-coverage.ts` pass for August 12–14 found:

| Sport / market | Games | Paired both-side multi-time price path | Paired high-limit price | Multi-time paired high-limit path | Both-side Playbook path | Both-side SharpAPI path |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| MLB moneyline | 38 | 38 | 18 | 5 | 38 | 38 |
| MLB total | 38 | 38 | 38 | 38 | 38 | 38 |
| WNBA moneyline | 8 | 8 | 8 | 8 | 8 | 0 |
| WNBA spread | 8 | 8 | 8 | 8 | 8 | 0 |
| WNBA total | 8 | 8 | 8 | 8 | 8 | 0 |

This is coverage, not performance validation. The Market Intelligence v2 collector intentionally
returns no SharpAPI observations for non-MLB sports, so WNBA's zero is a declared source-capability
boundary rather than evidence of neutral splits. WNBA can be validated with its actual source
contract; it cannot be represented as a two-provider split system unless a second legitimate WNBA
source is integrated and accumulated prospectively.

The MLB result means totals have a small but structurally complete recent corpus. Moneylines do
not yet have enough paired high-limit path coverage to claim the requested full-methodology test
across the whole slate. Broad market and split components can be tested on all 38 games, while a
high-limit leadership claim is limited to the five games with a genuine multi-time paired path.
That limitation must remain visible in every result.

## 9. Engineering sequence

1. **Coverage inventory:** measure, by sport/market/date/decision clock, paired both-side book
   prices, price history, full source-aware splits, book classification, known-news timestamps,
   independent projections, and outcomes.
2. **Canonical state assembler:** build one side-neutral, immutable, point-in-time object with
   provenance, integrity findings, both sides, all source observations, and release stamps.
3. **State-contract tests:** verify no future leakage, paired-vig math, source identity, symmetry
   when sides are swapped, stale/outlier handling, probable-to-confirmed starter replacement, and
   deterministic reconstruction.
4. **Historical corpus:** reconstruct only decision times supported by the state contract and
   label component-only history honestly.
5. **Regime and synthesis research:** fit causal-regime, independent residual, calibrated stacking,
   value, and stability candidates with documented searches.
6. **Chronological tournament:** compare against the vig-free market and current champion, with
   source ablations and multiple-testing control.
7. **Paired board replay:** measure every promotion/demotion, market mix, current slate effect,
   and rollback state.
8. **Versioned integration:** replace—not layer another writer beside—the superseded decision
   path; bump all affected release identifiers and update `current-model-releases.md` in the same
   commit.
9. **Atomic deployment and live proof:** deploy the intentional clean commit, verify release IDs,
   lease/cron health, data coverage, reader coherence, board counts, and the next refresh and lock.

## 10. Definition of “methodology complete”

Methodology is complete only when:

- every input and its provenance/limitations are specified;
- both sides and every available split source are represented through time;
- causal regimes, double-counting controls, cross-market logic, execution, and stability are
  defined;
- the canonical state can be reconstructed without future leakage;
- data coverage is sufficient for the claims made by the backtest;
- validation metrics and live acceptance rules are fixed before the outcome search;
- an independent reviewer can reproduce why a bet, grade, or flip occurred from the stored trace.

This document fixes the target. It does not claim that the current live engine already satisfies
it, and it does not authorize a production grading change by itself.
