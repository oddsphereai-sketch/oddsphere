# CFB directional probability normalization r73

## Predeclaration

- Scope: the sole CFB forward-evidence writer's internal market-outlook serialization.
- Incident: one future game had a valid nearly normalized PMF whose integer-line push and
  finite-precision accumulation left both directional Total values infinitesimally below 0.5.
  The strict outlook validator rejected the game, preventing a complete current-release member
  snapshot even though the other current-release evidence rows were successfully appended.
- Intended behavior: normalize a binary directional pair only when both values are below 0.5.
  Preserve every ordinary pair unchanged. Keep all broader structural, identity, probability,
  pricing, coherence, provider-budget, and publication failures fail-closed.
- Unchanged: score model, PMF construction, decision probabilities, selected sides, prices,
  grades, actions, stakes, promotion/demotion rules, evidence/member/snapshot/tracking releases,
  cron cadence, `prediction_pipeline:cfb` lease, member copy, labels, and layout.
- Release: sole writer r73. Rollback to writer r72 without rewriting immutable evidence.

## Result

- The focused CFB production suite passes, including a regression with a two-outcome PMF whose
  total mass is `0.999999999998`; Spread and Total outlook construction no longer aborts.
- Live-provider zero-write proof: 106 games, 100 proposed payloads, 168 evaluated markets, zero
  capture failures, zero writes, and a 60-call maximum accounting total.
- Because already-valid pairs are returned unchanged, same-input sides, probabilities, prices,
  grades, actions, stakes, board counts, promotions, and demotions are unchanged outside the
  previously unpublishable rounding boundary.
