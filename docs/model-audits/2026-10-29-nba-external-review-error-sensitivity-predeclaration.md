# NBA external-review error-sensitivity predeclaration

Date: 2026-10-29

Status: offline audit only. No live, shadow, member, writer, database, grade,
stake, lock, or tracking authority.

## Question

Identify reproducible weaknesses in the current NBA independent forecast and
the unified post-reader product before proposing another production release.
The audit must distinguish point-forecast error, probability calibration,
betting-line direction, market-reader correction value, and board calibration.

External AI review is used only to challenge the experiment design and the
interpretation. It is not statistical evidence and cannot authorize a model
change.

## Frozen incumbent

- base commit: `62d6764d925fdd0ef94bac2e00dc9ec9960f3b05`;
- model / prediction record:
  `nba_professional_unified_2026_10_29_r24_consumer_execution_authority`;
- market marriage:
  `nba_market_marriage_2026_10_29_r25_consumer_execution_authority`;
- grade policy:
  `nba_grade_policy_2026_10_29_r15_consumer_execution_authority`;
- independent artifact:
  `nba_professional_deployment_candidate_2026_10_15_r15_comparable_benchmark_gates`;
- point-in-time features:
  `nba_point_in_time_features_2026_10_15_r13_season_regime_state`;
- unified projection:
  `nba_unified_final_projection_2026_10_20_r4_minimum_coherent_crossing`.

The exact deployed artifact was refit through 2025. It may be scored only on
future rows after its release. Historical comparisons must rebuild the
incumbent recipe inside each chronological fold; backward scoring of the
full-history artifact is diagnostic leakage and may not be reported as
historical incumbent performance.

## Evidence partitions

1. Historical 2022-2025 seasons are opened replication/development evidence.
   None is described as a pristine confirmation set.
2. Current 2026-27 immutable locked rows are the forward confirmation ledger.
   They remain grouped by exact release tuple and lock timestamp.
3. Historical market open/close consensus is proxy evidence only. It cannot
   validate production same-book trails, splits, resistance, or buyback.
4. Market metrics require a complete exact timestamp-valid quote pair. Missing
   evidence is excluded and reported, never treated as neutral.

No audit may rewrite or reinterpret an existing locked row. Failed candidates
remain reproducible offline artifacts only and are not persisted as shadow
predictions.

## Baseline reports

Report the independent lane and unified final lane separately:

- team-score, margin, and Total MAE/RMSE/bias;
- winner accuracy, Brier score, log loss, and reliability;
- Spread and Total direction at the exact locked line, pushes excluded;
- exact-price wins, losses, pushes, units, ROI, coverage, and CLV when stored;
- correction-versus-harm ledgers for every reader-applied side or score change;
- actionable counts, grade mix, promotions, and demotions by market and release.

Compression diagnostics are the regression slope of actual margin on predicted
margin, predicted-versus-realized dispersion, tail calibration, and interval
coverage. There is no quota for blowouts, underdogs, favorites, Overs, Unders,
or market-reader flips.

## Predeclared diagnostic families

Every historical experiment is fitted and evaluated chronologically. Correlated
feature families receive add-one and drop-one refits; zeroing one feature in a
fixed fitted model is sensitivity evidence only.

Independent-model families, in order:

1. current/prior season-regime shrinkage and early-season dynamic priors;
2. opponent-adjusted ratings and short/current/prior windows;
3. Four Factors and matchup interactions;
4. rest, back-to-back, compressed schedule, travel, time-zone, and altitude;
5. rotation continuity and pregame expected-minutes/player-impact availability,
   including absence-duration state;
6. joint margin/Total distribution, conditional variance, asymmetry, and tails.

Unified-reader families, evaluated separately:

1. incumbent qualified Spread and Total number movement;
2. direct Moneyline price movement;
3. price-only versus number movement;
4. flow/split confirmation and opposition;
5. resistance, reversal, and buyback;
6. continuous evidence response versus the incumbent activation thresholds.

New reader authority requires authentic locked same-book, target-excluded,
decision-time evidence. Historical consensus proxies can reject a hypothesis,
but cannot promote one.

## Frozen cohorts

- incumbent-predicted margin: 0-2, 2-5, 5-10, 10+;
- evaluation-only closing spread: pick'em/0-2, 2-5, 5-10, 10+;
- realized absolute margin: under 10, 10-19, and 20+ (tail calibration only);
- season regime: fewer than 100, 100-299, and 300+ league team-games;
- home/away, favorite/underdog, and price bands;
- back-to-back, rest advantage/disadvantage, travel/time-zone, and altitude;
- pregame rotation continuity, minutes-impact availability, and absence duration;
- reader state: inactive, confirming, opposing, qualified crossing, resistance,
  reversal, and buyback.

Cohort membership is fixed from incumbent, market, pregame, or outcome fields as
declared above; it may not be defined from a candidate's favorable output.

## Acceptance gates

An independent-score challenger must satisfy all of the following on forward
confirmation before production consideration:

- paired game-block bootstrap team-score MAE improvement of at least 0.10 with
  the upper 95% interval below zero;
- margin and Total MAE point estimates no worse, with each upper 95% delta
  interval below +0.10;
- winner Brier score and log loss no worse;
- winner accuracy no worse by more than 0.5 percentage points;
- compression slope closer to 1 without worsening tail Brier/log loss or
  80/90/95% interval coverage by more than two percentage points;
- no fixed cohort with at least 150 games may regress more than 0.5 MAE points
  or two direction percentage points without a separately predeclared tradeoff.

A unified-final challenger must additionally preserve or improve every point
estimate for team-score, margin and Total MAE, winner Brier/log loss, ATS, and
Total direction. Reader corrections must exceed harms. ATS and Total one-sided
95% bounds may not permit more than a one-percentage-point regression.

A new reader branch needs at least 100 applied selection decisions and 100
forward confirmation decisions, at least 40 in each chronological half, at
least 55% direction in each selection half, and positive confirmation net
corrections before it can move a score or side.

Grade evaluation occurs last. Existing exact-price gates remain binding: at
least 200 selection and 150 confirmation decisions; at least 60 and 45 per
chronological half; Spread/Total above 52.38% with positive units in both;
Best Angle at least 75 selection and 50 confirmation decisions, at least 55%,
at least one point above Lean, and no half below 50%. Exact-price units, ROI,
coverage, CLV, market mix, and every promotion/demotion must be reported.

## Production boundary

This audit authorizes diagnosis and reproducible offline artifacts only. A
passing candidate still requires new release identifiers, one authoritative
runtime/writer, the shared `prediction_pipeline:nba` lease, same-input board
impact, tested promotion and demotion paths, locked-record precedence tests,
focused tests, `npm run verify:model-change`, latest-main integration safety,
a protected pull request, and post-deploy live verification.
