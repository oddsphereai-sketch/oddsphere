# UCL bounded partial-market recovery r9

Date: 2026-10-14

## Scope

- Competition: UEFA Champions League only.
- Markets: Match Result, Double Chance, Total 2.5, and Both Teams To Score.
- Writer: the existing `ucl-daily-refresh` and `ucl-pregame-lock` routes.
- Lease: the existing shared `prediction_pipeline:soccer` lease.
- Starting production commit: `36a06ffb6de977d3a3dd5b48fbe09724f76b867f`.
- Starting model release: `ucl_goals_coherent_2026_10_06_r7_target_excluded_opening_market_score`.
- Starting calibration release: `ucl_grade_policy_2026_10_14_r8_full_current_market_coverage`.

## Production incident

The r8 identity repair proved the provider exposed complete current markets for all nine fixtures,
including 18 PSG–Manchester City BTTS outcome rows. Its first production refresh nevertheless
captured only 31 of 36 selected quotes and 79 of 90 required outcomes. Later independent read-only
builds fluctuated between 34 and 36 selected quotes while the raw event catalog continued to expose
the same canonical events and markets.

The remaining defect was orchestration, not team identity or absent provider data. UCL explicitly
disabled the shared incomplete-fixture recovery pass while the shared adapter loaded three fixtures
at a time. A transient partial odds response therefore became a held market even though an immediate
independent request could return the complete pair or trio.

## Repair

- UCL loads one fixture at a time, limiting the market request fan-out to one fixture's four narrow
  market calls.
- After the first pass, only an incomplete fixture is loaded again.
- Every scheduled UCL fixture is eligible for that single recovery load; a complete first pass adds
  no calls.
- The upper bound is one additional four-market fixture load per UCL game.
- EPL retains its existing three-fixture concurrency and four-fixture recovery ceiling.

The immutable internal release identifiers advance to:

- `ucl_grade_policy_2026_10_14_r9_bounded_partial_market_recovery`
- `ucl_sharp_market_identity_2026_10_14_r2_bounded_partial_market_recovery`

## Model and product impact

This change does not alter the independent model, coherent PMF, market-reading formula, selected
side, probability, projected score, grade threshold, stake, member copy, label, or layout. On an
identical complete provider input, every market decision and grade remains unchanged, so promotions
and demotions are both zero. When the provider's first response is partial, the recovery pass can
restore the same valid market tuple that the first pass should have supplied; it never manufactures
a quote or changes a locked record.

Three independent credential-backed builds after the repair each returned the
same complete board:

- selected current quotes: `36/36`, `36/36`, `36/36`;
- required outcome prices: `90/90`, `90/90`, `90/90`;
- held markets: `0`, `0`, `0`;
- grade mix on every run: 4 Best Angles, 13 Leans, 8 Watchlists, 11 No Plays;
- incoherent games: `0`; nonpositive-EV actionables: `0`.

The repeatable identical grade mix confirms that the repair restores the same
complete-input decisions rather than manufacturing promotions or flattening
the board. Relative to an identical complete input, promotions and demotions
remain zero.

## Required verification

- `npm run test:ucl-production`
- repeated credential-backed `scripts/operator/audit-ucl-readiness.ts` runs
- `npm run verify:model-change`
- latest-main integration safety and protected PR checks
- production deployment, authenticated UCL refresh, member snapshot, T-60 lock, and PSG–Manchester
  City BTTS verification

## Rollback

Restore the r8 calibration and r1 market-identity releases plus UCL's prior zero-recovery setting
for future unlocked rows only. Never rewrite an r8 or r9 locked payload. Roll back if request load
escapes the stated bound, EPL behavior changes, the board remains incomplete with complete provider
data, publication mixes releases, the shared lease overlaps, or any locked tuple changes.
