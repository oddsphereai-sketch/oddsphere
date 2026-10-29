# College basketball neutral site and statistical model repair results

The private CBB candidate now has an implemented, tested repair for neutral-site
listing dependence. A new residual-stat model also improves full-season score errors
and winner accuracy, but it does not improve all quoted betting markets. None of these
candidates replaces the existing private R2 preview or activates CBB on the site.

## What changed

The neutral-site repair evaluates both equivalent team listings and produces one
listing-independent score. Genuine home games retain the original home-court treatment.
The narrow repair leaves all 5,032 non-neutral diagnostic forecasts unchanged within
numerical tolerance. A separately tested constrained refit did not beat that narrow repair
under the declared selection criteria.

Both the neutral repair and the new residual-stat model pass actual-state replay on all
689 neutral fixtures. Reversing the team listing gives opposite margins, identical
Totals, complementary winner probabilities and exchanged team scores. The largest
discrepancy is below 0.00000001 points. This removes a real software defect; it does not
prove that either orientation would have picked the eventual winner.

The residual-stat model keeps the repaired score as its starting prediction, then learns
corrections from additional shooting and matchup information. It regularized-residualizes
the 50 additional features against the original 19 inputs rather than freely refitting
the entire expanded model. All neutral margin corrections remain odd under a team swap;
Total corrections remain even. One final margin and Total determine both team scores and
every market probability. No manual market blend, winner override or minimum-edge veto
was added.

Uncertainty fitting used monthly out-of-sample mean predictions, not training-set mean
residuals. The game-dependent variance trial improved the joint marginal Gaussian score
on 2024, but worsened winner log loss versus the constant-variance trial. It was not
selected. The selected constant-variance control slightly improved 2024 probability
scores; its later results do not establish a broad improvement either.

## Full season comparison

These are the same 5,721 games from the already-opened 2025 season. They are retrospective
diagnostics, not a new untouched holdout. The mean heads use 2023 training and 2024
selection; the final fitted labels end before the evaluated season.

| Measure | Existing R2 | Neutral repair R10 | Residual stats R12 |
| --- | ---: | ---: | ---: |
| Winner record | 4,112–1,609 | 4,102–1,619 | 4,126–1,595 |
| Winner accuracy | 71.88% | 71.70% | 72.12% |
| Average margin error | 9.279 | 9.276 | 9.223 |
| Average Total error | 13.638 | 13.639 | 13.591 |
| Winner Brier score, lower is better | 0.180016 | 0.180017 | 0.178657 |
| Winner log loss, lower is better | 0.530108 | 0.530122 | 0.526941 |

Against R2, R10 corrects 19 winners and harms 29. R12 corrects 183 and harms 169:
14 net additional winners, or 0.245 percentage points. Its average Total underprediction
shrinks from 1.631 to 0.541 points, but the absolute Total error improves only 0.046 points.
The requested below-six margin error and below-ten Total error are not achieved.

For R12, the fixed-seed calendar-date bootstrap gives a winner-accuracy change interval
of approximately −0.416 to +0.888 percentage points. It includes no improvement. Removing
any one date leaves between 10 and 19 net additional winners, but that is not a substitute
for unseen validation or correction for all team dependence.

## Quoted markets do not show a complete upgrade

Every comparison uses the same existing quote and the same pregame forecast cutoff.
These are hypothetical directional picks at opening lines, not Best Angle or Lean records.

| Existing quote cohort | R2 W–L–P | R10 W–L–P | R12 W–L–P |
| --- | ---: | ---: | ---: |
| Moneyline, 353 games | 241–112–0 | 242–111–0 | 237–116–0 |
| Spread, same 353 games | 198–155–0 | 199–154–0 | 195–158–0 |
| Total, same 353 games | 175–178–0 | 175–178–0 | 186–167–0 |
| Total, broader 635 games | 341–294–0 | 337–298–0 | 333–302–0 |

R12's 353-game Total gain does not survive the broader Total cohort. It also loses four
moneyline winners and three spread winners in the three-market sample. R11 changes
uncertainty only, so its directional records equal R10. Opening prices do not establish
sharp movement interpretation, and the 353 fixtures have corroborated orientation rather
than independent selection-level side proof.

## Decision and remaining work

Keep the new code and results as private audit work. Preserve R2 as the unchanged
comparison preview, not as a claim that it is launch-ready or free of the diagnosed
neutral-site defect. No live shadow model, provider collector, writer, activation,
scheduled job, grade, stake, or locked prediction was created or changed.

The repairs show why a bug fix and a predictive upgrade are different claims. Symmetry
is now enforceable, and residual-stat learning improves some aggregate measures, but
market-specific accuracy remains mixed. Do not repeat the rejected expanded-head or
residual-stat settings as though untested, or tune a deadband on these opened 2025 losses.
The next evidence needed for choosing market-oriented corrections is chronologically
earlier quoted-line coverage, plus qualified movement evidence for the separate reader.
This turn does not certify missing historical injuries or market-reader integration.

## Reproduction and verification

Run the offline operators in order from the private branch:

```bash
npx tsx scripts/operator/repair-cbb-neutral-uncertainty.ts
npx tsx scripts/operator/evaluate-cbb-residual-stats.ts
npx tsx scripts/test-cbb-neutral-repair.ts
```

The operators accept no activation/publication arguments, read the existing cache in
`/private/tmp/oddsphere-cbb-data`, make zero provider calls and write local research
outputs only. The portable summary is `lib/cbb/artifacts/repair-r10-r12.json`; detailed
outputs are `cbb-repair-r10-r11-report.json`, `cbb-residual-stat-report.json`, and the
three release-specific diagnostic ledgers in that cache. The predeclaration is
`docs/model-audits/2026-10-28-cbb-repair-predeclaration.md`.

All nine focused CBB suites, TypeScript, scoped ESLint and `npm run verify:model-change`
pass. The optional Market Brain PostgreSQL integration proof is skipped because
`MARKET_BRAIN_POSTGRES_URL` is unset. The repair starts from remote main
`80a0154c73cc4729f5f2603bc204ee4e6c03462f`, with the other chats' changes preserved.
