# MLB + WNBA correctness and grade-improvement package

Date: 2026-08-10
Status: locally implemented and verified; not deployed
Parent audit: `2026-08-09-mlb-wnba-lifetime-methodology-audit.md`

## Outcome

This pass produced two correctness improvements and one paired grade policy
selected through offline historical replay. It does not require a future
waiting period.

1. MLB market evidence is now resolved by market side instead of whichever
   `sharp_signals` row happened to be returned last by the database.
2. Signed money-minus-ticket divergence now identifies whether the picked side
   is supported or opposed. The same physical market state produces the same
   verdict whether read from the picked-side or complementary-side row.
3. WNBA moneyline tracking now stores the probability actually used by the
   published decision. The independent and final probability layers are also
   retained separately for future ablation.
4. A guarded MLB ±10-point money/ticket promotion-demotion rule is implemented:
   promotions additionally require at least 54% picked-side model probability.

## Data actually analyzed

- 2,483 matched settled MLB/WNBA prediction records, including launch rows;
- approximately 2,100 settled MLB market predictions and 333 WNBA predictions;
- 916 distinct games in the matched lifetime audit;
- 153,507 matched line-history rows;
- 141,120 sharp-signal-history rows;
- 7,512 provider split observations;
- 767 settled, non-launch, price-complete MLB moneyline predictions with a
  reconstructed pre-lock split, covering 765 games from June 9 through August 8.

### Full MLB coverage funnel

The 282-play figure is not total history. It is the previously actionable
baseline inside the split-matched moneyline replay:

- 2,150 settled MLB market records across 805 distinct games;
- 2,042 price-complete MLB records;
- 907 historically actionable records;
- 807 moneylines, 807 totals, and 536 first-inning records;
- 807 MLB moneylines → 793 non-launch → 792 price-complete → 767 with a
  reconstructed pre-lock split → 282 previously actionable.

This coverage is consistent with official tracking beginning June 6 rather than
the beginning of the MLB season. The site may have existed longer, but earlier
mock/fixture or non-immutable rows are not silently treated as production truth.

The audit also corrected an edge-unit defect in its own analysis code. A raw
edge of 0.6 percentage points had been interpreted as 60 points solely because
its magnitude was below one. Edge is now reconstructed as `(locked model
probability - locked market probability) * 100`, with the raw percentage-point
field used only as a fallback. Split-policy results are unaffected because they
do not use stored edge.

The 767-row cohort is the eligible comparison population for the paired MLB
moneyline replay. It is not presented as whole-site CLV coverage. Direct
settled-game line history is concentrated after August 5, which prevents an
honest lifetime CLV claim.

## Root-cause correction: MLB market evidence

`sharp_signals` can contain one row for each side of a market. The grade and
market-signal batch services previously reduced those rows into a map keyed only
by `(game_id, market_type)`. One side therefore overwrote the other. The
surviving side depended on query row order.

There was a second semantic error: the classifier treated `signal.side` as the
side with more money than tickets. In the stored schema, it is simply the
selection represented by that row. For a picked-side row with 65% tickets and
50% money, the signed gap is -15 points and supports the opposite side; the old
interpretation could call it aligned merely because the row's side matched the
pick.

The corrected runtime:

- indexes MLB rows by `(game_id, market_type, side)`;
- loads picked and complementary rows explicitly;
- attributes picked-side EV only to the picked-side row;
- interprets split alignment using the signed gap;
- merges complementary evidence deterministically;
- resolves simultaneous strong conflict conservatively as resistance;
- leaves other sports on their established runtime path.

This correction can promote and demote. Strong aligned divergence can reach
`sharp_confirmed`; very-strong opposing divergence can reach `sharp_conflict`.
Both transitions are pinned by focused tests.

### Authoritative writer and existing-rule compatibility

The first implementation pass exposed an integration hazard: the generic grade
derivation service is not the final member-facing MLB grade authority. The
public `prediction_records` writer recomputes the final side and grade after the
existing inversion, pick-calibration, and market-aware side-correction rules.
The signed policy therefore lives only in that authoritative final writer; it
was removed from the generic grade layer to prevent two competing grade paths.

The final precedence is:

1. existing inversion logic;
2. existing pick calibration;
3. existing market-aware side correction;
4. freeze the final selected side and its price/probability tuple;
5. apply signed split evidence only as a grade decision on that frozen side.

Both signed rules fail closed whenever steps 1-3 changed the side. The
resistance rule can only stand down the unchanged side. It never recommends the
opposite team, and the promotion rule can only add a Lean—never a Best Angle.
Existing Best Angles, explicit no-bets, provisional rows, incomplete-data rows,
against-pick movement, public-split conflicts, missing prices, and every
existing correction/flip cohort retain priority. Integration fixtures assert
that a signed-resistance row has `final_side_changed=false` and keeps the
original pick while becoming a no-play.

