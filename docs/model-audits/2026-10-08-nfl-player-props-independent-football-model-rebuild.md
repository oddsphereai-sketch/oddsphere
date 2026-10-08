# NFL player props independent football-model rebuild

## Decision

The independent model is not failing because one matchup coefficient is too small. It is failing
because the current architecture is mis-specified at five connected layers: settlement population,
participation and role, team opportunity budgets, matchup currency and granularity, and outcome
distribution calibration. Tuning market weight or adding a single cornerback grade cannot repair
those foundations.

No live model behavior is authorized by this diagnosis. The rebuild remains shadow-only until it
passes release-pure chronological testing and an untouched 2026 confirmation window.

## What the 2026 replay proves

Through Week 4, the 183 locked canonical scopes with a genuinely independent stored probability
won 49.73% while carrying 74.81% mean confidence. Independent Brier was `0.31339`, versus `0.24916`
for the market and `0.25231` for the published final probability on the same rows. Across all 207
canonical point forecasts, independent MAE was `21.8400` versus `19.2661` published, with
`-10.5613` aggregate bias.

These are selected actionable rows rather than the complete Weeks 1-3 boards, so they cannot
estimate every-offer performance. They are nevertheless sufficient to reject the claim that the
existing raw probabilities are accurate enough to lead the market marriage.

## Ranked root causes

### 1. The historical target population does not match sportsbook settlement

The historical eligible training frame contains roster/game rows with `participated = 0`. In the
2025 audit, nonparticipation was 53.06% of QB-eligible rows, 47.15% of rushing rows, and 31.46% of
receiving rows. Production settlement does not grade an absent player missing from the final
exact-game stat response as a zero.

This is not just label noise. It pulls point centers downward, fattens the zero mass, distorts
residual quantiles, manufactures Under edges, and makes selected-side probabilities look more
certain than the population the product actually settles. Only Rushing Attempts has received a
settlement-aligned conditional repair. The other prop families still need the same conceptual
correction.

Required repair: model `P(active/full/limited)` separately, then model the outcome conditional on
that role state. A player who is out is a void state, not a zero-yard outcome. A limited player is a
distinct workload regime, not an ordinary active observation.

### 2. Opportunity is predicted player by player instead of allocated from a coherent team game

Most current non-QB markets are direct player regressions. They do not first forecast team plays,
dropbacks, rush attempts, routes, and targets and then allocate those opportunities across the
active roster. Consequently, projections can encode mutually inconsistent assumptions: player
target or carry shares need not add to the team budget, and a teammate injury does not explicitly
vacate and redistribute work.

Required repair: use one generative hierarchy with shared latent team totals and constrained player
shares. The model should make every prop family tell the same football story.

### 3. Forty-seven “current matchup” inputs are not current in the 2026 runtime

The portable artifact exposes 204 modeled inputs. The current-season updater refreshes player box
stats, basic team volume, pass rate, completion rate, passing yards per attempt, sack rate, rushing
yards per attempt, first-down rate, and turnover rate.

It does **not** refresh five `prior_offense_snap_pct_*` inputs. It also does not refresh 42 advanced
team/opponent matchup inputs: pass EPA/dropback, rush EPA/attempt, explosive pass rate, explosive
rush rate, air yards/target, YAC/target, and passing CPOE, each at 3-game, 5-game, and EWM windows
for offense and opponent allowed. Those fields therefore carry forward their through-2025 artifact
values during 2026.

That is train/serve skew. The features have matchup names, but they are not current-season matchup
measurements. The model is partly treating last season's team identity as this week's evidence.

Required repair: build a dated, as-of-safe team feature store from current-season play-by-play,
refresh it once per slate rather than per card, and fail closed or widen uncertainty when a field is
unavailable. Never silently substitute stale prior-season values as current evidence.

### 4. Roster and injury evidence is used mainly as a gate, not as a numerical workload transfer

The retained context has player identity, position, depth rank, injury status, expected QB, and
starter metadata. Current code uses that information primarily for eligibility, health holds, role
fingerprints, and expected-QB selection. `out`, `inactive`, IR, and doubtful can block a player, but
questionable/limited designations and teammate absences do not numerically change route, target,
carry, or snap-share distributions.

For the retained Week 5 context inspected on 2026-10-08, 675 unlocked rows covered 15 games, but
the latest evidence had zero games with attached injury evidence. The coordinating reliability task
owns that fallback problem; the independent model must also refuse to claim injury-aware workload
redistribution when the evidence is missing.

Required repair: convert availability into probabilistic role states and recompute the whole team
allocation when any material player changes state. Preserve uncertainty instead of treating
`questionable` as either fully healthy or absent.

### 5. Matchup representation is aggregate, unadjusted, and not assignment-aware

The existing live feature path has no direct representation of:

