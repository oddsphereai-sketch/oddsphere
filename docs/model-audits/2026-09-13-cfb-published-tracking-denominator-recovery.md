# CFB published prediction denominator recovery — 2026-09-13

## Predeclaration and scope

- Sport / markets: CFB Moneyline, Spread and Total official prediction accuracy.
- Affected runtime: bounded CFB evidence read, sole CFB forward writer and CFB official tracking-record builder.
- New releases: `cfb_forward_evidence_writer_2026_09_13_r61_payload_owned_recovery_cutoff` and `cfb_official_tracking_record_2026_09_13_r20_complete_published_denominators`.
- Unchanged authorities: evidence `cfb_forward_evidence_snapshot_2026_09_05_r22_confidence_economics_bridge`, member `cfb_v1_member_release_2026_09_05_r34_confidence_economics_bridge`, decision `cfb_v1_daily_edge_decision_2026_09_05_r31_confidence_economics_bridge`, current forecast `cfb_market_sharp_aware_production_2026_09_13_r19_balanced_positive_value`, calibration, grade policy, provider inputs, model PMF, side, probability, score projection, exact-price logic, stakes and settlement.
- Writer ownership remains `/api/cron/cfb-forward-evidence` under the shared `prediction_pipeline:cfb` lease. No new timer, endpoint, writer or prediction-generation path is introduced.

## Incident evidence

The September 12 ET Daily Edge slate contained published predictions for 105 games. Production tracking showed only two games / six records because the separate T-60 tracking capture succeeded for two games before a release cutover and writer failures missed the other boundaries. This was a tracking-denominator failure, not missing model output.

The immutable evidence store contains a qualifying prediction snapshot at or before each game's scheduled T-60 boundary for all 105 games. A read-only audit selects the latest such snapshot using only game and capture timestamps, evidence/member/decision releases and payload integrity—never a score, grade result or outcome. It yields:

| Denominator | Games/predictions |
| --- | ---: |
| Games with a qualifying published pre-boundary prediction | 105 |
| Moneyline predictions | 105 |
| Spread predictions with an actual reference line | 77 |
| Total predictions with an actual reference line | 77 |
| Total honest trackable predictions | 259 |
| Existing records | 6 |
| Missing records proposed | 253 |

Twenty-eight games lack an immutable historical Spread/Total reference line. Those lines cannot be inferred from the result, a later market or a projection, so only their exact published Moneyline direction is recoverable. This preserves all game-level coverage without fabricating 56 ungradable market calls.

## Recovery contract

For a started game with no eligible current official T-60 payload, the sole writer may select only the latest checksum-verified current evidence/member/decision payload captured at or before scheduled start minus 60 minutes. The payload must use either the September 12 r18 forecast authority or current r19 authority and must contain published model-owned market outlooks.

Each recoverable market becomes a side-bearing `No Play` prediction with `held=false`. It retains the source evidence hash, original capture timestamp, side, model probability and reference line when present. It is included in W-L-push accuracy. It has null odds, market probability, edge and EV; it is not a Best Angle or Lean, has no stake and cannot enter ROI. `No Play` here means no official wager economics can be reconstructed; it does not mean Held, Toss-Up or excluded from accuracy.

The reader remains bounded: latest current row per game/stage plus at most one additional pre-boundary row per game. Ordinary and no-collection writer cycles both run the same idempotent `(game, market, decision release)` existence check. Existing records are never overwritten.

## Model-change impact and acceptance

- Same-input prediction/probability/projection changes: 0.
- Grade promotions / demotions: 0 / 0.
- Actionable board change: 0.
- Stakes and ROI exposure added: 0.
- Prediction-accuracy denominator: +253 records after the audited six existing records.

Focused regressions must prove latest-at-or-before-boundary selection, rejection of post-boundary payloads, no recovery before kickoff, non-Held No Play rows, null economics, and no fabricated Spread/Total lines. Required gates are focused CFB tests, TypeScript, lint, `npm run verify:model-change`, repository verification, production build where available, latest-main integration safety, protected PR checks and live post-merge verification.

Live acceptance requires exactly 105 September 12 games represented across 259 graded/pending prediction records (105/77/77 by market), zero recovered Held rows, zero recovered prices/edge/EV, one released CFB lease, a successful tracking refresh/settlement, and the public Yesterday surface reflecting the complete denominator. Any post-cutoff source, outcome-dependent selection, unexpected side/probability mutation, duplicate record, count mismatch or writer/lease failure is a rollback condition. Rollback disables future recovery by reverting r61/r20 but preserves all immutable evidence and already-written prediction records.

The first r60 production invocation failed safely before inserting any record because one provider game ID retained rows across a kickoff correction. Candidate selection initially compared every row with another row's grouped kickoff while the record builder correctly validated the chosen payload's own kickoff. Writer r61 makes both gates use the selected payload's own scheduled start and adds the schedule-correction regression. The failed run wrote zero prediction records, so no partial recovery or cleanup was required.
