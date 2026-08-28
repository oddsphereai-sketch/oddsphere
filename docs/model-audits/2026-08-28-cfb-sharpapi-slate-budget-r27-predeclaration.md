# CFB SharpAPI expanded-slate request budget predeclaration (r27)

Date: 2026-08-28

Status: predeclared before implementation. Production providers, cron, writer, and database are not manually invoked by this change.

## Starting point and incident

- Clean worktree: `/private/tmp/oddsphere-cfb-sharp-budget-r27-20260828`
- Branch: `codex/cfb-sharp-budget-r27-20260828`
- Exact production base: `79bd98f36816e93b963326ab0bc507328d76da77`
- Sole authoritative writer: `runCfbForwardEvidenceWriter` under the existing sport-scoped `prediction_pipeline:cfb` lease.
- Current provider / collector / member / writer / fixture releases: `cfb_sharpapi_named_book_fallback_2026_08_28_r6_provider_page_stride` / `cfb_forward_evidence_collector_2026_08_28_r13_sharp_page_stride` / `cfb_v1_member_release_2026_08_28_r13_sharp_page_stride` / `cfb_forward_evidence_writer_2026_08_28_r15_sharp_page_stride` / `cfb_v1_member_fixture_2026_08_28_r17_sharp_page_stride`.

The first natural writer cycle after r26 completed strict forward pagination but failed before the atomic append because the expanded Division I weekly slate exhausted the legacy 96-request SharpAPI exact-event ceiling. That ceiling was frozen while the live slate contained eight games. The current model-covered slate contains fourteen games, and an exact game can require two calendar-date identities, four bounded bucket candidates, and up to four forward pages for the accepted event. The writer therefore preserved the prior coherent eight-game snapshot, leaving member-visible USC evidence and the expanded slate stale.

## Frozen correction

1. Keep exact-event reads, strict start/team/date identity, four bucket candidates, four forward pages per event, and all existing malformed/repeated/non-forward page failures.
2. Try the Eastern football calendar date before the UTC date. Evening games that cross UTC midnight are labeled by their Eastern game date in the verified Sharp event identity, so the UTC-first order spends four avoidable probes before the correct `b2` candidate.
3. Raise the all-run request ceiling from 96 to 192. This remains a hard cap, is below the paid provider's documented minute rate, and fits the existing five-minute route duration at the measured sequential request latency. It allows a fourteen-game slate with all eight strict empty candidates (112 requests) to complete without weakening identity or fabricating evidence.
4. Preserve fail-closed atomic publication. Exceeding 192 requests still aborts before the sole append, and member reads continue to make zero provider calls.

## Model and board invariants

This is a price-availability/publication repair only. The CFB r18 primary joint PMF, football-only secondary PMF, exact-price decision release, probability heads, thresholds, grade ladder, selected sides, stakes, T-60 locks, tracking, score display, split matching, reader components, and market-independent No Play semantics do not change. The expected comparison for already evaluated rows is zero promotions, zero demotions, and byte-identical decisions. Newly published games or markets may replace operationally stale/unavailable rows only through genuine exact provider evidence.

## Required proof before publication

- Regression: a fourteen-game strict empty-candidate slate completes 112 bounded requests; the prior ceiling would fail at 96.
- Regression: an evening game crossing UTC midnight probes Eastern-date `b2` first.
- Existing hard-cap, pagination, exact-identity, SJSU-USC, alternate-pair, one-sided Moneyline, and cross-market tests remain green.
- TypeScript, `npm run verify:model-change`, webpack build, diff check, and integration-safety check pass from a clean committed worktree rebased on current `origin/main`.
- Protected PR only; after merge, verify production deployment, the next untouched natural writer cycle, current slate/grade replay, and signed-in CFB plus MLB Daily Edge behavior.

## Rollback

Rollback restores Sharp fallback r6, collector/member r13, writer r15, and fixture r17. Immutable evidence, locked rows, and official tracking rows are never rewritten or deleted.