- offensive-line/pass-protection versus defensive pressure;
- run-blocking scheme/gap versus defensive front and box count;
- receiver alignment, route family, coverage shell, or likely corner/safety assignment;
- tight-end and running-back route matchups against linebackers/nickels;
- coaching/coordinator change, personnel tendency, motion, or formation;
- strength-of-schedule-adjusted opponent quality.

Raw opponent-allowed rolling stats confound defensive ability with the offenses already faced.
They also overstate certainty when a team has played only a few 2026 games.

Required repair: begin with opponent-adjusted team/unit features that can be refreshed reliably.
Add assignment-level features only when a source supplies timestamped historical training coverage
and the same live pregame fields. Depth-chart names are not enough to invent a CB/WR matchup.

### 6. The probability layer is a selected-sample empirical residual lookup

Most volume/yardage probabilities are derived from historical empirical residual distributions.
Those residuals inherit the target-population and stale-feature errors above. Selecting many props
and then inspecting only the actionable archive compounds the problem: the tails are exactly where
miscalibration is most damaging.

The 2026 evidence is direct: clean independent probabilities averaged 74.81% confidence and won
49.73%. This is not a minor calibration miss.

Required repair: fit market-specific conditional distributions on settlement-aligned outcomes,
then calibrate on complete frozen boards in walk-forward folds. Calibration cannot repair a bad
mean model, so it is the last modeling layer, not the first patch.

### 7. “Independent” provenance has not always meant independent

For QB passing workload markets, the released point path uses a 90% market / 10% role center when
market evidence is present. A probability calculated from that center was stored in
`rawModelProbability`. Twenty-four canonical replay rows therefore had to be excluded from the
independent-probability analysis.

Required repair: store and display three unambiguous objects: `independentForecast`,
`marketObservation`, and `publishedDecision`. The market may change the final decision only after
the independent forecast is frozen and its provenance recorded.

## The replacement architecture

### Layer A: independent game and team environment

Forecast a joint distribution for offensive plays, dropbacks, sacks, designed rushes, scramble
opportunities, drives, and scoring opportunities. Inputs should include current-season pace,
situation-neutral pass rate/PROE, early-down tendency, score-state behavior, opponent-adjusted
efficiency, coaching continuity, rest/travel, venue, and weather. Early-season observations receive
hierarchical shrinkage toward team, coordinator, and league priors.

The independent game environment must not use the target prop line, target prop price, game total,
or spread as a feature. Market totals and spreads remain external benchmarks for later diagnosis.

### Layer B: participation and role states

For every eligible player, estimate:

`P(out)`, `P(active_limited)`, `P(active_normal)`, and `P(active_expanded)`.

Condition those states on injury status and recency, practice/report evidence when available, depth
rank, starter status, recent snap/route share, teammate availability, transaction timing, and
coaching usage. The public forecast distribution is the mixture over settlable active states; the
out state is retained for availability risk and hold logic rather than graded as a zero.

### Layer C: constrained opportunity allocation

Use shared team budgets and roster-level shares:

- `QB dropbacks = team offensive plays - designed rushes - non-QB direct snaps`;
- `player routes = QB dropbacks × route participation`;
- `player targets = team targets × softmax(target-share scores over active route runners)`;
- `player receptions = targets × catch probability`;
- `player receiving yards = receptions × yards after catch + completed air-yards contribution`;
- `player carries = team designed rushes × softmax(carry-share scores over active rushers)`;
- `player rushing yards = carries × conditional yards per carry`.

Shares are sampled jointly so they add to the team total. Removing or limiting one player
automatically redistributes opportunity according to position, personnel, role, and coaching priors.

### Layer D: matchup efficiency

Separate opportunity effects from efficiency effects:

- passing attempts: pace, game state, pass tendency, pressure/sack expectation;
- completions: target depth, QB accuracy/CPOE, receiver separation proxy, coverage and pressure;
- passing yards: dropbacks × completion process × air-yard/YAC process;
- rushing attempts: team rush budget, QB keep/scramble share, role state, expected script;
- rushing yards: line/front interaction, box tendency, gap/scheme fit, yards before contact and
  tackle-breaking proxies;
- receptions: routes × target rate × catch probability, with alignment/coverage where supported;
- receiving yards: receptions plus air-yard and YAC distributions, not one generic yardage model;
- anytime touchdown: drive/red-zone opportunity and player share, modeled as a rare event rather
  than a transformed yardage forecast.

Opponent features must be adjusted for schedule and partially pooled. Assignment-level tracking
features are a separate enhancement gate because current public inputs do not supply reliable live
CB/WR, OL/DL, or route-coverage assignments.

### Layer E: market-specific distributions and calibration

Use distributions that match the data-generating process:

