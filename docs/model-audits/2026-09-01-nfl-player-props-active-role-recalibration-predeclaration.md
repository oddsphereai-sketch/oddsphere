# NFL Player Props active-role recalibration predeclaration

Date: 2026-09-01
Base: `b6585fac90a30e31b2f484e09891df5a92216e8b`

## Incident and invariant

The live Week 1 board contains implausibly low passing, rushing, and receiving projections and an
overwhelming Under skew. The frozen runtime states were built from weekly roster rows, and the
rolling player features count non-participation roster weeks as statistical zeroes. The production
runtime also does not enforce the market-position and minimum-prior-role eligibility used during
training. This can turn an established starter's prior production into an artificial zero trend and
can score an offered market outside the fitted support.

The challenger changes player production/opportunity rolling features to use the player's prior
participating games only. Participation-history features continue to use every prior roster week.
Team and opponent features remain every completed team game. Runtime scoring must enforce the same
position, prior-participation, and role-average support as training. An unsupported offer remains
visible as No Play with explicit internal provenance; it cannot become actionable.

## Frozen chronology and comparison

- Rebuild 2016-2025 regular-season features from the checksum-recorded nflverse source cache.
- Training ends in 2022, architecture selection is 2023, calibration selection is 2024, and 2025
  remains untouched until all feature semantics and candidates are frozen.
- Recover exact 2025 provider opening lines and prices without outcomes in the request. Split them
  at 2025-11-01 into selection and later confirmation for price/side/grade qualification.
- Compare the incumbent and challenger for every supported market on projection MAE/bias,
  distribution calibration, Over/Under directional accuracy, exact-price return, market breadth,
  and first/second-period stability. Report each market separately; no aggregate result can qualify
  a failing market.
- A production lane may be enabled only if it is coherent on the later confirmation period and has
  sufficient exact-price observations. Passing/rushing lanes do not become actionable merely
  because the current board is flat. Every demotion must be paired with the tested promotion path
  and current-board counts.

## Scope and exclusions

Owned scope is limited to the NFL Player Props historical/current feature builders and contracts,
the chronological tournament/calibration/price-audit scripts, the versioned runtime artifact and
scorer, focused tests, this audit/result note, and the NFL Player Props paragraph in
`docs/current-model-releases.md`.

Excluded: NFL Daily Edge, CFB, MLB/WNBA/EPL, UI copy or grade vocabulary, tracking/settlement,
provider schedules, cron/lease ownership, database schema, stakes, and any second writer. Current
season completed-stat ingestion is a separate follow-up and cannot be hidden in this release.

## Owner-approved production amendment

After reviewing the frozen qualification result, the product owner explicitly authorized a
production cross-market grade and opening-line release rather than the predeclared receptions-only
lane. This is a narrow release exception, not a replacement for the repository's general
model-safety rules.

The amended decision contract applies the same grade vocabulary to both Over and Under across all
seven modeled volume/yardage markets. A row must still have a supported player role, a complete
exact target-book price, a target-excluded same-line benchmark, positive expected value and
probability edge, and a non-stale quote. The standard Lean thresholds remain 4% EV, 2 percentage
points of edge, 70% participation, and one independent book; Best Angle remains 8% EV, 3.5 points,
85%, and one independent book.

Same-book opening-to-current movement is used as bounded evidence, not as an independent pick
generator. A side-supporting line move permits thresholds of 3% EV / 1.5 points for Lean and 7% EV
/ 3 points for Best Angle. A flat-line price change counts only at 2.5 implied-probability points
or more. Movement against the selected side caps an otherwise positive decision at Watchlist.
Missing or immaterial movement is neutral. Book name, quote freshness, role, independent-market,
exact-price, and economics gates remain mandatory. No market quota, side quota, stake change, or
fabricated unavailable market is authorized; locked rows remain immutable and anytime touchdown
behavior remains unchanged.
