# Restore the standard Champions League cards

Base: `4f1390feedb126b0c183d9435b6ca858a712fe31`.

The owner rejected #1089's separate schedule layout and required the existing
Daily Edge cards, slate and readers. Remove that component and DTO; the normal
`EdgeBoard`/`BoardGameCard` and `ReaderSurface` render the upcoming matchweek.

Read-only inspection found 72 authoritative saved prediction records for the
18 November 24–25 fixtures, all captured November 5 at 22:17:47.006 UTC by the
existing writer. Those records retain the exact four member market payloads,
coherent score presentation, projection, probabilities, model provenance,
competition context, prices, evidence and grades. The missing response cache
must not imply these forecasts never existed.

A bounded SELECT-only reader restores only a complete same-fixture, same-model,
same-calibration, same-capture four-market cohort. It copies the stored member
markets and projection exactly, including original observation clocks. The
standard DTO identity envelope comes from exact game/team foreign keys. Its
score uses the explicitly stored coherent score; there is no mathematical
reconstruction, model execution, price overlay, new grade or prediction writer.
The page labels the original publication time and delayed refresh visibly.

An existing visible member snapshot remains first authority. Legacy complete
locked cohorts beat newer unlocked rows. Any incomplete stored lock blocks an
unlocked replacement, and an overdue unlocked tuple never becomes a synthetic
lock. Readers return cloned payloads; production prediction/grade records and
snapshots are not mutated. Model R22, calibration R25 and writer R1 remain exact.
The reader is versioned independently as
`ucl_stored_member_reader_2026_11_10_r1_exact_saved_cards`.

The rating-source failure is independently verified: ClubElo returns HTTP 403
and its ordinary browser page presents Cloudflare security verification.
No security challenge is solved or bypassed. A successful authorized source
fetch and canonical leased refresh are still required for fresh forecasts and
odds; this release does not claim that outage is fixed or stamp old data fresh.

Validation includes original saved tuple parity across all 18 games/72 markets,
negative cohort/fixture/release/clock tests, lock reader precedence and no-write
immutability checks, standard Daily Edge and UCL production regressions, type,
lint/build and latest-main protected integration. Verify standard cards and
click-through readers in actual production after deployment.
