# NFL weekly joint-score engine predeclaration

Date: 2026-09-25

Tournament: `nfl_weekly_joint_score_engine_tournament_2026_09_25_r1`

Status: frozen research plan; no production behavior is authorized by this document

## Problem boundary

The current post-Week-1 NFL path does not build a fresh matchup-specific score
distribution from current team performance. It shifts a pooled Week-1 residual
shape to a moneyline projection and the market total, then gives current market
evidence 75% weight. That can preserve broad moneyline strength while leaving
spread, total, and displayed-score accuracy too dependent on the market center.

This tournament tests a replacement score-mean engine, not a grade threshold,
side flip, representative-score cosmetic, or board-count rule. Member copy,
labels, layout, tracking history, stakes, readers, writers, and crons are out of
scope.

## Frozen architecture

1. Build one orientation-symmetric team-score row per offense/opposing defense.
2. Exclude every market line, price, result, and team identity from the
   independent feature set.
3. Estimate each team's points from locked pre-week offense, opposing defense,
   pace, explosive-play, pressure/sack, turnover, red-zone, quarterback,
   injury, continuity, rest, venue, and weather state.
4. Pair the two independently estimated team scores into one game environment.
5. Apply the market only afterward as a two-team calibration blend. Both team
   scores must share the same frozen market weight so margin, total, and winner
   remain coherent.
6. Derive moneyline, spread, and total probabilities from the same score means
   and prior chronological residual distributions. No market receives a
   separate side-selection head.
7. The existing discrete-drive law may consume qualifying score means later;
   this tournament does not change its support or representative-score policy.

## Data and chronology

- Input: checksum-pinned
  `nfl_real_pregame_features_2016_2025_2026_08_19_r1`.
- Training: 2018-2022.
- Selection: 2023 only.
- Untouched confirmation: 2024 and 2025, opened once after estimator and blend
  selection are frozen.
- Every feature row is locked before its complete week is applied to team state.
- Preseason is excluded.

## Candidate family

The tournament compares regularized linear, robust linear, histogram-gradient,
and extra-trees team-score estimators. Selection also considers simple equal
ensembles. For each independent estimator, the only post-model calibration is
a shared market weight from 0% through 90% in 10-point steps. The selected
recipe minimizes a frozen joint loss over team-score, margin, and total MAE,
with direction accuracy and complexity tie-breakers.

The independent forecast and each market blend are both retained in the report.
This prevents a strong market calibration result from being mislabeled as an
independent matchup-model improvement.

## Promotion gates

A production cutover is ineligible unless the untouched 2024-2025 confirmation
passes every gate below:

- pooled team-score MAE improves over market-implied team scores;
- pooled margin MAE and total MAE both improve over market;
- neither confirmation season is worse than market on both margin and total
  MAE;
- moneyline winner accuracy does not regress versus market;
- spread and total direction accuracy are each at least 50%;
- pooled moneyline, spread, and total Brier score do not regress versus their
  no-vig market references;
- both spread sides and both total directions occur;
- the exact-price two-percentage-point action lane has at least 30 resolved
  selections, positive pooled ROI, no confirmation season below -5% ROI, and
  both directions represented for each spread/total market;
- a same-slate replay reports promotions, demotions, actionable counts, market
  mix, and no unexpected board collapse;
- runtime inputs can reproduce the research feature semantics without adding a
  per-card provider call or a second writer.

Failure of any gate keeps the candidate in research/shadow. It cannot be
rescued by relaxing grades, suppressing picks, manufacturing board balance, or
rewriting settled/locked rows.

## Production boundary if and only if qualified

A qualifying implementation must bump all affected model, distribution,
probability, calibration, decision, grade, member, writer, schema, fixture, and
snapshot releases; remain inside the sole NFL writer and
`prediction_pipeline:nfl` lease; preserve T-60 immutability and release-pure
tracking; pass `npm run verify:model-change`, focused tests, TypeScript, lint,
build, integration safety, protected-PR checks, and live reader/database proof.

Player props are a separate release boundary. A qualified game environment may
be evaluated as an upstream pace/team-points input, but cannot alter live prop
predictions until a clustered, market-specific, release-pure prop replay clears
its own gates.
