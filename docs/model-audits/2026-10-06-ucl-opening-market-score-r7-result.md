# UCL r7 target-excluded opening-market score arbitration — result

## Decision

Task worktree starting base: `414366068adc78db7c242582cb46531dd8068c49`.

Accept the UCL-owned `corroborated_crossing_w30` candidate for the next
unlocked UEFA Champions League slate. The independent Dixon–Coles club model
remains authoritative unless at least two complete provider opening 1X2 books,
after excluding the sportsbook whose quote is evaluated for the grade, have a
different leading result than the independent model and the market leader is
at least five percentage points clear of the next outcome. When that gate
passes, a 70% independent / 30% target-excluded market log pool is solved back
to one coherent pair of scoring rates while preserving the independent
expected total.

This changes no member copy, label, layout, stake, writer, schedule, provider
request count, lock, settlement rule, or existing locked record. Match Result,
Double Chance, Total, BTTS, projected goals, and grade inputs all consume the
same final score distribution.

## Release identifiers

- Model: `ucl_goals_coherent_2026_10_06_r7_target_excluded_opening_market_score`
- Coherent outcome: `ucl_coherent_market_outcome_2026_10_06_r3_target_excluded_opening_match_result`
- Arbitration: `ucl_opening_market_score_arbitration_2026_10_06_r1_corroborated_crossing_log_pool_30`
- Grade inputs: `ucl_grade_policy_2026_10_06_r7_opening_market_score_inputs`

Rollback is the complete r6 authority tuple documented in
`docs/current-model-releases.md`.

## Chronological evidence

The authenticated Ball Don't Lie UCL history supplied 378 exact frozen
regulation-result rows (189 in each of 2024 and 2025). Complete multi-book 2025
opening 1X2 evidence existed for 58 matches after choosing an evaluated book
from the independent forecast and excluding it. The first 38 priced matches
formed selection; the final 20, beginning 2026-03-17, remained the confirmation
block. The production implementation matched the selected audit candidate
bit-for-bit on all 58 rows.

| Metric | Independent selection | r7 selection | Independent confirmation | r7 confirmation |
| --- | ---: | ---: | ---: | ---: |
| Match Result | 20–18 (52.63%) | 23–15 (60.53%) | 10–10 (50.00%) | 10–10 (50.00%) |
| Multiclass Brier | 0.202889 | 0.199603 | 0.198784 | 0.195149 |
| Log loss | 1.017579 | 1.002929 | 0.988708 | 0.974952 |
| Per-team score MAE | 1.130246 | 1.127154 | 1.170749 | 1.160122 |
| Qualified market applications | 0 | 9 | 0 | 3 |
| Side flips | 0 | 4 | 0 | 0 |
| Flip corrections / regressions | 0 / 0 | 3 / 0 | 0 / 0 | 0 / 0 |

The broader continuous 30% candidate improved confirmation proper scores more,
but failed the live same-input board-shape gate by reducing actionables from 14
to 11. It was rejected. The narrower candidate retained the selection accuracy
gain, produced the best selection score MAE among qualified candidates, and
improved every confirmation proper-score/error metric without forcing a side
flip in that small confirmation block.

## Same-input current-board impact

The 18-fixture, 72-market October 13–14 board was captured once and replayed
through both authorities. The incumbent had 8 Best Angles, 6 Leans, 14
Watchlists, 44 No Plays, and 14 actionables. r7 had 7 Best Angles, 6 Leans, 15
Watchlists, 44 No Plays, and 13 actionables: one promotion, two demotions, two
Match Result side changes (with their corresponding Double Chance changes),
and no incoherent markets. The net one-actionable reduction is explicit, not a
quota; it pairs removal of an incumbent Best Angle on a flipped result with a
new target-excluded Best Angle and one confidence demotion. Missing prices
remain holds and were not manufactured.

## Operational boundaries

- The already-fetched provider opening board is reused; provider calls do not
  increase.
- The current exact quote remains economics and grade evidence only and is
  excluded from its own forecast.
- Fewer than two eligible alternative opening books is an exact independent
  fallback.
- Locked records remain immutable. The existing `ucl-daily-refresh` and
  `ucl-pregame-lock` writers remain under `prediction_pipeline:soccer`.
- Forward evaluation must remain release-pure by exact r7 model/calibration and
  lock timestamp.
