# MLB Player Props priced-offer retention r43 result

Date: 2026-09-21

## Outcome

The r43 candidate corrects the publication defect without manufacturing a prediction. A fresh, supported pitcher offer for a verified probable starter now survives an empty recent-MLB-log sample. Rows without a complete independent forecast remain on the existing Research/Data Check paths with zero units; null projection is accepted only on those held rows.

No page copy, label, badge, subtitle, layout, market name, grade name, or board quota changed. Hitter publication rules, every probability model, target-excluded market synthesis, actionability thresholds, prices, stakes, locks, tracking, provider budgets, writer, and shared lease are unchanged.

## Production-backed no-write replay

The 2026-09-21 full refresh candidate ran against current production data with `persist=false` at `2026-09-21T21:14:27.567Z`.

- Previous release: `mlb_props_2026_09_05_r42`
- Candidate release: `mlb_props_2026_09_21_r43`
- Candidate validation: publishable, zero validation errors
- Provider calls: 20 total (9 odds, 10 research, 1 lineups), within the existing budget
- Board rows: 1,112 previous; 1,128 candidate
- Matched rows: 1,101
- Matched grade transitions: every matched row retained its grade
- Actionables: 21 previous; 21 candidate
- Promotions: 0
- Demotions: 0
- Watchlist promotions: 0
- Actionable data-gate failures: 0
- Locked-row mutations: 0

The 16-row net increase is confined to real pitcher offers already present in the provider response:

- Pitcher earned runs: +4 Research
- Pitcher hits allowed: +2 Research
- Pitcher outs: +4 Data Check
- Pitcher strikeouts: +4 Data Check
- Pitcher walks: +2 Research

Every batter category retained the same row and grade counts. Every pitcher actionable and positive-signal count also remained unchanged. The replay fetched a newer provider state than the previous production snapshot, so raw probability/projection value changes across matched rows are input-time changes and are not attributed to r43. Under equal candidate input, the only r42-versus-r43 behavioral difference is whether the 16 verified no-history pitcher rows are discarded or retained on an existing nonactionable hold path.

## Verification

- `npx tsc --noEmit`: passed.
- `npm run test:mlb-props-engine`: 404 passed, 0 failed.
- `scripts/test-mlb-prop-market-model-ownership.ts`: passed; 19 markets versioned.
- `npm run test:mlb-props-launch`: passed.
- `npm run verify:model-change`: passed, including MLB, WNBA, NFL, CFB, UCL, player-prop, tracking, reader, writer, and lease contracts.
- Focused ESLint: passed with zero errors; eight pre-existing dashboard warnings remain.
- `npx next build --webpack`: passed under Next.js 16.2.6.

Build, integration-safety, protected-PR, and live-release proof are recorded during publication. Rollback is r42; historical snapshots and locked tracking evidence are never rewritten.
