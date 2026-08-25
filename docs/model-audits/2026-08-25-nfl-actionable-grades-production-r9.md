# NFL Week 1 actionable grades r9 production activation

Date: 2026-08-25

## Decision

Promote the qualified r9 NFL Daily Edge candidate as the first regular-season Week 1 production
release. This is a real member release, not a shadow endpoint. It preserves the independent r10
joint score/outcome distribution, publishes coherent Moneyline/Spread/Total exact-price grades,
and closes the forward-only T-60 tracking and exact-id settlement lifecycle. No stake sizing is
enabled.

The release is based on current `origin/main` after MLB coherence PR #202. Shared reader/type
behavior from that merge is preserved. NFL continues to use the one scheduled
`/api/cron/nfl-forward-evidence` writer under the `prediction_pipeline:nfl` lease; member reads
make no provider calls and no second NFL prediction writer or timer is introduced.

## Released identifiers

- Model: `nfl_v1_daily_edge_model_2026_08_25_r3_actionable_grades`
- Calibration: `nfl_v1_daily_edge_calibration_2026_08_25_r3_actionable_grades`
- Decision: `nfl_v1_daily_edge_decision_2026_08_25_r9_actionable_grades`
- Grade policy: `nfl_v1_grade_policy_2026_08_25_r9_actionable_grades`
- Member: `nfl_v1_member_release_2026_08_25_r6_actionable_grades`
- Forward writer: `nfl_forward_evidence_writer_2026_08_25_r7_actionable_grades`
- Member fixture: `nfl_week_one_member_fixture_2026_08_25_r7_actionable_grades`
- Tracking lifecycle/record: `nfl_tracking_lifecycle_2026_08_25_r3_regular_t60` /
  `nfl_official_tracking_record_2026_08_25_r1_regular_t60`
- Score ingest: `nfl_score_ingest_2026_08_25_r1_regular_exact_id`

## Model and grade evidence

The independent r10 football head excludes sportsbook prices, lines, fair probabilities, splits,
and movement. Its one joint PMF supplies expected team scores, representative final, winner,
margin/total distributions, and all market probabilities. In repeated confirmation it beat the
simple football baseline on winner Brier and log loss in both 2024 and 2025. Current Week 1 team
scores span 17.57-27.75 (SD 2.44), margins -4.10 to +10.18 (SD 3.75), and totals 38.66-48.98
(SD 2.77), correcting the retired preseason model's clustered-score/all-Over behavior.

All grading lanes were frozen before confirmation and use the exact evaluated named book, line,
and price beside target-excluded multi-book fair probability. Historical evidence and limitations
are preserved in `2026-08-25-nfl-actionable-grades-r9.md`. In brief:

- Moneyline Best Angle confirmation: 103 actions, +6.282u, +6.10% ROI, positive after the largest
  win, mean CLV +0.236pp.
- Spread Lean confirmation: 40 actions, +8.772u, +21.93% ROI, positive after the largest win;
  forward monitoring is required because 37/40 actions selected home.
- Total Lean confirmation: 95 actions, +1.578u, +1.66% ROI; capped at Lean because uncertainty is
  wide and 2024 was not largest-win-independent.

2024/25 are repeated confirmation, not pristine holdouts. Immutable 2026 opening, unlocked, T-60,
and settlement evidence remains the true forward holdout. No quota, forced minimum, reader-side
grade override, or post-hoc stake is introduced.

## Paired Week 1 board impact

A bounded SELECT-only replay read 128 append-only evidence rows and the latest exact 16-game wave
captured `2026-08-25T11:21:34.519Z`. The result is 48 coherent decisions:

- Overall: **3 Best Angles / 12 Leans / 5 Watchlists / 28 No Plays**.
- Moneyline: 3 Best Angles / 5 Leans / 2 Watchlists / 6 No Plays.
- Spread: 3 Leans / 3 Watchlists / 10 No Plays.
- Total: 4 Leans / 12 No Plays.
- Prior-to-new: 13 promotions, 0 demotions, +7 actionable markets. Watchlist promotions are not
  counted as actionable.

Best Angles are CHI ML -142 DraftKings, MIN ML -108 BetRivers, and DAL ML -146 FanDuel. Spread
Leans are CAR +2.5 +102 FanDuel, HOU +1.5 -112 BetRivers, and WSH +4.5 -110 Caesars. Total Leans
are NE-SEA Over 44.5 -105 Fanatics, BAL-IND Under 48.5 -110 BetMGM, BUF-HOU Over 44.5 -109
Caesars, and DEN-KC Under 42.5 -107 Caesars.

## Tracking and failure boundaries

- The regular-season public boundary is `2026-09-09`, the ET slate date of the verified Week 1
  opener. Every earlier date remains excluded, so preseason can never enter official lifetime
  results.
- Only a complete three-market tuple captured from T-60 through T-40, with coherent lock,
  timestamp, game, and release identities, can write a record. A 21-minute-late capture fails
  closed. Unlocked decisions are never tracked.
- The existing leased forward writer inserts only missing immutable rows. A cadence-not-due retry
  can repair a prior tracking-write failure from already stored T-60 evidence without a provider
  call. It never updates a locked prediction.
- The shared tracking refresh never reconstructs an NFL prediction. It only reads exact
  BALLDONTLIE game identities, updates final/void scores, and calls the shared ML/Spread/Total
  grader. Existing NFL lifetime baselines are appended to, never reset or backfilled.
- The member reader rejects stale or mixed current-slate releases. True price, identity, injury,
  quarterback-history, market-completeness, or lock-health failures render Held inside the normal
  Daily Edge layout. Projected QBs and absent strictly matched SharpAPI rows remain explicit
  context rather than counterfeit confirmation or automatic No Play.

## Validation and rollback

Focused tests cover r9 exact-price grading, all four display tiers, same-PMF score/probability
coherence, the official opener date, strict T-60 timing, immutable prediction-record shape,
writer/lease ownership, exact provider score normalization, and shared grading wiring. The full
model-change suite, TypeScript check, production build, diff check, and integration-safety check
must all pass on the final committed tree before the protected PR may merge.

Rollback member visibility through `NFL_DAILY_EDGE_ENABLED` / `NFL_WEEK_ONE_EVIDENCE_BOARD_ENABLED`.
Do not delete forward evidence or already locked official records. Mixed release IDs, stale-reader
publication, lost exact-price coherence, missing required data shown as ordinary No Play,
overlapping writers, or an unexpected actionable collapse are immediate rollback/hold criteria.
