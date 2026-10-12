# CFB provider team identity predeclaration — 2026-10-12

## Defect and scope

The October 12 current-slate audit found that the canonical BALLDONTLIE team identity for
App State (`APP`, "App State Mountaineers") did not match SharpAPI's live
"Appalachian State" label. The same full-slate audit found current-week mismatches for
Nicholls/Nicholls State, Miami/Miami Florida, Sam Houston/Sam Houston State, Middle
Tennessee/Middle Tenn ST, and Massachusetts/UMass. Provider adapters currently duplicate
partial alias tables or accept broad prefixes, creating both missing-evidence risk and a
latent wrong-team risk for names such as Florida and Alabama.

This change is limited to CFB provider-to-scheduled-team identity resolution. It does not
change the frozen market-reader artifact, independent model coefficients, thresholds,
calibration, stake policy, lock timing, or stored locked payloads.

## Hypothesis

A single abbreviation-scoped identity resolver with explicit aliases and only globally
unique prefix completion will recover verified exact-game odds and split evidence that is
currently missed, while rejecting ambiguous cross-team labels. Recovered evidence may
legitimately change unlocked projections, probabilities, sides, and grades through the
already-approved professional market reader. Missing evidence remains neutral.

## Primary validation cohort and metrics

- Cohort: every game on the current 2026 CFB production evidence slate at the latest
  pre-change snapshot, with the same snapshot timestamp and credentials for both runs.
- Provider coverage: matched exact events and split rows before versus after, reported by
  game and source.
- Safety: zero provider event may match more than one scheduled game; explicit collision
  tests must reject Florida→Florida State, Alabama→Alabama State, and Miami FL→Miami Ohio.
- Board impact: before/after counts by market and grade, plus promotions, demotions, side
  changes, probability changes, projected-score changes, and newly completed tuples.
- Coherence: every output must preserve score/winner, Moneyline/Spread, and Total
  consistency under the existing production contract.
- Locked immutability: no existing locked prediction or member snapshot is rewritten.

## Acceptance gates

1. All confirmed current-slate provider aliases resolve to exactly the intended team.
2. The collision tests and all existing CFB provider, production, coherence, and lock tests
   pass.
3. Current-slate replay contains no duplicate-event claim and no unexplained team mismatch.
4. Any board change is traceable to newly recovered exact-game provider evidence and uses
   the existing market-reader path; no quota or manual grade override is permitted.
5. Actionable demotions must be reported together with actionable promotions and total
   board counts. A newly flatter board without corresponding evidence-backed benefit fails.
6. `npm run verify:model-change` and integration-safety verification pass from a clean,
   committed latest-main descendant before publication.

## Rollback

Rollback the October 12 provider-identity release family to the October 11 consensus-
authority family and its prior provider adapters. Historical locked rows continue to render
their stored payloads under either reader and are never migrated or reconstructed.

