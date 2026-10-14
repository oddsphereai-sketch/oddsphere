# UCL Elo consensus, late market reader and Match Result grade r8u/r10

Date: 2026-10-14

## Scope and incumbent

- Sport/competition: UEFA Champions League only.
- Forecast markets affected: Match Result and the coherent projected goal split.
- Grade market affected: Match Result only.
- Preserved: independent expected total, Over 2.5 probability/direction, BTTS
  probability/direction, Double Chance policy, Total/BTTS/Double Chance grade
  policies, exact prices, provider hierarchy, member copy/layout, writer, cron,
  shared `prediction_pipeline:soccer` lease, locks and tracking semantics.
- Incumbent model/calibration:
  `ucl_goals_coherent_2026_10_06_r7_target_excluded_opening_market_score` /
  `ucl_grade_policy_2026_10_14_r9_bounded_partial_market_recovery`.
- Candidate model/calibration:
  `ucl_goals_coherent_2026_10_14_r8u_elo_late_consensus` /
  `ucl_grade_policy_2026_10_14_r10_agreement_probability_band`.

## Independent foundation

The r7 UCL-only regulation-time Dixon-Coles PMF remains the starting opinion.
For Match Result, r8u adds a chronology-safe 25% logarithmic pool with a club
strength vector. That vector is an equal local/public Elo consensus: local Elo
is built from completed domestic-league and UCL regulation results, while the
public half uses the MIT-licensed Club Football Match Data historical Elo
series. The coherent solver preserves the starting Over 2.5 probability, BTTS
probability and expected total while solving the changed home/draw/away result
distribution and one final projected goal split.

The strength source is one slate-level foundation, not a per-card or member
request. A versioned database snapshot is refreshed no more than weekly from
four completed/current domestic seasons across 11 leagues, with four-file
bounded concurrency, three bounded retries and 20-second request deadlines.
The seeded production foundation contains 1,001 clubs, 11,113 domestic matches
and 401 UCL matches. A failed refresh uses the last validated stored foundation;
without any validated foundation the writer fails closed and preserves the
last published member snapshot.

## Sport-specific market reader

The final reader uses complete current 1X2 vectors from at least two named
books, rejects Polymarket/Kalshi and incoherent holds, excludes the evaluated
book, and requires exact provider-event identity and pre-decision timestamps.
It forms a median target-excluded three-way consensus. Maximum market authority
is 45%, continuously reduced by cross-book leader disagreement and probability
dispersion:

`authority = 0.45 × leader agreement × clamp(1 - dispersion / 0.10)`.

The result vector is logarithmically pooled with the independent r8u result and
reconciled back to one score PMF. The exact evaluated quote remains downstream
economics/grade evidence and never validates itself. There is no favorite quota,
forced Draw, hard flip threshold or market-center anchoring.

## Chronological result

The independent r8u candidate passed the frozen 126-match selection and
63-match confirmation blocks:

| Block | r7 Match Result | r8u Match Result | Corrections / harms | r7 team MAE | r8u team MAE | r7 margin MAE | r8u margin MAE |
|---|---:|---:|---:|---:|---:|---:|---:|
| Selection | 55.56% | 57.94% | 4 / 1 | 1.1107 | 1.1061 | 1.6682 | 1.6492 |
| Confirmation | 52.38% | 55.56% | 2 / 0 | 1.1862 | 1.1851 | 1.7500 | 1.7288 |

Brier score and log loss improve in both blocks. Total and BTTS accuracy are
unchanged. Total-score MAE is unchanged by construction and every probability,
mass and mean residual is below `1e-7`.

The accepted target-excluded late reader then improves the 126-match selection
from 73/126 (57.94%) to 80/126 (63.49%), with eight corrections and one harm.
On confirmation it improves 35/63 (55.56%) to 36/63 (57.14%), with two
corrections and one harm. Brier, log loss, team-score MAE and margin MAE improve
in both blocks. Total direction, BTTS direction and expected total remain exact.

## Match Result grade

R10 creates a Lean only when the final forecast probability is at least 60%
and below 70%, target-excluded late consensus agrees, the evaluated book agrees,
and the exact price is above -600. It creates no Match Result Best Angle because
no tested value lane generalized. Total, BTTS and Double Chance grade functions
are unchanged.

The frozen selection block produces 20 actions at 16-4 (80%). Confirmation
produces nine actions at 6-3 (66.67%). Qualifiers appear in at least six of eight
league matchdays; knockouts are 5-3. The combined surface is 18.71% of eligible
rows and contains both promotions and demotions versus the transferred policy.
Leans are evaluated as likely-winner/parlay-confidence calls; the confirmation
exact-price return is -0.3429 units, so no value or ROI claim is made.

## Current-board rehearsal

The final exact zero-write October 14 rehearsal returns all nine fixtures, 36/36
markets and zero holds. The complete board moves from 17 to nine actionables.
Among the 28 still-unlocked market rows there are zero promotions, five
demotions and two linked side changes (PSG to Manchester City Match Result and
its Double Chance coverage). Three demotions are Match Result confidence
corrections under r10; one Total and one BTTS demotion arise from refreshed
exact prices under their unchanged policies. Nine actionables across 36 markets
is not a flat board, but it is materially less overconfident than the incumbent.

The two already locked games remain under their exact stored r7/r9 payloads.
They are never recomputed, relabeled or admitted to current-release tracking.
Unlocked rows and future locks alone may advance to r8u/r10.

## Publication and rollback gates

Publication requires the focused UCL production and DB immutability tests,
`npm run verify:model-change`, lint/type checks, a clean latest-main candidate,
integration-safety verification, protected pull-request checks and exact
post-deploy proof of the release tuple, sole writer/lease, 9/9 fixture and 36/36
market coverage, zero holds, member/score coherence and unchanged legacy locks.

Roll back future unlocked publication to r7/r9 on a mixed unlocked release,
missing or invalid Elo foundation, target-book leakage, fewer than two eligible
late books being treated as market evidence, score/prediction contradiction,
unexpected board collapse, writer overlap, timeout/load regression, reader
failure or any locked-field mutation.
