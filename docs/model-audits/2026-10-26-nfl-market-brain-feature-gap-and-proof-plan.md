# NFL Market Brain — feature gap, authoritative path, and proof plan

Date: 2026-10-27

Status: coordinated design plus raw-provider capture and release-pure materializer in shadow. No production prediction, probability,
projection, grade, stake, member display, tracking, or locked-record behavior is authorized by this
document.

## Decision

Keep the released Daily Edge NFL reader as the production comparator. Do not add another hand-built
rule layer to it. Finish the Market Brain tape into a lossless observation boundary, then build one
release-pure sequence materializer and one executable learned resolver behind a shadow-only gate.

The current semantic reader and the new tape are complementary:

- the current reader contains useful domain semantics and a coherent joint-score publication path;
- the tape closes upstream observation-loss and provenance gaps that the reader cannot repair after
  preprocessing; and
- the resolver must learn when market evidence confirms, recenters, flips, fades, or leaves the
  independent prediction unchanged. Those actions are outputs to evaluate, not quotas or required
  conjunctions.

"Every ledger signal was interpreted" is not equivalent to "every requested market observation
reached the ledger," and neither claim proves predictive improvement. Coverage and accuracy require
separate gates.

## Feature-path comparison

| Evidence or behavior | Released semantic path | Market Brain tape direction | Remaining gap before a predictive resolver |
| --- | --- | --- | --- |
| Independent prior | Target-free Margin/Total prior plus coherent forecast candidates | Exact immutable Margin/Total PMF bytes, event/release/availability identity, marginal hashes, and content-addressed artifact checksum | Validate every persisted artifact independently; never train from a later reconstructed score |
| Current multi-book quotes | Complete current pairs retained by family | Raw-response hashes and row accounting retain every recognized selection independently, including duplicates, incomplete sides, and unsupported rows, before market-state filtering | Forward capture must accumulate enough within-game points for true intraday path shape; provider-side rows that are never exposed remain unknowable |
| Opening-to-current movement | Trail direction, no-vig delta, hold delta, move order, persistence, reversal, buyback, key crossings | The release-pure materializer derives continuous line, fair-price, hold, lead/lag, reversal, buyback, and key-crossing features only from points available by cutoff | Validate the transforms on prospective cases and preserve the immutable prior artifact alongside the sequence |
| Freshness | Two-hour gate can remove a trail or split before arbitration | Fresh, stale, future, incomplete, and unavailable states are explicit | Learn behavior by missingness/freshness regime; do not encode stale or missing as neutral zero |
| Small moves | Direction requires a 0.5 point number move or 1 percentage-point fair-probability move | Raw values survive | Keep continuous deltas and uncertainty; thresholds may be safety metadata but not admission to the resolver |
| Named-book leadership | Circa/Pinnacle are classified as named; a named direction needs at least two aligned named movers | Book reputation is a prior and observed role begins unknown | Infer leader/follower/resistor/reversal from time order; do not let brand identity assert event leadership |
| Retail follow-through | Inferred after the completed aligned named-book move | All identifiable families and times are retained | Materializer must represent lead/lag continuously and allow simultaneous, retail-first, or no-follow regimes |
| Resistance/disagreement | Book disagreement, flow resistance, and reverse flow are categorized | Opposing quotes and source availability survive | Learn whether disagreement means resistance, stale data, target isolation, or a genuine regime transition |
| Public consensus splits | Continuous split row reaches the ledger, but directional qualification uses an 8-point money-minus-ticket gap and exact-line constraints | Public split values, books used, identity, and availability are masked observations | Preserve exact line/market ownership and denominator limitations; train with the continuous gap, never a public/sharp vote |
| Identified-book splits | Only the preferred first complete Circa/DraftKings/BetMGM row enters the incumbent `sharpSplits` set; directional qualification uses a 10-point gap | Every exact-identity row for all three requested books survives, including incomplete, duplicate, and unavailable states | Resolve duplicates deterministically, retain book-specific disagreement, and evaluate source ablations; do not promote a source solely because its brand is Circa |
| Missing source | Some missing candidates disappear because null rows are skipped | Every expected source has an explicit manifest row | Artifact metrics must be stratified by actual source-availability combinations |
| Target exclusion | Evaluated family and target-excluded consensus are separated | Every quote records its relation; the materializer re-derives the cutoff target family and excludes the exact target plus all same-family history before feature and role construction | Extend adversarial leakage tests through any future training/export path |
| Moneyline/Spread/Total relationship | Semantic side story joins Moneyline and Spread; Total remains independently preserved | Raw observations keep market identity | Resolver must estimate one coherent joint game state while allowing winner, cover, and scoring information to disagree |
| Availability and news | QB, injuries, weather, and player-aware forecast availability are interpreted mostly as context; report-versus-first-move timing is retained | QB/depth, injury report, and weather availability/provenance are explicit | Add state changes and their timestamps, distinguish "already in the prior" from new information, and never infer causation from ordering alone |
| Flip/fade behavior | Categorical hand-authored stories can choose an existing expert or reflect a margin; Total changes are disabled | Frozen scenarios state acceptable confirm/recenter/flip/fade/retain/stand-down behavior | Learn one coherent posterior distribution; measure factual prior/posterior/market relationships without a contradictory independent action head |
| Output coherence | One Margin/Total result rebuilds score and downstream ML/Spread/Total probabilities | Capture layer has no output authority | Candidate must preserve this single coherent publication path; separate market heads may inform but cannot publish mutually inconsistent results |
| Locked records | Existing locks are render-only | Shadow tape is not attached during locked reconstruction and is not read by member/tracking paths | Tests must continue proving exact stored-payload precedence after any future candidate is introduced |

