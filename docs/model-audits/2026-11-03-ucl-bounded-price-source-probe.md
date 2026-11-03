# UCL bounded price-source diagnostic

Base8b5bddf65cffbc2d8aea4c8bed5614858d8e39f5. Diagnostic release
ucl_bounded_price_source_probe_2026_11_03_r1. No model, grade, forecast,
writer, lock, stake, stored price, provider schedule or member behavior changes.

Owner approved one free UCL event-catalog read and at most two current-odds
requests for LASK–Slovan and Lens–Como, capped at eight market credits,
with no history calls or forecast writes. Scoped existing-key retrieval was
also approved, but Vercel's sensitive variable does not expose its value.
This authenticated diagnostic uses the already configured key inside runtime;
it never returns the secret or an arbitrary request URL/error body.

The unscheduled authenticated `/api/cron/ucl-price-source-probe` route accepts
only the exact `fixture_ids=4243843,4438978`. An older deployment returns404
instead of falling through to a normal refresh. The existing UCL refresh route
is byte-for-byte unchanged from the starting base. It uses existing cron authentication and the
soccer prediction_pipeline lease, its own15-minute diagnostic guard and the
normal-refresh15-minute guard. Its separate audit source cannot advance the
normal forecast job's success clock. No forecast path exists in the diagnostic route.

The helper verifies the current UCL snapshot and exact game/competition/name/
kickoff identity, requires an open game outside T60, makes one fixed-host free
catalog request, then zero to two exact matched event requests with four markets
and one five-book billing group. It checks remaining credits/reserve, never
retries, and reports current offered contracts and original source clocks.
Future-fixture freshness uses the existing kickoff-relative soccer window.
Wrong/missing/ambiguous events, malformed flags, lost requests and unknown quota
cannot create a forecast, history write or extra source retry.

Mock regressions cover request/credit ceilings, source identity, explicit
fixture scope, reserve, T60, future/source clocks, body receipt timing, secret
redaction, authorization, normal cadence and zero writer/slate/history calls.
Independent AI review found no remaining P1/P2 safety blocker. No provider call
was made during implementation or tests. The owner's source budget remains
unconsumed until the one production diagnostic is explicitly executed and its
receipt saved. This is source inspection, not inference authority.