## Paired MLB moneyline replay

Research rule:

- demote a currently actionable play when picked-side money minus tickets is
  at most -10 percentage points;
- promote a currently non-actionable play when the same gap is at least +10
  and picked-side model probability is at least 54%;
- keep stake unchanged;
- evaluate only settled, price-complete, split-matched MLB moneylines.

This is a selection-policy simulation, not an exact historical re-grade. The
historical snapshot does not retain every EV, steam, and RLM input used by the
grade engine at lock.

| Window | Baseline | Proposed | Board delta | ROI delta |
|---|---:|---:|---:|---:|
| Full non-launch | 282 plays, -1.5% | 285 plays, +9.3% | +3 | +10.8 pp |
| Train through Jul 7 | 189, -6.3% | 161, +2.8% | -28 | +9.1 pp |
| Validation Jul 8-27 | 46, +4.8% | 71, +16.8% | +25 | +12.0 pp |
| Holdout from Jul 28 | 47, +11.9% | 53, +18.9% | +6 | +7.0 pp |
| August only | 28, -3.3% | 26, +1.0% | -2 | +4.3 pp |

The guarded promotion cohort is 67 plays at +29.4% ROI. The demotion cohort is
64 plays at -17.1% ROI. The broader unguarded signal diagnostics remain useful:

- all picked-side gaps at least +10: 217 plays, +12.2% ROI, 95% interval
  [-1.9%, +26.1%], 95.6% positive-bootstrap probability;
- all picked-side gaps at most -10: 214 plays, -13.1% ROI, 95% interval
  [-24.7%, -0.9%], 1.7% positive-bootstrap probability;
- non-actionable promotion cohort: 112 rows in the broader bootstrap artifact,
  +22.9% ROI, 95% interval [+3.6%, +41.4%];
- actionable demotion cohort: 64 plays, -17.1% ROI, 95% interval
  [-38.9%, +6.3%].

The unguarded seven-play August promotion cohort lost 13.0% ROI. Requiring 54%
model probability removes those weak promotions: the guarded August promotion
cohort is four plays at +7.8% ROI, and the combined August board improves from
-3.3% to +1.0%. The full board grows by three plays rather than being flattened.

## Prediction-methodology tests

The audit tested whether richer corrections improve predictions rather than
assuming that more features must help.

### MLB total projection

On the post-July-28 holdout:

| Method | MAE | RMSE | Bias |
|---|---:|---:|---:|
| Raw projection | 3.490 | 4.407 | +0.388 |
| Global bias correction | 3.557 | 4.442 | — |
| Team/weather/park/data ridge residual | 3.645 | 4.533 | +0.670 |
| Existing calibrated total | 3.573 | 4.409 | — |

The richer residual model loses out of sample, so no point-projection change is
made. MLB total work should target distribution probability, side selection,
and price-aware grades.

### MLB total probability shrink recalibration

The current total probability era uses `k=.4` in
`market + k * (raw model - market)`. Its raw pre-shrink probability can be
reconstructed exactly from the locked regularized and market probabilities for
333 settled totals. A chronological fixed-grid replay finds `k=.15-.20`
consistently superior to the current `k=.4`:

| Window | Current k=.4 Brier | Candidate k=.2 Brier | Current log loss | Candidate log loss |
|---|---:|---:|---:|---:|
| Current-era full | .24961 | **.24875** | .69250 | **.69091** |
| Pre-holdout | .25150 | **.25041** | .69648 | **.69456** |
| Holdout | .24753 | **.24690** | .68811 | **.68688** |
| August | .25166 | **.25119** | .69650 | **.69552** |

`k=.2` is therefore the next total probability-head candidate. It is not yet
activated in this package because changing the shrink also rescales every total
edge and can alter grades. The required next step is an exact same-history
paired replay of the grade thresholds under `k=.2`; this is an offline task,
not a request to wait for future games.

### Incremental model-versus-price information

Latest holdout Brier scores (lower is better):

| Market | Model | Selected price | Winner |
|---|---:|---:|---|
| MLB ML | .24055 | .24435 | Model |
| MLB total | .24748 | .24672 | Price |
| MLB first inning | .24182 | .24326 | Model |
| WNBA ML | .18559 | .18655 | Model, narrowly |
| WNBA total | .24345 | .24884 | Model |
| WNBA spread | .24282 | .24082 | Price |

Fitted combinations did not consistently beat the best standalone input. This
rejects a blanket market blend. It supports market-specific calibration:
preserve MLB ML/FI and WNBA total model signal, and investigate price anchoring
for MLB totals and WNBA spreads through offline retrospective replay.

### Current-head MLB selected-side recalibration

