# NFL player-props member read hardening

Date: 2026-09-02  
Scope: member read path only; behavior-neutral

## Contract

- The canonical writer and readiness audit continue to use the uncached snapshot-store APIs.
- The member page uses a distinct API whose return type is the compact member DTO, so it cannot be substituted for the canonical writer prior.
- Successful member DTOs are cached in the server process for 60 seconds by public `season/week` identity only. No auth, user, request, cookie, or header state enters the cache.
- Concurrent cold reads share exactly one in-flight promise. The TTL begins only after a successful non-null decode and DTO construction.
- Null, database error, corrupt envelope, abort, and deadline results are never cached. Failed in-flight state is evicted so the next request can recover.
- The underlying member-only Supabase query receives a real `AbortSignal` and is bounded at 6 seconds, before the existing 8-second page deadline. Its timer is cleared on every completion path.
- A successful same-process canonical upsert invalidates the matching member cache entry only after the upsert succeeds. Writer reads remain uncached. Failed writes do not invalidate.
- Legacy/envelope decoding, locked precedence, canonical DTO construction, member UI, model output, grades, counts, stakes, provider calls, query shape, write count, cron, and lease semantics are unchanged.

## Verification

The focused snapshot-store test covers cold, coalesced, warm, resolution-based TTL, null, database error, corrupt payload, abort, recovery, successful-write invalidation, failed-write retention, and exact query counts. It also statically proves that the writer and readiness operator do not reference the member-only cached API.

The relevant bundled Next.js 16 guidance was reviewed before implementation. The page remains `force-dynamic`; this lane uses no route cache, `use cache`, `unstable_cache`, cache tag, or user-scoped cache input.
