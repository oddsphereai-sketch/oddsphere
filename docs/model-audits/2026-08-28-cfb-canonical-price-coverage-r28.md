# CFB canonical sportsbook-price coverage r28

Date: 2026-08-28

Status: implementation candidate; production and natural-cycle results pending.

## Implementation

The CFB SharpAPI price fallback now discovers official canonical events by unique slate date before requesting exact-event odds. It no longer constructs or probes guessed bucket IDs. A match requires one canonical ID, exact normalized home/away identity, and kickoff within 15 minutes. Ambiguous matches and one canonical event reused across games fail closed before the sole append. Unpublished events make no odds request and remain honest market-scoped unavailable evidence.

Exact-event odds use `market=main`, `is_live=false`, 200 rows per page, forward-only bounded offset pagination, and the existing 192-request all-run ceiling. Normalization and grading continue to require real non-live active paired sportsbook rows, exact target prices, and target-excluded same-line comparison evidence. The known SJSU-USC fixture still reconstructs BetMGM USC -38.5/SJSU +38.5 and Total 60.5 without allowing its one-sided Moneyline to suppress those sibling markets.

The shared football prediction helper now stops explicit `market_data_unavailable` Spread/Total states from falling through to `Projected margin` or `Projected total`. It uses the existing `Spread prediction unavailable` / `Total prediction unavailable` labels while leaving Quick Read score and winner context intact.

## Focused evidence

- Known canonical USC event: one discovery request plus one odds request; normalized target and comparison books unchanged.
- Fourteen unmatched games spanning two strict dates: 2 discovery requests instead of 112 guessed slug/bucket requests; zero fabricated matches.
- Canonical event absent: no odds request and null event identity.
- Wrong team identity: rejected.
- Two exact canonical matches: fatal ambiguity before odds normalization.
- Multi-page odds: forward-only pagination and all prior malformed/repeated/non-advancing page guards remain enforced.
- Shared Daily Edge experience: explicit unavailable football Spread/Total labels pass while MLB and other legacy model-native fallbacks remain unchanged.
- Current 38-game r8 board is the predeployment baseline: 27 evaluated / 87 unavailable, with 3 Best Angles / 2 Leans / 10 Watchlists / 12 evaluated No Plays. No stored decision is recomputed or mutated by deployment.

## Releases

- Sharp price fallback: `cfb_sharpapi_named_book_fallback_2026_08_28_r8_canonical_event_discovery`
- decision / tuple: `cfb_v1_daily_edge_decision_2026_08_28_r13_canonical_price_coverage` / `cfb_v1_exact_price_decision_tuple_2026_08_28_r7_canonical_price_coverage`
- evidence / collector / member: `cfb_forward_evidence_snapshot_2026_08_28_r9_canonical_price_coverage` / `cfb_forward_evidence_collector_2026_08_28_r15_canonical_event_discovery` / `cfb_v1_member_release_2026_08_28_r16_canonical_price_coverage`
- writer / fixture: `cfb_forward_evidence_writer_2026_08_28_r19_canonical_event_discovery` / `cfb_v1_member_fixture_2026_08_28_r20_canonical_price_coverage`
- shared presentation: `daily_edge_member_presentation_2026_08_28_r15_football_unavailable_prediction_copy`
- all PMF, outcome, calibration, grade-policy, T-60, tracking, and settlement releases: unchanged.

## Pending production acceptance

After protected merge and a Ready production deployment, wait for the untouched leased writer. A SELECT-only readback must prove one complete r9 wave across the eligible weekly window, exact request count, before/after availability and grade counts, no mixed r8/r9 fixture, and strict event/source/timestamp provenance. Signed-in QA must verify the shared MLB-style reader on desktop and 390px mobile, including score/winner coherence, exact prices, movement, public consensus, strictly matched Sharp splits, absence of projected-margin/total fallback copy, and no Toss-Up.
