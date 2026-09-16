# NFL injury pagination and Player Props recovery pre-publication declaration

Date: 2026-09-16

This declaration freezes the incident scope and acceptance gates before any production publication. The diagnostic branch already contained the smallest candidate repair when this record was written; no candidate had been committed, published, or used to write production data.

## Scope

- Sport and products: NFL Daily Edge and NFL Player Props.
- Model input: the existing BALLDONTLIE weekly injury report used by the sole NFL writer.
- Writer and lease: the existing `/api/cron/nfl-forward-evidence` writer under `prediction_pipeline:nfl`; no writer, cron, lease, or write path is added.
- Reader: NFL Player Props must resolve the same current NFL week as Daily Edge.
- Failure boundary: an incomplete game may be excluded with a health finding, but may not abort every otherwise complete Player Props game.
- UI-only parity: MLB Player Props adopts the already released NFL custom American-odds range filter through one shared utility. It changes only the displayed rows and makes no provider, model, grade, lock, tracking, or writer change.
- MLB Daily Edge sharp-book splits are outside the code-change scope. Direct source audits must remain truthful: missing named-book handle/ticket rows may not be relabeled from consensus or price data.

## Frozen incident evidence

The 2026 Week 2 injury response contains 488 rows across five pages (100, 100, 100, 100, and 88). The incumbent collector stopped after four pages and returned `null` whenever another cursor remained. That converted valid weekly injury evidence into `injury_report_unavailable` for all 16 games. Because NFL Player Props required the same shared evidence for every game, the first missing injury payload aborted publication of the entire props slate.

The provider pagination ceiling will increase from four to eight pages. The exact observed response completes on page five, so the new ceiling is bounded and leaves three pages of safety headroom. Collection remains slate-scoped and cached inside the existing writer; there are no per-card or per-user calls.

## Release and behavior boundary

All affected NFL model, calibration, decision, member, collector, writer, fixture, compact-snapshot, Player Props model/calibration/decision/runtime/board/member/writer/tracking, and inference-context identifiers must advance together. Existing locked and settled rows remain immutable. Grade thresholds, projections, forecast math, side selection, stake policy, settlement, and tracking rules are unchanged.

The previous coherent Daily Edge release family is the September 16 sharp-league-contract family (`r12/r18/r15/r29/r21/r13`). The previous coherent Player Props family is the September 7/3 family (`runtime r11`, `board r14`, `decision r10`, `model/calibration r7`, `member r17`, `writer r20`, `tracking r10`, context r3).

## Acceptance and rollback

Before publication:

1. A deterministic five-page fixture must prove that the fifth page is consumed and a response inside the eight-page cap is retained.
2. A current Week 2 read-only replay must cover all 16 games, retain injury evidence for all 16, and produce zero whole-game Daily Edge holds.
3. A direct current Week 2 Player Props replay must cover all 16 games and produce a nonempty board without context health holds.
4. Existing rows must not be demoted by a new rule; there is no new grade rule. Board-count impact and operational exceptions must be reported.
5. TypeScript, focused NFL tests, model-change verification, lint/build, protected-PR integration safety, and post-deploy live writer/reader checks must pass.

Rollback the complete new release family to the preceding coherent releases if the writer mixes releases, exceeds its declared bounded budget, loses complete games, produces a new full-slate abort, collapses actionability unexpectedly, or disagrees with the member snapshot. Preserve all locked historical evidence.