- attempts, targets, receptions, and carries: overdispersed count or state-mixture distributions;
- passing/rushing/receiving yards: compound count-efficiency distributions with heavy tails;
- touchdowns: zero-inflated Bernoulli/hazard or possession-level scoring model;
- all markets: position-, role-, and forecast-horizon-specific residual calibration.

Fit the mean and dispersion on settlement-aligned chronological data. Calibrate probabilities on a
later full-board fold, then confirm once on an untouched fold. Never calibrate only the selected
winners and losers.

### Layer F: separate market reader

Freeze and hash the independent forecast first. Then observe:

- same-book opening-to-current line and price movement;
- cross-book line and price disagreement;
- source reliability and timestamp freshness;
- sharper-book movement only when the provider identity and historical coverage are real;
- movement timing and corroboration across books.

Market evidence may support, demote, or—only after prospective evidence—flip a published side. It
does not rewrite the independent forecast. Missing market evidence is neutral. The published
projection, side, probability, grade, and representative line must remain mathematically coherent.

## Implementation order

1. **Fix the evaluation contract.** Keep the corrected replay provenance rule, retain every Week 5+
   board including No Plays, and report results by release and lock timestamp.
2. **Build settlement-aligned active-state targets for every supported market.** Reuse the promoted
   Rushing Attempts concept, but test conditional and role-mixture candidates independently for each
   market.
3. **Build team play/pass/rush budgets and roster-level constrained shares.** This is the first
   genuinely football-coherent candidate and has higher expected value than isolated matchup
   coefficients.
4. **Add the current-season as-of-safe matchup store.** Refresh EPA, explosives, air yards, YAC,
   CPOE, pace, and schedule-adjusted opponent features at slate level.
5. **Add injury/role redistribution and coaching continuity.** Do not promote while injury evidence
   coverage is incomplete.
6. **Fit market-specific compound distributions and calibration.** Freeze all gates before the next
   untouched outcomes.
7. **Run the market reader in shadow.** Test supportive promotions and adverse demotions as a paired
   policy, including board-count impact; do not use movement to conceal independent-model errors.
8. **Evaluate licensed tracking data separately.** Buy or integrate it only if historical/live
   coverage supports the same assignment features in training and inference.

## Acceptance gates

A candidate is eligible for production only when all of the following hold:

- lower MAE and RMSE than the incumbent independent point forecast overall and no material collapse
  in an important prop family;
- improved Brier/log loss and calibration slope/intercept on a complete-board untouched window;
- improved direction accuracy with game-cluster uncertainty reported;
- stable coverage and board size, with every demotion paired with a tested promotion rule;
- no target prop price, target outcome, future roster state, or post-lock information leakage;
- coherent team/player opportunity totals and coherent point/side/probability output;
- explicit missing-data holds and bounded slate-level ingestion;
- immutable locked records, new release identifiers, focused tests, `verify:model-change`, current
  main ancestry, protected PR, and live release/coverage verification.

The first four 2026 weeks are the diagnostic window, not a tuning playground. Week 5 and later
full-board snapshots are the prospective confirmation stream. Historical seasons may supply
partially pooled priors and training volume, but the promotion claim must be based on release-pure
2026 behavior and must never pretend older seasons had the same live evidence coverage.

## Data dependency boundary

The settlement, hierarchy, current-season team matchup, coaching, weather, and injury-role layers
can be materially improved with existing or publicly refreshable data. True assignment-level
CB/WR, TE/LB, OL/DL, route, coverage-shell, pressure, and box-count modeling cannot be honestly
productionized from the current provider payloads.

The smallest sufficient addition is a licensed or otherwise production-authorized feed containing
timestamped historical and live pregame/in-game participation/tracking features keyed to stable
game, team, and player identities. It must cover snaps, routes/alignments, blocking/pass-rush
interactions, coverage assignments/shells, and injury/practice availability with the same semantics
in backtest and live inference. Until that exists, use opponent-adjusted unit models with explicit
uncertainty and do not manufacture individual assignments.

## Primary research references

- NFL Football Operations, Next Gen Stats tracking overview:
  https://operations.nfl.com/gameday/technology/nfl-next-gen-stats
- nflverse in-season data update contract:
  https://github.com/nflverse/nflverse-data/blob/main/README.Rmd
- nflfastR play-by-play feature documentation and repository:
  https://github.com/nflverse/nflfastR
- nflverse participation loader, including the 2023+ postseason publication limitation:
  https://github.com/nflverse/nflreadr/blob/main/R/load_participation.R
- Route Identification in the National Football League:
  https://arxiv.org/abs/1908.02423
- Learning Man Coverage Assignments in the NFL:
  https://arxiv.org/abs/2603.25901
- Opponent-adjusted pass-block and pass-rush evaluation:
  https://arxiv.org/abs/2604.01491
