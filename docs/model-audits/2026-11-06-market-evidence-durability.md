# Collection chronology and bounded observation writes

Owner scope: preserve odds, money/ticket percentages and their actual chronology
throughout the day for future research, while keeping site memory bounded.
Starting main: `b77b1ed087765f7f9b5ce9ec323c0517d00b5408`.
Candidate only until protected merge and normal live collector verification.

## Demonstrated corrections

The active V2 routine collector used its run-start clock as `fetched_at` for
Owls prices/splits and Playbook broker reads; only the NBA prelock path used
response completion. A response arriving during the job could therefore appear
available before it actually arrived. Capture R29 now records actual completed
response/read availability for future observations, separately from untouched
provider `last_update`/`as_of` clocks. Small run telemetry records request/read
start and completion. Playbook broker completion can involve a cache and is not
proof of a provider-native observation time. Historical audit-only SharpAPI
adapters and old records remain exact.

V2 writes formerly serialized an entire slate into one PostgREST request.
`market_observation_write_batch_2026_11_06_r1_bounded_bytes` partitions both
prices and splits in original order into sequential requests of at most 240,000
UTF-8 JSON bytes and 500 rows. All observations, original hashes, native clocks,
nulls, conflict keys and `ignoreDuplicates` semantics stay exact. This bounds
individual write serialization, not the whole job's retained input arrays.
No new request to a provider, writer, schedule, prediction lease or poll is added.
The original T-60 budget is checked before every batch/retry; no new batch
starts after its deadline. Already acknowledged rows survive a later failure;
the failed tail is reported for ordinary idempotent recovery. An oversized single
row fails explicitly; it is never truncated to meet the ceiling.

Capture release:
`market_intelligence_v2_capture_2026_11_06_r29_response_clocks_bounded_writes`.
No forecasting coefficients, calibration, grade thresholds or stakes change in
this correction. Future availability-sensitive admission can correctly differ;
there is no historical retiming or automatic compensating play.

## Live read-only findings

`docs/audits/2026-11-06-market-evidence-storage.json` records the bounded seven-
sport audit: zero writes and provider calls. Latest normalized split captures
for CBB/NBA/NHL/CFB/NFL recover with verified part and full SHA-256 checksums.
All five archives are initialized. Hot rows and ordering metadata contain zero
events older than the three-day partition and zero undated rows. Compressed hot
feeds are approximately 0.15–0.57 MB each, versus 2.8–10.5 MB decoded. MLB and
WNBA are idle with October 29/November 1 legacy feeds; their first subsequent
normal capture must prove initialization before claiming seasonal live coverage.

The last 24 hours contain 288–297 captures per active sport and about 70.6 MB
of decoded original normalized capture JSON in total. This is not disk usage:
gzip parts, deduplicated indexed observations, WAL, indexes, backups and other
tables are separate. It is one seasonal day, not an annual growth forecast.

The latest 100 price and 100 split rows per sport contain no sampled provider
clock after local receipt. Owls samples have native clocks and hashes. Missing
canonical-lines price hashes do not mean original provider provenance exists;
the canonical table has no exact original provider row. Missing Playbook native
times remain unverified, rather than being filled with local receipt time.
Older hot observations also lack original local receipt times; do not invent
them from archive insertion time. These are explicit evidence limits.

## Durable storage and capacity contract

The already-live `current_split_observation_archive_v1` retains normalized
observation versions and compressed original capture receipts before display
trimming. Its append-only database guards reject UPDATE/DELETE/TRUNCATE.
Source hashes, array ordering, duplicates, unknown normalized fields and original
clocks survive recovery. Three-day hot partitioning changes loading, not
retention. Ordinary date-scoped readers avoid whole-history hydration; research
iteration uses keyset pages. See the November 5 history contract for exact
reader and failure behavior. This change does not introduce another archive.

Money evidence is handle/bet share, not actual dollars or a complete exchange
tape. Captures preserve what the configured feeds supplied at each poll;
unmapped raw provider fields and changes occurring entirely between polls are
not claimed. Native timestamps are not automatically verified movement times.

Years of retention require a separate disk budget from RAM. At the observed
one-day decoded receipt volume, a constant-rate illustration is 25.8 GB/year,
77.3 GB/three years and 128.9 GB/five years *before* compression and unrelated
relations; neither savings nor steady seasonal volume is guaranteed. Existing
November 5 measurements already show 12.7 GB database disk, including about
3.16 GB split table+indexes and 1.92 GB price table+indexes. This change cannot
promise those growing tables remain inside a fixed hosting allowance forever.

Before a storage-tier migration, measure actual relation/index and compressed
receipt growth over representative weeks; size headroom for the largest season,
WAL and backups. The safe next tier is checksum-verified compressed immutable
objects with a queryable event/date/book/hash manifest and bounded cold reads.
Require byte-for-byte restore and point-in-time query parity before moving any
hot/queryable evidence; keep locked snapshots authoritative. No TTL, retention
cut, deletion or unverified object offload is enabled here. The service currently
has database archives, not a claimed independent disaster-recovery export.

## Verification and rollback

The new offline test passes 3,602 exact observations through 17 requests, largest
239,993 bytes, one in flight. It proves complete row/order/hash/native-clock and
null preservation, Unicode byte accounting, unchanged conflict keys, partial
acknowledgements, explicit oversize failure and per-batch T-60 deadlines. Mocked
Owls responses prove both clocks without adding provider requests. The existing
148-assertion collector suite and current-split transport/reader tests pass.
Full model gate, TypeScript, protected fresh-main integration and natural live
capture verification remain required. The existing archive PostgreSQL suite
requires a disposable loopback PostgREST and is not represented as newly run
against production.

Rollback only future capture code through a protected PR. Do not retime or
delete observations already collected, revert archive-aware readers to an
unaware version, mutate locked records, or bypass the sole prediction writer.
