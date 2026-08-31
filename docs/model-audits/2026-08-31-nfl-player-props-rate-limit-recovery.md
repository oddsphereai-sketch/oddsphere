# NFL Player Props rate-limit recovery

Date: 2026-08-31  
Starting production base: `da808983903b6dce719d4d62b78024b834d0d588`

## Incident

The first natural writer after the complete-board release started at `2026-08-31T20:51:09.907Z`, exceeded the five-minute Vercel ceiling, and left its refresh row in progress without publishing a new props snapshot. The Sharp client may wait roughly 67 seconds internally after a 429. Doing that inside an optional eight-page enrichment loop can consume the whole authoritative NFL writer window and delay both the Daily Edge and Player Props publication stages.

## Recovery contract

- Sharp props pagination sets `retryRateLimitInternally=false`.
- A Sharp rate-limit response stops only the remaining optional Sharp pages, stamps `SHARPAPI_PROPS_RATE_LIMITED`, and retains every page already collected.
- Network, authentication, malformed-payload, and other provider failures still fail closed; they are not downgraded to rate limiting.
- The eight-page/1,600-row and 48-call ceilings remain unchanged.
- BALLDONTLIE remains the complete primary props catalog. Complete one-book exact-price reads still publish as No Play, so all 32 passing-yards quarterbacks remain visible even when Sharp confirmation is rate-limited. No actionable grade can be created without an independently collected same-line book.
- Model, calibration, probability, projection, thresholds, grade lanes, stakes, locks, tracking, cron, lease, and schedule remain unchanged.

Provider observation r6 and writer r12 identify the bounded rate-limit behavior. The member/decision/runtime/board contracts remain r10/r4/r4/r7 because the published row and grade semantics are unchanged from the complete-board release.

The post-fix no-write capture at `2026-08-31T20:57:46.630Z` completed in about ten seconds with eight Sharp pages and 36 BALLDONTLIE calls. It produced 1,050 evaluated rows across all 16 games, including 118 passing-yards side/price reads for all 32 quarterbacks, with 19 actionable rows. No database, cron, writer, or tracking mutation was invoked. This capture did not itself encounter a 429; the focused contract test proves that only the typed rate-limit error takes the bounded partial-page path, while other errors still fail closed. Natural production verification remains required after deployment.
