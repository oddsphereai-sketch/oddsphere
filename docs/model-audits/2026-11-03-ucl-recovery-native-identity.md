# UCL native identity through incomplete-fixture recovery

Starting base: `3b7a0e268e314d1bd23697ca68b0686b7a2815af` (PR963).

Normal15:47 UTC publication verified model R14 but exposed a complete-path
defect: Gala gained DraftKings references while LASK and Como still published
`independent_club_pmf` with no alternatives. The shared builder's bounded
incomplete-fixture retry reconstructed the fixture without its new per-provider,
book and market native identities. This discarded the source attestation before
the final UCL reader, even though normalization and direct inference tests passed.

Recovery now carries only the identities attached to the source selected for
each market, and only when that exact provider/native/book/market tuple exists
in the chosen rows. It never grants identity to an unattributed stored quote
or an unselected recovery row. Inputs without native identity metadata retain
their legacy EPL path.

The full18-fixture saved source receipt now runs through the actual UCL preview
builder, including cached provider retries, source selection, final model
authority, score construction and grades. Como's actual missing2.5 contract
forces its normal retry. A controlled partial LASK fixture additionally tests
that retry without fabricating any quote. Both complementary native catalogs
retain real alternative books in final provenance. Actual LASK DK BTTS−180
survives the complete builder. Fixed synthetic independent inputs exercise
the plumbing; they are not reconstructed historical model performance.

Release family: model R16, calibration R19, outcome R9, score R7, member R14.
Original-market-clock source R4 remains current. Existing inference equations,
binary qualification policy, grade gates, stakes, jobs, request ceilings, sole
writer/lease and locked reader precedence remain unchanged. No new promotion/
demotion rule or forced side is added. Source restoration may alter unlocked
forecasts through the existing reader; report actual board impact separately.

Focused full-builder/native/lock tests, full model safety, TypeScript/lint,
production build and clean fresh-main protected publication are required.
Verify actual normal publication, LASK/Como final references, coherent scores,
prices/grades and216 prior locked records×40 fields after deployment. The
main-line Total interpretation and missing Best-tier policy remain separate;
do not certify them from a source-handoff repair.
