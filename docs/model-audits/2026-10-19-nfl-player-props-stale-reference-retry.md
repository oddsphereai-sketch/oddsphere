# NFL Player Props stale qualified-reference retry — October 19, 2026

## Scope and authority

- Sport / market: NFL Player Props; qualified target-book-excluded Receptions evidence only.
- Authoritative path: the existing NFL forward-evidence cron invokes the sole player-props writer under `prediction_pipeline:nfl`.
- Preceding writer: `nfl_player_props_writer_2026_10_15_r56_independent_rushing_yards`.
- Candidate writer: `nfl_player_props_writer_2026_10_19_r57_stale_reference_retry`.
- Model, calibration, decision, runtime, board, member, tracking, settlement, lock, stake, and presentation releases are unchanged.
- Existing locked member and tracking rows retain exact stored precedence.

## Incident

The retained qualified-reference cache was last updated at `2026-10-19T05:06:09Z`. The ordinary hourly capture later failed, but the writer's reference-capture gate considered only cache existence, the first fifteen minutes of each UTC hour, and the final pre-lock window. A subsequent writer wake therefore reused the stale cache and correctly disabled source-aware Receptions, even though SharpAPI was again serving a valid Pinnacle catalog for the remaining Washington–San Francisco game.

This was not a team or game identity failure. A credential-backed raw probe at approximately `2026-10-19T13:33:53Z` produced:

- 98 Pinnacle observations.
- 49 complete Over/Under pairs.
- 49 exact offers matched to canonical game `1392308`.
- 98 of 98 rows matched that game's identity.
- Zero usable NoVig rows; the collector reported `SHARPAPI_PROPS_REFERENCE_CAPTURE_FAILED:novig` and `SHARPAPI_PROPS_REFERENCE_INCOMPLETE:novig`.

NoVig absence remains an explicit provider-source failure. It is not inferred, copied from Pinnacle, or relabeled.

## Repair

When the sole writer wakes, it now evaluates retained qualified-reference freshness with the same released quote-age policy used by the source-aware decision path. Missing or stale qualified evidence triggers the already-bounded Pinnacle/NoVig capture lane on that wake. Fresh retained evidence preserves the preceding hourly and final-pregame schedule.

The repair adds no endpoint, writer, timer, database loop, or lease. Existing per-cycle page and call ceilings remain unchanged.

## Exact no-write replay

Command class: `runNflPlayerPropsProductionWriter({ season: 2026, week: 6, apply: false })` with production credentials at `2026-10-19T13:37:46.514Z`.

- Main observations: 41,111.
- Exact main-board offers: 1,746.
- Reference observations: 98, all Pinnacle.
- Complete Pinnacle exact offers: 49.
- Effective qualified reference offers: 36.
- Source-aware reference availability: true.
- Member rows: 1,588.
- Provider/request maximum used by the replay: 44, below the declared 113-call incremental ceiling.
- The stale-reference-unavailable health finding disappeared; NoVig's source failure remained explicit.

Same-input source-aware effect against the incumbent fallback:

- Matched rows: 1,588.
- Projection changes: 16, all Receptions.
- Forecast-side changes: 0.
- Actionable promotions: 1.
- Actionable demotions: 0.
- Canonical actionables: 23 → 24.
- Every non-Receptions market: zero projection, side, promotion, or demotion changes.

The comparison against the previously stored live snapshot also contains ordinary offer-universe drift and is not used as the causal release comparison.

## Verification and rollback

Required focused checks:

- `scripts/test-nfl-player-props-production-contract.ts`
- `scripts/test-market-intelligence-v2-shadow-sync.ts` (cross-check that the separately repaired NBA split identity path remains intact)
- `npm run verify:model-change`
- current-main integration safety and protected PR checks

Rollback only the writer to r56 if stale-cache retries exceed the declared request ceiling, writer latency becomes unsafe, source-aware availability remains false despite fresh qualified rows, or any locked payload changes. Preserve all existing locked and captured evidence.
