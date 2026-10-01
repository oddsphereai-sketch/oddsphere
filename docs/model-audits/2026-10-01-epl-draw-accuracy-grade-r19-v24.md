# EPL draw arbitration and accuracy-first Match Result grading (r19 / v24)

Date: 2026-10-01

## Scope and releases

- Model: `epl_goals_coherent_2026_10_01_r19_draw_arbitration`
- Draw selector: `epl_draw_arbitration_2026_10_01_r1`
- Grade policy: `epl_grade_policy_2026_10_01_v24_accuracy_first`
- Coherent Total outcome contract remains `epl_coherent_market_outcome_2026_09_02_r2_structural_target_exclusion`.
- UCL remains independently pinned to r6. Its exact early forward release is 12-5 on Match Result, 10-3 on Total and 10-3 on BTTS; copying an EPL correction into that competition would be an unvalidated regression risk.

This release adds no member copy fields, labels or layout and changes no provider cadence, request budget, writer, lease, stake or settlement rule. Existing grade-reason text follows the new result honestly. Existing locked r18/v23 rows remain immutable and continue to settle by their stored release identity. R19/v24 applies to future unlocked EPL output.

## Professional architecture review

The review started from established score-model families rather than a favorite/underdog or draw quota:

- Dixon and Coles' low-score correction: <https://ajbuckeconbikesail.net/wkpapers/Airports/MVPoisson/soccer_betting.pdf>
- Karlis and Ntzoufras' bivariate Poisson and diagonal-inflation treatment of draws: <https://rss.onlinelibrary.wiley.com/doi/10.1111/1467-9884.00366>
- Koopman and Lit's dynamic bivariate-Poisson football forecasts: <https://academic.oup.com/jrsssa/article-abstract/178/1/167/7058470>
- Egidi et al.'s combination of scoring history and betting information: <https://arxiv.org/abs/1802.08848>
- Wheatcroft's evidence that forecast match statistics can add information beyond prices: <https://journals.sagepub.com/doi/pdf/10.3233/JSA-200462>

The incumbent already uses one Dixon-Coles score PMF, time decay, opponent interaction through attack/defense, home/away strengths, xG, and shrinkage. Five challengers were evaluated: pooled venue strengths, xG/shots-on-target blends, a score-driven pairwise count model, an Elo/matchup multinomial classifier, and historical opening-to-closing market arbitration. Several improved one opened historical slice, but all worsened at least one untouched or exact-forward score/Total/result gate. None replaces the score engine.

Generic market weighting and hand-built movement flips were also rejected. On the exact current-season replay they either reduced Match Result accuracy or failed to identify draws consistently. Market agreement remains a downstream accuracy/actionability check; evaluated prices still cannot pull every score toward consensus or turn a less-likely value side into the predicted result.

## Accepted draw lane

The raw Dixon-Coles marginal did not select one Draw across 790 release-comparable matches, even though 209 ended level. The accepted selector is deliberately narrow. It selects Draw only when all of the following are true:

- the exact-score mode is a draw;
- the better club's marginal exceeds Draw by no more than 8 percentage points;
- the two expected-goal means are within 0.20 goals;
- Draw probability is at least 24%; and
- neither club exceeds 40%.

The thresholds were selected on 2024-25 only. The 2025-26 season and exact 2026 r18 forward locks were then reported untouched.

| Cohort | Raw result | R19 result | Draw calls / wins |
| --- | ---: | ---: | ---: |
| 2024-25 selection (380) | 198-182, 52.11% | 202-178, 53.16% | 17 / 8 |
| 2025-26 untouched (380) | 185-195, 48.68% | 186-194, 48.95% | 24 / 9 |
| Exact 2026 r18 forward locks (30) | 11-19, 36.67% | 13-17, 43.33% | 2 / 2 |

The nearby 10-point draw gap was rejected despite looking stronger on the tiny current-season sample: it fell to 51.84% in selection and 46.84% untouched. This prevents current-result overfitting and a manufactured draw quota.

When the accepted lane selects Draw, the final displayed expected goals are equalized around the unchanged projected Total and the existing modal draw score becomes the representative score. Match Result, score direction, Total, and BTTS therefore remain one coherent card. The underlying PMF is retained for probability truth and auditability.

## Accuracy-first Match Result grades

The prior v23 Best Angle path could promote a low-probability result based only on price dislocation. In the exact forward release, a 37.1% Fulham forecast became Best Angle at +259. That was a value hypothesis, not an accuracy-first top pick.

Independent winner-confidence was stable across all three evaluation cohorts:

| Model probability floor | 2024-25 | 2025-26 untouched | Exact 2026 forward |
| --- | ---: | ---: | ---: |
| 50% | 119-73, 61.98% | 93-61, 60.39% | 5-4, 55.56% |
| 55% | 90-46, 66.18% | 64-35, 64.65% | 4-1, 80.00% |
| 60% | 66-32, 67.35% | 40-21, 65.57% | 3-0, 100.00% |
| 65% | 43-15, 74.14% | 24-11, 68.57% | 3-0, 100.00% |

V24 therefore reserves Match Result Best Angle for a non-proxy forecast at 65% or higher, agreement with the market favorite, and a price above -250. Lean requires at least 55%, market-favorite agreement, and a price above -300. The existing high-confidence short-price Lean remains available. A low-probability price dislocation can remain Watchlist evidence, but cannot masquerade as a high-confidence action.

| Exact r18 forward locks | v23 | v24 replay |
| --- | ---: | ---: |
| Actionable record | 2-5 | 4-1 |
| Grade mix | 6 Best / 1 Lean / 8 Watch / 15 No Play | 1 Best / 4 Lean / 11 Watch / 14 No Play |
| Actionable promotions / demotions | — | 4 / 6 |

On the current ten-game board, r19/v24 makes zero Match Result side changes. It promotes LEE@ARS from Watchlist to Lean at 68.0%, demotes BRE@AVL and FUL@IPS from Best Angle to Watchlist at 44.6% and 48.6%, and changes the actionable count from two to one. That is one net demotion, not a hidden board collapse. Existing Total and BTTS decisions are unchanged; their exact forward actionable records are 5-3 and 8-1 respectively.

## Safety and rollback

- The shared `prediction_pipeline:soccer` lease and single EPL writer remain authoritative.
- Current and opening prices, complete three-way boards, same-book trails, split evidence, lock timing and settlement are unchanged.
- No broad movement, public consensus or market-favorite flip is introduced. Missing market evidence remains neutral.
- Roll back future unlocked EPL output to r18/v23 if r19/v24 causes missing games or markets, score/side incoherence, a publication coverage regression, mixed release rows, lock failure or tracking failure. Never rewrite existing locked rows.

Reproducible audits:

- `scripts/operator/research-epl-draw-arbitration.ts`
- `scripts/operator/audit-epl-r19-v24-candidate.ts`
