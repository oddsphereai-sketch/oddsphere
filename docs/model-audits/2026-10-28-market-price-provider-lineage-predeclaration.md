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
