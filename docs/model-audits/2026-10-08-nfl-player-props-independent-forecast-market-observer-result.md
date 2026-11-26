# NFL Player Props independent forecast and market observer result

Date: 2026-10-08  
Starting base: `0e7e6e056f9b7da64dc3f71920c908f577c7c5c5`  
Decision: retain production; replace the architectural target and begin prospective evidence capture

## Owner direction and resulting architecture

The prediction must be an independent football forecast. The market is a separately reported
observer that may confirm the forecast, conflict with it, reduce decision confidence, or eventually
support a fully coherent side change only after release-pure chronological evidence proves that
rule. Consensus price is not a continuously blended forecast feature.

This supersedes the earlier objective of merely increasing the independent share of the existing
posterior. The three tournaments in this audit remain useful falsification evidence, but no market
blend from them is a production candidate.

The intended boundary is:

1. **Independent forecast:** projection and outcome distribution from timestamp-safe football data.
2. **Representative market:** one real executable player/market/line and its exact price.
3. **Market observer:** same-book line and price movement, source identity/trust, timing,
   corroboration, and disagreement with the independent forecast.
4. **Decision policy:** exact-price economics plus a separately calibrated market-observer state.
5. **Member coherence:** the displayed projection and prediction remain on the same side of the one
   displayed representative line. Missing market evidence is neutral.

Until a side-change rule is validated, the market observer may label agreement or conflict and may
participate in symmetric promotion/demotion research, but it may not silently replace or bend the
independent probability.

## Current production diagnosis

The owner's market-dependence concern is correct.

- Ordinary props currently use
  `sigmoid(logit(market) + w * (logit(model) - logit(market)))` in
  `lib/services/football/nflPlayerPropsRuntime.ts`.
- Every ordinary-market shard currently has `marketResidualWeight: 0.2`. The released final
  probability is therefore 20% independent model and 80% target-excluded market in log-odds space.
- Passing Attempts, Passing Completions, and Passing Yards also replace their point centers with a
  90% cross-market workload center / 10% role-model center before the probability marriage.
- Same-book movement is captured and classified, but currently changes only decision thresholds;
  it has no independently validated probability or side-flip coefficient.

The active Rushing Attempts point head itself remains legitimate and price-blind. It is the already
released 25% preceding / 75% official-participation-eligible head, checksum
`8ba171fe49c1ff87d50d3cc05fa52c2c77a4a7f84b8efc9f53766c8801249c02`. This audit does not revert
that improvement.

## What the independent model already uses

The historical substrate has 138,860 official 2016-2025 player-game rows and includes lagged and
rolling player volume, role share, offense snap share, team volume, opponent allowance, position,
home field, team/opponent play mix, completion and efficiency rates, sack pressure, EPA, first-down
and explosive rates, turnovers, air yards, YAC, roof, weather, and week. The Rushing Attempts
portable head consumes 204 numeric features.

This is materially more than a recent-average model. The weakness is not that offense, defense,
role, or environment are wholly absent. The important missing pieces are timestamp-safe pregame
availability/role changes and validated historical market movement.

## Chronological Rushing Attempts evidence

### 1. Frozen active probability; posterior-weight tournament

The checksum-pinned 2025 opening snapshot has 272 games, 183,182 normalized observations, and 942
exact non-push Rushing Attempts scopes after target-book exclusion. Selection contained 506 rows
through October 31; confirmation contained 436 rows from November onward.

| Independent log-odds share | Selection Brier / log loss | Confirmation Brier / log loss | Confirmation direction |
| ---: | ---: | ---: | ---: |
| 0% market-only | 0.24836 / 0.68984 | 0.24835 / 0.68984 | 55.28% |
| 20% production | 0.24419 / 0.68158 | 0.24338 / 0.67968 | 55.96% |
| 50% diagnostic | **0.24275** / 0.68080 | **0.24059** / **0.67353** | 56.42% |
| 65% | 0.24344 / 0.68501 | 0.24081 / 0.67410 | 57.11% |
| 100% raw independent | 0.24718 / 0.70458 | 0.24407 / 0.68336 | 56.65% |

The raw independent signal is directionally useful, but its probability tail is miscalibrated. No
predeclared independent-first weight passed selection Brier and log loss. Result checksum:
`f142ba1e0538377dbc2459787caea6506cbb7ae2c3be2344dfd431dada1f8772`.

### 2. Price-blind independent calibration

A second predeclared test fit only projection/threshold/outcome calibration through September,
selected in October, and locked November onward. No consensus probability or sportsbook price was
an independent feature. Logistic calibration of `projection - line` was selected.

- Raw independent confirmation: 56.65% direction, 0.24407 Brier, 0.68336 log loss, 0.09084
  calibration gap.
- Calibrated independent confirmation: 56.65%, 0.24277, 0.67838, 0.07531.
- Current production confirmation: 55.96%, 0.24338, 0.67968, 0.05998.

The calibrated independent signal beat production direction, Brier, and log loss, but missed the
predeclared calibration-gap tolerance. The selection-chosen 100% independent candidate was
therefore vetoed. A 65% candidate happened to pass confirmation, but selecting it after opening
confirmation would be invalid back-selection. Result checksum:
`08d7d7d0a43c93412871b88895af4bb4b4ec9642bc9c5dd9fa1985627a4f9f3e`.

### 3. Position-specialist and active-role point heads

