# NFL preview price and grade integrity r7

Date: 2026-08-20  
Scope: local founder preview only; no production writer, database mutation, official tracking, settlement, stake, or deployment  
Projection release: `nfl_pregame_real_local_current_refit_2026_08_19_r3`  
Grade-policy release: `nfl_regular_pipeline_preseason_grade_policy_2026_08_20_r2`

## Outcome

The restored Week 2 preview contains 16 real preseason games and three predictions per game: moneyline, total, and spread, for 48 prediction rows. Each card retains all three market buttons. Grade-filter counts now follow the one displayed market per game, so the headline counts sum to 16 instead of counting the same game in several categories.

The regular-pipeline preseason rehearsal no longer uses `Caution` as a synonym for preseason uncertainty. Preseason itself is not a conflict signal. Its 48 rows now contain 31 Watchlist and 17 No Play labels; the 16 displayed headlines contain 15 Watchlist and 1 No Play. There are no Caution, Lean, or Best Angle labels and no actionable board-count change.

## Price-history finding

The 0/16 figure is real provider-native opening coverage, not a count of current prices. BALLDONTLIE supplies complete paired current FanDuel prices for all 16 games. A single authenticated, game-scoped request to its NFL opening-odds endpoint returned HTTP 200 with zero rows for those same 16 game IDs. The official documentation describes opening odds as available where covered and limits odds coverage to the most recently completed and ongoing seasons where available; an existing endpoint does not guarantee a row for every preseason game.

The preview now keeps the two concepts explicit:

- `Provider-native openers: 0/16`
- `OddSphere first-observed trails: 16/16 (2+ snapshots/game)`

The stored observations are accepted only from checksum-named packages whose full file hash, release prefix, season, product week, provider week, and exact game-ID set match the active slate. The first stored current price is labeled `First observed`, never `Opening`. The current Week 2 snapshots prove capture continuity but happened to contain no price change during the observed interval.

A bounded two-request SharpAPI audit returned current NFL prices on a truncated first page and zero split rows. It did not establish provider-native opening history and was not integrated. Member preview reads continue to make zero provider calls.

## Actionable-grade rejection

A generic, predetermined ladder was tested against the frozen 2025 holdout predictions:

- Best Angle: probability at least 60% and model-minus-market edge at least 5 percentage points
- Lean: probability at least 55% and edge at least 3 points
- Watchlist: probability at least 52% and edge at least 1 point

It produced 55 actionables and lost 5.16 units in Weeks 1–9, then produced 75 actionables and lost 18.80 units in the untouched Weeks 10+ evaluation window. Relaxing the display threshold would therefore create more attractive labels while making the betting evidence worse. The model remains a non-actionable rehearsal until a promotion rule passes the frozen calibration/evaluation contract.

## Cost and tracking boundary

This audit used one bounded BALLDONTLIE opening-odds request and two bounded SharpAPI requests. They were diagnostics only and add no request path to the local reader. Preseason remains permanently excluded from official results and the pre-existing NFL lifetime record. A future regular-season launch still requires locked pre-kickoff predictions, an explicit production release, and the normal shared writer lease.

## Verification

- `npx tsc --noEmit --pretty false`
- `npx tsx scripts/test-football-product-preview.ts`
- `npx tsx scripts/test-football-shadow-foundation.ts`
- `npx tsx scripts/test-football-model-research.ts`
- `npx tsx scripts/test-football-weekly-slate.ts`
- `npm run verify:model-change`
- focused ESLint on the changed NFL preview/runtime/test files
- browser QA of `/dev/football-preview?sport=nfl`

## Rollback

Restore `nfl_regular_pipeline_preseason_grade_policy_2026_08_20_r1`, remove stored first-observed history assembly from the preview fixture, and restore the previous all-market grade-filter count. No production state or historical result would need repair because this release is local-only and writes nothing.
