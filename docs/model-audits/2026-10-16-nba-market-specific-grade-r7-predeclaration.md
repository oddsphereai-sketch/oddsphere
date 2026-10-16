# NBA market-specific grade r7 — predeclaration

## Purpose and chronology

The active r4 forecast is independent-first, but its presentation grade still comes from one generic
function shared by Moneyline, Spread, and Total. This audit asks a narrower question: which completed
r4 forecast decisions deserve `Best Angle`, `Lean`, or a nonactionable label in each market?

The frozen selection season is the 2024-25 regular season. The candidate selected there is carried
unchanged into the 2025-26 regular season for confirmation. Each season is also split into chronological
halves for stability reporting. These outcomes have already been examined in broader NBA forecast
audits, so 2025-26 is a fixed confirmation set, not a pristine never-observed holdout. No threshold may
be changed after this file is committed without starting a new release and predeclaration.

## Fixed forecast and evidence boundary

- The portable score owns 100% of the starting margin and Total.
- The r4 historical proxy applies the already-frozen two-point Spread residual re-orientation and the
  five-point opposing-movement / five-point independent-edge Total residual re-orientation.
- Moneyline, Spread, and Total probability use the deployed normal-residual sigmas. Every side and
  grade comes from that one coherent final score.
- Public consensus opening-to-closing movement is only a proxy for the production reader's stricter
  target-book-excluded same-book trail. It may evaluate a candidate but cannot manufacture live reader
  authority.
- Historical selected-book prices, source-qualified splits, injury states, and authentic same-book
  trails are unavailable. They will not be reconstructed. Moneyline economics use consensus no-vig
  fair prices and are explicitly labeled non-executable; Spread and Total use flat -110 only as a
  comparable direction benchmark.
- Existing locked member payloads are immutable. This audit is read-only and creates no writer.

## Incumbent reconstruction

For the quantitative historical rows, data-quality and injury gates are held eligible so that the audit
tests the numerical grade rule rather than fabricating missing historical evidence. The active generic
rule is reconstructed as follows:

- nonactionable below 55% selected-side model probability;
- `Best Angle` at 62% or higher when the model-to-market edge clears the active generic edge gate;
- otherwise `Lean` when the current neutral/support conflict gate permits it;
- `Watch`/`Caution` otherwise.

Coverage and injury gates remain mandatory in production regardless of the selected quantitative rule.

## Frozen candidate families

All percentages below are selected-side probabilities. Ties are resolved by the deterministic ranking
declared under Selection.

### Moneyline

- Lean probability floor: 55%, 57.5%, or 60%.
- Lean minimum model edge over closing no-vig probability: 0, 2, or 4 percentage points.
- Best Angle probability floor: 62%, 65%, 68%, or 70%.
- Best Angle minimum model edge: 2, 4, 6, or 8 percentage points.
- Best Angle must be a strict subset of the candidate's Lean-eligible population.

### Spread

- Reader-inactive Lean probability floor: 55%, 57.5%, or 60%.
- Reader-qualified/applied Lean probability floor: 50%, 52.5%, or 55%.
- Reader-inactive Best Angle floor: 60%, 62%, or 65%.
- Reader-qualified/applied Best Angle floor: 57.5%, 60%, or 62%.
- A Best Angle must also be Lean-eligible. Reader qualification may promote a row, while failure to
  qualify may demote the same probability band; neither lane may change the selected side.

### Total

- Base Lean probability floor: 55%, 57.5%, or 60%.
- Reader-corrected Best Angle floor: 55%, 57.5%, or 60%.
- Reader-confirmed/aligned Best Angle floor: 57.5%, 60%, or 62%.
- Reader-inactive Best Angle floor: 62%, 65%, or 68%.
- An uncorrected independent residual of at least 4, 5, or 6 points may be capped at Lean. It remains
  actionable; the paired promotion path is a qualified corrected or aligned read moving Lean to Best
  Angle. The candidate therefore cannot improve reported accuracy by silently deleting large-edge
  losses.

## Selection and confirmation gates

Each market selects one candidate on 2024-25. A candidate is eligible only when:

1. it has at least 200 actionable selection decisions and 150 actionable confirmation decisions;
2. each actionable chronological half has at least 60 selection decisions and 45 confirmation decisions;
3. Spread and Total actionables exceed 52.38% in both seasons and have positive flat -110 units in both;
4. Moneyline actionables have positive consensus-fair-price units in both seasons, while exact-price ROI
   remains unvalidated;
5. Best Angle has at least 75 selection and 50 confirmation decisions, is no worse than 55% in each
   season, and is at least one percentage point better than the same candidate's Lean tier in each;
6. no actionable chronological half is below 50%;
7. every actionable demotion has an explicit tested promotion path, and old/new grade counts,
   promotions, demotions, and net actionables are reported.

Among selection-eligible candidates, rank by: highest Best Angle accuracy, highest all-actionable
accuracy, highest actionable economics, largest Best Angle sample, largest actionable sample, then
lexicographically serialized recipe. The confirmation season is pass/fail only and cannot re-rank.

If no candidate clears every confirmation gate, there is no production grade change. The report must
still identify why the incumbent fails, preserve the live release, and specify the prospective evidence
needed to finish validation. A passing candidate may proceed only with focused runtime tests, same-input
current-board impact, release bumps, full model-change verification, integration safety, protected PR,
and post-deploy proof.