## What the current reader gets right

The released path should remain the benchmark and supply reusable domain transforms. In particular,
`nflMarketState.ts` already computes no-vig probability, hold, number/price order, persistence,
reversal magnitude, buyback, key-number crossings, lead/follow timing, resistance, and target-family
exclusion. `nflFullGameEvidenceLedger.ts` preserves coherent forecast experts, target-excluded market
state, source trails, flow, and availability context. `nflFullGameEvidenceArbiter.ts` provides an
auditable semantic vocabulary and `nflFullGameEvidenceRuntime.ts` proves how one coherent Margin/Total
state can rebuild scores and downstream decisions without mutating locks.

Those capabilities should be adapted as deterministic feature transforms and explanation labels.
They should not remain the authority for deciding which raw observations exist or for assigning the
candidate's final action.

## Gaps that can still hide NFL signals

1. `fetchSharpApiNflSplits` historically selected the first complete source in Circa, DraftKings,
   BetMGM priority. The new `sourcesByGame` manifest is lossless, but the active reader still consumes
   the backward-compatible collapsed `splitsByGame` value.
2. `buildNflMarketState` removes stale trails, requires an opening, and converts movement to direction
   only after 0.5-point or 1-percentage-point thresholds. Its split builder removes small gaps, future
   or stale rows, and public line mismatches. The later ledger cannot interpret observations that
   never reached this state.
3. Named leadership is partly asserted from a fixed Circa/Pinnacle class and a two-aligned-books
   conjunction. That is a useful prior, not proof of who discovered information in a particular game.
4. The full-game ledger records missing forecast and broad availability categories, but skips absent
   split candidates and lacks all-source split conflicts. "All captured interpreted" is therefore a
   downstream accounting invariant, not end-to-end source coverage.
5. The current arbiter's final behavior is categorical code. It can select a forecast expert or
   reflect a margin around a boundary, but it does not estimate calibrated uncertainty over actions,
   learn when a sharp move should be faded, or update Total when validated evidence supports it.
6. The existing 59-game ledger was outcome-opened during refinement. Its improvement is valuable
   defect evidence and a regression test, but it cannot be the proof that the candidate predicts
   future games better.
7. Current feeds do not reveal absolute handle, ticket count, bet-size distribution, limits, actual
   move origin, suspension lifecycle, or private order flow. The system must preserve these as blind
   spots instead of claiming to have completely observed the market.
8. The production writer builds `marketStates` without its resolved `excludedFamiliesByMarket`.
   Later ledger flags identify a target-family trail, but `interpretSignal` can still label that trail
   discovery or resistance. The single materializer must enforce target exclusion before deriving any
   predictive role.
9. A public split rejected from `state.splits` for a known line mismatch can later be rebuilt in the
   ledger with `exactLineMatched = null`; the ledger's directional qualification accepts anything
   other than explicit `false`. That is a real state-loss bug, not nuance, and must not be copied into
   the candidate.
10. `nflUnifiedTotalMarketInterpreter.ts` converts some absent split/mean inputs to zero and validates
    artifact shape/release strings without independently verifying dataset bytes, checksums,
    partitions, or metrics. Missing values must stay masked and candidate artifacts must be verified
    outside their own metadata.

## Existing authority duplication to remove after validation

The active decision route applies overlapping semantics in multiple places:

`buildNflMarketEvidenceOutcomeForecast` / `buildNflNoWeightMarketEvidenceOutcomeForecast`
→ target-excluded fixed-point resolution
→ named-sequence authority
→ professional-market authority
→ three-state reader
→ unified Total interpreter
→ full-game ledger/arbiter/runtime
→ specialized grade policies.

This creates multiple target-exclusion implementations, repeated role classification, repeated score
correction, and more than one grade authority. Until a replacement qualifies, this remains the
production comparator. After qualification, the old interpreters must be retired together rather
than removed piecemeal; retaining parallel decision authorities would double-count evidence and make
release attribution impossible.