The current MLB moneyline probability era has 343 settled selected-side rows.
A linear-log-odds calibration fitted only through July 27 (`intercept=.152`,
`slope=.628`) compresses the overly steep upper-confidence tail while retaining
the selected side. It improves the untouched July 28 onward Brier score from
`.24055` to `.23953`, and the August-only Brier score from `.25091` to `.25029`.
This is a genuine probability-accuracy candidate, separate from the signed
split grade policy.

The same method is rejected for first inning: its holdout Brier worsens from
`.24182` to `.25530`. A fitted nonlinear total correction is also unstable;
the fixed `k=.2` total shrink remains the simpler supported candidate.

The moneyline selected-side recalibration is not activated in this package.
Because it changes model probability, edge, EV gates, and the `54%` guarded
market-evidence promotion boundary, it requires an exact paired current-policy
board replay before receiving a new immutable probability-head identifier.

### WNBA projection-methodology replay

Immutable WNBA snapshots retain sufficient raw projection and market-line
context for 110 of 111 settled games. Direct one-game-per-observation replay
finds sharply different behavior by market:

| Market signal | Full history | Pre-validation | Validation | August |
|---|---:|---:|---:|---:|
| Raw total direction accuracy | 47.3% | 44.1% | 57.9% | 47.8% |
| Raw margin/spread direction accuracy | 58.7% | 53.7% | 68.4% | 65.2% |

For totals, market-only has lower full-history point-error than the raw model
(`16.391` versus `16.657` MAE), while the raw model has lower August MAE but
worse RMSE. Any convex market blend preserves the raw model's over/under side,
so changing the existing anchor weight cannot repair the below-50% directional
signal. WNBA totals need a new scoring input or selective stand-down; a blanket
weight change is rejected.

For margins, the current 25% raw-gap anchor improves on market-only, and the
raw stored margin improves further in August (`7.013` MAE versus `7.428` for
the 25% anchor and `7.587` for market-only). The best weight is not stable
across chronological windows, so no new spread weight is selected yet. The
useful conclusion is architectural: preserve and develop the margin head, but
do not infer WNBA total quality from spread performance.

## WNBA correction and remaining grade work

The prior tracking writer stored the independent picked-side ML probability in
`prediction_records.model_probability`, although the published side, confidence,
and grade used the final probability. In the lifetime audit, 94 of 111 WNBA ML
rows differed by more than 0.5 points; mean absolute mismatch was 3.2 points and
maximum mismatch was 22.6.

New records under
`wnba_prediction_record_contract_v2_published_probability_2026_08_10` store:

- the final published picked probability as `model_probability`;
- published, independent, and final picked probabilities in `snapshot_json`;
- the record-contract identifier;
- available public market context for later locked split replay.

Locked historical records are not rewritten. This preserves immutable history
and creates an explicit contract boundary.

This is a measurement correction, not a pick correction. Historical WNBA
teams, sides, grades, and win/loss results remain unchanged. For example, when
the independent layer estimated 65% but the approved market-calibrated decision
published 59%, tracking previously evaluated the pick as a 65% forecast. New
rows evaluate it as the 59% forecast members actually saw, while retaining both
numbers for research.

The local audit branch was behind `origin/main` and initially carried the old
`wnba_v1` / July distribution constants. That would have created an overwrite
or relabeling risk if committed. The candidate is now reconciled to the current
production champion contract:

- model: `wnba_v1_1_team_identity`;
- distribution: `wnba_market_heads_value_calibrated_2026_08_02_v3`;
- one hourly writer: `wnba-daily-refresh` under the WNBA-scoped shared
  `prediction_pipeline` lease;
- locked model and tracking rows remain immutable;
- unlocked tracking mirrors cannot override the newer coherent model payload;
- moneyline team identity is resolved canonically and unknown labels are
  withheld instead of silently treated as the away side.

WNBA total and spread confidence still must not be treated as a fully calibrated
cover probability at the offered line. Promoting/demoting directly from that
number as if it were validated EV would create false precision. The implemented
grade candidate therefore uses only an independently replayed agreement signal,
requires a real picked-side price, and does not relabel confidence as EV. The
next probability-model candidate must:

1. capture selected and opposite offered prices at lock;
2. compute no-vig market probability and offered-price break-even probability;
3. retain raw distribution cover probability separately from display confidence;
4. require positive offered-price EV for promotion;
5. demote negative-EV plays at a matched evidence threshold;
6. report paired board-count impact by immutable release and lock date;
7. reconstruct or backfill a price-complete historical cohort, replay it by
   immutable release and date, and implement the winner without waiting for a
   multi-week forward-shadow period.

### WNBA market-read follow-up

