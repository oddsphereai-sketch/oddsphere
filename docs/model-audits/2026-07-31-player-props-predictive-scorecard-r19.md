# MLB player-props predictive scorecard and r19 home-run model

Date: 2026-07-31
Candidate release: `mlb_props_2026_07_31_r19`
Production writes during research: none

## Decision

Replace the non-actionable batter-home-run probability read with the frozen market-residual
challenger. Do not change the separately validated home-run promotion sleeve, including its
selection probability, grades, or stakes. Do not release the batter-hits,
total-bases, H+R+RBI, pitcher-strikeout, or pitcher-outs challengers from this tournament.

This is the first release from a portfolio-wide predictive-accuracy program. Every supported
market was scored before selecting the first rebuild target; home runs were selected because
they passed both the chronological development sequence and the later exact locked holdout.

## Portfolio scorecard

The report card covers:

- 17 settled player-prop markets;
- 30 two-way or milestone offer channels;
- 321,478 historical opening-offer observations;
- 21,002 exact locked production rows from July 16–29;
- 4,601 later exact locked rows used for the popular-market holdout.

The broad scorecard separates reconstructed long-history probabilities from exact stored
production probabilities. Reconstructed results diagnose market families but are never
presented as exact release performance. Exact production rows remain attributable to their
immutable release identifiers.

Recent exact holdout examples showed the final production probability trailing the no-vig
market in most popular markets:

| Market | Rows | Market Brier | Final Brier | Final minus market |
| --- | ---: | ---: | ---: | ---: |
| Batter hits | 895 | 0.226858 | 0.229597 | +0.002739 |
| Batter total bases | 773 | 0.245111 | 0.247651 | +0.002540 |
| Pitcher strikeouts | 103 | 0.249350 | 0.256775 | +0.007425 |
| H+R+RBI | 865 | 0.246808 | 0.252206 | +0.005398 |
| Pitcher hits allowed | 82 | 0.255597 | 0.269654 | +0.014057 |
| Pitcher walks | 78 | 0.236767 | 0.244378 | +0.007611 |
| Pitcher earned runs | 84 | 0.248032 | 0.272027 | +0.023995 |

Lower is better. These results establish that changing promotion labels alone cannot solve the
core problem. The underlying event probabilities must improve.

## First-wave model tournament

The first wave tested batter hits, home runs, total bases, H+R+RBI, pitcher strikeouts, and
pitcher outs. Every fold used only prior games. Candidate selection occurred on the trailing
portion of the training period, followed by an untouched next-date evaluation block.

The candidate families separated opportunity and event rate where the data allowed it and also
tested prior-only threshold survival. A market-offset ridge stack was reported separately from
the independent baseball model so a market blend could not masquerade as independent lift.

| Market/channel | Forward rows | Current approximation | Market | Challenger | Market fold wins |
| --- | ---: | ---: | ---: | ---: | ---: |
| Batter hits, two-way | 6,478 | 0.240413 | 0.239398 | 0.238946 | 4/4 |
| Batter hits, milestones | 24,754 | 0.122225 | 0.118146 | 0.116127 | 4/4 |
| Batter home runs, milestones | 18,976 | 0.045542 | 0.039140 | 0.038662 | 4/4 |
| Batter total bases, two-way | 6,319 | 0.257045 | 0.243968 | 0.243553 | 3/4 |
| H+R+RBI, two-way | 6,447 | 0.259425 | 0.247262 | 0.246537 | 4/4 |
| Pitcher strikeouts, two-way | 384 | 0.259510 | 0.246000 | 0.251484 | 2/4 |
| Pitcher outs, two-way | 369 | 0.264594 | 0.242136 | 0.466301 | 0/4 |

The unstable pitcher stack is explicitly rejected. It is not part of runtime code.

## Frozen locked holdout

The batter challengers were frozen through July 23, then evaluated on exact public-display T60
locks from July 24–30. Probabilities were normalized back to a common Over event before scoring.

| Market | Rows | Market Brier | Current Brier | Challenger Brier | Challenger log loss | Decision |
| --- | ---: | ---: | ---: | ---: | ---: | --- |
| Batter hits | 1,463 | 0.236417 | 0.238809 | 0.236627 | 0.665955 | Reject: did not beat market |
| Batter home runs | 196 | 0.095161 | 0.099314 | 0.092503 | 0.330812 | Qualifies |
| H+R+RBI | 1,413 | 0.246559 | 0.248295 | 0.246047 | 0.685176 | Hold: interval crosses zero |
| Batter total bases | 1,263 | 0.243358 | 0.247534 | 0.243153 | 0.679353 | Hold: interval crosses zero |

For home runs, the market log loss was 0.340362 and the current final log loss was 0.354681.
The challenger calibration gap was +2.585 percentage points versus +5.131 for the market and
+8.848 for the current final probability.

The paired game/date-cluster bootstrap for challenger-minus-market home-run Brier produced:

- 67 clusters;
- observed delta: -0.002658;
- 95% interval: -0.006983 to -0.002000;
- probability the challenger is better: 99.96%.

The holdout contains multiple immutable production releases. Release-separated metrics remain
in the audit output; the aggregate is not labeled current-release performance.

## r19 runtime model

The immutable runtime model uses:

1. the last 20 prior home-run outcomes;
2. a line-specific development prior with strength 20;
3. the stored price-implied or paired market Over probability;
4. game home/away state;
5. the frozen market-offset coefficients fit through July 23.

It adds no trainer, provider, database writer, cron, or per-card request. The existing full-slate
research bundle supplies the prior outcomes, and the existing authoritative props writer remains
under the shared `prediction_pipeline:mlb` lease.

## Paired board impact

A no-persist July 31 full-slate comparison used the same 5,954 rows across r18 and r19:

- non-home-run probability changes: 0;
- home-run probability changes: 280;
- Best Angles: 8 to 8;
- Leans: 112 to 112;
- home-run Leans: 8 to 8;
- actionable promotions: 0;
- actionable demotions: 0;
- net actionable-board change: 0.

The existing promotion sleeve is intentionally unchanged, including the probability formula it
uses for the eight promoted Leans. The r19 residual therefore improves the non-actionable
home-run read only; it is not evidence that the actionable home-run selector has been
recalibrated. It makes 246 additional home-run rows inspectable as Watchlists instead of
research-only rows, while 9 rows become Pending Data because a model exists but required member
evidence is incomplete. This non-actionable board change is explicit and does not alter stakes.

## Reproduction

The read-only scripts use existing local caches and tracking data:

```bash
node ops-local/build-player-props-predictive-scorecard.mjs
SUMMARY_ONLY=1 node ops-local/popular-player-props-opportunity-model-tournament.mjs
node --import tsx --env-file=.env.local ops-local/validate-popular-player-props-locked-holdout.ts
```

Required verification:

```bash
npm run verify:model-change
node --import tsx scripts/test-mlb-props-engine.ts
npx tsc --noEmit
npx eslint lib/mlb/props/batterHomeRunsResidualModel.ts lib/mlb/props/liveBoard.ts
```

## Rollback

The rollback release is `mlb_props_2026_07_30_r18`. Roll back if production shows mixed current
release identifiers, stale or incoherent member snapshots, provider/request growth, actionable
board drift from the paired comparison, or home-run probabilities inconsistent with the frozen
runtime function.
