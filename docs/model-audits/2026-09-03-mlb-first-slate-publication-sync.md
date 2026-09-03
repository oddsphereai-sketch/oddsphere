# MLB first-slate publication synchronization — r81

## Scope

The first writable run for a newly seeded MLB slate creates prediction records
while games are still draft, then publishes the games later in the same
orchestrator lifecycle. The prior ordering could leave otherwise-current member
records with a null `published_at` until a later natural sync. It also made the
publication timestamp serve as Moneyline promotion-cycle identity, so merely
fixing the order with another sync could have counted one model run twice.

## Correction

- Run the existing prediction-record synchronization a second time only after
  the existing publish gate actually promotes one or more MLB games.
- Identify Moneyline promotion observations by the authoritative prediction
  `computed_at`, not by draft/publication state.
- Preserve every non-null prior publication timestamp. Initialize only a null
  timestamp on the post-publication pass.
- Report any bounded post-publication record error as partial/degraded rather
  than hiding it.

The change adds no route, provider call, model writer, database table, lease, or
cron. It changes no probability, projection, selected side, grade threshold,
stake, or lock. A qualifying Moneyline may become actionable only after the
unchanged two-distinct-natural-cycle and 20-minute promotion contract is truly
satisfied.

## Verification contract

Focused tests prove that the second sync is MLB-only, requires a successful
publication with at least one promoted game, reuses the existing record writer,
does not run for zero promotions or other sports, initializes a null publication
time, and cannot count the M3 and M4 passes as distinct model cycles. The full
model-change suite, TypeScript, scoped lint, production build, diff check, and
fresh-main integration-safety gate are required before publication.

Rollback is decision r80 / rule bundle v68 and removal of the guarded M4 pass.
Already locked records remain immutable.
