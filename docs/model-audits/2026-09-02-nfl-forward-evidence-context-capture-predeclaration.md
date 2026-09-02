# NFL forward contextual-evidence capture r1

Status: local source-review candidate only. This capture does not change a forecast, projection, side, probability, grade, stake, lock, writer cadence, lease, query, write count, member reader, or release registry entry.

## Frozen boundary

- Publication base: `4f84cf57d8e664ac78897f1fcd7820bc639efdf4` (protected main after the accepted #329 natural cycle).
- One optional append-only field, `contextualEvidenceCapture`, is attached by the existing sole NFL writer only after its existing forecast, decision, cross-market coherence, and tracking-eligibility work is complete.
- Capture release: `nfl_daily_edge_forward_context_capture_2026_09_02_r1`; schema: `nflfec1`.
- The authoritative payload remains primary. Removing the optional field must reproduce it byte-for-JSON-byte. Capture construction failure omits only the optional field.
- Existing Week 1 discrete outcome artifacts are labeled target-free. A later-week fallback whose Total prior comes from the selected market is explicitly labeled unavailable as a fully target-free prior.
- Operator ownership metadata is not loaded and is recorded as such; it is never inferred.

## Compact evidence contract

For each of Moneyline, Spread, and Total, retain at most eight complete canonical sportsbook families. Each family contains one opening and one current landmark with timestamp, age/freshness, line, and paired prices. The exact evaluated sportsbook/line/price/timestamp carries a stable identity, and target-excluded family names and observed/retained/omitted counts remain explicit.

At most one real Playbook public record and one real SharpAPI/Circa record are retained per market. Missing records stay null. Team names and full market objects are not copied into each landmark; canonical family codes and compact tuples are used. Roster, injury, and weather payloads are hashed, while the two expected quarterback identities/statuses and source timestamps needed for later context reconstruction remain explicit.

The full incumbent marginal PMFs are represented by SHA-256, support count, mass, mean, and standard deviation. The authoritative decimal expected and representative scores, win probabilities, exact-price downstream decisions, and coherence flags are captured without changing them.

Hard bounds are 8 KiB per market and 24 KiB additive JSON per game. A bound or serialization failure causes capture omission, not row failure. The focused stress test measures actual serialized additive bytes for a cap-saturated 16-game slate and reports hourly (inside 48 hours) and six-hour (outside 48 hours) daily growth under the existing cadence. Final measured values are recorded after the frozen test runs.

Measured cap-saturated serialization is 8,642 additive bytes per game, with a 1,949-byte largest market. The actual 16-game additive cycle is 138,316 bytes (0.132 MiB). At the existing natural cadence that is 3.166 MiB/day during the hourly 48-hour window and 0.528 MiB/day at the six-hour cadence. Opening and T-60 captures are one additional cycle each. This is below both hard bounds and is not operationally excessive, so the frozen compact schema was not widened or reduced after observation.

## Required proof before source review

- Actual 16-game serialized additive byte total at all family/provenance caps.
- Strip equality, locked-input immutability, missing-evidence neutrality, evaluated-family exclusion, observed/retained/omitted identity, PMF/score/side coherence, and failure-isolated omission.
- Static proof that the helper adds no provider/query/write path, plus existing NFL writer/model/integration gates from a clean commit.
- No push or pull request before root source review.
