# EPL professional Match Result tiering v25 — result

Date: 2026-10-10

## Decision

The v25 candidate passes the EPL-specific professional market-reader audit for
future unlocked rows. It closes the only inconsistent actionable-price path:
Match Result now uses exact offered-price tier arbitration while preserving the
accuracy-first regulation-result forecast.

This branch is implementation-ready but not yet published. A clean commit,
latest-main integration-safety proof, protected pull request, merge, and live
release/board/lock verification remain required.

## What changes

- A nonpositive-exact-EV Match Result that otherwise clears Best Angle becomes
  Lean.
- A nonpositive-exact-EV Match Result that otherwise clears Lean becomes
  Watchlist.
- Positive-exact-EV Best Angle and Lean paths remain unchanged.
- No side, probability, price, expected goals, likely score, representative
  score, Double Chance, Total, BTTS, stake, writer, lease, or lock changes.

The release is
`epl_grade_policy_2026_10_10_v25_exact_match_result_price_tiering`; model r19
remains authoritative because prediction and projection behavior are unchanged.

## Evidence

The exact 30-game opened forward replay changes Match Result actionables from
five at 4-1/+0.736u to two at 2-0/+1.209u. The other three rows remain visible
as Watchlist. This is retrospective diagnostic evidence, not a promised future
rate.

The current ten-game/40-market board retains all seven actionables. Arsenal at
home to Leeds changes Best Angle to Lean because 68.0% at -229 is negative
2.25% exact model EV. The complete same-book three-way trail also moved 1.26pp
against Arsenal, but movement is context rather than a separately fitted veto.
No current side, probability, quote, or projection changes.

## Rejected market shortcuts

- SharpAPI returned zero authentic EPL split slices across 122 retained
  captures per market. Missing splits remain neutral.
- The settled target-excluded same-book movement challenger did not improve
  the required Total/BTTS proper-score gates and remains audit-only.
- The best Match Result market-flip rule made one selection-block correction
  and zero harms but never activated in the untouched ten-game block. It is not
  authorized for production.
- Cross-book first prices remain context and are never called same-book
  movement. Playbook remains excluded because its EPL aliases returned NFL
  rows.

## Verification

- `scripts/test-epl-shadow-model.ts`: passed.
- `scripts/test-epl-coherent-market-outcome.ts`: passed.
- `scripts/test-epl-locked-member-snapshot.ts`: passed.
- `scripts/operator/audit-epl-professional-market-reader.ts`: exact settled and
  current-board replay passed with zero writes.
- The complete `verify:model-change` command chain passed, including NFL, CFB,
  MLB, NHL, WNBA, EPL, UCL, props, tracking, lock, and writer regressions.

Rollback restores v24 for future unlocked rows only. It must never rewrite,
suppress, or reinterpret any locked snapshot.