Separate QB versus RB/FB Poisson heads, active-role training weights, their combination, and fixed
25/50/75/100% blends were fit through 2022 and selected on 2023. None improved both MAE and RMSE for
both the complete participating target and the `prior_rushing_attempts_avg5 >= 4` active-role
cohort. They were rejected before confirmation/holdout selection. Result checksum:
`ace99de169c3f11a9b7621116d54735515e8ea49a3c18f449b645ab06d69d79d`.

This rules out a simple position split or role-weighting patch. It does not support weakening the
already released settlement-aligned head.

## Specific missing dependencies

### Timestamped historical availability and substitution context

The source cache contains injuries, weekly rosters, and snap counts for 2016-2025. However, the
history manifest explicitly records
`CURRENT_WEEK_ROSTER_AND_INJURY_CONTEXT_LACKS_SOURCE_TIMESTAMPS`; injury and roster status are in
`unstampedContextColumns` and are excluded from model features. Using them would leak information
that may not have been public at forecast time.

The current inference path does capture timestamped injury/depth context and safely holds players
listed out, but `injury_status`, `depth`, and `depth_rank` are not trained features in the released
204-feature head. Consequently, the system cannot learn historical substitution shocks such as a
backup inheriting carries after a starter is ruled out.

The NFL's injury policy makes practice participation and game status explicitly time-varying public
reports, so retaining their publication time is part of the predictive fact, not metadata that can
be discarded. See the official [NFL injury report policy](https://operations.nfl.com/media/2683/2017-nfl-injury-report-policy.pdf).

### Historical same-book player-prop movement

The bounded BALLDONTLIE reconstruction provides the 2025 opening record, but BALLDONTLIE documents
that live player props are updated in real time and historical updates are not stored; only a
separate opening endpoint is retained. Therefore 2025 cannot supply a trustworthy open-to-T-24,
T-6, T-60, or close movement label. See the official
[BALLDONTLIE API documentation](https://docs.balldontlie.io/).

The current OddSphere writer already records opening/current same-book evidence prospectively, but
the available completed, settled release-pure sample is not yet sufficient for a per-market
confirmation/adverse/flip tournament. A movement flip coefficient fitted now would be invented.

### Individual matchup data

Public nflverse data supports play-by-play, official player/team stats, snap counts, rosters,
injuries, participation, and some Next Gen Stats aggregates. It does not provide a historical,
pregame, player-pair assignment table for OL/DL blocks or CB/WR coverage that can be joined to every
supported prop. nflverse also notes that 2023+ participation data is supplied after the postseason,
which limits live use. See the official [nflverse data catalog](https://github.com/nflverse/nflverse-data)
and [participation loader](https://github.com/nflverse/nflreadr/blob/main/R/load_participation.R).

Player tracking can model expected rushing yards, coverage, routes, location, speed, and
acceleration, but the NFL describes the raw tracking feed as a club/league system rather than a
complete public historical pregame dataset. See [NFL Next Gen Stats](https://operations.nfl.com/gameday/technology/nfl-next-gen-stats).

## Smallest safe data addition

Do not add a new provider loop or second prediction writer. Extend the existing append-only,
slate-level evidence path, under the shared `prediction_pipeline:nfl` lease, with two release-pure
tables/snapshots:

1. **Pregame player context** at every available official practice-report/depth update and at the
   existing opening/unlocked/T-60 boundaries: source, source player/game identity, published-at,
   captured-at, practice participation, game designation, active/inactive, depth slot/rank, and the
   teammates whose status can transfer opportunity.
2. **Same-book prop observations** at opening, T-24, T-6, and T-60: player/game/market/line identity,
   book, both side prices, observed-at, captured-at, source, and availability. Preserve every prior
   observation; never rewrite an opening or locked snapshot.

This is a storage/evidence addition, not authorization to change predictions. It should reuse the
already bounded slate collector and authoritative writer. The Odds API can return timestamped
historical snapshots and player props are queried per event, but using another provider is optional;
prospective internal persistence is sufficient and avoids a new production loop. See the official
[historical snapshot documentation](https://the-odds-api.com/liveapi/guides/v4/index.html).

## Validation plan after evidence accrues

Run a separate tournament for each prop market; do not pool markets or books and call the result
universal.

- Freeze weeks 1-8 for feature/calibration fit, weeks 9-12 for rule selection, and weeks 13-18 for
  untouched confirmation. If a split has fewer than 100 settled exact-line decisions, retain shadow
  mode and continue into the following season.
- Independent candidates may use only timestamp-safe football context. Evaluate point MAE/RMSE,
  direction, Brier/log loss, calibration, chronological segments, participation/status cohorts,
  and board coverage.
- Market-observer candidates are discrete states: unavailable, neutral, confirming, adverse, and
  strong adverse. Test book-specific and corroborated movement at fixed horizons. Compare against
  the unchanged independent forecast; do not use final/closing data at an earlier decision time.
- A side-flip rule must improve direction, Brier, and log loss on untouched confirmation, preserve
  projection/side/line coherence, and beat a no-flip observer. Missing evidence remains neutral.
- Decision overlays must report paired promotions and demotions, exact-price EV, actionables,
  settled units, board size, and nonpositive-EV actions. No board-flattening shortcut is allowed.
- Locked writer immutability and locked reader precedence remain mandatory.

## Publication decision

No production model, probability, grade, UI, provider loop, writer, schedule, lock, or release
identifier changes in this audit. The current independent point improvement remains active. The
market-dominant posterior is diagnosed but is not replaced with an under-validated pure model.

The next production-capable step is coordinated prospective evidence persistence in the existing
writer-owned area. That area overlaps the separate CFB/NFL scheduling and T-60 reliability task and
must not be edited from this branch without explicit ownership coordination.
