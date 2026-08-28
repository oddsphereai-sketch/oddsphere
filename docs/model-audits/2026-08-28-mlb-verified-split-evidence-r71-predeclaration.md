# MLB verified split evidence r71 predeclaration

Date: 2026-08-28
Mode: shadow candidate; no production behavior activated by this document.

## Incident

The current MLB slate contains fresh SharpAPI/Circa split rows with exact
100% tickets and 100% money on one side and exact 0%/0% on the other. The
provider payload and every persisted copy lack ticket counts, handle sample
sizes, or another sample-size field capable of verifying those endpoints.
Current completeness scoring rewards the perfect complement and can label the
rows complete, show them to members, and use them as grade context.

## Frozen candidate rule

For MLB public-split evidence only, an exact 0% or 100% ticket or money share
is unavailable unless the same provider observation carries a verifiable
sample count. Current SharpAPI/Circa and Playbook observation schemas do not
carry such counts, so exact endpoints fail closed field by field. A valid
non-endpoint tickets field remains available when only money is an endpoint,
and vice versa. The candidate never synthesizes a replacement percentage,
never complements the opposite side, and never mixes providers into one row.

The rule must cover future canonical observations, SharpAPI signal mapping,
last-known-good carry-forward, the provider-separated observation mirror,
unlocked grade inputs, lock snapshots, and both source-aware and legacy reader
surfaces. Existing locked picks, exact prices, lines, probabilities, actions,
stakes, tracking rows, and settlement state remain immutable.

## Activation gates

Before activation:

1. Unit tests must prove valid non-extreme evidence is unchanged; fully
   saturated pairs are unavailable; and partial valid fields remain honest.
2. A SELECT-only current-slate replay must report exact before/after grade
   counts, promotions, demotions, and affected rule identifiers.
3. No new promotion rule is authorized. If removing invalid evidence demotes
   an actionable pick, the demotion must be reported explicitly and reviewed
   as a data-integrity consequence rather than hidden by replacement data.
4. Current odds, lines, starters, model features, and reader freshness must be
   audited independently so this fix does not mask a second incident.
5. Focused tests, `npm run verify:model-change`, TypeScript, webpack build,
   integration safety, protected PR checks, natural-cycle confirmation, and
   signed-in live QA must pass.

Rollback is the active r70/v58/v48/v22 release and the pre-r71 shared member
presentation behavior.
