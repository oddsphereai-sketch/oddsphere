# NFL player props Anytime TD exact-price economic ledger result

Date: 2026-10-15
Decision: classify the released layer as both economically weak and probabilistically
miscalibrated; keep production actionability disabled

## Exact locked result

The immutable Week 5 board contains 45 canonical Anytime TD rows across two games. At each
row's exact locked sportsbook price, the board finished 11-34 for `-16.9555u` and `-37.68%`
flat-stake ROI. The average locked break-even probability was `21.69%`; the realized hit rate was
`24.44%`. That hit-rate comparison does not rescue the board because the wins and losses occurred
at very different prices.

The released final probability claimed `+9.20%` average expected value over all 45 rows and marked
32 rows positive-EV. Those 32 rows finished 7-25 for `-11.6114u` and `-36.29%` ROI. The claimed-EV
ranking was especially poor:

| Released ranking | Record | Units | ROI |
| --- | ---: | ---: | ---: |
| Top 5 expected value | 0-5 | -5.0000 | -100.00% |
| Top 10 expected value | 0-10 | -10.0000 | -100.00% |
| Top 20 expected value | 2-18 | -12.0000 | -60.00% |

This is an economic failure of the EV claim and its ordering, not merely an unlucky aggregate hit
rate. It is not evidence that a live betting portfolio lost money: the TD artifact intentionally
had no actionable grades. The nine Watchlist rows went 3-6 for `+2.0000u`; Held went 0-6 for
`-6.0000u`, and No Play went 8-22 for `-12.9555u`.

## Probability quality

| Probability | Brier | Log loss | AUC | Decile calibration error |
| --- | ---: | ---: | ---: | ---: |
| Released independent | 0.122582 | 0.367081 | 0.933155 | 0.125268 |
| No-vig market | **0.104257** | 0.340263 | 0.935829 | 0.170118 |
| Released final | 0.105544 | **0.339895** | 0.941176 | 0.170821 |
| Fixed independent ensemble | 0.108720 | 0.329791 | **0.959893** | 0.143912 |
| Fixed ensemble plus existing 20% residual reader | **0.103026** | **0.332261** | **0.957219** | 0.145762 |

The released final probability loses to the no-vig market on Brier and has `0.170821` decile
calibration error, so the released layer is also probabilistically miscalibrated. The fixed
market-independent ensemble materially improves independent Brier, log loss, and discrimination.
Its existing residual reader would beat the released final and the no-vig market on Brier, but
its calibration error remains too large to release from this two-game board.

The fixed ensemble also does not fix the economic ordering. Its 31 positive-EV rows went 9-22 for
`-6.8351u` (`-22.05%` ROI), and its top 10 claimed-EV rows went 0-10. A predictor swap alone is
therefore insufficient.

## Market reading and CLV

Twenty-three rows have an exact same-game, same-player, same-book `t60_lock` observation. Every
matched price was unchanged, producing zero positive, zero negative, and 23 flat CLV rows. No
`t24` or cross-book price was substituted. This is valid coverage but contains no directional
closing-line signal.

The ranking split is more informative. Released top-5 and top-10 no-vig-edge groups returned
`+1.8u` and `+1.0u`, while the posted-price expected-value groups returned `-5u` and `-10u`.
That pattern is consistent with longshot price distortion and overround—not proof of it from 45
rows. Primary betting-market research documents persistent favorite-longshot bias and recommends
using normalized probabilities rather than inverse odds when testing efficiency
([Goto and Yamada, 2023](https://doi.org/10.1016/j.iref.2023.03.002);
[Hegarty and Whelan, 2025](https://doi.org/10.1016/j.ijforecast.2024.06.013);
[Newall and Cortis, 2024](https://doi.org/10.1016/j.serev.2024.100042)). This supports keeping
no-vig market reading distinct from the independent forecast and treating raw posted-price EV as
an economic ranking that must earn its own validation.

## Classification and next repair

Classification: **both economically weak and probabilistically miscalibrated**. The economic
label applies to the published EV claim/ranking, not to a disabled actionable portfolio.

The next predeclared candidate adds the TD-specific information that the independent allocation
foundation currently omits: lagged player red-zone and goal-line opportunity, player scoring
base rate, team touchdown production, and opponent touchdown allowance. It remains fully
market-independent. Its probability gate is evaluated chronologically on 2024 selection and 2025
confirmation before the already-open Week 5 board is used only as a frozen external check. Price
and no-vig economics remain a separate market-reading gate.

No live probability, projection, grade, stake, writer, lease, or locked record changed. Board
impact: zero.
