# Daily Edge cushion and football actionability result — 2026-10-13

## Candidate result

The candidate described in `2026-10-13-daily-edge-cushion-actionability-predeclaration.md` passed its publication gates locally.

- CFB current-board replay: 99 games / 297 markets; visible actionables 91 to 55, while executable actionables remain 55 to 55 because all 36 changed labels were already `Shop / no_bet`. Best Angle / Lean / Watchlist / No Play move 18 / 73 / 58 / 148 to 16 / 39 / 94 / 148. Negative-EV actionable labels move 36 to zero. No side, probability, price, score, or No Play changes.
- NFL current-board replay: 14 games / 42 markets; Best Angle / Lean move 22 / 3 to 20 / 5. Total actionables remain 25. Baltimore -225 and Buffalo -275 remain positive-value Moneyline Leans. No side, probability, price, score, or No Play changes.
- Missing-data behavior remains neutral rather than automatically punitive. Current actionable rows still include games with unavailable injury reports or missing split observations. The candidate acts only on a complete exact-price economic tuple.
- CFB preceding r49/r27/r37 payloads pass explicit immutable-reader coverage. NFL's live preceding r32 snapshot was read successfully through the transition key after the candidate decision release was loaded.

## Verification

- `npm run verify:model-change`: passed, including all MLB, WNBA, EPL, NFL, NHL, CFB, UCL, tracking, lock, and reader suites.
- Focused CFB market-reader and production tests: passed.
- Focused NFL actionable-grade and compact-snapshot tests: passed.
- `NODE_OPTIONS=--max-old-space-size=8192 npx tsc --noEmit`: passed.
- Focused ESLint: no new errors; only pre-existing unused-function warnings in two touched CFB modules.

## Rollback

For future unlocked decisions, return NFL decision / grade to r32 and CFB decision / grade / market reader to r49 / r27 / r37. Do not rewrite, migrate, suppress, or reinterpret any already locked payload. The transition readers remain safe to retain after rollback.

## Remaining sport-specific work

NHL's negative-EV actionable Total cohort requires its own chronological replay and paired promotion rule before publication. MLB v37, WNBA v1.7, and EPL r19/v25 do not yet have enough release-pure settled volume for a result-driven production change. UCL's release-pure query returned no settled rows and requires a tracking-boundary audit rather than a model adjustment.
