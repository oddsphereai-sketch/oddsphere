# Current MLB and WNBA model releases

This file is the human-readable production handoff registry. Runtime constants and stamped
prediction snapshots remain the machine authority. Future model work must start here, verify the
constants, and preserve the precedence and writer ownership below.

Last reviewed: 2026-08-11

## MLB champion

- Projection runtime: resolved automodel `v2_2`
- First-inning runtime: `fi_v2`
- Public calibration: `mlb_public_calibration_v19_guarded_signed_market_evidence_2026_08_10`
- Decision release: `mlb_daily_edge_decision_2026_08_11_r29`
- Rule bundle: `mlb_daily_edge_rule_bundle_v28_2026_08_11`
- Grade policy: `mlb_public_grade_policy_v20_guarded_signed_side_market_evidence_2026_08_10`
- Machine registry: `lib/automodel/mlbModelLayerVersions.ts`
- Authoritative member-facing writer: `lib/services/predictionRecordService.ts`

Moneyline precedence is immutable unless a later versioned release explicitly replaces it:

1. Existing inversion logic.
2. Existing pick calibration.
3. Existing market-aware side correction.
4. Freeze the final side and its price/probability tuple.
5. Apply signed money-minus-ticket evidence only to the grade on that frozen side.

The signed rule never flips a side. A picked-side gap of at most -10 points stands down an
otherwise unchanged action. A gap of at least +10 may promote a Watchlist to Lean only with at
least 54% picked-side model probability, a real selected-side price, no opposing movement or
public conflict, complete data, and no prior side change. It never creates a Best Angle.

Historical paired replay: 282 actions at -1.5% ROI became 285 at +9.3%; the holdout moved from
47 at +11.9% to 53 at +18.9%. The guarded promotion cohort was 67 plays at +29.4%; the demotion
cohort was 64 plays at -17.1%. Board delta: +3.

The August 11 r29 totals correction policy keeps every historically unstable opposite-side
correction candidate rejected and hidden. A rejected candidate no longer automatically stands
down the original model side. The original side is restored and must independently pass the
existing price, positive-EV, projection-alignment, probability, data-quality, and validated-grade
gates. The forward correction audit found that the prior blanket stand-down removed nine original
sides that went 7-2 (+4.04 units, +44.9% ROI), while the rejected candidates went 2-7 (-5.09
units, -56.6% ROI). The paired current-slate replay and rollback evidence are recorded in
`docs/model-audits/2026-08-11-mlb-totals-rejected-correction-original-side-r29.md`.

The August 11 r28 first-inning availability release keeps MLB Stats as the authoritative starter
source and fills only an empty side through the existing ESPN probable-pitcher fallback. The
shared service retries ESPN's equivalent official site API host when its primary host is empty or
unavailable from production. A game with named probable starters, a complete two-sided FI market,
and publishable offense context now degrades to a non-actionable Toss-Up when verified starter
history is sparse; an actually unknown starter or missing FI market remains an explicit hold.
The r28 tracking-coherence follow-up preserves that Toss-Up in `prediction_records` even though
its retained audit correctly says the directional fresh-data gate did not pass. It never assigns
a side, price, edge, units, or actionable grade to that row. Data-health actionable counts now
use the actual member grades (Lean/Best Angle) instead of counting Watchlists as actionables.
The tracking follow-up is recorded in
`docs/model-audits/2026-08-11-daily-edge-fi-tracking-coherence-r28.md`.
The paired live-slate replay is recorded in
`docs/model-audits/2026-08-11-daily-edge-fi-probable-availability-r27.md`.

## WNBA champion

- Model: `wnba_v1_1_team_identity`
- Distribution: `wnba_market_heads_value_calibrated_2026_08_02_v3`
- Calibration schema: `wnba_core_calibration_v1`
- Grade policy: `wnba_grade_policy_v4_market_resistance_and_elo_stat_agreement_2026_08_10`
- Prediction-record contract: `wnba_prediction_record_contract_v2_published_probability_2026_08_10`
- Machine registry: `lib/automodel/wnbaChampionRuntime.ts`
- Authoritative model writer: `lib/services/wnba/runWnbaModel.ts`
- Tracking writer: `lib/services/wnba/buildWnbaPredictionRecords.ts`
- Member reader: `lib/services/wnba/buildWnbaDailyEdgeAdapted.ts`
- Scheduled owner: `/api/cron/wnba-daily-refresh` under the WNBA-scoped shared
  `prediction_pipeline` lease

WNBA moneyline selection and its established public-support grade behavior are preserved.
Public support cannot promote total or spread Watchlists. Public resistance remains active in all
markets. A spread Watchlist can promote to Lean only for the home side when Elo and statistical
home margins differ by less than three points, at least ten books quote the spread, an exact
picked-side price exists, and public conflict is absent. The rule never changes a side, projection,
probability, or stake.

