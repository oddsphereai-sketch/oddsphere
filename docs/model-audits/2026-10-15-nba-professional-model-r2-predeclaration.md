# NBA professional model r2 predeclaration

Date: 2026-10-15

Production decision deadline: 2026-10-20 (NBA opening night)

## Objective and release boundary

Build a professional NBA Daily Edge model using the same product contract as the mature MLB and
NFL systems: one authoritative independent basketball forecast, a separately validated NBA market
reader, exact-price decisions, immutable T-60 evidence, and release-pure tracking. This document
does not authorize a live prediction change. The current champion remains
`nba_v2_independent_first_2026_10_06_r1` until a chronological candidate clears the complete
model-change protocol.

The r2 program targets a production-ready NBA release for opening night. Shadow is a validation
stage, not the end state. Its first implementation slice is data-only: it captures dated
BALLDONTLIE GOAT team feature
snapshots in additive tables. It does not read those tables in the active model, overwrite
`nba_team_ratings`, change a score, side, probability, grade, price, stake, lock, schedule, member
copy, or tracking record.

## End-state contract

1. The independent stage predicts possessions, each team's points per possession, a joint score
   distribution, Moneyline probability, line-specific Spread probability, and line-specific Total
   probability without evaluation-book prices or outcomes unavailable at prediction time.
2. Pregame availability is player- and minutes-aware. Injury counts alone are not a player-impact
   model. Unknown availability increases uncertainty and can hold an exact-price decision.
3. Team strength is opponent-adjusted and time-aware. Current-season evidence is shrunk toward an
   explicit prior early in the year; no full-season aggregate may leak into an earlier prediction.
4. Candidate matchup families include Four Factors, shot zones, play types, tracking, transition,
   half-court creation, rebounding, foul pressure, and hustle. Capturing a field does not authorize
   production use; every family must improve chronological holdout performance or calibrated
   uncertainty.
5. Schedule context includes venue, home court, rest, back-to-backs, compressed stretches, travel,
   time-zone change, and altitude where available. Coefficients are selected chronologically rather
   than copied from a public estimate.
6. Market evidence remains a separate timestamped layer. Same-book/two-sided no-vig pairs,
   exact-line identity, opening/current continuity, target-book exclusion, and price freshness are
   mandatory. A market correction may change the final forecast only after its fixed rule improves
   untouched chronological evidence; naive score averaging and split-only flips are prohibited.
7. The writer, member reader, lock snapshot, and tracking row expose one coherent release tuple.
   Existing locked NBA payloads remain immutable.

## Candidate data and provider roles

- BALLDONTLIE GOAT: historical games and player-game statistics; dated team/player season
  averages; advanced, tracking, play-type, shooting-zone, hustle, injury, active-player and roster
  evidence; opening/current odds as an audit and continuity source.
- NBA official injury reports: authoritative scheduled pregame availability checkpoints.
- SharpAPI: primary current sportsbook quotes, line history, public splits and opportunity context.
- ESPN: schedule/injury reconciliation fallback.
- Basketball Reference: historical validation/backfill during transition, not an unversioned sole
  production dependency.

BALLDONTLIE lineups are available only after a game begins and therefore cannot be treated as a
pregame confirmed-lineup input. Expected rotations and minutes must be estimated from prior games;
late availability must come from a true pregame source.

## Chronological evaluation

Every feature row carries an as-of date and provider release. Research must reconstruct only the
state available before each game's decision cutoff. Candidate selection, calibration and final
evaluation use separate chronological blocks, supplemented by rolling-origin folds.

Required reporting includes team-score, margin and Total MAE/RMSE; Moneyline Brier score/log loss
and calibration; Spread/Total direction at exact lines; exact-price units/ROI; CLV when available;
coverage; market mix; promotion/demotion counts; and game-clustered uncertainty. Baselines are the
active r1 model, simple rating models, the market benchmark, and the owner's manual-model lifetime
record when supplied.

No live grade or stake is authorized by a score-only backtest, an opened diagnostic set, a blended
release, or an aggregate record without exact prices. Insufficient evidence remains shadow-only.

Historical reconstruction will use a walk-forward pregame state: each game may use only games,
player participation, injuries and market observations timestamped before that game's decision
cutoff. Random row splits and end-of-season averages applied backward are prohibited. When exact
historical prices or pregame availability cannot be recovered, that slice may test score error or
probability calibration but cannot support a units, ROI or market-reader claim.

The first point-in-time builder treats a finalized result as unavailable until five hours after tip.
This conservative delay prevents a same-evening or simultaneous game from consuming a result that
was still in progress at its own tip. Its candidate matrix includes short/current/prior offensive and
defensive efficiency, opponent scoring efficiency, pace, Four Factors, online opponent-adjusted
ratings, rest and compressed-schedule context, volatility, and rotation depth/concentration. A
no-leakage test changes one finalized score and requires that game's own pregame vector to remain
identical while only later eligible games change.

Research basis for the candidate families includes the NBA's per-possession advanced-stat framework,
the modern Four Factors literature, peer-reviewed NBA travel/rest work, and regularized adjusted
plus-minus literature. These motivate candidates; they do not determine production coefficients:

- https://www.nba.com/stats/help/glossary
- https://arxiv.org/abs/2305.13032
- https://pmc.ncbi.nlm.nih.gov/articles/PMC8636381/
- https://pmc.ncbi.nlm.nih.gov/articles/PMC7925613/
- https://pmc.ncbi.nlm.nih.gov/articles/PMC7447047/

The October 20 decision is a go/no-go gate. A candidate that clears the independent-model,
market-reader, coherence and operational checks may replace r1 under new release identifiers. If
the evidence is incomplete, r1 remains the production fallback while r2 continues forward shadow
collection; the deadline does not justify promoting an unproven candidate.

The frozen score tournament uses seasons before 2024-25 for fitting, 2024-25 for feature-family,
architecture and regularization selection, and 2025-26 as the one-time confirmation block. It
compares rating-only, rating-plus-schedule, Four-Factors, and rotation-enriched ridge candidates,
with both direct team-score and joint margin/Total heads. The tournament writes research artifacts
only and hard-codes `promotionAuthorized: false`; score results alone cannot change production.

## Initial shadow schema

`schema-migration-v43-nba-goat-shadow-features.sql` adds immutable capture batches and team-stat
observations. The collector is read-only unless both `--apply` and
`NBA_GOAT_SHADOW_WRITES_ENABLED=true` are supplied. An incomplete batch can resume by inserting only
missing unique rows; a completed batch is never overwritten.

## Promotion prerequisites

- Version every changed independent, distribution, market-reader, grade and lock component.
- Prove provider coverage/freshness and bound requests, pagination, retries and writes.
- Report the complete current-board side, promotion, demotion, actionable and coverage deltas.
- Run focused NBA tests and `npm run verify:model-change` from the clean committed worktree.
- Reconcile latest `origin/main`, pass integration safety, publish only through a protected PR, and
  verify the live release, writer lease, source health, reader, lock and tracking behavior.
