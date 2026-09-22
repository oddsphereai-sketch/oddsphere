# NFL Week 3 publication continuity hotfix

Date: 2026-09-22

## Scope and incident evidence

- Sport / markets: NFL Daily Edge Moneyline, Spread, and Total publication only.
- Sole writer / lease: the existing `/api/cron/nfl-forward-evidence` writer under `prediction_pipeline:nfl`; no writer, timer, provider request, or lease is added.
- Active prediction authority remains `nfl_v1_member_release_2026_09_21_r18_opening_market_direction` with decision release `nfl_v1_daily_edge_decision_2026_09_21_r21_opening_market_direction`.
- Production advanced to Week 3 at Tuesday midnight Eastern, but every natural writer cycle after the transition was partial. Game `1392255` was isolated with `decision_forecast_side_disagreement(total decision under; PMF over; expected-score direction over; distance 0.8562897656623605; line 42.5)`, leaving the member fixture at 15/16 and therefore preventing compact snapshot publication.
- The provider schedule, odds capture, NFL tracking refresh, and Week 3 Player Props snapshot continued running. The missing Daily Edge board was a publication-validator mismatch, not an empty schedule.

## Repair

NFL Spread and Total decisions already compute side probabilities after excluding exact-line pushes. The shared publication validator previously classified a decision side with half-push display math. On a push-heavy, near-normalized discrete distribution, those two conventions could land on opposite sides of the 50% boundary even though the released decision and its own PMF probability were coherent.

The NFL writer now explicitly requests the push-excluded validator convention. CFB keeps its existing half-push convention. Every other coherence check remains fail-closed, including distribution mass and expected-score identity, wider PMF/mean direction disagreement, market count, side/line identity, quote validity, EV identity, positive-value actionability, and Moneyline/Spread event containment.

Release-only publication identifiers advance to:

- coherence: `football_cross_market_coherence_2026_09_22_r12_nfl_nonpush_side_alignment`
- sole writer: `nfl_forward_evidence_writer_2026_09_22_r37_nonpush_side_alignment`
- member fixture: `nfl_weekly_member_fixture_2026_09_22_r27_nonpush_side_alignment`
- compact snapshot: `nfl_forward_member_snapshot_2026_09_22_r19_nonpush_side_alignment`

The active model, calibration, decision, grade, weekly outcome, score-distribution, probability, Total head, Spread head, and target-exclusion releases do not change. The compact reader accepts r18 as its direct bounded predecessor so deployment cannot create a version-key empty-board gap.

## Same-input board impact

- Forecast changes: 0
- Probability changes: 0
- Side changes: 0
- Price / line changes: 0
- Grade changes: 0
- Promotions / demotions: 0 / 0
- Stake changes: 0
- Expected coverage after the next natural writer: 16 games / 48 predictions instead of the blocked 15/16 intermediate fixture.

Separately, the retained split values remain visible through the existing fallback hierarchy without member-facing stale, historical, or warning labels. This presentation repair changes no split value, provenance, freshness metadata, model input, market reading, prediction, or grade.

## Verification and rollback

Required before merge: focused cross-market, NFL writer, fixture, snapshot, Daily Edge experience, CFB regression, TypeScript, lint, `npm run verify:model-change`, production build, and latest-main integration safety. Live acceptance requires a natural successful NFL writer cycle, the r19 Week 3 compact snapshot, 16/16 games and 48/48 predictions, intact opening/current trails and prices, unchanged active model/decision releases, one released NFL prediction lease, a responsive member reader, and no stale/historical split wording.

Rollback publication releases r37/r27/r19 and the NFL validator opt-in together to r36/r26/r18. Preserve all immutable forward evidence and official tracking rows. Roll back immediately for a mixed release set, a changed prediction tuple, incomplete current prices, a failed lock/tracking boundary, duplicate writer activity, or renewed reader unavailability.
