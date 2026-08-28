# CFB event-discovery pagination r31 audit

## Result

The launch blocker was a provider-catalog pagination regression, not a reader cache or missing scheduler invocation. Natural cron rows at 5:09, 5:24, 5:39, and 5:54 PM ET all failed before publication because the Aug. 29 SharpAPI NCAAF event catalog required more than two pages. The writer's atomic boundary preserved the last complete 38-game r29 wave.

Provider r9 now permits up to eight forward-only canonical-event pages per date while retaining the unchanged 192-request all-run ceiling. Exact normalized team/date/time identity, unique canonical event ownership, main-market odds, real book/line/price/timestamp tuples, and every prior fail-closed pagination guard remain mandatory. A test event located on page three resolves to the same normalized BetMGM/consensus evidence as a page-one event; the eight-page exhaustion case still fails closed.

The behavior is versioned through decision r14, tuple r8, schema r10, collector r16, member r18, writer r21, and fixture r22. The independent PMF, probabilities, score, winner, grade policy, calibration, thresholds, T-60 rules, tracking, Sharp split matching, and public presentation are unchanged. The complete r29 wave is an explicit atomic fallback during transition.

## Pre-publication validation

- `scripts/test-cfb-sharpapi-odds.ts`: passed.
- `scripts/test-cfb-v1-decision.ts`: passed.
- `scripts/test-cfb-v1-production.ts`: passed.
- `npx tsc --noEmit`: passed.
- `npm run verify:model-change`: passed, including the 182-case shared Daily Edge experience suite and every CFB/NFL model boundary.
- `npm run build -- --webpack`: passed on Next.js 16.2.6.
- `git diff --check`: passed.
- Integration-safety, protected checks, natural-cycle replay, exact before/after counts, and signed-in QA are recorded after they complete.

No provider or writer was manually invoked during diagnosis or validation. The operational evidence came from SELECT-only immutable snapshots and `data_refresh_log` reads.
