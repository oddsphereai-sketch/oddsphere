# MLB Daily Edge r20 — FI grade ladder and daily stats health

Date: 2026-07-29

## Scope

- Sport: MLB.
- Market behavior changed: First Inning public grade only.
- Model inputs refreshed: current-season batting and pitching aggregates used
  by MLB Daily Edge feature construction.
- Unchanged: First Inning pick/probability head, moneyline and total
  probability/grade rules, prices, stakes, player props, lock behavior.
- Authoritative writer: the existing MLB automation orchestrator under the
  sport-scoped `prediction_pipeline` lease. No cron, timer, or independent
  writer was added.

Previous release:

- decision: `mlb_daily_edge_decision_2026_07_28_r18`
- rule bundle: `mlb_daily_edge_rule_bundle_v18_2026_07_28`
- public calibration: `mlb_public_calibration_v15_2026_07_28`

Intermediate release:

- decision: `mlb_daily_edge_decision_2026_07_29_r19`
- rule bundle: `mlb_daily_edge_rule_bundle_v19_2026_07_29`
- public calibration: `mlb_public_calibration_v16_2026_07_29`
- grade policy: `mlb_public_grade_policy_v16_fi_paired_ladder_2026_07_29`

Final release:

- decision: `mlb_daily_edge_decision_2026_07_29_r20`
- rule bundle: `mlb_daily_edge_rule_bundle_v20_2026_07_29`
- public calibration: `mlb_public_calibration_v17_2026_07_29`
- grade policy:
  `mlb_public_grade_policy_v17_fi_paired_ladder_daily_stats_marker_2026_07_29`

## Locked First Inning replay

Population: 125 settled, locked rows from 2026-07-11 through 2026-07-28
under the unchanged active probability head
`mlb_first_inning_fi_v2_signed_edge_price_gate_2026_07_11`.

Chronological windows:

- train: 2026-07-11 through 2026-07-17
- validation: 2026-07-18 through 2026-07-22
- untouched: 2026-07-23 through 2026-07-28

Paired rules:

1. Demotion: NRFI posterior in `[0.57, 0.63)` is Lean-only. The base Best
   Angle cohort was 6-6, -0.843 units, -7.0% ROI; validation was -5.2% ROI and
   untouched was -27.5% ROI. This is a grade demotion, not removal from the
   actionable board.
2. Promotion: a clean, non-provisional positive-edge FI base Lean at
   plus-money price is a Best Angle. The cohort was 6-3, +3.450 units,
   +38.3% ROI across 6 dates: train 1-1 (+4.0% ROI), validation 2-0,
   untouched 3-2 (+23.0% ROI). Every leave-one-date-out replay remained
   positive. Provisional, lineup-restricted, stale, or held rows cannot use
   this promotion.

Combined grade replay:

| Policy | Best Angle | Record | Units | ROI | Untouched |
| --- | ---: | ---: | ---: | ---: | ---: |
| r18 | 36 | 20-16 | +3.167 | +8.8% | 6-8, -16.2% |
| r20 | 23 | 13-10 | +3.125 | +13.6% | 4-5, -10.0% |

The untouched Best Angle result remains a small losing sample, so r20 is not
represented as a guarantee or a solved probability model. It does improve the
same locked holdout from 6-8 / -16.2% to 4-5 / -10.0%, while each new rule's
own held-out cohort moves in the intended direction. The unchanged FI
probability head remains 72-51, +8.57% ROI across all settled priced rows.

Actionable board count is invariant: r18 and r20 each produce 105 actionable
historical rows. No daily cap or target count is used. On the 2026-07-29
current slate, NYY@CWS NRFI moves from Best Angle to Lean. BOS@ATH NRFI +107
does not promote because its FI snapshot is provisional. The slate moves from
3 FI Best Angles / 8 FI Leans to 2 / 9 while retaining all 11 actionable FI
picks.

## Stats refresh repair and load bound

- Batting freshness now requires every already-usable active batter row on
  slate teams to have been refreshed on the slate's Eastern calendar day,
  while retaining the minimum qualified-team coverage guard.
- Scheduled pitching refresh now covers active starters and relievers on
  slate teams using one league-wide MLB Stats request and bounded
  partial-column upsert batches. It replaces the scheduled per-starter
  fan-out.
- Batting remains one league-wide request with the same bounded upsert path.
- Database batches contain at most 250 rows, but every eligible row is
  processed; this is a transport/load bound, not a model or board cap.
- Both steps run once per slate day, before feature/model construction, under
  the existing orchestrator write gate and `prediction_pipeline` lease.
- Each successful league-wide refresh writes a date-scoped lifecycle marker
  to the existing `data_refresh_log`. Later cycles on the same slate date use
  that exact success marker and make zero season-stat provider calls. This
  avoids treating legacy/unmapped roster rows as proof that the current bulk
  request failed, without relabeling old stat values as freshly fetched.
- No prediction, tracking, odds, or First Inning split columns are written by
  these aggregate-stat refreshes.

Provider probes on 2026-07-29 returned 672 hitter rows and 761 pitcher rows.
The no-write live-data check correctly reported both current batting and
pitching coverage as requiring the daily refresh. The leakage-safe batting
replay (2026-07-16 through 2026-07-28) covered 166 games with no skipped game:
fresh batting increased total all-market units from +1.416 to +3.971, created
31 promotions and 23 demotions, and increased actionable count from 121 to
129. Its untouched all-market result was slightly lower (-0.8% versus +0.5%
ROI), so this is treated as a data-correctness/freshness repair, not a claim
that fresh batting alone is a new profitable model.

## Rollback

Rollback to r18 if production shows a mixed current-slate release, a
prediction-writer overlap, a failed/partial stats step that publishes a new
snapshot, materially increased cycle duration, or a reader mismatch. Locked
rows are never rewritten by this release.
