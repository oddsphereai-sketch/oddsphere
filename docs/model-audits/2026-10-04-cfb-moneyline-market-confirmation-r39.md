# CFB Moneyline market-confirmation grade repair (r39)

## Scope and production boundary

- Sport / market: CFB Moneyline only.
- Changed layer: play-grade calibration after the existing independent forecast, coherent joint PMF,
  market arbitration and exact-price decision are frozen.
- Unchanged: projected scores, winner probabilities, selected sides, Spread and Total behavior,
  stakes, provider calls, schedules, the `prediction_pipeline:cfb` lease, member copy, labels and
  layout.
- Locked rows remain immutable. The release applies only to future unlocked decisions.
- Previous champion: decision r38, grade policy r16, market-grade production r26.
- Candidate: decision r39, grade policy r17, market-grade production r27.

## Failure diagnosis

The October 3 settled board contained 88 Moneyline forecasts and finished 58-30 (65.91%). The
member-facing actionable hierarchy was the failure: Best Angles were 4-5 and Leans were 12-9,
while Watchlists were 25-2. In the dominant exact r38 cohort, current actionables were 11-12,
-5.174 locked-price units and -22.50% ROI.

The old bridge treated model-minus-target-excluded-market disagreement as value. Across the
release-stamped September 1 through October 3 sample, actionable Moneylines with at least a five
percentage-point model advantage but without independent multi-channel market confirmation were
7-17, -10.353 units and -43.14% ROI. Those rows were also severely overconfident (0.4018 Brier,
1.0693 log loss).

This is not evidence that the independent winner model should be replaced with market consensus.
The complete October 3 forecast was still 58-30, and FBS-involved games were 39-15. It is evidence
that the actionability layer selected the wrong subset of that forecast.

## Repair

1. An existing actionable Moneyline is capped at Watchlist when model probability exceeds the
   target-excluded market probability by at least five points unless two independent market
   channels support the selected side and no channel resists it.
2. A current Watchlist favorite is promoted only to Lean when its verified price is between -201
   and -700, model win probability is at least 65%, and target-excluded market probability is at
   least 60%. This preserves likely-winner / parlay utility without making an expensive favorite a
   Best Angle or claiming that its displayed price has positive EV.
3. Exact-price execution state remains unchanged. A confidence Lean may remain `shop`; the release
   does not fabricate expected value or convert a non-bet price into a bet.
4. Sharp, public and movement inputs remain source-separated. No fallback split is relabeled as
   Circa and no single split feed can flip or promote a selection by itself.

## Locked chronological replay

The committed SELECT-only audit is:

```bash
npx tsx --env-file=.env.local scripts/operator/audit-cfb-moneyline-market-confirmation-r39.ts \
  --from=2026-09-01 --through=2026-10-03
```

Across 111 release-stamped current actionables, the paired policy moves 111 to 114 actionables:

| Surface | Record | Hit rate | Units | ROI | Brier | Log loss |
|---|---:|---:|---:|---:|---:|---:|
| Current | 78-33 | 70.27% | +4.512 | +4.07% | 0.2295 | 0.6633 |
| Candidate | 96-18 | 84.21% | +17.209 | +15.10% | 0.1571 | 0.4920 |
| 27 promotions | 25-2 | 92.59% | +2.344 | +8.68% | 0.0773 | 0.3008 |
| 24 demotions | 7-17 | 29.17% | -10.353 | -43.14% | 0.4018 | 1.0693 |

Release-pure checks preserve the direction of the result:

- r33: 17-5 current to 20-5 candidate; actionables 22 to 25.
- r34: 27-10 current to 32-9 candidate; actionables 37 to 41.
- r36: 4-2 current to 5-0 candidate; actionables 6 to 5.
- r37: 1-0 current and candidate; actionables unchanged.
- r38: 11-12 current to 16-2 candidate; actionables 23 to 18, with nine promotions and fourteen
  demotions inside that release.

On October 3 across the r36/r37/r38 transition, the counterfactual board is 22-2 instead of 16-14
and moves 30 to 24 actionables through ten promotions and sixteen demotions. This is an historical
counterfactual, not a promised future hit rate.

## Data-source finding

At lock, all 30 October 3 actionable Moneylines recorded Circa sharp direction as unknown. Twenty-
five had a fresh DraftKings fallback split. A blanket substitution was rejected: the fallback's
simple selected-side direction was 15-10 and frequently contradicted winners. The fallback remains
available on the existing member Sharp Book Splits surface, but it is not silently granted Circa's
internal trust weight. A future source-aware promotion requires its own release-pure validation.

## Release continuity and rollback

Evidence r34 / member r48, fixture r70, compact snapshot r29, reader r14, writer r94 and tracking
r35 stamp the new decision family. The reader explicitly accepts the immediately preceding r33 /
r47 / r38 evidence and r28 / r69 compact snapshot during the handoff, so the board cannot disappear
before the first r39 writer run. Immutable r38 locks are never rewritten.

Rollback r39/r17/r27 and the publication family together to r38/r16/r26 and r33/r47/r69/r28/r13/
r93/r34. Preserve every append-only evidence and tracking row. Roll back or hold the candidate on
mixed releases, a missing board, lost market coverage, writer overlap, lock failure, or unexpected
actionable collapse.
