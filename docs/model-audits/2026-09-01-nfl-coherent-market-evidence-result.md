# NFL coherent market-evidence candidate result

Date: 2026-09-01
Starting research base: `3c114e3c0b696cdafbbd831f3fef8d2746a0a507`
Integrated production base: `5d0cb424adb707b7f6a13735a7dd5644c6738e37` (tree `f7964c922c727dba08a5c1a8f51ec59af3826c55`)
Candidate decision: `nfl_v1_daily_edge_decision_2026_09_01_r14_forecast_value_separation`
Candidate policy: `nfl_v1_grade_policy_2026_09_01_r14_qualified_underdog_value`
Status: standalone NFL source and registry candidate accepted on the deployed FI r78 production base; protected PR, deployment, natural writer, and live verification remain pending, and publication is held until FI's next natural-cycle member-coherence verification completes

## Root-cause decomposition

The first direct-PMF candidate was not publication-ready: actionable grades fell 13 to 9, with 8 promotions, 17 demotions, and 22 side changes. The evidence-stage replay showed that ordinary movement/public noise was not the primary cause:

- 21 side changes appeared when the old post-PMF Spread/Total heads were removed and the market-only PMF became authoritative.
- Three additional stage crossings appeared when public/sharp splits were added.
- Two appeared when movement was added. These stage counts can overlap in the final 22 rows.
- All final side-change rows had missing/stale Circa evidence, available public evidence, and available movement.

The accepted candidate moves the trained residual calibration into the PMF at a bounded 50% logit weight, then applies Circa/public/movement with an explicit weak-reversal threshold. This retains the football residual information without allowing it to remain a detached final-side override.

## Current-board result

The read-only production replay pinned 16 Week 1 evidence rows captured at `2026-09-01T16:36:09.845Z`, evaluated 48 markets, and made zero writes. The operator accepts `--captured-at=2026-09-01T16:36:09.845Z` so the frozen acceptance wave cannot silently move with a later writer refresh.

| Measure | Current release | Candidate | Change |
| --- | ---: | ---: | ---: |
| Best Angle | 5 | 11 | +6 |
| Lean | 8 | 10 | +2 |
| Watchlist | 8 | 7 | -1 |
| No Play | 27 | 20 | -7 |
| Actionable | 13 | 21 | +8 |

The clarified transition contains 18 promotions and 8 demotions. Promotions by market are Moneyline 5, Spread 7, and Total 6; demotions are Moneyline 6, Spread 2, and Total 0. Exact-price economics were strengthened for the special underdog path: a sub-50% side requires a positive price, at least two target-excluded comparators, at least 2% EV, and at least 2pp consensus edge before it can oppose the predicted winner.

| Market | Best Angle | Lean | Watchlist | No Play | Actionable |
| --- | ---: | ---: | ---: | ---: | ---: |
| Moneyline | 4 | 4 | 1 | 7 | 8 |
| Spread | 3 | 5 | 5 | 3 | 8 |
| Total | 4 | 1 | 1 | 10 | 5 |

The forecast itself had zero Moneyline winner changes on this frozen wave, and final score winner, Moneyline prediction, and outcome probability agreed for all 16 games. Four separately qualified Moneyline value bets opposed the predicted favorite: SF +168 at 40.76% / 9.24% EV / 4.05pp consensus edge (Best Angle), ATL +145 at 43.67% / 7.00% / 3.89pp (Lean), TB +171 at 38.77% / 5.07% / 2.93pp (Lean), and IND +155 at 40.40% / 3.03% / 2.06pp (Lean). The only forecast-side crossing versus the stored release remained the nonactionable WSH/PHI Total; Spread had zero side changes. Tests separately prove a fresh qualifying Circa shift can push an underdog above 50% and flip the expected-score direction, predicted winner, and Moneyline forecast together.

## Forecast and evidence impact

