# NFL Player Props qualified-reference cache persistence correction

Date: 2026-10-15  
Status: production correctness repair

## Incident

The first credential-backed cycle after the qualified-reference and member-evidence releases
collected 1,946 Pinnacle/NoVig observations, built 623 effective reference offers, published the
complete 1,194-row member board, and attached qualified evidence to 226 rows. The isolated durable
reference-cache write then failed because its `lab_response_snapshots` upsert omitted the table's
required `kind` column. The writer correctly reported
`NFL_PLAYER_PROPS_REFERENCE_OFFER_CACHE_FAILED` as critical health and did not hide the error.

## Correction

The same sole NFL player-props writer now supplies the established snapshot schema fields:
`kind=daily_edge`, `sport=nfl`, null `slate_date`, the cache release as `payload_version`, and exact
generated/update/expiry/stale timestamps. The qualified-offer payload, source restrictions,
completeness validation, 14-day retention, cache key, reader precedence, provider calls, model,
calibration, projection, probability, side, grade, threshold, stake, and cadence are unchanged.

The store release advances to
`nfl_player_props_reference_offer_store_2026_10_15_r3_snapshot_schema`; the sole writer advances to
`nfl_player_props_writer_2026_10_15_r54_reference_cache_persistence`. No locked member or tracking
row is read, reconstructed, or rewritten by the cache repair.

## Gates and rollback

A focused persistence test proves the exact database row contract, payload round trip, and explicit
database-error propagation. Publication additionally requires the NFL props production contract,
full model-change suite, TypeScript, current-main integration safety, protected PR checks, and a
credential-backed post-deploy cycle showing a nonempty Pinnacle/NoVig cache, null cache error, empty
critical health, one `prediction_pipeline:nfl` lease, stable member board, and unchanged legacy
locks. Roll back only future cache writes to r2 / writer r53 if those checks fail; stored locked
records remain immutable.
