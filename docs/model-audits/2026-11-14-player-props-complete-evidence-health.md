# Player props: complete NFL evidence, exact confidence and private process health

The previous reader threw at exactly 5,000 ordered evidence rows. This stopped
both existing NFL consumers; it was not evidence of a credit or provider failure.
R38/R117/R98 retain all original observations through a request-local lossless
archive. Pages remain 50 rows; the 12,000-row cap has a one-row terminal probe.
Each payload is bounded to 2 MB of JSON, retained hot JSON to 96 MB, compressed
history to 256 MB, and decoded cold cache to 64 groups / 8 MB. Every original
stored hash and metadata binding is checked before retention. Limits fail closed.
There is no latest-N selection, active-game filtering, new query source or writer.
Only an array response can attest a page, including the terminal probe; null or
malformed data remains an unavailable read rather than an empty/complete release.

Private capture R2 fixes a separate diagnostic gap: oversized complete semantics
previously caused omission before compression. Complete exact semantics now remain
inside the existing 8 MB raw / 262,144-byte gzip archive; the outer description
binds their hash and size. The 128,000-byte description and 600,000-byte record
limits remain. V72 changes only the existing append function's supported capture
release and R2 stub validation; R1 writes/reads, service-only ACL, sport lease,
job clocks, deduplication, append-only evidence and four states plus overflow persist.
It does not reconstruct older missing archives or waive an identity refusal.

Private writer/cron health across NBA/NFL/MLB now distinguishes incomplete or unavailable
AI work from native board publication. Operations R7 retains a separate postlock
reload diagnostic only after the exact game's ready callback was actually awaited
wholly before its lock. SQL completion/new-review counts alone cannot establish it.
Absent, failed or late acknowledgements and genuine prelock current-source failures
remain process exceptions. This changes no source admission, fallback or lock payload.
MLB health remains transient writer-result/cron data outside all member snapshots. When a short or expired invocation deadline skips scheduled-slot inventory for an
eligible current-day unexpired game, a private deferred-inventory finding keeps
coverage unverified; it does not invent a specific failed review. Off-day, locked,
next-day and intentionally disabled states remain distinct. No extra call is made.
No diagnostic or result surface is public.
NBA rescue R3 also retains private process failures rather than treating native
publication as completed AI coverage; original canonical-write/provider counts and
nonpublished classifications remain exact.
MLB handoff R2 makes any uncertain append/index acknowledgement sticky for the
invocation: already queued callbacks and final writes refuse stale materialization.
Returned database errors and lost responses both enter the private partial route,
which omits stale tracking/member fallback and reports unknown write/commit counts.
The next ordinary leased invocation reads persisted authority rather than retrying.
Future R2 cutoff eligibility additionally requires its exact publication index,
binding run ID, source checksum, snapshot ID, slate, as-of, model release and an index
clock between source creation and cutoff. One bounded query covers the existing
twelve candidates; thirteen returned rows or an unavailable read fails closed.
Missing/mismatched/late indices fall through to a prior eligible source or hold.
Absent/original R1 sources retain the original cutoff branch, and existing locked
payloads remain opaque first authority. Unknown tags cannot qualify new cutoff
sources. No index reconstruction/backdating, migration, provider call or extra review
is introduced. Fault tests exercise actual append/index/cutoff/first-lock/display
paths, returned errors, unknown acknowledgements, sibling queues, restart, midnight
and legacy controls; a retained unindexed source cannot become an unreadable new lock.
MLB locked-source reader R1 fixes a separately reproduced legacy lookup failure:
the previous global 500-index limit let unrelated later publications hide a retained
original source, and unavailable inventory/all-missing sources could return mutable
current rows. Source resolution now filters the exact slate/snapshot before its
bound; missing/ambiguous/empty original authority is an explicit read failure.
The existing 100-row game-lock inventory bound gains a one-row overflow probe;
null, malformed and overflowing inventories remain unknown rather than no-lock.
Opaque original locked rows retain their evidence and historical team context.
No raw JSON scan, reconstructed index, changed stored lock or new source is used.
Raw-board caching still coalesces canonical reads; lock application follows retrieval
so a prelock cached display cannot bypass a new first lock. Member fast paths use the
existing bounded fresh lock inventory and reject cached unlocked rows for a known
locked game, returning to the authoritative display path. Full manifests are checked
after assembling shards, and research-only data and opaque already locked fields
remain unchanged. An unavailable lock inventory remains a read failure, never healthy
mutable fallback. These are existing database reads, not provider/model requests.
Every referenced locked research key reserves its original presence or absence,
including opaque stored values; current dictionaries cannot fill missing originals.
Conflicting original key presence/values hold rather than selecting another source.
The browser likewise honors locked rows before current preview grading. Its lazy
cache binds actual returned rows to the same original game, research key, first lock
and core payload; prelock/unbound/foreign entries cannot become locked context or
block the first locked read. Only six supported research modules may hydrate rows,
with embedded locked fields taking precedence. No research can change a projection,
probability, pick, grade, price or stake. Normal valid unlocked research remains usable.
Future member-contract policy R1 (`player_props_ai_member_contract_2026_11_14_r1_nba_ou_execution`)
aligns priced-tail admission with the existing NBA ordinary Over/Under adapter.
NBA Yes/milestone offers remain complete archived/read market context, not execution
targets. Only law R3 uses this scope policy; R1/R2 retain their original admission.
All independent-prior tails, means, support, dependence and supported execution tails
stay strict. Future R3 diagnostic dedup uses the canonical contract, so an implicit
Yes at an integer line cannot mask an ordinary Over/Under check. NFL/MLB supported
contracts remain unchanged. R38 adds a short versioned contract-purpose instruction;
older generation meaning strings remain exact. No quote, actor or scope is dropped,
no numerical tail/decline is fabricated and no closed review is replayed.
R36 remains explicitly accepted under its original parser and law authority.
Future law R3 / selection R8 / grade R5 fix floating subtraction at the existing
paired-confidence Lean boundary using exact integer event masses and rational prices.
The original inclusive 55% floor and 98%–130% paired-implied coherence bounds remain.
Only diagnostic display uses decimal conversion. Original R1/R2 laws keep their own
hashes, probabilities, pricing/selection and R3/R4 grade semantics through initial
pricing and later member repricing; stored locks take precedence before new semantics.
The shared Daily Edge helper is unchanged. The contract-purpose instruction changes
only future R38 requests; raw sources and accepted legacy probabilities, projections,
stakes and execution prices remain exact. Synthetic paired controls include both
Over and Under promotions, rejected neighboring/coherence/exception cases and exact
legacy controls; the ordinary-price 7,902-case board has 592 boundary promotions and
zero demotions. This is a controlled test impact, not a live board or accuracy claim.
Poor recent performance is not sufficient evidence for retrospective probability
fitting. Historical locks, misses and outcomes remain unchanged.

Validation requires exact JSON/hash and consumer equivalence, all retained schema
releases, exact-boundary/overflow/page/read-error controls, bounded-memory workers,
R1/R2 corruption and rolling compatibility, real disposable PostgreSQL ACL/lease/
append-only proof, actual writer/route health, focused and mandatory model checks,
full TypeScript/lint/build, two consecutive fresh three-reviewer clean rounds,
protected current-main PR/CI and actual production scheduled proof. Static engine
checks follow the current approved off-day/unavailable copy and locked-first merge
contract; no product copy was changed to repair the old stale test expectations. Local memory
and CPU measurements do not include production network latency or guarantee deadlines.
Rollback is the prior protected source release; V72 is backward compatible with R1.
Never rewrite prior payloads or replay closed review jobs during rollback.
