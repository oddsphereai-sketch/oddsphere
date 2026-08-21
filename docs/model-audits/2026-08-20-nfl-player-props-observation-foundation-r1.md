# NFL player-props local observation foundation r1

Date: 2026-08-20

## Decision

Accept the versioned provider-observation foundation for local research only. It is not a fitted
player-props model, calibration, decision policy, grade writer, or product launch. It makes no
production database, cron, route, tracking, stake, or member-reader change.

- Research schema: `nfl_player_props_research_schema_2026_08_20_r4`
- Provider snapshot: `nfl_player_props_provider_observation_2026_08_20_r4`
- Shadow model: `nfl_player_props_shadow_unfit_2026_08_20_r1`
- Calibration: `nfl_player_props_calibration_unfit_2026_08_20_r1`
- Decision policy: `nfl_player_props_decision_unfit_2026_08_20_r1`
- Authoritative local collector: `scripts/operator/collect-nfl-player-props-observations.ts`
- Runtime contract: `lib/services/football/nflPlayerPropsContract.ts`

The `unfit` releases are deliberate circuit breakers. No consumer may infer a projection,
probability, edge, play grade, or stake from this observation snapshot.

## Product and modeling boundary

The eventual NFL product should reuse the MLB player-props interaction pattern: one Player Props
destination with separate MLB and NFL pills, a compact server-built member snapshot, and no
provider calls from member requests. This audit does not add that UI or reader.

The model and the market brain are separate layers:

1. A statistical distribution estimates a player's full outcome distribution, not just a point
   projection.
2. A price layer converts each exact line and price into no-vig market probability and model EV.
3. A market-reading layer evaluates opening-to-current movement, fixed-line price movement,
   cross-book agreement, freshness, limits/source quality, and conflicts.
4. A calibrated decision release may later assign Best Angle, Lean, Watchlist, Caution, or No Play.

Market evidence is not allowed to overwrite the base projection silently. Each candidate signal
must beat both the market-only baseline and the same statistical model without that signal on
chronological holdout weeks. A grade must be attached to an exact book, line, price, observation
time, and model/calibration/decision release.

## Initial market scope

Phase one is limited to the higher-frequency volume and yardage families:

- passing attempts, completions, and yards;
- rushing attempts and yards;
- receptions and receiving yards.

Touchdowns, first/anytime touchdown, interceptions, longest-play props, combined yardage, and
kicking props remain research markets. Sparse binary/count outcomes and milestone ladders require
different likelihoods and calibration; they must not be pooled with ordinary two-way over/under
rows.

## Research basis

There is little directly transferable public research on profitable NFL sportsbook player-prop
models. The defensible architecture comes from combining validated football subproblems with
probabilistic forecasting discipline:

