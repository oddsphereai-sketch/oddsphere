# CFB complete tracking recovery predeclaration — 2026-09-20

## Scope and production authority

- Sport / markets: CFB Moneyline, Spread, and Total prediction-accuracy tracking.
- Affected layers: reference-line coverage, immutable forward evidence, held-market outlook publication,
  official tracking recovery, member fixture/snapshot publication, writer health and request-budget telemetry.
- Unchanged layers: the weekly score model and joint PMF, market/sharp forecast synthesis, exact-price
  decision selection, grade ladder, promotion/demotion policy, actionability, stake, ROI, settlement math,
  member copy, labels, and page structure.
- Sole writer: `/api/cron/cfb-forward-evidence` under the existing `prediction_pipeline:cfb` lease. No
  second timer, endpoint, per-card provider request, or independent prediction writer is authorized.
- Starting production base: `9f5568d726f1a0270a359d66e5fdc07c10a88eda`.
- Current release family: evidence / collector / member
  `cfb_forward_evidence_snapshot_2026_09_19_r24_contained_spread_counter_signal` /
  `cfb_forward_evidence_collector_2026_09_19_r30_contained_spread_counter_signal` /
  `cfb_v1_member_release_2026_09_19_r36_contained_spread_counter_signal`; writer
  `cfb_forward_evidence_writer_2026_09_19_r65_price_history_continuity`; fixture / outcome
  `cfb_v1_member_fixture_2026_09_19_r56_price_history_continuity` /
  `cfb_market_sharp_public_outcome_contract_2026_09_19_r51_contained_spread_counter_signal`;
  tracking `cfb_official_tracking_record_2026_09_19_r22_contained_spread_counter_signal`.

## Observed defect and outcome-blind hypothesis

The production September 19 slate contains 97 final games and 239 canonical CFB prediction records:
97 Moneylines, 71 Spreads, and 71 Totals. Independent re-grading from stored selections, lines, and final
scores matches all 239 stored grades. There are no canonical duplicates. The unequal counts come from
26 games whose immutable pre-cutoff forecast exists but whose captured Playbook/BALLDONTLIE/SharpAPI
payload has no Spread or Total reference line. The current recovery builder truthfully emits only
Moneyline in that state.

The hypothesis is that a strictly identified, sportsbook-attributed ESPN opening line can close this
reference-line coverage gap without changing the score forecast or fabricating betting economics.
The fallback is eligible only when the primary reference line is absent. It supplies a Spread/Total
evaluation point for the already-published joint PMF; it is not a multi-book consensus, current quote,
sharp signal, recommendation, price, edge, EV, stake, or ROI input.

## Recovery and forward rules

1. Match an ESPN event by exact away/home identity and kickoff, fail closed on zero or multiple matches,
   and accept only a complete named-sportsbook opening Spread and Total pair.
2. For a completed-game repair, select the latest checksum-verified immutable production forecast at or
   before scheduled T-60. Rebuild the weekly PMF from the frozen runtime and pregame prior results, then
   require its PMF hash, expected scores, representative score, intervals, and win probability to match
   the immutable capture. Final scores may grade the recovered prediction only after the side is frozen;
   they may not select the line, side, or probability.
3. Append only the absent `(game, market)` tuples. Preserve every existing record. Recovered Spread and
   Total rows are non-actionable `No Play` accuracy records with null odds, market probability, edge, EV,
   stake, and ROI fields and explicit opening-line recovery provenance.
4. For future captures, collect the same fallback at slate scope inside the sole writer with bounded
   concurrency, timeouts, request count, and payload size. Primary lines retain precedence. A provider
   failure isolates the fallback and preserves the last coherent member snapshot.
5. Existing priced decisions and all games with a primary line must be byte-for-byte unchanged in side,
   probability, projection, quote, grade, actionability, and stake. Promotions and demotions must be 0/0;
   the actionable-board count must be unchanged. The expected September 19 denominator impact is
   97/71/71 to 97/97/97 by adding exactly 52 accuracy-only records.

## Verification and rollback

Acceptance requires a deterministic 26/26 event and opening-line match, 26/26 immutable PMF replay,
exactly 52 absent tuples proposed, no mutation or duplication of the existing 239 records, 3/3 markets
for all 97 games after settlement, focused CFB tests, TypeScript, lint, `npm run verify:model-change`,
full verification/build, integration safety against the latest `origin/main`, protected-PR checks, and
postdeploy proof from the live writer, database, member reader, lease, and site health.

Roll back the new evidence/member/writer/fixture/tracking release family together if identity is
ambiguous, a PMF replay differs, any existing row changes, any economic field is reconstructed, an
actionable count changes, provider work exceeds its bound, the writer times out, the lease overlaps,
the snapshot fails publication, or the live denominator is not exactly three markets per eligible game.
Preserve all append-only evidence and prediction records during rollback.
