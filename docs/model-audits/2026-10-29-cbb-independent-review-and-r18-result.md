# CBB independent review and r18 exact-center falsification

This is private CBB research, not activation. Three read-only independent
reviewers inspected the independent score model, market reader, and evaluation
design. We then implemented the frozen r18 exact-price-center test in the
separate predeclaration. These were independent AI code reviews, not external
human experts. No current CBB member prediction, writer, cron,
grade, stake, tracking record, or locked payload changed.

## Concrete findings

1. **An old Spread diagnostic used the wrong decision convention.** The
   readiness script chose a side from the sign of the estimated center plus
   line; the product's `reviewCbbQuote` uses discrete/no-tie probabilities.
   On these 1,070 cached games, the two conventions disagree in 351 cases
   using the old reference center. Old sign-based win deltas are not a
   production-pick result. The reusable market evaluation helper now calls
   `reviewCbbQuote`, with a boundary regression test.
2. **The price-to-score inverse was approximate.** The exact, release-stamped
   r18 path solves the same probability function used for a Spread/Total
   decision. It changes the median reference Spread center by 0.418 point on
   average, Moneyline by 0.087, and Total by zero in this particular cache.
   It changes 324 canonical reference Spread sides: 164 corrections and 160
   harms versus the approximate reference, only +4 net. A round-trip test
   covers an asymmetric integer Total with push mass.
3. **The historical market evidence is not live-market-equivalent.** The
   1,070-game cohort contains 59 January, 782 February, and 229 March games,
   no November/December games. Target opening cutoffs range roughly 5 minutes
   to 16 days before tipoff. Earlier reference *openings* may be stale by the
   target cutoff, and this BDL archive has no comparable live movement/splits
   or verified Owls-source timing. That is a data/decision-time mismatch, not
   something a more complex head can repair.
4. **Two independent-model mechanisms merit new tests, not another generic
   score tweak.** R2 carries last-season team strength at a fixed 0.8 despite
   roster turnover; current roster context is descriptive only. Four-Factor
   matchup features use raw per-game means rather than opponent-adjusted,
   recency-weighted rates. A neutral-site home/away-swap inconsistency is
   confirmed, but its already-tested R10 symmetry repair lost winners; it is
   not a newly discovered accuracy gain. Historical pregame roster receipts
   are not in the existing score cohort, so a roster-aware fit cannot be
   honestly declared validated from these files.

## Frozen r18 replay

The independent r2 forecast and exact target quotes were held fixed. One
depth-2, 40-round full score head used early games for fitting; February
selection and March later games were evaluated chronologically. A second fit
through February was checked on its 199 eligible March games. The old
approximate-center head was evaluated on the same games.

| Period | Candidate | Moneyline | Spread | Total | Margin MAE | Total MAE |
| --- | --- | ---: | ---: | ---: | ---: | ---: |
| February, 369 | r2 | 251 | 199 | 183 | 8.987 | 12.997 |
| February, 369 | old full head | 251 | 183 | 189 | 9.196 | 13.004 |
| February, 369 | r18 exact full head | 244 | 184 | 186 | 9.163 | 12.955 |
| March, 229 | r2 | 148 | 130 | 111 | 9.479 | 13.047 |
| March, 229 | old full head | 145 | 119 | 120 | 9.623 | 13.116 |
| March, 229 | r18 exact full head | 146 | 121 | 117 | 9.563 | 13.102 |
| Refit March, 199 | r2 | 132 | 114 | 102 | 9.362 | 13.234 |
| Refit March, 199 | r18 exact full head | 128 | 96 | 104 | 9.618 | 13.287 |

The correction is mathematically right, but **the r18 full-score model is
rejected**: on February selection it harms 16 Moneylines versus nine
corrections and 58 Spreads versus 43 corrections. On March the corresponding
counts are six versus four and 39 versus 30; the chronological refit is worse.
Its modest Total pick gains do not compensate for ML/Spread harms or score
error. No grades or stakes were tested or promoted. The old r5 fitting
semantics remain intact for historical reproducibility; only the explicit
r18 path requires a release-bound head and rejects mixed independent releases.

This opened, selected one-season cohort is not a pristine holdout. Its
reference-only correction is a diagnosis, not a betting rule. The meaningful
next independent-model test is a receipt-safe, player-aware preseason prior
and/or opponent-adjusted Four Factors, fitted on earlier seasons and checked
against r2 at exact decision times across all three markets. Without the
historical roster evidence and fixed-time quotes, we should not claim that
another fitted market head has solved the problem. We will not deploy a
live background candidate merely to collect a label.

Reproduce the no-provider-call r18 replay:

```sh
node --import tsx scripts/test-cbb-market-reader.ts
node --import tsx scripts/operator/audit-cbb-exact-price-centers.ts
```
