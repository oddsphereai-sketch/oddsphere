# MLB player-props calibration audit — 2026-07-24

## Scope and evidence contract

- Opening-price snapshots: 2026-06-03 through 2026-07-23.
- Outcomes: official MLB player game logs; official winning-pitcher decisions;
  ordered game scoring summaries for first-home-run outcomes.
- Identity: exact provider-to-MLB player mapping. Ambiguous rows were excluded.
- Evaluation: chronological future windows (June 22-30, July 1-7, July 8-12,
  and July 16-23), locked/opening prices, flat one-unit returns, and
  date-cluster bootstrap uncertainty.
- Offer contracts were evaluated separately. Two-way over/under markets were
  de-vigged; one-sided milestone ladders were not treated as missing pairs.
- Historical rows remain attributed to their original release. This document
  does not restamp or rewrite them.

The design follows the established evidence that probability calibration is
more relevant than classification accuracy for betting decisions, and that
baseball rates should be shrunk rather than projected from raw recent averages:

- Walsh and Joshi, *Machine learning for sports betting: should model selection
  be based on accuracy or calibration?* (2023):
  https://arxiv.org/abs/2303.06021
- Brown, *In-season prediction of batting averages: A field test of empirical
  Bayes and Bayes methodologies* (2008):
  https://arxiv.org/abs/0803.3697
- Jensen, McShane, and Wyner, *Hierarchical Bayesian Modeling of Hitting
  Performance in Baseball* (2009):
  https://arxiv.org/abs/0902.1360
- MLB Statcast expected statistics methodology:
  https://www.mlb.com/glossary/statcast/expected-woba
- Brill, Deshpande, and Wyner, *A Bayesian analysis of the time through the
  order penalty in baseball* (2022):
  https://arxiv.org/abs/2210.06724

## Release decision

One narrowly scoped behavior change is release-ready: replace the
pitcher-outs probability/projection layer under the existing production
side-selection, price, grade, and stake contract. The separate two-sided value
policy remains rejected, and no other player-prop market is approved.

Candidate identifiers:

- Bundle: `mlb_props_2026_07_24_r7`
- Pitcher outs: `pitcher_outs_peer_consensus_compact_core_v3_verified`

### Hits + runs + RBIs

Exact reconstruction used the production negative-binomial distribution,
official historical batting order (9,636/9,636 mapped player-games), and only
information available before each game.

| Cohort | Decisions | Units | ROI | Date-cluster 95% ROI |
| --- | ---: | ---: | ---: | ---: |
| Current over Leans | 1,018 | -124.79 | -12.26% | -17.61% to -7.02% |
| Current under Leans | 1,570 | +66.05 | +4.21% | -0.64% to +9.33% |
| Under, probability >=56%, edge >=4%, EV >=3% | 1,350 | +69.89 | +5.18% | -0.07% to +10.86% |
| Candidate under 1.5, probability 54%-56%, edge >=5%, EV >=3% | 144 | +3.23 | +2.24% | -17.82% to +24.87% |

The over-side overconfidence is decisive. The stricter established under
segment was positive in all four windows but its cluster interval narrowly
crossed zero. More importantly, the proposed Watchlist promotion failed two of
four windows after historical batting order was restored. Therefore the
demotion has no validated paired promotion and cannot ship under the
model-change safety protocol.

The active identifiers remain unchanged:

- Bundle: `mlb_props_2026_07_24_r6`
- HRR model: `batter_hrr_negative_binomial_v1`

### Pitcher outs

The expanded reconstruction added the full 2025 regular season before any
pitcher-outs model behavior was changed:

- 2,217 unique 2025 pitcher/line outcomes and 721 completed 2026 outcomes.
- 6,978 sportsbook-level 2025 offers and 3,229 sportsbook-level 2026 offers.
- Current-season-only prior starts; the earlier audit bug that allowed a prior
  season into the "season" average was corrected before this evaluation.
- Candidate parameters were fit through June 2025, selected on July 2025, and
  evaluated unchanged on August-September 2025 and completed 2026.
- Uncertainty was bootstrapped by slate date.

The diagnosis is now specific:

1. The current mean workload projection is not the primary failure.
2. Converting the mean through an independent-count Poisson tail is
   misspecified: roughly two thirds of actual outs land at a completed-inning
   boundary.
3. The current scorer is directionally biased toward unders and overconfident.
   In 130 reconstructed locked rows, unders won 36/80 while overs won 31/50.
   The locked final Brier score was 0.2612 for unders versus 0.2395 for overs.
