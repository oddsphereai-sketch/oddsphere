# CBB r17 Total-only private preview result

This continuation did **not** activate CBB. It corrected a release-purity
defect in the research cache, then fit and tested an explicit r17 private
Total-only market score head. No production writer, member route, official
tracking, grade, stake, stored prediction, or locked snapshot changed.

The 353 original exact-opening rows had been stamped r1 while 717 added rows
were r2. Regenerating the original rows produced a pure 1,070-game r2 cohort.
The chronological replay's aggregate selection/later scores remained exactly
the same, but the mixed-release run is discarded as evidence. All five audit
paths now reject a mixed r1/r2 cohort, and the fit requires 1,070 distinct
2025-season r2 games before writing a local artifact. The r17 artifact was
fit through March 27, 2026, so it cannot be applied to an earlier game or a
training-game ID.

The selected 40-round Total-only head changed February selection Totals from
183/369 to 189/369 and later March Totals from 111/229 to 120/229 in the
already-opened retrospective replay. Refit gains were smaller. Moneyline and
Spread are deliberately unchanged, because r17 preserves r2's exact margin
and winner probability and derives both team scores from the corrected Total.
This is not a three-market accuracy qualification or a profitability claim.
The requested sub-10 Total and near-6 margin MAEs remain unmet.

The current-source private preview was refreshed with two bounded Owls calls
(odds and splits). The response reported fresh odds and no splits. For the
November 1 Villanova–Notre Dame game, the preview uses DraftKings as the
three-market execution target and nine target-excluded reference pairs. The
r17 Total moves 146.79 to 146.27; both team scores move down 0.26 while the
10.23-point margin and 81.24% home-win probability remain exactly r2. None
of its three target-book picks changes side. Liberty–High Point has one
complete Betr target but no eligible target-excluded reference, so its entire
r2 forecast remains unchanged. Reference books are *not* separately graded
against a forecast that used their own prices.

This is a source-shift diagnostic: r17 learned from historical BDL opening
prices but the preview reads current Owls named-book quotes. Their feature
distribution has not been shown equivalent, and no current historical
movement/split context is available. The small current correction is neither
proof of an accurate pick nor a reason to promote grades. The independent r2
preview remains the default. Local preview:
`/private/tmp/oddsphere-cbb-data/preview-total-only-2026-11-01.html`.

Reproduce locally without publication:

```sh
node --import tsx scripts/operator/evaluate-cbb-market-reader.ts
node --import tsx scripts/operator/fit-cbb-total-only-private.ts
node --import tsx scripts/operator/preview-cbb-prelaunch.ts --candidate=r17 --date=2026-11-01
node --import tsx scripts/test-cbb-research-cohort.ts
node --import tsx scripts/test-cbb-total-only-market-research.ts
```

Still required before any production consideration: prospective release-pure
pick outcomes, matched source/timing semantics, a Moneyline/Spread accuracy
solution (or convincing evidence of preserving a strong incumbent), exact
price grade calibration and board counts, availability/roster validation,
leased single writer, immutable lock writer/reader proof, tracking and member
parity, freshness/load proof, full model-change gate, current-main integration
and owner approval. This private preview is not a live shadow model.