Exact current-release attribution removed five total/spread public promotions that went 0-5 and
added six spread agreement promotions that went 5-1 (+3.421 units), for a +1 board delta. The
broader historical promotion cohort reproduced at 14-3: 2-1 train, 6-1 validation, and 6-1
holdout.

## MLB Player Props candidate

- Release: `mlb_props_2026_08_11_r28`
- Machine registry: `lib/mlb/props/marketModelVersions.ts`
- Authoritative writer: `/api/cron/mlb-player-props-refresh` through
  `refreshMlbPropsBoard`
- Status: private launch candidate; not publicly enabled

The r28 probable-pitcher contract uses MLB Stats as the authoritative starter source and fills
only an empty game side from ESPN's published probable, provided the name resolves to exactly
one active pitcher on the corresponding MLB roster and exactly one Ball Don't Lie player on the
same team. MLB Stats automatically supersedes the fallback on the next authoritative refresh.
Team-pair ESPN identity is never used to guess between doubleheader games, ambiguous mappings
remain held, and an operator kill switch can revert immediately to official-only behavior. If
ESPN's primary official site API host returns an empty slate from the production serverless
network, r28 retries ESPN's equivalent official site API host before declaring the source empty.

The paired August 11 shadow rebuild held all 5,874 offer rows and the same live prices constant.
Fallbacks for Jake Irvin and Carson Whisenhunt restored opposing-starter and pitch-mix research
to 370 rows. Required-research holds fell from 402 to 32, all of which had verified but
insufficient pitch-mix samples. The actionable board moved from 107 to 116 through 11 promotions
and 2 demotions (net +9); 105 actionables were retained. No stale odds, missing prices, mapping
errors, or publication errors were present. Full details are in
`docs/model-audits/2026-08-11-player-props-probable-fallback-r27.md`.

The r26 publication and launch-readiness contract preserves every research-quality gate at row
level. A row missing required opposing-starter or pitch-mix evidence must be
explicitly stamped `PENDING_DATA` or `RESEARCH`, remains ineligible for units,
and is disclosed in snapshot warnings. Those already-held rows no longer
freeze complete priced rows from unrelated games or falsely close the admin
launch gate. Any incomplete row carrying an ordinary Watchlist, Lean, or Best
Angle grade still blocks both publication and launch readiness.

The underlying r23 adapter remains intact: a current Ball Don’t Lie endpoint
response stamps the quote with the current fetch observation while retaining
`updated_at` in raw evidence for movement auditing. This prevents an unchanged
but still-listed offer from being falsely expired after 45 minutes.

The paired August 10 audit compared the latest valid r21 private snapshot with
an r23 read-only rebuild: 3,789 exact rows matched, 204 rows were added, 45
were removed, and the board grew from 3,834 to 3,993 rows. The actionable
board moved from 83 to 79 through 10 promotions and 14 demotions, with 69
actionables retained. The candidate was publishable with all 16 supported
markets, zero stale displayed odds, complete required research, and no public
flags enabled. Full details are recorded in
`docs/model-audits/2026-08-10-player-props-current-observation-r23.md`.

The August 11 paired production dry-run contained 5,821 offer rows and 103
actionables with complete research and fresh prices. Exactly 403 unrelated
rows were already fail-closed (`310 PENDING_DATA`, `93 RESEARCH`): 370 lacked
an announced opposing starter and 33 additional rows had a verified but
insufficient pitch-mix sample. Operational warnings distinguish source-not-yet-
published data, insufficient verified samples, and true unavailable data. The
r26 contract changes only snapshot and launch-gate availability: it promotes zero incomplete
rows, demotes zero complete rows, and leaves the actionable count at 103. See
`docs/model-audits/2026-08-11-player-props-held-research-readiness-r26.md`.
New WNBA records store the final published picked-side moneyline probability while retaining the
independent and final layers separately. Tracking refuses a source payload whose model,
distribution, or grade-policy identifier differs from the champion. The reader hides stale
unlocked payloads but preserves locked historical recommendations.

## Explicitly not active

The following research findings are not production rules and must not be inferred from older
audit documents:

- MLB total probability shrink `k=.2`.
- MLB selected-side probability compression.
- Any new MLB first-inning probability or flip rule.
- Any WNBA money/ticket, steam, reverse-line-movement, or opposite-side flip rule.
- Any WNBA total probability recalibration or blanket projection blend.
- Any WNBA spread probability/anchor-weight change.

They require a new immutable release, exact paired replay through the entire downstream grade
pipeline, and the full `docs/model-change-safety.md` protocol.

## Release verification

Before calling a later change live:

1. Confirm these identifiers in the machine registries and member-facing snapshots.
2. Run `npm run verify:model-change` plus the MLB prediction-record, signed-evidence,
   market-signal, grade, and WNBA core suites.
3. Confirm all prediction writers use the sport-scoped `prediction_pipeline` lease.
4. Verify unlocked source releases are coherent and locked rows remain immutable.
5. Compare current board counts and market mix against the approved paired replay.
6. Verify the deployed commit, cron health, response freshness, and member reader after both a
   scheduled refresh and the next lock sweep.
