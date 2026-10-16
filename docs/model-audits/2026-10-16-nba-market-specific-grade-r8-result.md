# NBA market-specific grade r8 — result

## Decision

The fixed post-diagnostic policy clears its two-season historical replication gates. It changes no
score or selected side: r4 remains independent-first and has no scalar market weight. The r5 production
candidate changes only future unlocked market grades and calibrated grade confidence.

The reproducible operator is `scripts/operator/audit_nba_market_specific_grade_r8.py`; its report is
`nba-research/reports/nba_market_specific_grade_r8/report.json`. The 2025-26 season was visible during
diagnosis, so these numbers are replication evidence rather than a pristine holdout. Exact 2026-27
locked results remain mandatory prospective validation.

## Historical replication

| Market / tier | 2024-25 | 2025-26 | Flat-price result |
|---|---:|---:|---:|
| Moneyline actionables (unchanged) | 483-219, 68.80% | 485-210, 69.78% | positive consensus-fair units both seasons |
| Moneyline Best Angle | 258-113, 69.54% | 238-94, 71.69% | positive consensus-fair units both seasons |
| Spread actionables | 197-132, 59.88% | 178-120, 59.73% | +47.09 / +41.82 units at flat -110 |
| Spread Best Angle | 135-85, 61.36% | 126-78, 61.76% | +37.73 / +36.55 units |
| Spread Lean | 62-47, 56.88% | 52-42, 55.32% | +9.36 / +5.27 units |
| Total actionables | 120-90, 57.14% | 91-74, 55.15% | +19.09 / +8.73 units at flat -110 |
| Total Best Angle | 48-30, 61.54% | 32-23, 58.18% | +13.64 / +6.09 units |
| Total Lean | 72-60, 54.55% | 59-51, 53.64% | +5.45 / +2.64 units |

The 60%/56% Spread and 60%/54% Total tier calibrations improve both Brier score and log loss against
the raw normal-residual probabilities on every replicated tier. Moneyline remains unchanged because its
existing Best Angle, Lean, fair-price economics, and tier ordering already pass.

## Promotion and demotion ledger

The policy does not manufacture accuracy by retaining only old winners. It has explicit new promotion
lanes and reports the contraction:

| Market | 2024-25 promotions / demotions | 2025-26 promotions / demotions | Replacement evidence |
|---|---:|---:|---|
| Spread | 41 / 522 | 39 / 542 | promoted rows 63.41% / 64.10%; demoted rows 47.70% / 50.74% |
| Total | 92 / 700 | 81 / 695 | promoted rows 56.04% / 54.32%; demoted rows 49.14% / 49.93% |

This is an explicit accuracy-first contraction, not a hidden `No Play` side effect. Across Moneyline,
Spread, and Total the replicated candidate still averages approximately one actionable market per game.
Every card retains its score and picked side; rows outside validated lanes remain visible as Watch.

## Runtime contract

- Model / prediction record: `nba_professional_unified_2026_10_16_r5_market_specific_grades`.
- Grade policy: `nba_grade_policy_2026_10_16_r5_market_specific_accuracy`.
- Market marriage remains `nba_market_marriage_2026_10_16_r4_independent_first_total_disagreement`.
- Point projection remains `nba_unified_final_projection_2026_10_16_r3_total_disagreement_reader`.
- Reader remains `nba_professional_market_reader_2026_10_16_r4_total_disagreement_authority`.
- Existing locked r4 and older payloads retain unconditional reader precedence.
- Missing exact price, target-excluded fair reference, high-quality inputs, or known injury-source state
  blocks actionability. Nonpositive calibrated EV blocks actionability.
- Qualified correction grades consume the same reader decision and movement magnitude that already own
  the final coherent score; display splits cannot authorize a grade.

## Exact current-board impact

The read-only same-input rehearsal at `2026-10-16T15:51:55Z` covered the October 20-21 board: 14
games, 42 markets, and complete reader evidence for every game. It changed no score or selected side.
The early board had no qualified same-book Spread or Total correction, so only an independent lane
could qualify.

| Market | Incumbent Best / Lean | Candidate Best / Lean | Net actionables |
|---|---:|---:|---:|
| Moneyline | 1 / 0 | 1 / 0 | 0 |
| Spread | 1 / 8 | 3 / 0 | -6 |
| Total | 4 / 5 | 0 / 0 | -9 |
| All | 6 / 13 | 4 / 0 | -15 |

The three candidate Spread Best Angles are PHI at NY, ATL at ORL, and MIN at MIA. Each was already
an incumbent Lean, and each has positive exact-price expected return. The other grade changes are:

- Spread Lean to Watch: BOS at DET, OKC at SA, CHI at TOR, DAL at HOU, and PHX at POR.
- Spread Best Angle to Watch: CHA at BKN.
- Total Best Angle to Watch: BOS at DET, CHA at BKN, MIN at MIA, and PHX at POR.
- Total Lean to Watch: PHI at NY, OKC at SA, ATL at ORL, CHI at TOR, and DAL at HOU.

There are zero newly actionable promotions and zero nonpositive-EV promotions. The quiet early Total
board is intentional rather than a missing forecast: every Total pick and score remains visible as
Watch. The large independent Total disagreements being demoted belong to the stable below-50%
historical cohort, so restoring their old action grades merely to increase card counts would contradict
the accuracy audit. Qualified reader corrections can add Total actions as authentic movement develops.

The reproducible operator is `scripts/operator/audit-nba-market-specific-grade-current-board.ts`.

## Verification completed

- market-specific grade boundaries and exact-price EV gates passed;
- professional candidate, reader, unified-score, runtime-artifact, site-wiring, and display separation
  tests passed;
- locked member snapshot precedence, lock coherence, and current-board odds pagination passed;
- repository TypeScript passed;
- the complete `npm run verify:model-change` suite passed.

## Remaining publication proof

Before merge: latest-main integration safety and protected PR checks. After merge: live release tuple,
writer lease, reader evidence, score/pick coherence, board counts, and unchanged-lock proof. Exact
2026-27 locked outcomes remain mandatory prospective validation; the pre-season historical audit cannot
manufacture those observations. Roll back future unlocked grading to r4 on mixed identity,
nonpositive-EV promotion, unexplained board contraction, reader/grade disagreement, or prospective
harm; rollback cannot rewrite an r5 lock.
