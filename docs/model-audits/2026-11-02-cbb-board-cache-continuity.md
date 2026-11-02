# CBB board cache continuity

Production base: `0211a1688a87a99c79b4a503b1b457346709ced8`.

The restored CBB source history expanded the current member artifact to
6,154,660 JSON characters. Installed Next.js limits a data-cache entry to
2 MiB. Returning the full artifact directly prevented normal warm caching.
At 15:11 UTC production also recorded a Supabase/Cloudflare HTTP 521 outage.
The page's snapshot read timed out, then subsequent reads reported the
published board unavailable even though a direct read still contained 116
complete games and 348 evaluated prices. The locked overlay and coherence
checks passed independently. No stored board, prediction, or lock was lost.

The existing server cache now losslessly compresses only CBB payloads. The
actual artifact compresses to about 0.46 MiB, under the framework entry limit.
Decoded snapshots retain the exact stored projections, prices, grades, sources,
timestamps, and locked evidence. Decode output is bounded at 64 MiB. Other
sports keep their original payload representation, dates, and selection rules.

A missing published artifact now rejects cache revalidation instead of caching
null over a verified board. The existing framework stale-on-revalidation-error
behavior can preserve its last verified entry; the separate locked-record
overlay remains mandatory and still fails closed on an unverifiable lock.
The cache release is bumped to v3 so prior cached null entries cannot linger.
No provider requests, alternate prediction writer, model/input changes,
prediction reconstruction, or record mutations are introduced. Promotion,
demotion, actionable-count and same-input numerical impact are all zero.

Validate lossless lock/evidence round trips and the actual published reader
under a simulated transient database failure. Confirm production board/reader
recovery and the next scheduled publication. Rollback the cache change only;
preserve every stored member record.
