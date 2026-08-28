# CFB SharpAPI expanded-slate request budget (r27)

Date: 2026-08-28

Status: verified production candidate; no provider, cron, writer, or database was manually invoked during implementation.

## Root cause and correction

After Division I weekly coverage expanded the live board beyond its prior eight-game slate, the natural CFB writer reached the Sharp exact-event fallback's legacy 96-request all-run ceiling and failed before its atomic append. The failure correctly preserved the prior coherent snapshot, but that left the member board stale and prevented recovered USC Spread/Total evidence and newly eligible games from publishing.

Provider release `cfb_sharpapi_named_book_fallback_2026_08_28_r7_expanded_slate_budget` makes two bounded changes:

- event candidates use the Eastern football calendar date before UTC, avoiding four known-wrong date probes for evening games crossing UTC midnight;
- the all-run hard ceiling is 192 requests instead of 96, allowing the expanded slate to finish while retaining exact event/team/start identity, eight maximum strict candidates per game, four maximum forward pages per event, sequential calls, and fail-closed atomic publication.

The sole writer remains `runCfbForwardEvidenceWriter` under `prediction_pipeline:cfb`. Member requests make zero provider calls. No route, cron, lease, database schema, or second writer was added.

## Model and grade impact

The score/winner r18 primary PMF, football-only secondary PMF, exact-price decision release, thresholds, grades, prices, sides, stakes, lock/tracking policy, Sharp split matching, and reader presentation are unchanged. Existing evaluated decisions have zero promotions and zero demotions. This candidate changes only whether a complete current evidence wave can finish and replace a stale snapshot; any newly available market remains governed by its existing exact-price probability, fair price, EV, and grade policy.

The EMU-SAC example remains a legitimate price-sensitive No Play set rather than a quota target: the current stored EMU Moneyline, SAC spread, and Over price each have negative expected value under the existing model/market tuple. USC Moneyline remains independently forecast but operationally No Play if a coherent two-sided target quote is absent; complete Spread and Total evidence are evaluated independently.

## Verification

- `npx tsx scripts/test-cfb-sharpapi-odds.ts`: pass. A fourteen-game worst-case empty-candidate slate completes exactly 112 requests without fabricating a match; Eastern-date `b2` is first for a UTC-crossing kickoff; existing pagination, hard-cap, identity, one-sided Moneyline, paired-alternate, and USC exact-tuple regressions pass.
- `npx tsx scripts/test-cfb-v1-decision.ts`: pass.
- `npx tsx scripts/test-cfb-v1-production.ts`: pass.
- `npx tsx scripts/test-cfb-weekly-engine.ts`: pass.
- `npx tsc --noEmit`: pass.
- `npm run verify:model-change`: pass, including the complete football and shared Daily Edge suites.
- `npm run build -- --webpack`: pass, 105/105 static pages.
- `git diff --check`: pass.

## Active release boundaries

- SharpAPI exact-event odds: `cfb_sharpapi_named_book_fallback_2026_08_28_r7_expanded_slate_budget`
- Evidence collector: `cfb_forward_evidence_collector_2026_08_28_r14_expanded_sharp_budget`
- Member release: `cfb_v1_member_release_2026_08_28_r14_expanded_sharp_budget`
- Writer: `cfb_forward_evidence_writer_2026_08_28_r16_expanded_sharp_budget`
- Member fixture: `cfb_v1_member_fixture_2026_08_28_r18_expanded_sharp_budget`
- Evidence schema, decision, PMFs, calibration, grade policy, and tracking: unchanged.

## Production acceptance

After protected merge and deployment, the candidate is not complete until an untouched natural cycle succeeds under the sole lease and signed-in QA confirms the current board count, USC's market-scoped exact evidence, EMU's exact-price/EV explanation, r18 primary plus football-only secondary, zero unmatched Sharp rows, and the MLB one-Public/one-Sharp split-card regression.

## Rollback

Rollback restores Sharp fallback r6, collector/member r13, writer r15, and fixture r17. Immutable evidence and locked/tracking rows are never mutated.