## One authoritative candidate architecture

### 1. Observable tape

`marketBrainShadow.case` is the only candidate input boundary. It records expected inputs,
availability masks, raw values, source identity and prior, target relation, event identity, timestamps,
raw-response checksums and row accounting, and immutable prior identity. It has no prediction authority.

### 2. Release-pure sequence materializer

For an evaluation timestamp, load only tape rows written at or before that timestamp and only the
model prior release that was available then. Produce a variable-length sequence/set plus masks. Derive
continuous no-vig, hold, number movement, price movement, lead/lag, persistence, reversal, buyback,
key-number transition, disagreement, and cross-market coherence from that bounded tape.

`nfl_market_brain_sequence_materializer_2026_10_27_r9_identity_conflict_safe` implements this
boundary without a resolver: it refuses mixed events/releases, applies Oddsphere availability time
before feature construction, masks incomplete/unsupported rows, fails conflicting immutable
observation identities, pairs sides only when line/time identity agrees, and derives event roles from
chronology rather than brand. It removes same-family split rows and same-family expected-source
missingness as well as prices, so the evaluated sportsbook cannot re-enter through a non-price
feature. It re-verifies the exact prior artifact rather than trusting stored summary fields. Data
absence otherwise remains a learned missingness regime.

`nfl_market_brain_research_evaluator_2026_10_27_r8_capture_window_bound` derives its baseline winner
probabilities and Margin/Total moments from that exact artifact. It accepts outcomes only after both
the feature cutoff and game start, requires candidate training to end before the case, binds the
candidate to the immutable sequence checksum, rejects mixed-release aggregation, and reports Brier,
winner log loss, realized Margin/Total distribution log score, winner accuracy, Margin/Total MAE,
corrections, and harms. The companion chronological
manifest prevents opened development evidence from being relabeled selection or confirmation. The
evaluator accepts only a manifest attested by an append-only database receipt created before its
earliest selection, confirmation, or prospective capture window; a JSON copy or caller-declared timestamp is insufficient. A
candidate must submit complete Margin and Total distributions whose winner probabilities and moments
exactly reconcile; an incoherent set of point estimates is rejected before scoring.

### 3. Executable learned resolver

Freeze the candidate families and hyperparameters before inspecting a later confirmation window.
The first eligible family is deliberately small and fully executable: a regularized joint residual
model over Margin and Total. Earlier mixture-of-experts and calibrated-head descriptions were removed
because prose is not an implementation. A later family requires a new predeclared release, real
trainer/inference code, and untouched evidence. The resolver emits one coherent joint outcome
distribution; factual prior/posterior relationships explain it but do not award points or grades.

No eligible family may use a required signal count, fixed sportsbook weight, universal market blend,
automatic favorite/underdog rule, automatic line reflection, one-book command, or game-specific
exception.

`nfl_market_brain_resolver_contract_2026_10_27_r7_interpretive_artifact_binding` now enforces this boundary and
`nfl_market_brain_tournament_2026_10_27_r7_interpretive_artifact_binding` freezes the one executable family,
its regularization grid, rolling-origin split policy, predictive selection objective, and fitted-
parameter ceiling before confirmation outcomes are inspected. The
13 behavior stories advance to `nfl_market_brain_behavior_scenarios_2026_10_27_r2_probabilistic` and
carry soft, non-one-hot expected distributions for a future fitted-model test. The production-facing
shadow contract does not accept an independent action head. It rejects unfrozen hyperparameters,
out-of-window training, impossible football score states, incoherent Margin/Total outputs, invalid
probability mass, and any production authority. This is a contract/tournament freeze, not a trained
model or evidence of predictive improvement.

`nfl_market_brain_resolver_features_2026_10_27_r6_fixed_executable_vector` is the only eligible trainer
input. It exports the exact independent prior, every eligible continuous quote path, non-price
context and split tokens, explicit eligible missingness, cross-market chronology, and source regime;
it omits audit hashes and every evaluated-family observation or missingness state. Its payload hash
is invariant to additional excluded target-only rows, while its outer checksum still binds the full
audited sequence for provenance.

The serialized object is called `weights` in the current internal schema for compatibility, but it is
not a sportsbook scorecard or authority table. It contains outcome-learned model coefficients. The
artifact binding proves that those exact learned parameters produced the posterior and prevents a
caller from substituting a preferred pick. There is no coefficient clipping, posterior-movement cap,
minimum move, agreement quota, or per-book multiplier. L2 is selected chronologically as overfit
control; it does not declare how important a book or signal is. The current family is a transparent
baseline, not the final sophistication ceiling: sequence-native or nonlinear families remain valid
future candidates only when they have executable training/inference code and untouched evaluation.

