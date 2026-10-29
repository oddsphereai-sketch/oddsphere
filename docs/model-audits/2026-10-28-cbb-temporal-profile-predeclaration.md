# CBB private temporal-profile experiment r4

Continue r3 without production authority. Baseline is r3's selected Huber
shot-profile head, fixed penalty 10. Test only current-rating recency constants
30, 60, 120 days versus the existing 90; retain ridge 1, pace ridge 0.25,
prior carry 0.8 and all shot features. This tests whether evolving team strength
is being averaged over the wrong timescale, not another shooting-head grid.

Train residuals/uncertainty in 2023, select in 2024 using equal normalized
margin/Total MAE with both better, Brier no worse and winner loss at most 0.5
percentage points. Refit the selected candidate on 2023–24 before opening the
already-inspected 2025 diagnostic. No 2025 outcome chooses configuration.
Retain all attempted results. Do not change preview/runtime automatically.

Scope is CBB independent score, winner and probability audit only. No market
reader authority, production writes, grades, stakes, locks, cron or UI changes.
