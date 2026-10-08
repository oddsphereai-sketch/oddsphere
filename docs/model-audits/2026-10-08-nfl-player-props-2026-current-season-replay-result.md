# NFL player props 2026 current-season replay result

## Outcome

The first four completed weeks do **not** support reducing the market safety rail yet. They show
that the archived independent model was substantially overconfident and, on these locked picks,
less accurate than both the market probability and the published model/market marriage.

This does not mean the product should become more market-dependent. It means the route to a truly
independent product is to repair and validate the independent distributions first, while using
market movement as a separate shadow reader. Removing the market contribution from the existing
model would have made this replay worse.

No live projection, probability, grade, selection, stake, or release changed.

## Exact replay scope

- Stored 2026 state: 64 final games through Week 4, with 4,173 player-game stat rows.
- Immutable locked ledger: 209 exact actionable records covering 47 games.
- Canonical accuracy view: 207 game/player/market/line/side scopes after removing two duplicate
  sportsbook copies. Of those, 183 have a genuinely independent stored raw probability.
- The other 24 canonical scopes are QB workload rows whose stored point center used the released
  `market_dominant_expected_starter` path (90% market / 10% role). They remain in published and
  point-projection results but are excluded from independent-probability comparisons.
- Outcome matching: 209/209 records matched; 0 locked-payload errors and 0 disagreements with the
  151 already settled ledger records.
- The other 58 ledger records remain pending and unchanged. Stored current-season stats supplied a
  research outcome, not authorization to mutate the public record.
- Markets represented: passing attempts, passing completions, passing yards, receiving yards,
  receptions, rushing attempts, and rushing yards. There were no four-week locked actionable
  anytime-touchdown records to score.
- Weeks 1-3 do not have retained full-board snapshots. Week 4 has a separate exact-board replay.
  Therefore the four-week metrics below describe actual locked actionable decisions, not every prop
  displayed during those weeks.

## Independent probability versus market and published final

The exact independent-probability cohort had a 91-92 record, or 49.73% directional accuracy. The
complete 207-scope published cohort had a 107-100 record, or 51.69%.

| Probability source | Mean forecast | Observed win rate | Calibration gap | Brier | Log loss |
|---|---:|---:|---:|---:|---:|
| Independent raw | 74.81% | 49.73% | 25.08 pp | 0.31339 | 0.85102 |
| Market, same 183 rows | 50.56% | 49.73% | 0.83 pp | 0.24916 | 0.69147 |
| Published final, same 183 rows | 56.06% | 49.73% | 6.33 pp | 0.25231 | 0.69799 |

Lower Brier and log loss are better. The game-cluster bootstrap difference for independent minus
published-final Brier was `+0.06223` with a 95% interval of `[+0.02298, +0.10587]`. Independent
minus market was `+0.06551`, interval `[+0.01617, +0.12144]`. Both intervals exclude zero in the
wrong direction for independence.

The result repeated in every completed week on the clean independent cohort:

| Week | Clean scopes | Independent Brier | Market Brier | Published Brier |
|---|---:|---:|---:|---:|
| 1 | 6 | 0.36023 | 0.25695 | 0.26676 |
| 2 | 83 | 0.30570 | 0.24852 | 0.25101 |
| 3 | 63 | 0.31185 | 0.25264 | 0.25389 |
| 4 | 31 | 0.32803 | 0.24228 | 0.24979 |

The predeclared residual-weight diagnostic was monotonic in the wrong direction: market-only
weight `0.00` had Brier `0.24916`; the current-style `0.20` diagnostic had `0.25231`; `0.50` had
`0.26853`; and independent-only `1.00` had `0.31339`. This is in-sample diagnosis, not a new
weight-selection result.

## Point-projection accuracy

Across the 207 canonical scopes:

| Point source | MAE | RMSE | Bias | Correct side of line |
|---|---:|---:|---:|---:|
| Independent projection | 21.8400 | 41.8176 | -10.5613 | 50.72% |
| Published projection | 19.2661 | 37.2641 | -5.3554 | 51.69% |
| Offered line, descriptive only | 19.4082 | 36.8801 | -4.6594 | — |

Independent-minus-published MAE was `+2.57` in the archive aggregate. The game-cluster 95%
interval was `[-0.05, +5.87]`, so the point difference is directionally unfavorable but not yet
precise. The independent MAE was worse in all four completed weeks, failing the predeclared point
promotion gate.

Only one narrow point cell was directionally encouraging, and it is not large enough for a
release: passing-attempts independent MAE was `9.2854` versus published `9.3443`, across only 16
scopes.

The earlier apparent passing-yards probability improvement was not valid independent evidence:
12 of its 14 scopes used the market-dominant QB point center. The clean independent subset has only
two observations from one game and cannot support any conclusion.

The largest repair needs are visible by market. On exact independent rows, Brier was `0.45419` for
passing completions (five rows), `0.32981` for receptions, `0.31802` for rushing yards, and
`0.30091` for receiving yards. Independent point projections also carried an aggregate negative
bias, especially in the receiving markets.

## Market movement

Every canonical record had same-book opening and lock line/price evidence. A direct measured
opening-to-lock classification produced:

| Movement relative to pick | Scopes | Games | Win rate |
|---|---:|---:|---:|
| Supports pick | 37 | 25 | 56.76% |
| Against pick | 90 | 41 | 46.67% |
| Mixed or neutral | 80 | 28 | 55.00% |

The observed support-minus-against gap was about `+10.1 pp`, but its game-cluster 95% interval was
`[-11.3 pp, +33.2 pp]`. It is a legitimate shadow signal, not enough evidence to flip predictions.
The stored coarse movement label was less informative: its `support` cohort won 51.11% and its
`neutral` cohort won 51.85%.

These are market-movement results, not sharp-action results. The archived ledgers do not contain a
complete Pinnacle feed or another historical sharp-book designation.

## What changes in the work plan

1. **Repair target population and participation before tuning matchup weights.** Historical
   training included many roster/game zero rows that production settlement would void rather than
   grade. Model active/full/limited participation explicitly, then model production conditional on
   role.
2. **Rebuild opportunity as a team hierarchy.** Forecast team plays and dropbacks/rushes, then
   allocate routes, targets, catches, and carries coherently so player shares cannot exceed the team
   budget.
3. **Refresh real current-season matchup inputs.** The runtime currently refreshes basic box-score
   rates but leaves advanced EPA, explosive-rate, air-yard, YAC, CPOE, and snap-share inputs at the
   through-2025 artifact values. Those features cannot be treated as current 2026 matchup evidence.
4. **Calibrate each market-specific distribution.** Count props, yardage props, and rare-event
   touchdowns need different conditional distributions and walk-forward calibration. A blanket
   global shrink chosen on these outcomes is not authorized.
5. **Keep market movement as a separate shadow reader.** Preserve the independent forecast, then
   test paired supportive-movement promotions and adverse-movement demotions. Do not auto-flip a
   pick from this sample.
6. **Retain every future T-60 full board.** Week 5 onward must preserve the full decision universe,
   including No Plays, so selection accuracy and calibration can be evaluated without survivorship
   bias.

The practical conclusion is: keep the market as a safety rail today, but stop treating the blend as
the modeling solution. The independent model has measurable target, opportunity, matchup-currency,
distribution, and calibration problems; those are now the primary engineering targets.

## Reproduction

Run:

```bash
node --import tsx --env-file=.env.local scripts/operator/audit-nfl-player-props-2026-current-season-replay.ts
```

The script is SELECT-only, performs zero provider calls, uses the stored current-season state, and
clusters uncertainty by game.
