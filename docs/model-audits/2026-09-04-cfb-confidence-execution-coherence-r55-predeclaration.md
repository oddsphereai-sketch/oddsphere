# CFB confidence / execution coherence r55 predeclaration

Status: outcome-blind production hotfix declaration after the first two natural r54 writer cycles
failed closed. No CFB r54 payload was published by either failed cycle.

## Observed integration failure

Protected PR #374 intentionally made `Best Angle` and `Lean` confidence labels independent from
the economics of one displayed sportsbook quote. Its first eligible production writer cycles at
2026-09-04T20:09:48Z and 2026-09-04T20:24:48Z both stopped before append because the shared
football coherence validator retained the preceding assumption that every confidence-actionable
grade must also have positive exact-price EV. Game 458254 correctly produced a Moneyline Best
Angle with a `shop` execution status, -1.5907% exact-price EV, and a positive 1.3239pp no-vig
consensus gap. The stale assertion rejected that valid two-axis state.

## Frozen correction

The shared validator will accept an optional explicit `bet` or `shop` execution status. CFB will
pass the writer-owned status already stamped by its r54 confidence decision. An actionable `shop`
is valid only at negative exact-price EV and remains non-wagering. An actionable `bet` is valid only
at nonnegative exact-price EV and retains the existing positive consensus-gap requirement. A
missing execution status preserves the preceding NFL and legacy validator behavior byte-for-byte.

The correction changes no forecast, PMF, probability, side, confidence score, grade, quote, EV,
stake, lock, provider request, schedule, or tracking calculation. It only prevents a valid CFB
confidence/Shop combination from aborting the sole leased writer. The shared coherence validator
and CFB writer receive new release identifiers. MLB, MLB first inning, NFL decisions, and every
other sport are compatibility-only.

## Acceptance and rollback

Focused coherence and CFB writer tests must prove: the exact production failure case passes as
Shop; a Shop with nonnegative EV fails; a Bet with negative EV fails; legacy/NFL actionable
nonpositive-value behavior still fails; and stake remains unchanged. Full model-change verification,
TypeScript, build, latest-main integration safety, protected PR checks, and deployment must pass.
Live acceptance requires one successful natural CFB writer cycle, r54 decision/grade coherence,
the expected Bet/Shop board, no stake change, preserved locks, and a released
`prediction_pipeline:cfb` lease. Roll back the validator/writer release pair if any of those fail.
