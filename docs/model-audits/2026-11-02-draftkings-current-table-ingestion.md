# DraftKings current-table ingestion repair

Starting base: `6d8a4439c47f4bd100b88167c6a59c0fbb582373`.
Branch: `codex/cbb-draftkings-fallback-source-repair-20261102`.

The owner requested repair of missing CBB public/named split data. After the
public-source matching and scheduling repairs, all 213 public panels on 71
unlocked games were present and fresh. The licensed named-book feed remained
partial. Its existing free DraftKings fallback returned zero parsed CBB games.
An independent browser check showed actual games and complete market data on
the same source page, so that empty fallback was an ingestion defect.

One saved raw page contained ten `tb-se` game blocks. The source now prefixes
dates with weekdays, places one Selection/Odds/Handle/Bets header per game,
labels the individual market groups separately, and uses percentage cells
without the old `flex-1` class. The old parser required numeric-first dates,
repeated market headers and that CSS class. It discarded every game.

Parse each actual `tb-sm` market group using its own immediately preceding
explicit market label. Accept the observed weekday date format and both old
and new percentage-cell markup. Require exactly two percentage axes for each
side and preserve the existing complete opposing percentage checks. Unknown
groups cannot inherit a prior market label; missing dates remain rejected.
Existing sport/team/date/neutral-site and lock guards are not loosened.

Advance the shared durable source to R4, include that identifier in its cache
key, and preserve stored R3/R2 fallback payloads without renewing their source
clocks. Expose the existing cached/durable source refresh separately from the
combined Owls refresh, plus its stored-only reader, so the CBB source collector
and sole writer can reuse it without a new Owls request or a member-read poll.
No score, probability, pick, grade, stake or locked field is changed here.

The saved current-page regression parses ten games where the old parser
parsed zero. A bounded read-only run of the existing page collector recovered
50 games and 142 market panels, including Florida Gulf Coast–UCF and Kent
State–Louisiana Tech, with original source-side money/ticket values retained.
No production writer was invoked by these source checks. The actual source
does not publish every game/market, so this is not a full-coverage assertion.

Require legacy and captured-current parser/fallback tests, CBB split identity
and lock tests, shared source and neutral-tie regressions, full model safety,
build/TypeScript and latest-main protected PR checks. CBB scheduled-source and
reader/sole-writer integration is owned by the coordinating CBB chat and must
preserve all earlier source/display repairs and locked records. Production
source and member-panel recovery must be verified after those changes deploy.