### 4. Coherent shadow output

Map the selected posterior to a single Margin/Total distribution, then derive expected score,
Moneyline, Spread, Total, and line-specific probabilities from it. Run the ordinary decision and
grading code on that shadow distribution, retaining exact quote identity. Store the baseline and
candidate side by side with its factual posterior relationship and source/missingness regime. Do not alter the
member payload.

### 5. Explanation projection

Use the existing semantic roles as post-hoc factual explanations of observed chronology. The member
explanation may be simpler than the internal tape, but it cannot be an input to inference and cannot
suppress internal contrary evidence.

## Proof plan

### Frozen comparators and ablations

Compare every candidate against the exact released semantic reader at the same locked evaluation
timestamp and quote. Run these predeclared ablations:

1. released semantic baseline;
2. baseline resolver inputs with the collapsed preferred split;
3. all-source split manifest added;
4. unthresholded continuous price paths added;
5. chronology-derived observed roles added;
6. availability/news sequence added; and
7. complete joint candidate.

This identifies whether an apparent gain comes from actual signal recovery, target leakage, one feed,
or a changed board policy.

### Chronology and labels

- Partition by scheduled start in rolling-origin order; never random-split games from the same season
  or slate.
- Purge overlapping capture windows and keep all observations for a game in one partition.
- Freeze materializer release, features, candidate families, hyperparameters, and selection metric
  before the later confirmation window is scored.
- Use game outcomes only as labels: home win/tie, realized margin, realized total, cover at the exact
  evaluated line, and over/under at the exact evaluated line.
- Closing-line movement is a diagnostic for price discovery, not the outcome label and not a feature
  unless it was already observable at the evaluation timestamp.
- The 59-game outcome-opened repair ledger is development/regression evidence only. It must never be
  relabeled confirmation or combined with a new prospective confirmation sample.

### Required metrics

Report all games, not only bets:

- Moneyline log loss, Brier score, calibration slope/intercept, expected calibration error, and
  winner accuracy;
- Spread and Total probability log loss/Brier score at the exact evaluated line, directional
  accuracy including pushes, Margin/Total MAE, and distribution score where available;
- representative-score and team-score error;
- confirm/recenter/flip/fade/retain/stand-down counts, calibration, corrections, harms, and mean
  posterior movement;
- exact-price units, ROI, and uncertainty intervals as secondary economic diagnostics;
- grades, promotions, demotions, board counts, and results for both sides of every grade transition;
  and
- every metric by season/week, source-availability regime, source family, target book, favorite/dog,
  home/away, key-number state, and availability-news regime, subject to minimum-sample disclosure.
- provider requests/credits, raw and stored bytes per case, content-address hit rate, projected
  slate/season storage, and research-compute cost. A predictive gain that requires unbounded paid
  calls, duplicate artifacts, or per-pick generative inference is not eligible.

### Acceptance

A candidate may continue to prospective shadow only if it improves the frozen primary predictive
score on selection without material regression in any claimed market, survives source and
missingness ablations, passes all 13 frozen behavioral scenarios probabilistically, and preserves
output coherence and board balance. A candidate may receive production consideration only after a
later untouched chronological confirmation and a prospective shadow probation show the same
direction of benefit.

If the evidence is small or inconclusive, keep capturing and remain in shadow. Limited history is not
permission to skip chronology, but it is also not a reason to block better evidence capture or to
pretend a rigid rule is validated.

## Implementation order

1. Complete prospective lossless capture and audit source availability for at least one NFL cycle.
2. Build and checksum the release-pure sequence materializer with leakage and target-exclusion tests. **Complete.**
3. Bind and independently verify the exact target-free prior artifact, then freeze a release-pure,
   rolling-origin evaluator that counts corrections and harms. **Complete.**
4. Convert the 13 frozen stories into probabilistic resolver tests without inspecting confirmation
   outcomes. **Complete at the contract level; no fitted resolver has passed them.**
5. Freeze the executable learned-model tournament and instantiate the predeclared rolling-origin evaluation manifest.
   **Tournament complete; event partitions remain pending sufficient release-pure tape.**
6. Run the outcome-opened 59-game ledger only as a regression/development screen.
7. Run untouched chronological confirmation if sufficient historical tape exists; otherwise begin
   prospective shadow probation and wait for outcomes.
8. Inspect every disagreement and source-regime failure. Retraining or feature changes create a new
   release and a new future confirmation window.
9. Only after the model-change gates pass, open a separate production proposal with release bumps,
   paired promotion/demotion evidence, lock tests, integration safety, and live verification.

This sequence gets Oddsphere to a nuanced market reader without pretending that vocabulary,
coverage, or an opened replay alone proves prediction accuracy.
