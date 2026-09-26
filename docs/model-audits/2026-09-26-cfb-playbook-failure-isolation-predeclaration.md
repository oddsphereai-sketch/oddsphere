# CFB Playbook failure isolation predeclaration

## Scope and production baseline

- Sport / surface: CFB Daily Edge, all three Moneyline / Spread / Total markets.
- Base commit: `d64994f92a83faa2cd6063e67f55cf381b9bdf48` (current remote `main` at branch creation).
- Sole authoritative writer: `/api/cron/cfb-forward-evidence` under the existing `prediction_pipeline:cfb` lease.
- Current writer release: `cfb_forward_evidence_writer_2026_09_24_r69_sharp_price_release_seed`.
- Current evidence / collector / member family remains `cfb_forward_evidence_snapshot_2026_09_20_r26_reference_coverage_cursor` / `cfb_forward_evidence_collector_2026_09_20_r32_reference_coverage_cursor` / `cfb_v1_member_release_2026_09_20_r38_reference_coverage_cursor`.
- Current model, PMF, probability, calibration, decision, grade, stake, tracking, member copy, labels, and layout are out of scope and must not change.

## Production finding

At `2026-09-26T13:45Z`, the published 106-game / 318-market member snapshot was approximately 13 hours old. The preceding twelve scheduled writer runs all failed before publication because either Playbook `/v1/lines` or `/v1/splits` returned HTTP 429. The schedule and sport-scoped lease were running; an optional-provider exception was aborting the sole writer before healthy BallDontLie, SharpAPI, ESPN reference, retained evidence, and snapshot publication could complete.

The stale snapshot contained current price coverage for 67/106 games, 119/318 markets without a current price/history trail, and 205 No Plays. Its projected-score distribution was not globally compressed: 11/106 expected margins and 14/106 representative margins were within two points, while 13 expected margins exceeded 28 points. The immediate issue is provider-failure isolation and price freshness, not a justification to alter score math or force promotions.

## Predeclared repair

1. Isolate Playbook lines and splits requests independently. A request error becomes an internal writer health finding instead of aborting the CFB refresh.
2. Retain each game's latest valid Playbook line and split observation when the corresponding endpoint fails or omits that event. Preserve its original observation timestamp; do not relabel it as fresh.
3. Continue collecting and publishing healthy BallDontLie, SharpAPI, ESPN-reference, quarterback, and weather evidence through the existing sole writer and lease.
4. Advance only the operational writer release. The evidence schema and every prediction/model release stay unchanged because the calculation and successful-provider path are unchanged; this repair restores the already-authoritative scheduled input refresh.
5. Expose provider failure only in cron/operator health. Add no member-facing copy, stale tag, substitute label, badge, or layout change.

## Acceptance and rollback gates

- A forced Playbook lines/splits failure must not reject the collection attempt and must retain the prior timestamped observation.
- The focused CFB production tests and `npm run verify:model-change` must pass.
- A dry live replay must complete without writes and report the natural same-board grade/actionability impact. No quota may be used and no artificial board flattening is allowed.
- Before publication, refresh remote `main`, run integration-safety from the clean committed worktree, and publish only through an up-to-date protected PR.
- After merge, a natural or authorized existing cron run must publish a fresh coherent snapshot, keep one empty `prediction_pipeline:cfb` lease, preserve immutable T-60 rows, and maintain site responsiveness.
- Roll back the writer release if the repair creates mixed releases, fabricated prices/splits, a second writer, score/market incoherence, a snapshot failure, or an unexpected actionable-board collapse. Existing immutable evidence must never be rewritten.

## Validation result

- Focused production suite: `npm run test:cfb-v1-production` passed on 2026-09-26. This includes cross-market coherence, event identity, weather, decision, weekly engine, named-book odds, ESPN reference, market-informed outcome, market/sharp shadow, holistic confidence, grade semantics, SharpAPI split matching, and the full production contract.
- Live-provider replay: the repaired writer completed with `apply:false`, processed 106 games, planned 100 upcoming writes, evaluated 163 decisions, and performed zero writes. Playbook lines and splits both returned HTTP 429 during this replay; each failure was isolated and surfaced as an operator health hold instead of aborting the run.
- Natural board-count result from that dry replay: 4 Best Angles, 52 Leans, 71 Watchlists, and 36 No Plays. No threshold, probability, score, prediction, grade, stake, promotion, or demotion rule changed.
- Production incident recovery was independently confirmed by invoking the existing production writer after Playbook overage was enabled. The member snapshot advanced from `2026-09-26T00:39:48.434Z` to `2026-09-26T13:54:56.350Z`; current-price coverage rose from 67 to 76 games and markets lacking both a current price and price trail fell from 119 to 89. The recovery used the pre-existing r69 writer and therefore does not count as proof that r70 is deployed; r70 still requires the protected-PR and post-merge verification gates above.
- Remaining missing current-price rows were classified rather than masked: 75/89 were FCS-only markets. Among FBS-involved games, eight Moneyline rows lacked a two-sided current quote and three games lacked current sportsbook prices for Spread and Total even though their prediction lines were present. No price or split was fabricated to fill those gaps.
