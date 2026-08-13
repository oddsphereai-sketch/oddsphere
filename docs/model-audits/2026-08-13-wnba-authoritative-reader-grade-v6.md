# WNBA authoritative reader grade v6

Date: 2026-08-13

## Scope and authority

- Sport: WNBA.
- Markets: moneyline, total, and spread at the member-reader boundary.
- Model and distribution are unchanged: `wnba_v1_1_team_identity` and
  `wnba_market_heads_value_calibrated_2026_08_02_v3`.
- Grade policy advances from
  `wnba_grade_policy_v5_projection_rest_spread_agreement_2026_08_12` to
  `wnba_grade_policy_v6_authoritative_reader_grade_2026_08_13`.
- The sole writer remains `lib/services/wnba/runWnbaModel.ts`; the scheduled owner remains
  `/api/cron/wnba-daily-refresh` under the WNBA-scoped `prediction_pipeline` lease.

## Defect

The writer already emits a versioned, market-aware final grade. The member reader nevertheless
applied an older second cap using rounded display confidence and a separately reconstructed
picked-side no-vig probability. Those values do not share the same precision or grading contract,
so an official Lean could render as Watchlist.

This was a reader/writer coherence defect, not a new predictive rule. The v6 reader trusts the
authoritative writer grade only for v6 snapshots. Locked v5-and-older snapshots keep the legacy
reader behavior and are not rewritten.

## Paired impact

- Latest August 13 snapshot: 1 Lean, 8 Watchlists before; 1 Lean, 8 Watchlists after.
- Promotions: 0.
- Demotions: 0.
- Net actionable board change: 0.
- Picks, projections, probabilities, prices, sides, and stakes changed: 0.

A diagnostic across 40 stored WNBA games and 120 market rows from August 1-14 found four
historical cases where the obsolete reader cap changed an official writer Lean to Watchlist:
three moneylines and one spread. Those locked rows are evidence of the defect but remain on their
historical release behavior. The correction prevents the mismatch on new v6 snapshots.

Because v6 adds no promotion or demotion rule, outcome calibration, ROI, Brier score, and log loss
are unchanged from v5. The v5 spread-promotion evidence remains the applicable predictive
validation: 22-10 overall, 9-6 train, 7-2 validation, and 6-2 holdout.

## Verification and rollback

- Focused tests assert that v6 preserves an authoritative Lean even when rounded display
  confidence is slightly below the reconstructed market probability.
- Focused tests assert that v5 locked history retains the legacy cap.
- The complete model-change verification and WNBA focused suite must pass before deployment.
- Roll back to v5 if the live writer, tracking records, and reader do not all report v6, or if any
  current selection/projection/probability/price changes unexpectedly.