- [nflfastR](https://nflfastr.com/) provides public play-by-play history and modeled completion
  probability, expected yards after catch, expected points, and win probability. It supports
  leakage-safe opportunity, efficiency, game-state, and opponent features rather than box-score
  averages alone.
- [Predicting NFL play calls with hidden Markov models](https://arxiv.org/abs/2003.10791) reports
  out-of-sample play-call prediction and supports explicitly modeling latent game state and play
  selection before allocating player opportunities.
- [Frame-by-frame completion probability](https://arxiv.org/abs/2109.08051) uses a two-stage
  target-probability then conditional-completion structure. The analogous pregame design is to
  estimate routes/targets first and catch/yards conditional on that opportunity.
- [Expected Hypothetical Completion Probability](https://arxiv.org/abs/1910.12337) uses Bayesian
  non-parametric completion modeling with uncertainty integration, reinforcing that target and
  completion uncertainty should propagate through the final distribution.
- [Going Deep](https://arxiv.org/abs/1906.01760) combines a modular within-play framework with
  conditional density estimation. Its relevant lesson is to retain distributions and dependence,
  not independently regress every prop mean.
- [Inductive Venn-Abers predictive distributions](https://proceedings.mlr.press/v91/nouretdinov18a.html)
  and the broader probabilistic-forecasting literature motivate held-out distribution calibration.
  NFL evaluation still requires chronological, clustered game/player splits because ordinary IID
  guarantees do not match weekly football drift.

These sources inform architecture; none establishes a profitable prop edge. Profitability and
grade thresholds must be proven independently using locked, offered prices.

## Proposed distribution stack

The next research release should construct an as-of player-week cache and fit components in this
order:

1. Availability and role: active status, practice/injury state, depth position, prior snaps,
   routes, dropbacks, designed rush share, target share, red-zone role, and teammate competition.
2. Team opportunity: projected offensive plays, pass rate over expectation, neutral/game-state
   tendencies, pace, opponent pace, and market-implied scoring environment.
3. Player allocation: hierarchical/shrunk shares for attempts, routes, targets, carries, and
   goal-line work with explicit quarterback/starter uncertainty.
4. Conditional efficiency: completion probability, air yards, yards after catch, yards per rush,
   explosive-play and sack/scramble behavior, adjusted for opponent and venue/weather context.
5. Joint simulation: preserve correlations among team plays, quarterback attempts/completions,
   receiver targets/receptions/yards, rush shares, game script, and teammate outcomes.
6. Market-specific CDFs: price the exact threshold from simulation or a validated count/continuous
   distribution, then calibrate by market, line region, role certainty, and data regime.

Candidate families should be compared against simple empirical-Bayes, negative-binomial,
beta-binomial, and market-only baselines before more complex gradient-boosting or neural models
are accepted. CRPS/log loss/Brier, interval coverage, calibration error, MAE, and tail calibration
all matter; MAE alone cannot validate over/under probabilities.

## Live provider observation

A bounded 2026 Regular Week 1 collection completed on 2026-08-20:

- 16 canonical games and 933 retained observations;
- 34 BALLDONTLIE requests and one SharpAPI request;
- BALLDONTLIE: 840 normalized rows across four games, 78 resolved players, DraftKings and
  FanDuel, with 420 current and 420 opening rows;
- SharpAPI: 93 current NoVig touchdown over/under rows across the same four canonical games and
  76 named players;
- 80 BALLDONTLIE rows are ordinary Phase 1 two-way offers, while 752 are milestone offers;
- 22 BALLDONTLIE and 17 SharpAPI complete two-way buckets;
- 114 current and 114 opening period-specific touchdown rows were rejected as unsupported
  markets, rather than silently remapped;
- every retained Sharp row matched exactly one BALLDONTLIE slate game by teams and scheduled
  start; cross-week rows were rejected;
- collection completed, but `modelingReady` remained false.

Provider roles are therefore:

- BALLDONTLIE: canonical slate identity, player identity, current/opening offers where available;
- SharpAPI: complementary book/market observations and later movement/close evidence, subject to
  entitlement and historical coverage;
- Playbook: roster, team/player, opponent, and main-market context only; its documented surface
  has no player-prop price endpoint.

Observed coverage is early-board coverage, not a launch guarantee. Week 1 currently has prices for
only four of 16 games. Milestone offers cannot substitute for missing conventional two-way lines.

## Load and failure controls

- Maximum 18 games per slate.
- Maximum eight Sharp cursor pages at 200 rows each.
- BALLDONTLIE game requests run at concurrency three.
- Player identity enrichment is capped at 300 players in batches of 100.
- Provider transport completion is separate from modeling readiness.
- Unknown markets, unmatched events, missing identity, truncation, and empty providers create
  explicit health findings.
- Persisted local snapshots use content-hashed filenames and a small latest manifest under the
  ignored `football-research/cache/nfl-player-props` path.

The eventual production path must write one bounded compact slate snapshot under the existing
sport-scoped `prediction_pipeline` lease. Member reads must make zero provider calls, and a failed
refresh must retain the last coherent snapshot.

## Promotion gates

Before any live probability, play grade, or stake:

- build checksum-pinned, as-of historical player-week features and exact outcome labels;
- prove provider/player/game identity through trades, suffixes, duplicate names, and late status
  changes;
- reconstruct or capture exact opening, decision-time, locked, and closing prices without future
  leakage;
- use expanding chronological train/calibration/holdout splits and cluster uncertainty by game
  and player;
- beat player baseline and market-only benchmarks on calibration and locked-price value;
- report market-by-market coverage, board count, CLV, units/ROI, Brier/log loss, calibration gap,
  and tail behavior;
- test actionable promotions together with demotions and report net board impact;
- complete a forward shadow period across representative regular-season weeks;
- add the compact NFL reader and MLB/NFL pills only after data and snapshot contracts are stable.

## Board impact and rollback

Board impact is zero: no predictions, probabilities, grades, stakes, tracking records, production
snapshots, member pages, routes, crons, leases, or database rows changed.

Rollback is removal of the isolated local contract, normalizers, collector, focused test, operator
command, and this registry/audit entry. Existing NFL Daily Edge and all other sports remain
unchanged.
