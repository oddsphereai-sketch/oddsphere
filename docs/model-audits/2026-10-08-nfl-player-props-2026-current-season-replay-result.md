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
  sportsbook copies.
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

Canonical scopes had a 107-100 record, or 51.69% directional accuracy.

| Probability source | Mean forecast | Observed win rate | Calibration gap | Brier | Log loss |
|---|---:|---:|---:|---:|---:|
| Independent raw | 72.66% | 51.69% | 20.97 pp | 0.30482 | 0.83033 |
| Market | 50.45% | 51.69% | 1.24 pp | 0.24946 | 0.69209 |
| Published final | 56.08% | 51.69% | 4.39 pp | 0.25082 | 0.69504 |

Lower Brier and log loss are better. The game-cluster bootstrap difference for independent minus
published-final Brier was `+0.05534` with a 95% interval of `[+0.02158, +0.09092]`. Independent
minus market was `+0.05676`, interval `[+0.01414, +0.10192]`. Both intervals exclude zero in the
wrong direction for independence.

The result repeated in every completed week:

| Week | Scopes | Independent Brier | Market Brier | Published Brier |
|---|---:|---:|---:|---:|
| 1 | 6 | 0.36023 | 0.25695 | 0.26676 |
| 2 | 89 | 0.30119 | 0.24833 | 0.25019 |
| 3 | 67 | 0.30416 | 0.25246 | 0.24966 |
| 4 | 45 | 0.30558 | 0.24625 | 0.25168 |

The predeclared residual-weight diagnostic was monotonic in the wrong direction: market-only
weight `0.00` had Brier `0.24946`; the current-style `0.20` diagnostic had `0.25186`; `0.50` had
`0.26572`; and independent-only `1.00` had `0.30482`. This is in-sample diagnosis, not a new
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

Only two narrow cells were directionally encouraging, and neither is large enough for a release:

- Passing-yards independent probability: Brier `0.22012` versus published `0.23205` and market
  `0.24879`, but only 14 scopes in 9 games.
- Passing-attempts independent point MAE: `9.2854` versus published `9.3443`, only 16 scopes.

The largest repair needs are visible by market. Independent Brier was `0.40659` for passing
completions, `0.32981` for receptions, `0.31802` for rushing yards, and `0.30091` for receiving
yards. Independent point projections also carried an aggregate negative bias, especially in the
receiving markets.

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

1. **Probability calibration is the first independent-model repair.** The raw models should stop
   emitting 70%+ selected-side confidence on cohorts winning near 52%. Recalibration must be
   market-specific and trained walk-forward; it cannot be a blanket global shrink chosen on these
   same outcomes.
2. **Point models need market-specific bias repair.** Passing completions, receptions, receiving
   yards, rushing attempts, and rushing yards need their own workload, participation, matchup, and
   dispersion audits. The aggregate negative bias argues against a single shared correction.
3. **Market movement becomes a separate shadow reader.** Preserve the independent projection,
   then test paired rules—supportive movement promotion and adverse movement demotion—without
   rewriting the model probability. Do not auto-flip a pick from this sample.
4. **Retain every future T-60 full board and movement timeline.** The missing Weeks 1-3 full-board
   snapshots prevent a fair all-offer replay. Week 5 onward should preserve the complete decision
   universe, including No Plays, so selection accuracy and calibration can be evaluated without
   survivorship bias.
5. **Use Week 5 as the next untouched confirmation window.** The current Week 5 release has no
   settled outcomes. Freeze any candidate rules before settlement, then score independent point,
   independent probability, market, final, movement support/adverse, promotions, demotions, and
   board-count impact by release.

The practical conclusion is: keep the market as a safety rail today, but stop treating the blend
as the modeling solution. The independent model has a measurable calibration and point-center
problem; that is now the primary engineering target.

## Reproduction

Run:

```bash
node --import tsx --env-file=.env.local scripts/operator/audit-nfl-player-props-2026-current-season-replay.ts
```

The script is SELECT-only, performs zero provider calls, uses the stored current-season state, and
clusters uncertainty by game.
