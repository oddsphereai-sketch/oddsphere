# NFL Owls capture cutover

Date: 2026-10-27  
Scope: future-unlocked NFL full-game evidence collection and member named-book split display  
Owner direction: continue removing the cancelled SharpAPI subscription; keep predictive Market Reader work in its separate task

## Production boundary

- The sole `prediction_pipeline:nfl` writer requires `OWLS_INSIGHT_API_KEY`, not `SHARPAPI_KEY`.
- One bounded Owls `/api/v1/nfl/splits` request replaces the live SharpAPI weekly split request.
- The direct SharpAPI NFL sharp-book odds request is retired. Circa/Pinnacle price history already runs through the scheduled, observation-only Market Intelligence V2 Owls collector; BALLDONTLIE retains the current retail same-book decision and display trail.
- The NFL player-props writer receives no SharpAPI key. BALLDONTLIE remains its active offer source and last-known-good rules are unchanged.
- Exact team orientation and event date are required. Unknown, duplicate, cross-week, incomplete, or non-complementary rows fail closed.

## Authority and immutability

Owls split rows are stored for future-unlocked member evidence and are labeled with `provider="owls"`. `nflModelSharpSplits` removes them before every forecast, target-excluded outcome, grade, professional/named/three-state reader, market state, semantic runtime, and contextual decision capture. Historical SharpAPI rows retain their exact legacy provider identity and incumbent age rules. Existing locked payloads are never refreshed, relabeled, or reconstructed.

The active model, calibration, decision, grade, fixture, compact member snapshot, tracking, and context-capture releases do not change. Only the sole writer and evidence collector advance to:

- `nfl_forward_evidence_writer_2026_10_27_r91_owls_capture_only`
- `nfl_forward_evidence_collector_2026_10_27_r29_owls_capture_only`
- adapter `nfl_owls_splits_2026_10_27_r1_capture_only_named_books`

## Evidence

The live read-only provider probe returned 14 NFL split events / 168 normalized rows with complete Circa or BetMGM coverage for all 14 current games, zero rejected identities, and provider status `partial` only because an advertised named book was unavailable. The companion scheduled Owls price lane returned 257 NFL odds events and complete normalized Circa/Pinnacle pairs.

The full live writer replay ran with `apply=false` and proposed 14 future-unlocked payloads, inserted zero rows, covered 14 games / 42 markets, matched Owls splits for 14/14 games, and reported no Owls error. The local environment did not contain the Playbook credential, so an isolated dummy token was used; its 11 Best Angles / 10 Leans / 11 Watchlists / 10 No Plays output is provider-path evidence only and is not claimed as a board comparison. Full-provider board verification is required on the deployed production cron before completion.

Focused adapter, complete NFL production, type, integration, and model-change suites must pass. The change must ship through a fresh-base protected PR and then prove the production writer release, Owls capture telemetry, zero SharpAPI route requirement, member snapshot refresh, and live member split visibility.

## Rollback

Roll back writer r91 and collector r29 together. Do not alter any already stored locked or legacy SharpAPI payload. The observation-only Market Intelligence V2 Owls price history may continue independently.
