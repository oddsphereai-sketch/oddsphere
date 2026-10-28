# CBB independent architecture and combined-product research: r6–r9

## Outcome

**The private r2 preview remains unchanged. No candidate from this round earns
replacement, and nothing is deployed.** Four structural variants, six basketball
mechanism heads, six evidence-maturity heads, and three combined-market heads
were tested. All choices, including failures, are retained in
`lib/cbb/artifacts/research-r6-r9.json`.

This round did find independent-model score improvements. They did **not**
consistently improve ML/spread/total picks at the archived quotes. Reporting only
their full-season winner/MAE gains would give the owner a misleading picture.

## Same-game full-season diagnostic

All rows below use the same 5,721 games and midnight UTC cutoffs with the six-hour
result holdback. 2022 warms up ratings; 2023 trains; 2024 selects one candidate
within each declared experiment. The selected head is refitted through 2024 and
then evaluated on the **already-opened** 2025 season (2025–26 calendar). These are
adaptively researched retrospective results, not a pristine holdout or promised
future accuracy.

| Independent version | Correct winners | Accuracy | Margin MAE | Total MAE | Winner corrections / harms vs r2 |
| --- | ---: | ---: | ---: | ---: | ---: |
| Frozen r2 preview | 4,112–1,609 | 71.88% | 9.2789 | 13.6378 | — |
| r6 season-end prior | 4,105–1,616 | 71.75% | 9.2534 | 13.6406 | 19 / 26 |
| r7 basketball interactions | 4,145–1,576 | 72.45% | 9.2306 | 13.5738 | 174 / 141 |
| r8 evidence-maturity interactions | 4,146–1,575 | 72.47% | 9.2267 | 13.5709 | 177 / 143 |

R7 Brier/log loss improve 0.180016/0.530108 → 0.178533/0.526666;
r8 improves them to 0.178601/0.526654. R8's aggregate calibration gap instead
worsens 0.013725 → 0.014966. Neither gets close to the requested sub-6 margin
and sub-10 Total MAE targets.

Calendar-date block bootstrap (2,000 fixed-seed draws over 148 dates): r7 MAE
delta intervals are margin [-0.0920,-0.0061], Total [-0.1150,-0.0167]; winner
accuracy [-0.00073,+0.01218] includes zero. R8 intervals are margin
[-0.1021,-0.0042], Total [-0.1280,-0.0094], winner [0,+0.01243]. These quantify
within-cohort sampling variation, not selection bias, team dependence or future
season uncertainty. R8's early-season score gains weaken/reverse in some later
months. This is not a reason to declare its early-season subset validated.

## Actual archived opening-line picks

The independent model is rerun at each exact selected target quote timestamp,
not replaced with a later daily forecast. The frozen r2 scores must reproduce
their previous quote-time replay to 1e-8 before comparison. There are 888 unique
fixture/cutoff pairs across the two overlapping cohorts below. Do not add their
counts or present them as independent samples.

353-game three-market research cohort:

| Version | Moneyline W–L–P | Spread W–L–P | Total W–L–P |
| --- | ---: | ---: | ---: |
| Frozen r2 | 241–112–0 | 198–155–0 | 175–178–0 |
| r6 | 243–110–0 | 196–157–0 | 176–177–0 |
| r7 | 239–114–0 | 184–169–0 | 189–164–0 |
| r8 | 240–113–0 | 186–167–0 | 186–167–0 |

The broader 635-game Total-only cohort:

| Version | Total W–L–P | Corrected / harmed Total decisions | Hypothetical units at one risked |
| --- | ---: | ---: | ---: |
| Frozen r2 | 341–294–0 | — | +14.94 |
| r6 | 342–293–0 | 3 / 2 | +16.84 |
| r7 | 335–300–0 | 64 / 70 | +3.50 |
| r8 | 331–304–0 | 82 / 92 | -4.29 |

These are all-game side choices, **not** Best Angles or live tracking. Units use
the actual recorded side price, not an assumed -110. Eight fixed Saturdays are
a narrow, correlated sample. ML/spread fixture orientation is independently
corroborated, but not certified at the bookmaker selection level. Opening quotes
are not closing-market or nuanced movement-reader evidence. All original matching
and source restrictions remain in force.

## What was learned

1. **The 24-pass fit is not the main problem.** Every refinement converged; the
   convergence-only variant changes score error by only a few millionths on
   selection. The largest first refinement update was 0.00263 rating units.
