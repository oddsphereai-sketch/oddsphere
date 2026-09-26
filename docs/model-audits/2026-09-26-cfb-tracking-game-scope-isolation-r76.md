# CFB tracking game-scope isolation r76

## Scope and predeclaration

- Sport / market: CFB Moneyline, Spread and Total official tracking only.
- Sole write path: `runCfbForwardEvidenceWriter` under the existing
  `prediction_pipeline:cfb` lease.
- Previous writer / tracking record releases:
  `cfb_forward_evidence_writer_2026_09_26_r75_sharp_price_trail_continuity` /
  `cfb_official_tracking_record_2026_09_26_r25_score_side_coherent`.
- Candidate writer / tracking record releases:
  `cfb_forward_evidence_writer_2026_09_26_r76_tracking_game_scope_isolation` /
  `cfb_official_tracking_record_2026_09_26_r26_tracking_game_scope_isolation`.
- Trigger: the September 26 writer reported `official_tracking_incomplete` while a complete new
  T-60 cohort existed. Read-only audit showed that an older incomplete recovery candidate caused
  the slate-wide tracking transaction to return before inserting complete sibling games.

## Intended behavior

Tracking completeness is enforced at game scope. A candidate game is inserted only when every
market planned for that game is already present or has an immutable record ready in the current
run. An incomplete game remains fully missing and is reported for recovery. Complete sibling games
are inserted in the same run. Existing keys remain idempotent and immutable.

The change cannot recalculate or alter a prediction, probability, projected score, side, line,
price, grade, action, stake, member card, or settled result. It adds no provider request and no
writer. Promotion / demotion / actionable / side / score impact is 0 / 0 / 0 / 0 / 0.

## Verification and rollback

- Focused test proves a complete three-market game is insertable while an incomplete sibling is
  held as an explicit three-market gap.
- Required gates: focused CFB production tests, TypeScript, lint, `npm run verify:model-change`,
  integration safety, protected PR checks, and live writer proof.
- Live acceptance: complete due games receive all planned records, the writer continues reporting
  any genuinely unrecoverable game, the member snapshot remains coherent, and the lease is empty.
- Roll back the writer / tracking constants to r75 / r25 without deleting or rewriting any records.
