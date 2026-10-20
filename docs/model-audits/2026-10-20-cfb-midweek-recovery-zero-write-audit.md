# CFB midweek recovery zero-model-write audit

Date: 2026-10-20

## Incident

The current board had two independently verified ingestion failures.

- The official Sun Belt JSON had published South Alabama–Marshall availability
  rows, but the conference adapter compared school-only labels such as `South
  Alabama` with a local mascot-stripping list that omitted `Jaguars`. The exact
  game was therefore rejected even though its date and team orientation were
  correct.
- Stored request-budget evidence showed 3,470 paid-provider credits remaining,
  but the 5,000-credit reserve prevented every current FCS fallback request.
  The provider was not queried, so the missing FCS prices could not honestly be
  classified as unavailable at sportsbooks.

The CUSA signed Faktor page was also verified to use `section` containers in
its current empty-state markup while the parser accepted only `article`. CUSA
had not yet published a report at audit preparation time; no unofficial injury
row is substituted for the absent official report.

## Audit-only release

The authenticated `/api/cron/cfb-midweek-recovery-audit` endpoint runs the sole
CFB writer with `apply=false` and the existing `prediction_pipeline:cfb` lease.
It rehearses:

- shared CFB provider identity matching for official reports;
- both `article` and `section` Faktor cards;
- the exact `NM State` alias needed by the current CUSA slate; and
- one paid FCS odds request below the live reserve.

It returns only bounded operational summaries: before/candidate FBS and FCS
coverage, grade counts, health/provider errors, and every changed side, line,
or grade with promotion/demotion totals. It does not return credentials or raw
provider payloads. Because the provider rehearsal outlives the production HTTP
response window, the sanitized result is also written to the isolated
`cfb::operator-audit::2026-10-20-midweek-recovery` response-snapshot key and is
available only through the same cron authentication. It cannot overwrite a
Daily Edge, model, evidence, member, tracking, or lock key. The ordinary route
cannot set these flags, and the writer
throws if any candidate flag is supplied with `apply=true`.

## Acceptance and rollback

This release deliberately changes no production model or collector release,
scheduled-writer behavior, credit reserve, evidence row, member snapshot,
tracking row, projection, probability, side, grade, stake, or locked record.
Its sole state change is the replaceable sanitized operator-audit artifact.
The audit result is the required current-board evidence for a separate live
repair. Remove the endpoint after that repair is accepted. Revert this audit
release if it writes model state, escapes authentication or the shared lease,
or permits candidate behavior in an applying writer.

The first durable current-board result retained 0/40 FCS paired Moneyline,
Spread, and Total coverage with zero promotions, proving that lowering the
reserve alone was not a valid repair. A bounded `provider=1` mode therefore
queries only the paid FCS endpoint and returns sanitized public event identities,
bookmaker keys, exact-match counts, failure reasons, and credit counters. It is
authenticated, shares the CFB lease, makes one request, and writes nothing.
