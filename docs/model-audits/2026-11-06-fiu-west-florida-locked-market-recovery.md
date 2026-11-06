# FIU–West Florida locked market recovery

Starting production base: `9c9ba4db585044f5a0867dc6040fc1ac2ecf667c`.
Reader release: `cbb_member_reader_2026_11_06_r2_verified_market_recovery`.
Recovery artifact: `cbb_locked_market_recovery_2026_11_06_r1_west_florida_fiu`.

The owner reported that locked CBB game 10882715 (November 6, 2026, 22:00 UTC)
showed “Argonauts” instead of West Florida and had no lines or prices, and explicitly
asked to fix that locked card. This correction is limited to the verified identity
presentation and append-only historical context. It does not authorize retrospective
prediction, grade, stake, evidence or wager-price replacement.

BALLDONTLIE school 732 supplied `full_name: Argonauts`, `college: null`.
The existing verified membership/cross-division mapping identifies 732 as West Florida.
Owls had the event `ncaab:West Florida@FIU-20261106`; the institution-name join failed.
The original member snapshot locked at 21:09:27.509 UTC with missing market tuples.
Its recursively key-sorted full-payload SHA-256 remains:
`a0373e093d6bef2377c690463cdbec10aa1a44bdbf2b25c666363864bb8e8df8`.

Six bounded, read-only Owls history calls recovered Pinnacle's two sides for moneyline,
spread and total. No AI call, model refresh, prediction write or lock rewrite was used.
Raw responses are preserved under `scripts/fixtures/cbb-fiu-recovery-20261106/`;
the artifact records their SHA-256, event, book and retrieval clocks. The provider
reported over 237,000 requests remaining after this bounded recovery.

Only the latest paired, same-native-timestamp, pregame observations at or before the
intended 21:00 UTC cutoff were selected:

| Market | Native UTC observation | Historical pair |
| --- | --- | --- |
| Moneyline | 16:39:12.254 | FIU −1989 / West Florida +1058 |
| Spread | 19:40:13.039 | FIU −16.5 (−111) / West Florida +16.5 (−105) |
| Total | 19:40:13.039 | 162.5, Over −104 / Under −116 |

Retrieval occurred at 22:11 UTC, after the lock. These prices are therefore labelled
recovered historical context, never evidence known to the original decision. The
original frozen markets, prices, probabilities, projections, predictions, grades,
stakes and evidence take precedence and remain unchanged. Exact game IDs, provider
school IDs, start, lock timestamp, original name and full payload hash must all match
before the reader can append the context. A changed or unrelated record gets no
correction. Re-reading an already corrected cached DTO still starts from the exact
original stored lock. Official results continue through the existing result-only path.

The UI displays both sides of the recovered market separately from the locked wager,
with its native observation time and after-lock retrieval disclosure. The away identity
reads West Florida Argonauts. Client code imports only the DTO, not the server crypto
or artifact module. No database migration, new writer, recurring request, lease,
model/calibration/grade/publisher change, or private model upload is introduced.
Board impact: zero promotions, zero demotions, no score/probability/stake changes.
Other games are unaffected by the full-record hash binding.

Validation: focused recovery test independently hashes all six receipts and recomputes
the paired cutoff selection; rejects a changed original payload; renders all three
markets; verifies locked writer zero writes, exact reader precedence and repeat reads.
The existing member-store and fixture-clock suites pass. Production webpack build
passes. Independent read-only review found no blocker and independently reran the
focused receipt/immutability test successfully. Publication additionally requires the clean current-main integration guard
and protected PR checks. Post-deployment verification must compare the original
stored payload hash and inspect the production recovered DTO.

The future source-identity correction is separate: exact school 732 institutional
normalization and FIU matching across collection, odds/splits, tracking and unlocked
publication. It is checkpointed independently and must integrate the concurrent
Daily Edge grading release before publication. This reader-only repair does not
claim that future ingestion is repaired yet.
