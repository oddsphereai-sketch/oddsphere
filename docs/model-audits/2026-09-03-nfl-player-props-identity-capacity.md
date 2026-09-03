# NFL Player Props Week 1 identity-capacity correction

## Production incident

The natural `nfl_forward_evidence` cycles at 2026-09-03 10:51Z, 11:06Z, and 11:21Z completed partial because BALLDONTLIE's combined current and opening NFL player-prop catalogs contained 306 distinct player IDs. The collector's aggregate ceiling was 300, unchanged from the August 20 preseason launch. The failure occurred before player enrichment, and the production writer correctly retained the coherent 10:36Z last-known-good snapshot rather than publishing a partial board.

The retained Week 1 board contained 1,184 decisions, 282 distinct BALLDONTLIE player identities and 20 SharpAPI-only evaluated identities. All 32 expected team abbreviations were represented. Selected identity breadth was 4–21 players per team and 12–41 per game. The six-ID increase beyond the old ceiling is consistent with ordinary Week 1 market maturation; there was no cross-sport team identity or single-event explosion in the retained evidence.

## Correction

The aggregate circuit remains bounded and fail-closed at 400 identities. A second independent guard fails closed when any one provider game contains more than 64 distinct player IDs. Exact provider player IDs remain deduplicated in first-observed order and are enriched in deterministic batches of 100. This adds at most one BALLDONTLIE identity request to the declared collection budget, increasing it from 48 to 49.

No identity is inferred. Existing player lookup, roster/team/opponent matching, role ambiguity Holds, schedule reconciliation, Sharp event reconciliation, exact market pairing, forecast, probability, projection, grade, stake, lock, tracking, settlement, snapshot, lease, and cron behavior are unchanged. The provider-observation and writer releases are bumped because the accepted collection envelope changes; model and decision releases remain unchanged because scoring and selection do not.

## Acceptance

- A 306-player, multi-game fixture is accepted with exact order and deduplication.
- 401 aggregate identities fail before player lookup.
- 65 identities within one game fail before player lookup.
- The maximum declared provider-call budget is 49.
- Existing model-change, production-contract, type, lint, build, and integration-safety gates must pass from fresh protected main before publication.

The first natural post-deployment cycle must publish the current writer/provider releases, remain within the declared call budget, retain all locked decisions, show no role/identity mismatch increase attributable to the correction, and replace the stale last-known-good snapshot. A failure outside these boundaries rolls back the provider and writer releases while preserving every prior snapshot and tracking row.
