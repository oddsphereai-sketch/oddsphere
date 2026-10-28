# Market-price provider lineage predeclaration

Date: 2026-10-28

## Confirmed defect

`market_price_observations_v2` stored the sportsbook but not the provider that produced the row.
Consequently, an internal reader could not prove whether a Circa or Pinnacle observation came from
Owl's, the canonical `lines` table, or a legacy source. The NFL Market Brain correctly kept this
ambiguous history out of provider-specific authority, but its frozen roster still named retired
SharpAPI price feeds.

## Candidate boundary

Capture release `market_intelligence_v2_capture_2026_10_28_r12_price_provider_lineage` adds explicit
provider, provider-event, ingestion-run, and normalized-row hash fields to future price observations.
Existing rows are labeled only `legacy_unattributed`; they are not inferred, relabeled as Owl's, or
otherwise reconstructed. Future Owl's rows carry `provider=owls`, their actual provider event id,
the shared ingestion run, and a stable SHA-256 of the normalized provider row. Rows read from the
canonical `lines` table carry `provider=canonical_lines` and do not invent a raw-row hash.

The uniqueness key becomes provider-scoped so identical book quotes from two distinct sources do
not suppress each other. This change adds no provider request, writer, schedule, lease, model input,
reader score, prediction, probability, side, projection, grade, stake, lock, tracking write, or
member-visible field.

## Promotion prohibition

Provider lineage is necessary but not sufficient for Market Brain use. Owl's price evidence remains
capture-only until a later release adds bounded success/partial/empty/failure receipts, raw-response
archive linkage, exact-game replay, and chronological sport-specific qualification. Same-input board
impact is contractually zero promotions, zero demotions, zero side changes, and zero actionable-count
change.

## Verification and rollback

- Type checking and Market Intelligence focused tests must pass.
- `npm run verify:model-change` must pass before publication.
- The additive V51 migration must preserve every preexisting row as `legacy_unattributed`.
- The provider column uses PostgreSQL's metadata-only constant-default path; it must not rewrite the
  approximately 3.8 million existing price rows merely to establish legacy provenance. The required
  provider-scoped uniqueness index is built concurrently and replaces, rather than supplements, the
  existing roughly 447 MB uniqueness index. No additional provider lookup index is created.
- Roll back the application release if a new Owl's row lacks explicit provenance or if provider-
  scoped uniqueness changes any downstream output. The new nullable lineage columns may remain;
  existing observations and locked records are never deleted or rewritten.

## NFL forward-slate observation repair, October 28 follow-up

Status: unpublished capture-only candidate. Starting production base:
`6c3da56e1ef1ee5fcf5d072a53f72f6fe04001a4`; separate branch
`codex/nfl-market-capture-repair`. This repair does not promote the offline predictive candidate.

Capture `market_intelligence_v2_capture_2026_10_28_r17_nfl_forward_slate_contract` fixes a real
handoff failure: the generic games table has no current NFL slate, while the existing immutable NFL
forward snapshots contain 14 future games. The reader selects game metadata only, never projections,
and resolves each ID's latest state without a start-date filter. It accepts only scheduled/pre games,
normalizes whitespace/case, preserves provider/generic namespaces, reconciles exact team/kickoff
bridges, and rejects ambiguous clocks, duplicate semantic IDs, and schedule conflicts. Cancellations
and reschedules cannot resurrect an older in-window record. Forward-only games never query generic
lines with a provider ID. Optional public-feed or canonical-line failures retain valid NFL Owl rows;
other sports retain their existing failure behavior and identity matching.

Production identity was verified independently by matching existing live cron log IDs 311422–311428,
with exact timestamps and counts, to the local read-only database connection. No cron was invoked for
this identity check. The live provider/display source remains separately owned. Its complete Circa
display snapshot does not establish an internal price chronology: the verified production NFL price
observation count was zero. Research table API reads returned 404 schema-cache errors; physical table
absence was not established, and no production research/shadow table was created.

One bounded verified-production rehearsal (`apply:false`) used exactly one Owl NFL odds GET and one
splits GET, with Playbook intentionally skipped. It yielded 14 games, 168 price observations, and
82 split observations; zero observations were written and zero mutation attempts occurred. The split
response was partial/book_unavailable with BetMGM ticket-only data, not complete Circa handle data.
Sixty unmatched prices were next-week matchups outside the capture window. This is collection proof,
not a full-provider green rehearsal or predictive qualification. No additional provider calls are
needed to repeat local fixture tests.

Read/resource accounting: the forward slate used 15 database queries / 504 rows / 358,245 returned
JSON bytes; the entire collector rehearsal used 17 database requests and 4,252ms. The reader enforces
a shared ten-second deadline, 20,000 seed rows, 64 event IDs, four concurrent latest-state reads, and
84 maximum queries. At the existing 75 scheduled cycles/day, the measured metadata payload alone is
about 26.9 MB/day; this excludes other query traffic and database storage. Restoring the previously
skipped provider work can add up to 150 Owl and 150 Playbook requests/day, with manual calls extra.
These are request ceilings, not measured billed credits or a total cost estimate. No schedule,
per-game provider loop, new writer, prediction lease, model, grade, stake, member, or lock change.
Same-input prediction/grade/promotion/demotion/actionable deltas are contractually zero.

The initial full safety run exposed an obsolete football-prefetch assertion corrected upstream in
PR #846. The isolated capture branch integrated exact main
`ecfd01dadcdd30bb9f2fab7994e35f580113deb4`; its full `npm run verify:model-change` then passed.
The dedicated research PostgreSQL proof was explicitly skipped because its test URL is unset; no
capture schema migration is introduced. The focused suite is wired into `preverify:model-change` as
`npm run test:nfl-market-capture`.

Rollback: restore the exact production r12 capture implementation. Keep every already captured row
and every locked public record unchanged. The predictive registry remains disabled. After an approved
merge, verify the deployed capture release, natural cron health, and new provider-lineaged NFL rows;
a branch rehearsal alone is not live verification.
