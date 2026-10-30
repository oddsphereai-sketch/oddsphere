# NBA lock recovery and allocation-only refresh repair

Base: `795f43c08e21a5927a881d6c933ea8392fc0c44b`.
Operational refresh: `nba_daily_refresh_schedule_2026_10_30_r21_low_copy_props_payloads`.
The r24 NBA model, r25 marriage, r15 grade, r2 lock coherence, private props
models, serialized payload releases, provider requests, capacity limits,
cadences, stakes, shared lease, and stored lock precedence remain unchanged.
Same-input projection/side/price/grade/promotion/demotion/actionable deltas
are zero: this change only allocates and serializes identical bytes differently.

## Incident and operational recovery

OWLS rejected its configured key with HTTP 403 until the owner reactivated it.
The existing final-refresh/coherence gate correctly did not fabricate a lock.
The ordinary scheduled pipeline then locked CHA–WSH at 22:25:27 UTC and
WPG–FLA at 22:25:49 UTC. Four NBA games locked automatically at 22:30:33 UTC;
three more locked at 23:00:33 UTC. SEA–CGY locked at 23:00:58 UTC. The 23:09
read-only audit found no overdue NBA/NHL game and unchanged prior lock hashes.
All three official markets are stored, not merely a visual lock badge.

The normal display collector resumed across sports. Illinois's original-date
winner and actual-date spread/total now resolve and render real shared
history on the site, including exact -2.5 and Over 54.5 contracts. CFB, NFL,
CBB and NHL publishers recovered through their existing routes and leases.
Separate soccer price gaps and allowance-protected optional history deferrals
remain explicit; they must not be described as fully resolved source coverage.

## Separate memory defect

Vercel's production runtime log for request
`zx7b4-1793399501384-d413ede375df` at 22:32:00 UTC reports an out-of-memory
kill of `/api/cron/nba-daily-refresh`, after its line refresh and before the
optional private props stage completed. A hard process kill bypasses the
ordinary `finally` block, leaving the shared lease to expire normally.
No lease was forcibly cleared or bypassed during recovery.

Actual stored state metadata: prior-season props state 37,853,873 JSON bytes;
current-season state 2,528,718 bytes; the private market history was 109,258,224
bytes / 162,250 observations for the final codec replay. Default inflate
chunking creates an additional full-history concat buffer. Whole-history
stringification and UTF-8 conversion add more large simultaneous buffers.

The repair sizes one inflate buffer from the independently validated existing
envelope length (retaining the existing maximum-output cap), hashes valid
UTF-8 bytes directly, and preserves legacy malformed-UTF-8 replacement/hash
semantics. Market-history writes stream the identical top-level key order and
per-observation JSON into 64 KB batches through backpressured level-9 gzip.
Compressed output remains capped at 8 MB; uncompressed JSON remains capped at
192 MB; no historical observation is truncated or removed. A failed stream
cannot reach the existing upsert. Other payload encodings remain byte-identical.

## Evidence and publication gates

SELECT-only old/new replays on the same actual stored data made zero provider
calls and zero writes. They produced the identical checksum
`0ede549dec288ad2435eaed20e6fd6eb932cf821853a78f73e2301c6f2eab86b`,
109,258,224 JSON bytes and 2,640,032 gzip bytes. Peak RSS fell from
1,600,520,192 to 966,148,096 bytes (about 40%). This is local memory evidence,
not a claim that production has already completed the repaired stage.

Regression coverage requires exact old/new gzip/checksum/length/value parity,
Unicode, legacy malformed UTF-8, corrupt and truncated envelopes, empty and
large streamed arrays, circular-input failure isolation, and input immutability.
Run all affected NBA props tests, lock tests, TypeScript, lint, full model-change
verification, current-main/overlap safety and protected PR checks. The optional
PostgreSQL proof is unavailable locally without its configured URL.

After merge, verify the exact production commit, r21 cron result, completed
private props stage, published member snapshot, released sport lease, no new
OOM log and unchanged frozen-record hashes. Hold or revert the allocation
repair on any byte/decision mismatch, stream-limit bypass, mutation of an old
lock, or continued production memory failure. Do not claim all sport source
coverage is complete merely because OWLS authentication is restored.