A second offline pass tested the market context retained across all 111 settled
WNBA games: published-model versus sharp probability, selected price,
projection-versus-line gap, market weight, book count, dispersion, side,
rest, and Elo-versus-statistical-margin disagreement. Durable movement and
split coverage is much thinner than MLB: only 13 games have reconstructable
line history and four have a usable pre-lock public split. No WNBA
money-versus-tickets or line-movement rule is claimed from that tiny subset.

The runtime audit nevertheless found a concrete grade-policy defect. WNBA
public splits could make total/spread Watchlists actionable even though their
documented contract does not establish +EV. Exact database attribution was then
run against the authoritative locked `game_predictions.sport_specific` payload,
not inferred from incomplete tracking snapshots. It covered all 75 market rows
from the 25 settled v1.1 games. There were 12 exact Watchlist-to-action public
split promotions: moneyline 7 (5-2, -0.263 units, -3.8% ROI), total 4 (0-4,
-4.000 units), and spread 1 (0-1, -1.000 unit). Because the moneyline cohort
selected winners and has no count-balanced replacement, its established boost
is preserved. Only the five losing total/spread promotions are removed.

The paired replacement policy is:

- public splits remain usable as resistance/demotion evidence in every market;
- the established WNBA moneyline public-support boost is preserved;
- public splits cannot create total or spread action from a Watchlist;
- promote a WNBA home spread Watchlist to Lean only when the Elo and statistical
  home-margin estimates differ by less than three points, at least ten books
  quote the spread, a picked-side price exists, and no public-market resistance
  is present;
- never change the selected side or projection.

The spread promotion cohort was 14-3 for +56.6% ROI: 2-1 in train, 6-1 in
validation, 6-1 in holdout, and 5-1 in the current WNBA v1.1 release. The
threshold is not a single-point optimum: nearby agreement thresholds remain
positive, while the ten-book guard improves reliability. Bootstrap resampling
of the broader under-three-point home cohort was positive in 99.4% of 20,000
draws.

On the settled v1.1 board, the paired change removes exactly five total/spread
actions (0-5, -5.000 units) and adds exactly six spread actions (5-1, +3.421
units, +57.0% ROI). The transparent board delta is therefore **+1**, not a hidden
flattening. This is an offline replay, not a promise of future return, but it
improves grade sorting while preserving every WNBA side, projection, and the
successful 5-2 moneyline selection behavior.

## Releases and runtime ownership

- MLB calibration: `mlb_public_calibration_v20_guarded_signed_market_evidence_2026_08_10`
- MLB decision release: `mlb_daily_edge_decision_2026_08_10_r27`
- MLB rule bundle: `mlb_daily_edge_rule_bundle_v26_2026_08_10`
- MLB grade policy: `mlb_public_grade_policy_v21_guarded_signed_side_market_evidence_2026_08_10`
- WNBA record contract: `wnba_prediction_record_contract_v2_published_probability_2026_08_10`
- WNBA champion model preserved: `wnba_v1_1_team_identity`
- WNBA distribution preserved: `wnba_market_heads_value_calibrated_2026_08_02_v3`
- WNBA grade policy: `wnba_grade_policy_v4_market_resistance_and_elo_stat_agreement_2026_08_10`

No new writer, cron, or refresh path was added. Existing scheduled writers keep
the shared sport-scoped `prediction_pipeline` lease. The tracking catch-up
writer also fails closed when the source `game_predictions` model,
distribution, or grade-policy identifier differs from the exact champion
release; it cannot relabel an older unlocked payload as the new release.

## Verification

- TypeScript: `npx tsc --noEmit` — passed.
- Focused production lint has no errors; pre-existing warnings remain in the
  dirty shared worktree and test fixtures retain existing `any` usage.
- Authoritative MLB prediction-record integration — 301/301 passed.
- MLB signed evidence fixtures — 10/10 passed.
- Market-signal derivation — 44/44 passed.
- Grade derivation — 102/102 passed.
- WNBA core/calibration/record-contract/team-identity/market-read tests — 66/66 passed.
- WNBA price-trail consensus — 3/3 passed.
- Current release-manifest assertion — passed with the production WNBA v1.1
  and August distribution identifiers.
- Mandatory `npm run verify:model-change` — passed, including 57 pipeline
  safety checks and all chained model/props tests.

## Deployment decision

This work is not deployed by the audit itself.

- Deployment candidate: MLB deterministic side-aware evidence correction,
  guarded paired ±10/54% MLB moneyline grade rule, and WNBA
  probability-record contract correction plus the paired public-split
  resistance/home-spread agreement grade policy, reconciled onto WNBA v1.1.
- Offline historical research only: any MLB probability-confidence adjustment
  from splits, WNBA total/spread EV grade gates, and any new projection blend.

Before declaring the candidate live, deploy from a clean intentional commit and
verify the live identifiers, cron health, sport-scoped lease behavior, model
coherence, current data coverage, and the locked reader snapshot.
