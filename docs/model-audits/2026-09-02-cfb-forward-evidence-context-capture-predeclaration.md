# CFB forward contextual-evidence capture r1

Status: local source-review candidate only. This capture does not change a forecast, projection, side, probability, grade, stake, lock, writer cadence, lease, query, write count, member reader, or release registry entry.

## Frozen boundary

- Publication base: `bab6b6e4e2ce803d1c81c873339d64e4d31f3f24` (after the protected NFL and MLB capture and target-exclusion releases).
- One optional append-only field, `contextualEvidenceCapture`, is attached by the existing sole CFB writer only after its existing forecast, decision, and cross-market coherence work is complete.
- Capture release: `cfb_daily_edge_forward_context_capture_2026_09_02_r1`; schema: `cfbfec1`.
- The authoritative payload remains primary. Removing the optional field must reproduce it byte-for-JSON-byte. Capture construction failure omits only the optional field.
- The pre-market independent weekly PMF is preserved as the target-free prior. Its full joint PMF is hashed and summarized rather than copied; sampled artifacts measured roughly 86–101 KiB per game before this design, which would violate the approved compact bound.
- Operator ownership metadata is not loaded and is recorded as such; it is never inferred. Timestamped CFB injuries remain provider-unavailable, while the loaded quarterback and exact kickoff-weather states are retained compactly.

## Compact evidence contract

For each of Moneyline, Spread, and Total, retain at most eight complete canonical sportsbook families. Each family contains one earliest loaded same-book opening/history landmark and one current landmark with provider, source class, timestamp, age/freshness, line, and paired prices. The exact evaluated provider/sportsbook/line/price/timestamp carries a stable identity, and target-excluded family names and observed/retained/omitted counts remain explicit.

At most one real Playbook public record and one real SharpAPI record are retained per market; Circa is preferred over DraftKings when both are loaded. Missing records stay null. Team names and full quote objects are not copied into each landmark; canonical family codes and compact tuples are used. Quarterback, availability, and weather payloads are hashed, while the two expected quarterback identities/statuses and source timestamps needed for later context reconstruction remain explicit.

The independent and authoritative joint PMFs are represented by SHA-256, cell count, and mass. The authoritative decimal expected and representative scores, win probability, interval, exact-price downstream decisions, and coherence flags are captured without changing them.

Hard bounds are 8 KiB per market and 24 KiB additive JSON per game. A bound or serialization failure causes capture omission, not row failure. The focused stress test measures actual serialized additive bytes for a cap-saturated 87-game slate and reports hourly (inside 48 hours) and six-hour (outside 48 hours) daily growth under the existing cadence. Final measured values are recorded after the frozen test runs.

Measured cap-saturated serialization is 8,522 additive bytes per game, with a 1,947-byte largest market. The actual 87-game additive cycle is 741,813 bytes (0.707 MiB). At the existing natural cadence that is 16.979 MiB/day during the hourly 48-hour window and 2.830 MiB/day at the six-hour cadence. Opening and T-60 captures are one additional cycle each. This is below both hard bounds; even the full cap-saturated peak adds about 34 MiB over the two-day hourly horizon, so the frozen compact schema was not widened or reduced after observation.

## Required proof before source review

- Actual 87-game serialized additive byte total at all family/provenance caps.
- Strip equality, locked-input immutability, missing-evidence neutrality, evaluated-family exclusion, observed/retained/omitted identity, PMF/score/side coherence, and failure-isolated omission.
- Static proof that the helper adds no provider/query/write path, plus existing CFB writer/model/integration gates from a clean commit.
- No push or pull request before root source review.
