# CBB normal acquisition receipts

Starting production base: `6df2750c6417ed71cd9dc0803466870b56ac36de`.

R38's acquisition details were returned in its cron HTTP response, which the
shared refresh logger does not persist. This operational follow-up emits a small,
explicit whitelist of acquisition facts into ordinary runtime logs so source
coverage and actual quota headers can be verified after scheduled cycles without
an extra paid read or manually triggered refresh.

The receipt reports status, source release, request/availability times, actual
request counts, credit headers, offered event count, matched game/quote counts
and controlled rejection-reason counts. HTTP/network/body failures log only a
stage and numeric status/quota fields. It never logs the API key, request URL,
raw body, credentials, team list, quote values or a spread of the source object.

The same fetched response, parser, returned object, clocks, quotas, request count,
writer lease, forecast, grade, stake and locked record remain unchanged. The receipt change alone is
logging only; the accompanying fixture-clock repair advances publication to
R39/R22/R18/R6/R25 as documented in the fixture-clock audit.
No source retry, endpoint, scheduler, cache or production observation is added.
Existing coordinated-source and publication tests, type checking, lint, build,
latest-main integration safety and protected checks precede publication. Verify
live normal-cycle receipt and exact source quota/coverage after deployment.
