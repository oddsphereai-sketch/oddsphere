# NBA reader structural qualification r9 — implementation result

Date: 2026-10-20

Status: implemented and verified on the candidate branch; not production until owner approval,
protected pull-request merge, and live verification

## Outcome

The candidate repairs a real qualification defect while keeping the independent-first architecture.
The independent score still owns the starting margin and Total. The reader now treats same-book number
movement, same-number no-vig price movement, retail noise, named-book disagreement, and source-specific
flow as distinct evidence instead of making every family pass one all-or-nothing gate.

Forecast authority is unchanged:

- Spread can change the coherent score only through the previously confirmed two-point categorical rule;
- Moneyline can change only when that corrected margin crosses zero;
- Total still requires two persistent five-point named-book moves plus the existing opposing five-point
  model residual;
- a qualified observational read below those boundaries cannot change a score, side, probability, grade,
  or stake by itself.

This is market reading, not a market-consensus blend. No fixed market weight was introduced.

## Exact opening-day zero-write comparison

The incumbent and candidate snapshots used the same current displayed quotes. All three games retained
complete evidence and coherent Moneyline, Spread, and Total outputs.

| Game | Incumbent final | Candidate final | Market effect | Grade/action effect |
|---|---:|---:|---|---|
| Boston at Detroit | BOS 114.32, DET 113.84 | BOS 115.34, DET 112.82 | persistent three-point Boston Spread move clears the existing rule; Spread flips from DET +1.5 to BOS -1.5 | BOS Moneyline Watchlist -> Lean; BOS Spread Watchlist -> Lean |
| Philadelphia at New York | NY 115.60, PHI 112.64 | unchanged | one-point Philadelphia move confirms PHI +4.5 but is below score authority | unchanged |
| Oklahoma City at San Antonio | SA 114.24, OKC 113.90 | unchanged | one-point Oklahoma City move confirms OKC +1.5; direct upset signal remains observational | unchanged |

Board impact: one score change, one Spread-side change, two promotions, zero demotions, two actionables
instead of zero, and no Total or direct Moneyline override. At the compared quotes, both promoted rows
had positive expected value under the candidate's coherent probabilities.

Reader status changed from 1/3 qualified Moneyline reads, 0/3 Spread reads, and 0/3 Total reads to 3/3,
3/3, and 2/3 respectively. Qualification is not being misreported as authority: only Boston-Detroit's
Spread read changed the final forecast.

## Predictive evidence and limitation

The unchanged two-point Spread authority previously improved the 2025-26 historical consensus proxy from
48.86% to 52.94% ATS, winner accuracy from 68.14% to 69.28%, margin MAE from 11.35 to 11.05, Spread +3
from 57.43% to 62.01%, and Spread +6 from 66.83% to 70.92%. Direct Moneyline and ordinary Total movement
rules failed that confirmation season, so this candidate does not grant them new authority.

Authentic same-book price and source-specific split capture began on 2026-10-15. There is no settled
regular-season sample for the exact repaired qualifier yet. The release must therefore be reported as
provisional and evaluated prospectively by model release and locked timestamp. Current-board plausibility
is not presented as predictive validation.

## Safety and release identity

- Model / prediction record: `nba_professional_unified_2026_10_20_r9_reader_structural_qualification`
- Market marriage: `nba_market_marriage_2026_10_20_r9_reader_structural_qualification`
- Internal reader: `nba_professional_market_reader_2026_10_20_r6_structural_qualification`
- Grade policy remains `nba_grade_policy_2026_10_16_r5_market_specific_accuracy`
- Point projection remains `nba_unified_final_projection_2026_10_16_r3_total_disagreement_reader`
- Writer and lease remain the existing NBA writer and `prediction_pipeline:nba`
- Stored locked payloads retain exact precedence and are never reconstructed or rewritten

Rollback restores the r8/r5 reader family for future unlocked computation only if release identity mixes,
locked payloads change, the reader admits target leakage or post-lock evidence, board contraction is
unexplained, score and picks become incoherent, or prospective corrections create material harm.

## Verification completed

- `scripts/test-nba-professional-market-reader.ts`
- `scripts/test-nba-professional-candidate.ts`
- `scripts/test-nba-market-reader-display-separation.ts`
- `scripts/test-nba-lock-coherence.ts`
- `scripts/test-nba-locked-member-snapshot.ts`
- repository TypeScript (`npx tsc --noEmit`)
- full model-change verification (`npm run verify:model-change`)
- exact current-board zero-write replay

The candidate is intentionally not merged or deployed by this result. Latest-main integration safety,
protected pull-request checks, explicit owner approval of the before/after board, and live verification
remain publication gates.
