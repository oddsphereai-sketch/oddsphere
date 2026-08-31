# NFL Player Props complete-board predeclaration

Date: 2026-08-31  
Starting production base: `eaaad39470f7da8c7abd78c8c596aaa33aa64612`

## Production defect

The natural Week 1 collector received 32 passing-yards quarterbacks from BALLDONTLIE but published only about seven. Two independent defects caused the gap:

1. SharpAPI returned `has_more=true` without `next_cursor` or `next_offset`; the bounded collector stopped after the first 200-row page even though the endpoint accepts offsets.
2. A complete, fresh, exact two-sided offer was removed from the member board whenever no second sportsbook posted the identical line. This hid the model projection and executable price instead of publishing a truthful non-actionable read.

## Frozen change before result inspection

- Keep the existing eight-page / 1,600-row SharpAPI ceiling and existing provider-call ceiling. When SharpAPI says `has_more=true` but omits both continuation fields, advance by the already-requested 200-row page size. Stop normally when `has_more` becomes false; retain the existing truncated-by-budget diagnostic if eight pages are exhausted.
- A complete, fresh exact offer with model features but no independent same-line sportsbook becomes a completed `No Play` row. Its target-book two-way no-vig probability may provide visible price context, but is explicitly labeled as awaiting independent confirmation.
- Missing independent confirmation can never create Watchlist, Lean, Best Angle, tracking, or stake eligibility. Genuine role/player-identity ambiguity remains Held; stale, incomplete, and missing-feature outcomes remain excluded.
- When a later page supplies an independent exact-line book, the existing frozen model, calibration, lane eligibility, economics, participation, and divergence rules decide the grade. No threshold, projection, probability model, market family, stake, lock, or tracking rule changes.

## Required impact report

Before publication, compare the current and candidate no-write boards on the same provider capture. Report total rows, games, players and passing-yards quarterbacks, every grade count, promotions/demotions, provider calls, pagination completeness, and any remaining truncation. The change may ship only through the existing leased writer and protected PR workflow.