- All 16 games changed decimal projected score, with a maximum absolute expected team-score change of 2.738214 points.
- All 48 displayed probabilities and EVs changed; 12 target-excluded fair probabilities and 11 evaluated quotes changed after the qualified underdog value tuples were evaluated.
- Final score winner, Moneyline prediction, and primary outcome probability agreed for all 16 games.
- All 16 games had valid same-book movement. Across 48 market rows, Circa was missing or stale, public evidence was available, and movement was available.
- Circa therefore produced zero nonzero shifts, public evidence produced four, movement produced 43, and 43 combined evidence shifts were applied. Missing Circa evidence remained neutral and did not hold or flatten the board.
- No current-board evidence shift attempted a weak forecast direction reversal, so the runtime guard rejected zero live crossings. A focused synthetic boundary test proves that an ordinary public-only crossing is rejected, while a fresh qualifying Circa shift reverses the final PMF, expected-score direction, and predicted winner. A separate test proves a 46% underdog can become a positive-EV Best Angle without changing the favorite prediction, while a negative-EV underdog remains unselected even when the favorite is No Play.
- The residual calibration lives inside the margin and total distributions. Line probabilities recomputed from those distributions match the stored calibrated probabilities, and expected scores retain fractional precision.

## Rejected alternatives

- Direct PMF with no residual-head migration: 9 actionable, 8 promotions, 17 demotions, 22 side changes; rejected as flat and excessively disruptive.
- Full residual-head logit calibration inside the PMF: 29 actionable, 26 promotions, 8 demotions, one side change, and a maximum team-score move above 5.53 points; rejected as excessively promotional and too large a projection transition.
- Quarter-strength residual calibration: 6 actionable, 8 promotions, 14 demotions, 12 side changes, and a maximum team-score move near 1.60 points; rejected as a hidden flatter board.
- Half-strength residual calibration before forecast/value separation: 17 actionable, 15 promotions, 9 demotions, one side change, and a maximum team-score move of 2.738214 points; accepted as the coherent forecast core. The owner-authorized underdog-value clarification then added four independently qualified Moneyline values without changing any PMF, predicted winner, projected score, Spread/Total decision, or exact-price threshold for the forecast winner.

## Verification completed on the standalone candidate

- NFL cross-market coherence, actionable-grade, forward-writer, r6 portable parity, official tracking, and held-member fixture tests passed.
- TypeScript typecheck passed.
- The full mandatory `npm run verify:model-change` gate passed on the deployed FI r78 base, including NFL, CFB, MLB, WNBA, FI, props, soccer, tracking, reader, and lock-sensitive suites.
- The production `next build --webpack` gate passed on the FI r78 base.
- Read-only NFL and CFB production replays made zero writes.

## Later-wave observation

A separate unpinned read-only replay observed the later `2026-09-01T22:51:09.374Z` writer wave. It was not substituted for the frozen acceptance set. Its current board was already 16 actionable; the candidate produced 21 actionables with 19 promotions and eight demotions. The same four independently qualified Moneyline value bets opposed the favorite prediction, while Moneyline forecast-side changes remained zero. Three Total sides crossed, all nonactionable, and Spread had zero side changes. This is a changing-input observation, not a release-rule or exact-price relaxation; publication still requires fresh-base integration and live verification after FI r78.

## Fresh-base integration boundary

The standalone NFL candidate is rebased onto exact FI r78 production commit `5d0cb424adb707b7f6a13735a7dd5644c6738e37`. The shared movement primitive is byte-identical to the version already published by CFB r49, so it is not part of the NFL candidate diff. Every FI r78 source/contract file and every CFB runtime file remain byte-identical to protected main; the shared registry differs only by the new NFL r11 section above the unchanged prior NFL history. Publication remains held until FI's next natural-cycle member-coherence verification completes. Immediately before a protected NFL PR, refresh main again, preserve any intervening hunks, rerun affected gates and integration safety, and verify the remote PR tree matches the locally proven tree. After merge, verify the production commit, deployed release identifiers, writer and lease health, natural unlocked refresh, immutable T-60 records, official tracking, and signed-in Daily Edge behavior.
