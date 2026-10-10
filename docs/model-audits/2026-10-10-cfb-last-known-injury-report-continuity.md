# CFB last-known injury-report continuity

## Scope and predeclaration

- Sport / surface: College Football Daily Edge availability panel and the existing verified-quarterback availability input.
- Authoritative writer / lease: the sole CFB forward-evidence writer under `prediction_pipeline:cfb`; no writer, cron, provider request, or cadence is added.
- Defect: the continuity builder could preserve a previous report, but the writer supplied only the newest evidence row's report. When that newest row recorded a failed or omitted injury refresh with `report=null`, an older verified exact-game report became unreachable.
- Candidate: select the newest verified exact-game report across the writer's already bounded evidence history, preserve its original provider timestamp through a later failure/omission/older replay, and replace it only with a genuinely newer verified report. Stop polling Playbook's unsupported CFB injury product after a credential-backed replay returned HTTP 404 while the same credential successfully returned CFB lines and splits; retain the existing official-conference collector as the current report source.
- Missing evidence stays unavailable. Team/game identity remains exact. No injury, player, status, freshness timestamp, split, line, price, or market signal is inferred.
- Existing locked records remain byte-for-byte authoritative. This repair applies only to future unlocked evidence and reader publications; it never rewrites a stored lock.

## Release family

- Evidence schema, independent model, probability, calibration, decision, grade, professional market-reader, exact-price, tracking, and stake releases remain unchanged.
- Collector / member: `cfb_forward_evidence_collector_2026_10_10_r57_last_known_injury_report_continuity` / `cfb_v1_member_release_2026_10_10_r60_last_known_injury_report_continuity`.
- Writer / fixture / public outcome: `cfb_forward_evidence_writer_2026_10_10_r114_last_known_injury_report_continuity` / `cfb_v1_member_fixture_2026_10_10_r86_last_known_injury_report_continuity` / `cfb_market_sharp_public_outcome_contract_2026_10_10_r76_last_known_injury_report_continuity`.
- Compact snapshot / reader: `cfb_forward_member_snapshot_2026_10_10_r46_last_known_injury_report_continuity` / `cfb_member_snapshot_reader_2026_10_10_r31_last_known_injury_report_continuity`.
- Immediate rollback is the complete October 9 r59/r113/r85/r75/r45/r30 provider-continuity family. The r58 and r57 families remain readable behind it for immutable locks.

## Required evidence

- Unit proof that a newer null row cannot hide an older verified report.
- Unit proof that a newer verified clear/update supersedes the retained report.
- Focused CFB production suite and full `npm run verify:model-change`.
- Same-input board impact: game and market coverage, promotions, demotions, actionables, score/side/price changes, and injury coverage.
- Live proof: exact release tuple, one writer/lease, snapshot freshness, injury request health, retained-report timestamps, market-reader release continuity, board coherence, and unchanged locks.

## Pre-publication result

- Focused CFB continuity, production, market-reader, price, lock, and member-snapshot suites pass. The full `npm run verify:model-change` gate and the production Next.js build pass.
- Read-only production snapshot at `2026-10-10T13:10:15.281Z`: 80 games / 240 markets, 76 upcoming games, 134 upcoming actionable markets, zero missing current prices, zero empty odds trails, zero unavailable predictions, and zero member-presentation health errors. The compact snapshot was 15.4 minutes old and its source evidence 29.7 minutes old.
- Credential-backed zero-write replay: Playbook CFB lines and splits succeeded, while `/v1/injuries` returned HTTP 404. Current report evidence is 24 exact-game official-conference reports and zero Playbook CFB reports. Removing the unsupported call therefore changes no current score, side, probability, grade, promotion, demotion, stake, or lock; it reduces the declared Playbook request maximum from four to three and removes the false `playbook_injuries_request_failed` cycle alarm.
- The same replay observed ordinary fresh-market changes against the older published snapshot (12 line/side/grade tuples); those are time-separated quote changes and are not attributed to this report-continuity repair. Conference reports remain display-only, and the professional market reader is unchanged.
- Protected-PR checks, merge, and production verification remain pending. Live acceptance requires the r60/r114/r86/r76/r46/r31 tuple, one writer/lease, a fresh coherent board, no CFB Playbook injury-request error, retained original report timestamps, and unchanged locked payloads.
