# NFL real local pregame model r5

Date: 2026-08-19  
Scope: NFL preseason product rehearsal and NFL regular-season pregame model  
Environment: local only; no production writer, cron, database, official grade, stake, or tracking mutation

## Releases

- Source cache: `nfl_real_model_source_cache_2016_2025_2026_08_19_r1`
- Feature release: `nfl_real_pregame_features_2016_2025_2026_08_19_r1`
- Tournament: `nfl_real_pregame_model_tournament_2026_08_19_r1`
- Frozen historical candidate: `nfl_pregame_real_local_candidate_2026_08_19_r2`
- Current refit: `nfl_pregame_real_local_current_refit_2026_08_19_r3`
- Calibration: `nfl_empirical_residual_probability_2026_08_19_r1`
- Preseason model: `nfl_preseason_real_local_candidate_2026_08_19_r2`
- Preseason stored input: `nfl_preseason_current_provider_inputs_2026_08_19_r2`
- Preseason scored snapshot: `nfl_preseason_real_current_snapshot_2026_08_19_r2`
- Preseason shadow-grade policy: `nfl_preseason_shadow_grade_policy_2026_08_19_r1`
- Current regular snapshot: `nfl_regular_real_current_snapshot_2026_08_19_r1`
- Tracking policy: `football_tracking_policy_2026_08_19_r1`

The r3 current model freezes the architecture selected by r2, then refits that architecture
through 2025. It is a new immutable release and does not rewrite r2 evaluation evidence.

## Real-data boundary

The regular-season source cache contains 40 checksum-pinned nflverse files covering
2016–2025 play-by-play, weekly rosters, snap counts, and injury reports (209,498,602 bytes).
The feature build contains 2,639 regular-season games and excludes preseason. Team state is
updated only after a complete week, so an earlier game in a week cannot leak its result into a
later game in the same week. Training features use only information available before kickoff.

The 143 model features cover opponent-adjusted offense and defense EPA/play, pass and rush
EPA, early-down pass efficiency, success and explosive-play rates, sacks, turnovers, pace,
red-zone rate, pass rate over expected, Elo, quarterback EPA/CPOE/sacks/turnovers, starter and
coach continuity, roster continuity, injuries, rest, venue, roof, surface, and weather.

The current 2026 Regular Season Week 1 input is a checksum-frozen BALLDONTLIE snapshot with
16 verified games, paired named-sportsbook moneyline/spread/total prices, current injury data,
32 rosters/depth charts, and a matched historical QB1 state for all 32 teams. Member reads make
no provider calls; the local reader consumes the bounded snapshot.

## Chronological model tournament

- Training seasons: 2018–2023
- Architecture/calibration selection: 2024
- Untouched historical holdout: 2025 (272 games)
- Independent candidates: ridge, robust ridge, histogram gradient boosting, Huber gradient
  boosting, Extra Trees, Random Forest, and pairwise blends
- Margin architecture: 50% Huber gradient boosting + 50% Random Forest; frozen market blend
  is 30% independent projection and 70% terminal market margin
- Total architecture: 25% Huber gradient boosting + 75% Random Forest; frozen market blend is
  40% independent projection and 60% terminal market total
- Exact-line moneyline, spread and total probabilities use expanding-window empirical residual
  distributions. Identity, Platt and isotonic calibrators were compared on 2024; identity won
  all three markets before the 2025 holdout was opened.

### 2025 holdout

| Target | Independent MAE | Market-aware MAE | Market-only MAE |
| --- | ---: | ---: | ---: |
| Margin | 10.016 | 9.757 | 9.722 |
| Total | 10.747 | 10.451 | 10.393 |

Holdout Brier scores were 0.21375 for home win, 0.25198 for cover, and 0.25305 for total.
The real model is materially stronger than the prior score-only benchmark, but neither the
margin nor total forecast beat the terminal market. Simulated threshold betting did not
establish a stable actionable rule. Therefore r2 failed the launch gate, and r3 is limited to
locked 2026 forward evaluation. It issues no grades or stakes.

## Preseason product rehearsal

The separate preseason cache contains 309 actual BALLDONTLIE outcomes from 2019–2025; the
canceled 2020 preseason contributes zero rows. The model uses prior regular-season team state
and team-specific preseason history. Historical quarterback rotations, snap plans and
comparable-timestamp odds are unavailable.

On the untouched 2025 preseason, margin MAE was 12.691, home-win Brier was 0.27169, and the
margin correlation was negative. Total MAE was 8.219, but market value cannot be backtested.
The current preseason model therefore exists only to exercise the complete real product path:
schedule, odds, inputs, predictions, injuries, reader state and navigation. The separate r1
shadow-grade policy gives those real outputs a non-actionable product hierarchy without claiming
validated betting value: moneyline/spread signals can reach only Caution, sufficiently strong
total signals can reach Watchlist, and no preseason market can become Lean or Best Angle.
Preseason Week 2 is the current complete rehearsal board. Week 3 is fail-closed as of this audit
because one or more games have moneyline-only prices; it will not render until paired spread and
total coverage is complete and the scored snapshot is regenerated.

The product exposes one current NFL board. During preseason that pointer is fixed to the complete
Week 2 stored package; old `phase` and `week` query parameters cannot open a parallel board. The
reader consumes the checksum-matched stored schedule, odds, injuries and scored projection bundle
and therefore makes zero provider calls. Before regular Week 1, the same pointer—not a second
reader—must be advanced to a launch-approved, locked-input regular-season snapshot.

## Tracking and publication boundary

- Preseason is permanently ineligible for official and lifetime tracking. Its games and results
  cannot train or calibrate the regular-season model.
- Regular-season tracking remains off. After explicit launch approval, only a prediction locked
  before kickoff may settle and append to the pre-existing NFL lifetime record.
- The existing NFL lifetime baseline is never reset, replaced, or blended with preseason.
- Board impact in this local release: zero actionable promotions, zero actionable demotions and
  zero net actionable change. The current 48 market rows move from a blanket No Play display to
  8 Watchlist, 26 Caution and 14 No Play shadow labels. At the game-headline level the mix is
  8 Watchlist, 7 Caution and 1 No Play. Lean and Best Angle remain zero.
- Rollback: remove the isolated local NFL reader/model files or restore the previous research
  contract constant. No production behavior or historical row changes.

## Cost and failure controls

- Historical raw data and model artifacts are local, checksum-pinned, and gitignored.
- Current provider collection is operator-triggered and bounded at slate level; roster/depth
  collection uses concurrency four rather than a request per member/card.
- The reader uses a five-minute local cache and never synthesizes a schedule, price, opening,
  split, injury, result, or prediction when evidence is missing.
- BALLDONTLIE public/sharp splits are unavailable. They stay visibly unavailable and are not
  inferred from ticket/money bars or silently used in the model.

## Verification contract

- `npx tsc --noEmit --pretty false`
- `npm run test:football-shadow-foundation`
- `npm run test:football-model-research`
- `npm run test:football-weekly-slate`
- `npm run test:football-product-preview`
- `npm run verify:model-change`

No deployment is authorized by this audit. Promotion requires clean locked 2026 forward
evidence, a new immutable release, a tested promotion/demotion policy with board counts, the
shared `prediction_pipeline` lease, a deliberate production enablement, and live verification.
