# CFB complete tracking recovery result — 2026-09-20

## Production defect

The September 19 CFB slate has 97 final games. The live canonical tracking set before repair is:

| Market | Records | Win | Loss | Push |
| --- | ---: | ---: | ---: | ---: |
| Moneyline | 97 | 81 | 16 | 0 |
| Spread | 71 | 40 | 29 | 2 |
| Total | 71 | 35 | 36 | 0 |

All 239 stored grades independently re-grade to the same result from the stored side/line and final
score. There are zero canonical duplicate records. The arithmetic is correct; the denominator is not.
Twenty-six games are missing both Spread and Total, for 52 absent `(game, market)` tuples.

## Outcome-blind recovery proof

The read-only recovery audit performs the same immutable reconstruction required by production:

- 26/26 games have a latest checksum-verified production forecast captured at or before scheduled T-60.
- 26/26 frozen weekly PMFs reproduce exactly: SHA-256, cell count, expected scores, representative
  score, win probability, and every 80% interval all match the immutable context capture.
- 26/26 games match one ESPN event by exact away/home ESPN identity and bounded kickoff tolerance.
- 26/26 events expose a complete DraftKings opening Spread pair and opening Total pair.
- One game, Sacred Heart at Elon, already has a real immutable exact-price Spread and Total prediction
  published five minutes before T-60; those published sides/lines/probabilities take precedence.
- The other 25 games use the reproduced independent PMF evaluated at the strict DraftKings opening
  line. The final score is not read until after every side, line, and probability is fixed.

The append-only plan proposes exactly 52 rows: 26 Spreads and 26 Totals. Fifty use the ESPN opening
reference recovery source; two use the earlier immutable published prediction. Duplicate tuple count is
zero. Every row is non-Held `No Play` with null odds, market probability, edge, EV, stake, and ROI.
Promotions, demotions, exact-price decisions, actionable count, and stake count are all 0.

Independent post-selection grading of the proposed rows is 14-12 on Spread and 13-13 on Total. If the
atomic append and normal settlement complete, September 19 becomes:

| Market | Records | Win | Loss | Push |
| --- | ---: | ---: | ---: | ---: |
| Moneyline | 97 | 81 | 16 | 0 |
| Spread | 97 | 54 | 41 | 2 |
| Total | 97 | 48 | 49 | 0 |

These outcomes were not used to choose the repair rule, line, or side.

## Forward repair and load controls

The sole `/api/cron/cfb-forward-evidence` writer remains under `prediction_pipeline:cfb`. When the
primary Playbook reference is missing either a Spread or Total, the writer may collect a strictly
identified ESPN/DraftKings opening reference at slate scope. The reference creates a model outlook only;
it never enters current named-book consensus, market/sharp PMF synthesis, exact-price EV, grading,
actionability, or stake logic. Primary reference fields retain per-market precedence.

Collection is capped at eight prospective fallback games per natural run, six concurrent summaries,
seven scoreboard dates, six-second request timeouts, and 32 historical recovery games. There is no
per-card or member-request provider call. A provider error is isolated, leaves the preceding coherent
snapshot readable, and prevents a partial tracking append. Tracking reads existing CFB tuples without a
model-version filter, so a release bump cannot duplicate an immutable game/market record.

The compact reader now validates the previous snapshot against its own exact evidence/member/fixture
release tuple. This closes the deployment-handoff defect that previously let a new snapshot key hide the
still-valid CFB board before the first new writer publication.

## Release and rollback

- ESPN reference: `cfb_espn_reference_line_2026_09_20_r1_strict_opening_fallback`
- Evidence / collector / member: `cfb_forward_evidence_snapshot_2026_09_20_r25_complete_tracking_reference` /
  `cfb_forward_evidence_collector_2026_09_20_r31_complete_tracking_reference` /
  `cfb_v1_member_release_2026_09_20_r37_complete_tracking_reference`
- Sole writer: `cfb_forward_evidence_writer_2026_09_20_r66_complete_tracking_reference`
- Fixture / outcome: `cfb_v1_member_fixture_2026_09_20_r57_complete_tracking_reference` /
  `cfb_market_sharp_public_outcome_contract_2026_09_20_r52_complete_tracking_reference`
- Snapshot / reader: `cfb_forward_member_snapshot_2026_09_20_r16_complete_tracking_reference` /
  `cfb_member_snapshot_reader_2026_09_20_r5_complete_tracking_reference`
- Tracking: `cfb_official_tracking_record_2026_09_20_r23_complete_tracking_reference`

The joint PMF, score model, probability/calibration releases, exact-price decision release, grade policy,
promotion/demotion rules, and stakes remain the September 19 r69 family. Roll back the complete release
set above if the live writer fails strict identity or PMF replay, proposes anything other than the audited
52 rows, changes an existing tuple, reconstructs economics, exceeds the request bound, fails snapshot
publication, overlaps the lease, or does not settle to equal 97/97/97 market denominators. Preserve all
append-only evidence and prediction rows.
