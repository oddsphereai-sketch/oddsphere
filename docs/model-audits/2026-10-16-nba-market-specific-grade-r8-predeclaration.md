# NBA market-specific grade r8 — post-diagnostic predeclaration

## Status and honesty boundary

The generic r7 grid failed because it could not validate Spread or Total actionability without either
flattening the board or retaining losing tiers. The subsequent frozen loss ledger identified the exact
cohorts below. Both 2024-25 and 2025-26 outcomes were visible during that diagnosis. This is therefore a
post-diagnostic replication across two complete seasons, not a pristine holdout and not permission to
claim guaranteed future hit rates. The rules below are frozen before runtime implementation and before
the same-input 2026-27 board replay.

No score, side, categorical reader correction, writer, lease, lock, stake, or stored payload changes in
this release. The candidate changes only future unlocked grades and grade confidence. Historical locks
retain exact payload precedence.

## Shared gates

An actionable grade still requires a selected exact price, a coherent two-sided target-excluded market
reference, high data quality, known injury-source status for both teams, and positive expected value at
the candidate tier's conservative calibrated probability. Missing evidence fails closed to `No Market`
or `Watch`. Exact-price EV may demote a historical proxy qualifier; it may never promote a row that does
not qualify its market-specific lane.

Public split divergence remains descriptive. It does not promote, demote, or flip a grade because
authentic historical source-qualified split chronology is unavailable.

## Frozen market policies

### Moneyline — retain and validate the incumbent

The current Moneyline rule is unchanged:

- actionable at model probability at least 55% with model-minus-closing-no-vig edge at least -2 points;
- Best Angle at model probability at least 62% and positive edge at least 4 points;
- otherwise Lean when actionable.

The audit must report its two-season accuracy, fair-price economics, chronological halves, and tier
ordering. No Moneyline promotion or demotion is authorized by r8.

### Spread — independent moderate-edge plus categorical-correction lanes

- `Best Angle`, calibrated grade confidence 60%:
  - no qualified Spread read and absolute independent residual at least 2.5 but under 3.5 points; or
  - a qualified Spread read actually corrected the independent side and its median supporting same-book
    movement is at least 4 points.
- `Lean`, calibrated grade confidence 56%:
  - a qualified Spread read actually corrected the independent side and its median supporting same-book
    movement is at least 3 but under 4 points.
- all other complete Spread rows are `Watch` unless an existing stronger fail-closed state requires
  `Caution` or `No Market`.

The historical proxy substitutes consensus opening-to-close movement for the production reader's
stricter two-persistent-trail, target-book-excluded contract. Production cannot infer qualification from
consensus alone.

### Total — corrected-disagreement plus low-residual Over lanes

- `Best Angle`, calibrated grade confidence 60%:
  - a qualified Total read actually corrected the independent side; and
  - the preserved absolute independent residual is at least 5 but under 9 points.
- `Lean`, calibrated grade confidence 54%:
  - a qualified Total correction with a preserved absolute independent residual of at least 9 points; or
  - no qualified Total read, the independent side is Over, and its absolute residual is at least 1 but
    under 2 points.
- all other complete Total rows are `Watch` unless an existing stronger fail-closed state requires
  `Caution` or `No Market`.

The low-residual Over rule is a grade lane only. It does not move the total, flip an Under, or use a
market blend.

## Required historical and current-board gates

For each candidate Spread/Total tier and all actionables combined:

1. selection and replication accuracy must exceed flat -110 break-even;
2. selection and replication flat -110 units must be positive;
3. Best Angle must exceed Lean in both seasons;
4. every full-season actionable cohort and combined chronological half must remain at least 52.38%;
5. the two-season calibrated grade probability must improve or preserve confirmation Brier and log loss
   relative to the raw normal-residual probability on that exact cohort;
6. at least one tested promotion and one tested demotion must exist in each changed market, with their
   outcomes and full board-count impact reported;
7. the exact current-board replay must report old/new counts by market and grade, every promotion and
   demotion, exact price EV, reader status, selected price, and net actionables. No nonpositive-EV row may
   be promoted.

Publication additionally requires grade/release bumps, focused boundary and locked-reader tests,
`npm run verify:model-change`, TypeScript, latest-main integration safety, protected PR checks, and live
release/evidence/coherence/lock proof. The release remains provisional until 2026-27 exact-price locked
results independently validate it.