4. An odds-independent workload logistic model also failed. The stable
   probability layer was a leave-one-book-out model that prices a target book
   from the other books already present in the same refresh.

The broad cross-book replacement improved log loss versus the current final
probability in both primary holdouts, but its general promotion pool was not
stable. It therefore does not qualify as a whole-market release.

One pre-specified threshold cohort did survive every aggregate segment:

| Over 16.5 outs cohort | Decisions | Record | Units | ROI | Date-cluster 95% ROI |
| --- | ---: | ---: | ---: | ---: | ---: |
| 2025 train | 5 | 3-2 | +1.16 | +23.24% | -50.49% to +110.02% |
| July 2025 calibration | 8 | 5-3 | +1.62 | +20.28% | -54.13% to +77.32% |
| Aug-Sep 2025 holdout | 19 | 10-9 | +0.47 | +2.47% | -41.30% to +36.82% |
| Completed 2026 replay | 24 | 18-6 | +10.75 | +44.78% | +11.86% to +75.36% |
| Combined | 56 | 36-20 | +14.00 | +25.00% | +2.52% to +46.54% |

The fixed rule is: over 16.5, at least two books, leave-one-book-out model edge
at least 5 percentage points, EV at least 2%, and at least 10 current-season
starts. The analogous existing locked-price threshold cohort is 4-2,
+1.56 units, but only six decisions.

This is the first credible replacement candidate, not an approved release.
Historical provider archives contain opening player props rather than locked
prices, and applying the rule alone would sharply reduce pitcher-outs action
volume. That board reduction must be explicitly approved and the exact current
snapshot impact must be checked before integration. On the latest `r6` snapshot
at `2026-07-24T18:17:48.678Z`, a bounded current-provider read found 108
complete two-way pitcher-outs offers, 12 offers at 16.5 with at least 10 starts,
and zero offers passing the candidate edge/EV gates. The closest miss was Shane
McClanahan over 16.5 at Caesars (4.77-point edge, 1.87% EV). No pitcher-outs
production probability, grade, stake, release identifier, writer, or cron was
changed.

#### Full workload and residual-model follow-up

The 16.5 cohort is not a full model replacement. A subsequent all-lines audit
separated probability accuracy from sportsbook actionability:

- An independent workload model was trained on 3,078 official 2024 starter
  outcomes expanded across thresholds 13.5 through 19.5. It selected the
  workload/context feature family over projection alone: recent outs, pitch
  count, batters faced, baserunner/run prevention, outs efficiency, rest,
  opponent tendency, team hook tendency, and home/away.
- On completed 2026 offered props, that independent model improved Brier from
  0.2612 (current) to 0.2546, but remained behind the market at 0.2446.
- A stacked model combining the independent workload distribution with market
  consensus produced 0.2446 Brier and essentially eliminated selected-side
  overconfidence.
- Official MLB transaction history was joined strictly before each game.
  Generic activation from the IL was not a reliable proxy for a pitch
  restriction. The existing runtime has an injury-risk recommendation gate,
  but the live pitcher-outs scoring path does not currently supply an explicit
  return/pitch-limit state.

Residual forensics found four repeatable errors in train, calibration, 2025
holdout, and completed 2026:

1. A decline of more than two outs across the most recent three starts was
   underweighted; the over remained too high.
2. When the independent workload probability was at least eight points below
   the market, the stack still followed the market too far.
3. Pitchers with 8-11 current-season starts were over-shrunk and their over
   probability was too low.
4. Generic IL activation within 30 days had a different population effect from
   an explicit workload restriction and must not be treated as the same input.

A compact monthly walk-forward residual model fit only on earlier dates
produced:

| Model | Rows | Brier | Log loss | Selected overconfidence gap |
| --- | ---: | ---: | ---: | ---: |
| Market consensus | 2,019 | 0.24443 | 0.68192 | -1.74 points |
| Simple workload + market stack | 2,019 | 0.24446 | 0.68198 | -1.79 points |
| Compact stable-residual stack | 2,019 | 0.24358 | 0.68016 | -0.07 points |

The compact model's date-cluster Brier delta versus market was -0.00110
(negative favors the candidate), with a 95% interval of -0.00269 to +0.00050.
It improved the aggregate but not every monthly fold. A 2024 price-archive
confirmation was attempted, but the provider returned zero historical pitcher
prop rows for those dates. Therefore this is a broad calibration candidate,
not yet a release-approved actionable model.

