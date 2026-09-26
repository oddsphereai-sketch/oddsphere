# Playbook request-efficiency result — 2026-09-26

## Scope and release

- Starting production base: `f744729564ce0392e3479bffc27791b26f460496`
- Operational release: `playbook_request_efficiency_2026_09_26_r1_shared_fresh_reads`
- Member-facing presentation changes: none
- Prediction, probability, projection, grade, promotion, demotion, and stake changes: none
- Board-count impact: zero promotions and zero demotions; displayed game and pick counts are unchanged

## Implemented topology

All production Playbook readers now use one server-side broker. Identical in-flight requests are coalesced and successful reads are shared across cron paths with endpoint-specific cache windows:

- current splits: 10 minutes
- current lines: 10 minutes
- immutable historical splits by date: 24 hours
- venue/weather: 10 minutes
- injuries: 15 minutes

The current splits cache remains shorter than the existing 15-minute freshness policy, so it reduces duplicate calls within a refresh cycle without extending the accepted age of displayed evidence. Provider errors propagate without a second paid retry. Direct diagnostic probes remain uncached so operator checks continue to exercise the provider itself.

Additional request gates:

- WNBA seeding and line refresh return before Playbook access when no eligible scheduled games exist.
- NHL public-split ingestion returns before provider access for preseason games; the member product remains regular-season only.
- Started, final, postponed, canceled, and suspended events are excluded from current-split polling.
- Today and future slates use current endpoints; only past dates use immutable history.
- Last-known-good stored split rows are not deleted by an empty provider response.

## Measured request impact

At the production slate inspected before this change, NHL contained 14 preseason games and WNBA had no eligible slate. The prior schedules could spend approximately 26,000 Playbook weighted units per 30-day month on those empty/ineligible paths and on a duplicate MLB split read inside the same refresh cycle. Those calls are removed. During an active WNBA slate, the three-date refresh previously exposed as many as nine Playbook calls; shared current payloads reduce the repeated split/line reads to the minimum fresh set for the process and cache window.

This is a bounded estimate from the deployed cron topology and Playbook's documented endpoint weights, not a claim that every historical account unit came from these paths.

## Verification

- `npm run test:playbook-request-efficiency` — passed
- `npx tsc --noEmit` — passed
- targeted ESLint for all changed TypeScript files — passed
- `npm run build` — passed on Next.js 16.2.6
- `npm run verify:model-change` — passed in full on the final source
- focused public-splits, Playbook overlay, MLB venue/weather, NFL, CFB, NHL regular-season, and WNBA promotion suites — passed
- repository-wide lint retains pre-existing unrelated failures; no changed file has a lint failure

## Safety conclusion

The change reduces duplicate and inapplicable provider reads at the shared source boundary while preserving the existing user interface, freshness contract, stored fallback behavior, writer leases, predictions, and actionable board composition.