2. **Offseason prior aging is testable, but not a proven upgrade.** Moving the
   previous-season endpoint from July 1 to its last accepted result improved
   margin error slightly but lost seven full-season winners. It is not adopted.
3. **Date-specific national normalization is not automatically better here.**
   Both tested variants worsen Total MAE on selection. The method described in
   [Ken Pomeroy's additive-model update](https://kenpom.com/blog/ratings-methodology-update/)
   motivated the test; our estimator is not a reproduction of his implementation.
4. **Basketball interactions carry some signal.** R7 combines shooting/shot mix,
   turnovers, rebound recovery and FT scoring through a possession-accounting
   feature, plus pace-gap and smooth closeness interactions. Learned corrections
   lower score errors and improve full-season winner counts, but those benefits
   do not establish better quoted spread/Total choices.
5. **Maturity interactions are not enough.** R8 learns how relationships vary
   with current-season sample size, with no hard calendar switch. It adds one
   full-season winner over r7 but does not resolve quoted-market regressions.
6. **The market layer cannot be assumed to rescue a weaker side decision.** R9
   rebuilds the opening-price context against r8 and jointly learns one final
   margin/Total. Its three penalties lose net 14, 7 and 8 selection decisions
   against frozen r2; none qualifies, so the later block is not used to choose
   another setting. No rejected head is connected to the preview.

This supports a narrower conclusion than “the model is broken” or “nothing can
improve”: lower average score error and higher full-season winner accuracy are
not sufficient replacement criteria for this product. The unresolved objective
is reliably improving the conditional side decisions at real lines **without
breaking the common score projection**. Small opened-cohort gains cannot certify
that. More blind coefficient sweeps or a separate winner for every market would
not resolve the evidence requirement.

## Implementation and safety

- New research modules/operators are local-only. They use cached raw data and
  make zero provider calls or production writes in this round.
- R2's numerical forecasts, portable artifact, activation flag and original
  preview are unchanged. No route, cron, writer, lease, shared reader, grade,
  stake, tracking row or locked payload is changed.
- New r9 reader heads have their own release and must match the r8 independent
  release at fitting and inference. Wrong/missing lineage is rejected.
- Fixed a private forecast-label defect: `forecastCbbGame` now propagates its
  rating state's release instead of always labeling research-state forecasts r1.
  This changes no numeric output and does not relabel existing stored artifacts
  or locked records. R1 forecasts retain their original r1 identifier.
- New tests cover numerical convergence, prior timing, per-observation chronology,
  future/current-game box exclusion, mechanism direction, sample maturity,
  version lineage, input immutability and coherent scores/ML probabilities.
- Production base incorporated at the start of this round:
  `f7f33a327dc12b5813853e3a618b41ebc2dc24da`. The task started this round at
  `524b646fc249abcc12a3b224e7ae2f2ca2c66592` and integrated the new main in its
  dedicated worktree, without touching the shared primary checkout.
- Before publishing the private draft branch, main advanced to
  `41c52c3ece7000cc820c82c878b02701ab4d89a9` (#858 chart comparison work).
  It was integrated cleanly with no CBB overlap. The full
  `npm run verify:model-change` suite, all seven CBB suites, both affected
  prediction-market chart suites, TypeScript and focused ESLint passed on that
  fresh base. The optional PostgreSQL proof was skipped because
  `MARKET_BRAIN_POSTGRES_URL` is unset. The clean committed integration guard
  also passed; no protection/check bypass or main merge is performed.
- Actionable-board impact is zero: no promotions, demotions, grade/stake changes
  or activation changes are proposed by this research-only commit.

## Reproduction

From the dedicated worktree with the existing local raw data directory:

```bash
npx tsx scripts/operator/improve-cbb-structural-fit.ts
npx tsx scripts/operator/improve-cbb-matchup-mechanisms.ts
npx tsx scripts/operator/improve-cbb-matchup-mechanisms.ts --maturity
npx tsx scripts/operator/compare-cbb-score-candidates.ts --candidate=r7
npx tsx scripts/operator/compare-cbb-score-candidates.ts --candidate=r8
npx tsx scripts/operator/benchmark-cbb-independent-candidates.ts --include-maturity
npx tsx scripts/operator/evaluate-cbb-matchup-market.ts
```

Raw outputs remain in `/private/tmp/oddsphere-cbb-data/`: structural-fit,
matchup-mechanism, evidence-maturity, paired-r7/r8, independent opening benchmark
and matchup-market reports. The tracked compact JSON retains all 19 candidate
settings, numeric results and decisions. Detailed rows/receipts remain local.