#### Component ablation and target-book confirmation

The earlier stack mixed useful residual signals with noisy reconstructed
context. A component-by-component monthly walk-forward ablation isolated the
actual gain:

- Opponent adjustment and team hook adjustment slightly worsened Brier.
- Raw pitch count, outs-per-pitch, hits/walks, and earned-runs inputs were
  unstable and collectively overfit.
- The two stable corrections were a last-three-start workload decline greater
  than two outs, which lowers the over probability, and starts 8-11 of the
  current season, which raise an over probability that the baseline had
  over-shrunk.
- Recent batters faced and generic post-IL activation added smaller apparent
  gains, but neither is required for the low-load core model.

The low-load core uses only same-refresh prices, line shape, current-season
starts, season outs per start, and the already-fetched pitcher game logs. It
does not need opposing-lineup calls, opponent aggregates, manager-hook
estimates, a transaction refresh, or another writer.

The harder confirmation excluded the target sportsbook from its own
probability anchor. For each target-book offer, the model used only the other
books at the same line and was then judged at the excluded book's price.
Monthly models were trained only on earlier dates.

| Probability source | Book offers | Brier | Log loss | Over calibration gap |
| --- | ---: | ---: | ---: | ---: |
| Current pitcher-outs probability | 7,414 | 0.25906 | — | Directionally under-biased |
| Target-book no-vig probability | 7,414 | 0.24475 | 0.68256 | +0.18 points |
| Leave-one-book-out compact core | 7,414 | 0.24372 | 0.68042 | +0.07 points |

The compact core improved four of five evaluated monthly folds; July 2026 was
the exception (0.24141 versus 0.24101). The workload-decline and starts-8-11
coefficient directions were unchanged in all five folds. Point estimates
improved for BetMGM, Caesars, DraftKings, Fanatics, and FanDuel separately,
although the individual-book intervals crossed zero.

The original equal-slate-weight date bootstrap estimated a -0.00155 Brier
delta with a 95% interval of -0.00307 to -0.00002. A stricter follow-up kept
the row-weighted estimand fixed while resampling whole clusters. Its aggregate
delta was -0.00104, with intervals:

| Cluster | 95% Brier-delta interval |
| --- | ---: |
| Slate date | -0.00247 to +0.00041 |
| Game | -0.00271 to +0.00063 |
| Pitcher | -0.00279 to +0.00076 |
| Calendar week | -0.00188 to -0.00018 |

The result is robust but not unambiguously significant under every defensible
cluster estimand. A 27-specification curve varied the recent-decline cutoff,
starts window, and ridge strength around the frozen core. Twenty-six of 27
specifications beat the target-book aggregate Brier; 18 beat it in at least
four of five monthly folds. The frozen model's calibration intercept/slope
were -0.004/1.097, versus -0.012/1.262 for the target book and 0.020/0.051 for
the current model.

Brier is not projected-outs error. A separate chronological point-projection
conversion was therefore evaluated:

| Projection | MAE | RMSE | Bias |
| --- | ---: | ---: | ---: |
| Current projection | 2.811 | 3.706 | +0.162 outs |
| Sportsbook line | 2.707 | 3.620 | +0.418 outs |
| Compact calibrated projection | 2.683 | 3.564 | +0.071 outs |

The compact projection improved MAE in all five monthly folds.

#### Brier decomposition and mechanism challenge

The Brier score is not a distance from a sportsbook projection. A
CORP/isotonic decomposition of the 7,414 leave-one-book-out offers separated
event uncertainty, useful discrimination, and correctable miscalibration:

| Probability source | Brier | Uncertainty | Discrimination | Miscalibration |
| --- | ---: | ---: | ---: | ---: |
| Current pitcher-outs model | 0.25906 | 0.24999 | 0.00113 | 0.01020 |
| Target sportsbook | 0.24475 | 0.24999 | 0.00676 | 0.00152 |
| Compact core | 0.24371 | 0.24999 | 0.00829 | 0.00201 |

The current model's problem is therefore measurable: it adds substantial
miscalibration while extracting almost no outcome separation. The compact
core wins primarily by discriminating outcomes better, not by cosmetically
forcing the average probability toward 50%. Most of the remaining score is
the irreducible uncertainty of a near-even binary outcome.

Segment diagnostics showed the largest repairs at 14.5, the 8-11 start
window, completed-inning thresholds, and 16.5. Apparent remaining weaknesses
against the target book appeared at 15.5, 18.5, and when the excluded book
disagreed materially with peers, but each reversed direction across monthly
folds. They are hypotheses, not stable correction rules.

