# Cross-sport Market Brain rollout predeclaration

Status: **OPEN — scope frozen; production influence remains prohibited**

Registry release: `market_brain_product_registry_2026_10_27_r1_complete_active_product_scope`

## Objective

Build one shared evidence, chronology, provenance, evaluation, and consequence framework while
requiring an independently implemented and qualified adapter for every active Oddsphere prediction
product. The shared framework is not permission to transfer NFL parameters, thresholds, evidence
authority, or validation to another sport.

## Complete active scope

The executable registry covers NFL, CFB, NBA, WNBA, MLB, NHL, Premier League, Champions League,
NFL Player Props, NBA Player Props, and MLB Player Props. Their current champion releases remain
the exact identifiers in the corresponding sections of `docs/current-model-releases.md`; this
predeclaration changes none of them.

CBB is separately registered as prelaunch and unqualified. It cannot become active merely by
sharing basketball vocabulary or NBA infrastructure; it requires its own writer, lease, source
roster, independent model, adapter, chronology, settlement, and untouched qualification.

Every adapter must declare and prove:

1. its independent model and market-free input lineage;
2. its sport/competition/prop-specific market geometry and settlement rules;
3. a versioned expected feed and participant roster, exact identity, availability time, and replay
   boundary for every consumed source;
4. a complete target-family-excluded chronological evidence sequence, including failed and missed
   expected attempts;
5. an interaction-rich learned reader that jointly interprets the available price, number, source,
   cross-market, split, news/availability, and independent-prior sequence without signal-count
   quotas or fixed sportsbook weights;
6. one coherent posterior distribution and a quote-menu consequence layer capable of confirm,
   recenter, flip, fade-market, retain, and stand-down;
7. chronological train/selection/confirmation/prospective evidence, calibration, clustered
   uncertainty, ablations, exact incumbent corrections and harms, promotion/demotion counts, board
   impact, cost, and failure behavior;
8. its existing authoritative writer and sport-scoped `prediction_pipeline` lease. No adapter may
   create a parallel prediction writer.

## Writer and lease boundary

NFL Daily Edge and NFL Player Props retain `prediction_pipeline:nfl`; CFB retains
`prediction_pipeline:cfb`; NBA Daily Edge and NBA Player Props retain `prediction_pipeline:nba`;
WNBA retains `prediction_pipeline:wnba`; MLB Daily Edge and MLB Player Props retain
`prediction_pipeline:mlb`; NHL retains `prediction_pipeline:nhl`; EPL and UCL retain the shared
`prediction_pipeline:soccer` lease. The exact current writers and release identifiers remain those
recorded in `docs/current-model-releases.md`.

## Missing-data rule

An expected source that is absent because of request cadence, pagination, parser coverage, identity,
storage, replay, or writer failure is a repair defect and must remain observable as such. Only a
source or field that the provider genuinely does not supply may be represented as a provider blind
spot. Neither case may be zero-filled, inferred, or treated as confirming evidence. A reader may
continue from the remaining genuine evidence with calibrated uncertainty; missing one modality is
not a universal veto and is never a substitute for a market interpretation.

## Activation boundary

All active and prelaunch registry rows have `productionInfluenceAllowed=false`. NFL is research-executable but
not predictively qualified; the other adapters are not started. Each product must advance through
its own versioned capture, replay, reader, consequence, evaluation, and qualification releases.
Production activation requires the model-change protocol, current-main integration safety,
protected PR checks, a balanced same-board impact report, immutable locked-record precedence, one
authoritative writer/lease, and post-deploy live proof. No all-sport flag or shared-core completion
may mark an individual adapter production-eligible.
