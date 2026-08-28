# CFB event-discovery pagination r31 predeclaration

## Trigger

The protected r29 forecast release reached production, but the sole scheduled CFB writer did not publish a fresh member wave. SELECT-only `data_refresh_log` evidence shows four consecutive natural failures at 2026-08-28T21:09:49Z, 21:24:48Z, 21:39:48Z, and 21:54:48Z with the same error: the SharpAPI `/events` catalog for 2026-08-29 exceeded the bounded two-page discovery cap. The prior complete r29 wave remained live, so no partial or mixed-release rows reached members.

## Scope and releases

- Sport/markets: CFB Moneyline, Spread, and Total exact-price evidence only.
- Prediction model, PMF, calibration coefficients, grade thresholds, stakes, and public outcome contract: unchanged.
- Provider boundary: `cfb_sharpapi_named_book_fallback_2026_08_28_r9_event_discovery_pagination`.
- Exact decision/tuple: `cfb_v1_daily_edge_decision_2026_08_28_r14_event_discovery_pagination` / `cfb_v1_exact_price_decision_tuple_2026_08_28_r8_event_discovery_pagination`.
- Evidence/collector/member/writer: `cfb_forward_evidence_snapshot_2026_08_28_r10_event_discovery_pagination` / `cfb_forward_evidence_collector_2026_08_28_r16_event_discovery_pagination` / `cfb_v1_member_release_2026_08_28_r18_event_discovery_pagination` / `cfb_forward_evidence_writer_2026_08_28_r21_event_discovery_pagination`.
- Member fixture: `cfb_v1_member_fixture_2026_08_28_r22_event_discovery_pagination`.
- Sole write path and lease: existing `/api/cron/cfb-forward-evidence` under `prediction_pipeline:cfb`; no endpoint, timer, provider, or schema migration is added.

## Frozen change

Raise canonical `/events` discovery from two to at most eight forward-only pages per unique Eastern/UTC date. Keep `limit=200`, the existing forward-offset calculation, repeated-page and malformed-page guards, exact normalized home/away identity, kickoff tolerance, event uniqueness, exact-event `market=main` odds, and the unchanged 192-request all-run hard cap. An exhausted page or request cap still fails before the sole all-game append.

The complete r29 schema/member/decision wave remains the atomic reader fallback until all current-window games exist under the new releases. Missing exact evidence remains public No Play with an independent football forecast and no synthetic quote, line, probability, or EV.

## Acceptance

1. A canonical event first appearing on page three is recovered with the identical exact normalized sportsbook tuple.
2. Repeated, non-advancing, malformed, ambiguous, reused, over-eight-page, and over-192-request cases fail before append.
3. Focused provider, decision, writer/member, production, TypeScript, model-change, and webpack checks pass.
4. Protected publication is followed by an untouched natural writer cycle, SELECT-only reconciliation of 38 games/114 market slots and exact unavailable reasons, and signed-in desktop/mobile reader QA.
5. Report exact before/after grade counts and promotions/demotions from the natural repaired wave; do not infer them from stale or mixed releases.