An exploratory mechanism challenge then tested categorical line effects,
smooth workload splines, and line-by-workload interactions:

| Mechanism | Brier | Delta vs target book | Monthly fold wins |
| --- | ---: | ---: | ---: |
| Frozen compact core | 0.24371 | -0.00104 | 4/5 |
| Categorical line | 0.24421 | -0.00055 | 4/5 |
| Smooth workload | 0.25039 | +0.00564 | 0/5 |
| Line/workload interactions | 0.24420 | -0.00056 | 3/5 |
| Long-rest return proxy | 0.24451 | -0.00025 | 3/5 |
| Reduced recent pitch-count proxy | 0.24408 | -0.00068 | 4/5 |
| Combined return/workload proxy | 0.24453 | -0.00022 | 2/5 |

The nonlinear extensions did not close a stable gap; they weakened the
frozen core. Long-rest and low-recent-pitch-count holds reduced some of the
2026 action loss, but the correctly two-sided rule still lost 1.98%-2.97%
after those exclusions. They do not explain the action-policy failure.

This agrees with published work cautioning against treating the
third time through the order as a single discontinuous removal threshold:
starter deterioration and manager decisions are continuous and confounded
([Brill, Deshpande, and Wyner](https://arxiv.org/abs/2210.06724)).
Pitcher-removal research instead points to pitch count, recent in-game
runs/walks/hits, handedness of upcoming batters, score state, and bullpen
context as decision inputs
([Oxford Economic Papers](https://academic.oup.com/oep/article/77/3/849/8029835)).

The remaining genuinely missing pregame input is an explicit expected pitch
limit/manager restriction for injury returns and planned short starts. The
recommendation interface has an `injuryRisk` hold, but the live real-scoring
call does not currently supply it. Generic IL activation did not validate as
a substitute for an announced restriction, so it must not be converted into
a probability adjustment.

A live read-only check of the repository's Playbook injury contract found
that its July 24 response was last updated July 16 (12,580 minutes old) and
contained only generic `Out / Injury / injured-list` labels, not pitch limits.
It is not fit for this purpose. The exact current candidate board also
contained multiple recent injury/rehab return Overs, confirming that the
missing safety state is operationally relevant even though generic historical
proxies did not improve calibration.

A future removal-hazard model or safety hold must use timestamped, explicit
restriction evidence and must pass the same paired promotion/demotion
validation before it can affect production.

#### Two-stage workload/removal model

A final structural challenge modeled starter workload in two stages rather
than treating outs as one count:

1. Predict allowed pitch count from prior pitch usage, season-start count,
   rest/gap state, recent results, and team usage.
2. Predict outs per pitch from prior efficiency and run-prevention inputs.
3. Multiply the two stages for projected outs and use the chronological
   empirical residual distribution for Over/Under probabilities.

The audit matched 2,927/2,938 offered outcomes (99.6%) to 15,149 deduplicated
official starter-like game logs. Every monthly fold used only earlier starts
and earlier offered outcomes.

| Model/output | Result |
| --- | ---: |
| Recent-five pitch-count baseline MAE | 8.884 pitches |
| Two-stage pitch-count MAE | 8.265 pitches |
| Current outs projection MAE on matched rows | 2.780 outs |
| Two-stage outs projection MAE | 2.718 outs |
| Compact calibrated projection MAE | 2.683 outs |
| Market line MAE on matched rows | 2.677 outs |
| Two-stage independent Brier | 0.25644 |
| Two-stage market stack Brier | 0.24442 |
| Market Brier on matched rows | 0.24433 |

The return/gap inputs modestly improved pitch-count prediction, but the
two-stage model did not beat the compact projection or the market probability
baseline. A nonlinear binned-additive version worsened outs MAE to 2.726 and
stacked Brier to 0.24463. Explicit planned restrictions remain important
row-level safety evidence, but a generic removal/workload model is not the
missing broad calibration solution.

This closes the broad probability-calibration gap: the compact model removes
the current scorer's large Poisson overconfidence and marginally beats the
price baseline without adding provider load. It does not yet close the
action-policy gap.

At the site's existing 3.5-point edge, 5% EV, and eight-start screen, one
deduplicated best offer per pitcher/game/line initially produced positive
point results, but uncertainty crossed zero. A stricter production-contract
replay also exposed that the current model interface chooses the more likely
side rather than independently comparing value on both sides; results from the
two side-selection contracts must not be blended.

| Cohort | Decisions | ROI | Date-cluster 95% ROI |
| --- | ---: | ---: | ---: |
| Combined | 497 | +3.33% | -4.79% to +11.51% |
| Over | 263 | +3.84% | -8.81% to +16.50% |
| Under | 234 | +2.76% | -9.31% to +15.42% |

Expected-value buckets were non-monotonic: 2%-5% estimated EV was positive,
5%-8% was weak, 8%-12% was strong, and greater than 12% was overconfident.
Lowering the minimum EV or excluding a book after observing these results
would be post-hoc tuning, not a defensible release rule.

A bounded policy grid was subsequently ranked only on 2025 walk-forward
predictions, then evaluated unchanged on 2026. This exposed two different
side-selection contracts:

- The current production contract returns the side whose outcome probability
  exceeds 50%, then checks price. Under that contract, a 2025-selected
  5-point edge, 2%-20% EV, eight-start rule remained positive in 2026 on both
  sides.
- The general betting-value contract compares both sides with their no-vig
  prices. For example, a 48% Under can still be the value side when the book
  prices it at 42%. Under this correct two-sided contract, the 2025-selected
  rule was 3.5-point edge, 2%-8% EV, and at least eight starts.

| Two-sided value rule | Decisions | Over ROI | Under ROI | Combined ROI |
| --- | ---: | ---: | ---: | ---: |
| 2025 discovery | 408 | +7.77% | +6.04% | +6.63% |
| 2026 validation | 289 | -3.08% | -3.30% | -3.19% |

A nearby 2%-12% EV cap was positive in 2026, but selecting it after reading
the validation result would be post-hoc tuning. Therefore the properly
two-sided paired promotion rule failed and is not part of `r7`.

The release question was then narrowed to the forecast replacement under the
unchanged production action contract. That contract was not selected from the
action-policy grid: it retains the existing 3.5-point edge, 5% EV, eight-start,
and most-likely-side rules. The frozen candidate was positive on both sides in
both chronological eras:

| Existing action contract | Decisions | Over ROI | Under ROI | Combined ROI |
| --- | ---: | ---: | ---: | ---: |
| 2025 walk-forward | 200 | +9.22% | +2.01% | +5.54% |
| 2026 held-out replay | 183 | +10.71% | +8.93% | +10.08% |

The ROI cluster intervals cross zero, so these returns are not treated as
proof of profitability. The release evidence is the forecast comparison:
candidate Brier improved by 0.01535 versus the current model, and all four
cluster bootstraps excluded zero in the candidate's favor:

| Brier delta vs current | 95% interval |
| --- | ---: |
| Slate date | -0.02111 to -0.00961 |
| Game | -0.02084 to -0.00988 |
| Pitcher | -0.02146 to -0.00964 |
| Calendar week | -0.02004 to -0.01118 |

This proves the replacement predicts outcomes better than the current model;
it does not claim that realized betting profit is proven.

The exact current-board replay used the latest `r6` snapshot at
`2026-07-24T18:17:48.678Z` and current provider offers:

- 108 complete two-way pitcher-outs offers.
- 104/108 (96.3%) had all required peer-price and recent-workload inputs.
- The four holds were visibly attributable to fewer than three prior starts;
  no missing evidence was converted into ordinary `NO_PLAY`.
- No additional provider call, writer, refresh, lease, or database write is
  required; the inputs already exist in the slate research bundle.
- Under the unchanged production thresholds and the candidate's already
  market-anchored probability, the candidate produced seven actionable
  outcomes: six Overs and one Under. The current board had 12: 11 Unders and
  one Over.
- The corrected side-specific comparison retained one action, promoted six,
  and demoted 11, a net board change of -5. Side flips count as one promotion
  and one demotion rather than being mislabeled as retained.

That side-mix reversal directly addresses the current under-heavy failure.
The smaller board is an explicit measured tradeoff paired with six tested
promotions, not a hidden demotion-only rule.

Confirmed opposing lineups were separately reconstructed from 1,799 official
MLB boxscores, with 2,935/2,938 observations and 98.6% average hitter coverage.
Lineup strikeout, walk, hit, home-run, total-base, recent-delta, and order-shape
features worsened the compact model (0.24412 versus 0.24375 Brier; clustered
delta +0.00059, 95% -0.00060 to +0.00183). Cross-line price translation also
failed in both held-out periods. Those paths should not be added to the refresh.

An untouched older price confirmation is not available from the current
providers: the attempted 2024 archive returned zero pitcher-prop rows.
Commercial archives advertise historical non-featured/player-prop data, but
the available accounts do not authorize them. SharpAPI's documented
`/historical/odds/closing` endpoint contains per-book closing player props and
no-vig probabilities, but requires Enterprise. A read-only entitlement check
with the project's existing `sharp`-tier key returned `403 tier_restricted`.
Ball Don't Lie historical Lab/API access was also not authorized. That archive
remains required before replacing the existing action contract with a general
two-sided value policy. It is not required for the narrower `r7` forecast
replacement because the action contract remains unchanged and the candidate's
direct forecast advantage over the current model is conclusive under every
reported cluster scheme.

The final non-persisting production-path preview at
`2026-07-24T21:35:47.439Z` stamped `r7`, was publishable with zero validation
errors and zero stale odds rows, and produced six pitcher-outs actions split
three Overs and three Unders. It used 44 verified target-book rows at model
weight 1 and left eight research-only rows unpromoted. The full snapshot
remained within the existing bounded payload path (1,447,834 gzip bytes).

## Market-by-market disposition

| Market | Contract/evidence | Decision |
| --- | --- | --- |
| Pitcher strikeouts | 610 paired observations; current over action screen was unstable across future windows | No behavior change |
| Pitcher outs | Poisson is structurally misspecified. The frozen leave-one-book-out compact core improved Brier from 0.25906 to 0.24371 versus current, with all date/game/pitcher/week cluster intervals decisively favoring the candidate, and improved projected-outs MAE from 2.811 to 2.683. Under the unchanged production action contract it was positive on both sides in 2025 and held-out 2026, while the separately proposed two-sided value policy failed | Release only the forecast/projection replacement as `r7`; preserve the existing action contract, writer, lease, grades, stakes, and refresh cadence |
| Pitcher hits allowed | Under segment positive but uncertainty crosses zero; over sample too small | No behavior change |
| Pitcher walks | Actionable sample too small and unstable | No behavior change |
| Pitcher earned runs | Over segment failed, but no independently validated promotion pool yet | No behavior change |
| Pitcher to record a win | 986 official-decision outcomes; one-sided prices overstated observed win rate by 9.91 points and failed all four future windows | Keep research-only |
| Batter strikeouts | Only 39 paired observations; the large remainder is one-sided milestone inventory | No behavior change |
| Batter hits | With exact historical batting order, 2,368 over Leans lost 6.00% with a wholly negative cluster interval; the under side was not stable across all windows. No Watchlist promotion passed | No behavior change until a balanced release is available |
| Batter total bases | Current under action screen was negative and unstable | No behavior change |
| Batter home runs | One-sided milestone contract; field vig and rare-event uncertainty prevent a generic promotion | Keep existing capped policy |
| Batter RBIs | Context-heavy and current over weight is already capped to market | Keep Watchlist-only |
| Batter runs | Under segment was approximately break-even with wide uncertainty | No behavior change |
| Batter hits + runs + RBIs | Exact dedicated audit confirmed decisive over-side overconfidence, but the candidate promotion failed two future windows | No behavior change until a balanced release is available |
| Batter singles | Under segment was positive overall but failed one future window and interval crossed zero | No behavior change |
| Batter doubles | Current capped action pool did not produce enough evidence | Keep Watchlist-only |
| Batter triples | Four paired observations; one-sided milestone evidence did not support promotion | Keep Watchlist-only |
| Batter walks | Current under segment was negative overall and unstable | No behavior change |
| Batter stolen bases | Missing battery/attempt context and no stable held-out promotion | Keep Watchlist-only |
| First home run | 12,272 reconstructed field outcomes; one-sided prices overstated observed probability by 2.12 points and failed all four future windows | Keep research-only |

## Verification and next evidence requirement

- The proposed HRR production change remains reverted. HRR stays on `v1`.
- Pitcher-outs `r7` is the only approved model behavior change in this release.
- `npm run verify:model-change` passed: 35 pipeline-safety tests, 15 automodel
  version tests, market ownership, batter-hits, and HRR focused tests.
- The focused MLB props engine passed 340 checks, including peer-book
  exclusion, recent-three workload, fail-closed inputs, projection scale, and
  prevention of double market anchoring.
- A non-persisting full production-path preview was publishable with no errors,
  no stale odds rows, and no tracking/database writes.
- The separate one-sided milestone display correction changes no model,
  probability, grade, stake, writer, refresh cycle, or provider load.
