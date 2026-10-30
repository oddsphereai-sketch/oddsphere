# CBB loss audit: an architectural defect and clearer failure priorities

## Bottom line

The audit found a concrete **neutral-site label-dependence defect** in the current
private r2 model and an even larger defect in the rejected r8 candidate. This is
a model-consistency problem, not something attributed to game randomness.

It also pinpoints where the new candidate loses spread decisions and shows why
reducing average score error has not delivered a large winner-accuracy jump.
**No model repair, improvement or production deployment is claimed here.**

Scope: private CBB retrospective forecasts, not live NBA/NFL records. The census
retains all 5,721 paired games, all 1,609 r2 losses, all 1,575 r8 losses and the
143 harmful winner flips. There are 3,969 games both get right, 1,432 both get
wrong, 177 corrected winners and 143 harmed winners. No loss is deleted or
labeled “pure variance.” The detailed ledger includes winning controls too.

## 1. Confirmed defect: neutral-site predictions depend on listing orientation

For each of the 689 verified neutral-site games, rerun the frozen model at its
original pregame cutoff. The original forecast must reproduce exactly. Then
swap only the listed home/away teams, keeping each team's actual historical
statistics, the same neutral venue, cutoff, model and uncertainty. Convert the
result back to the original team orientation.

Given these declared inputs, the same real-world matchup should retain the same
scores/probabilities. It does not:

| Neutral-site label-swap result | Private r2 | Rejected r8 |
| --- | ---: | ---: |
| Games tested | 689 | 689 |
| Predicted real-world winner changes | **104** | **135** |
| Average absolute margin discrepancy | 2.23 points | 3.34 points |
| Largest absolute margin discrepancy | 9.03 points | 13.78 points |
| Average Total discrepancy | 0.62 points | 1.16 points |
| Average probability discrepancy | 6.51 percentage points | 9.50 percentage points |

The score heads accept inputs that do not change when teams are swapped—such
as projected Total, pace, absolute margin and closeness—into a **signed**
home-margin correction without enforcing the appropriate neutral-site symmetry.
The global margin calibration offset is also applied to the listed home team.
Likewise, orientation-sensitive terms can affect the Total head.

Exact head accounting verifies how the r2→r8 score changes arise: shared-input
reweighting, shot profiles, basketball mechanisms and maturity interactions all
contribute and can offset each other. It would be incorrect to credit every gain
to the newly added statistics or remove the largest coefficient as if it were
causal importance. Every ledger explanation is mechanical, not a causal claim.

**Repair direction:** build a separately versioned head whose neutral-site margin
changes sign when team roles swap and whose Total does not change. Preserve real
home-court advantage and explicitly verified travel/host/seeding context; do not
silently infer an advantage from a provider's listing position. Keep both scores
and all market probabilities consistent with that shared forecast/distribution.
This is an input-consistency requirement, not a cap, confidence gate, manual
winner bump or ban on evidence-driven flips.

The 104 cases are **not 104 newly recoverable wins**. Either original orientation
could already be correct. The audit never selects the orientation that won and
does not reclassify any historical prediction. A repair still needs chronological
score/ML/spread/Total evaluation before adoption.

## 2. Most losses are in games the model already considers uncertain

| R2 selected-side confidence | Games | Correct | Losses | Losses implied by its probabilities |
| --- | ---: | ---: | ---: | ---: |
| 50–60% | 1,427 | 780 | 647 | 643.1 |
| 60–70% | 1,376 | 866 | 510 | 482.5 |
| 70–80% | 1,121 | 830 | 291 | 282.8 |
| 80–90% | 921 | 796 | 125 | 141.9 |
| 90–100% | 876 | 840 | 36 | 40.9 |
| **All games** | **5,721** | **4,112** | **1,609** | **1,591.1** |

1,157/1,609 losses (71.9%) are in the below-70% confidence groups. The aggregate
gap is about 18 additional losses, not hundreds of unexpected failures. Calendar-
date resampling gives an excess-loss-rate interval of [-0.69,+1.33] percentage
points, including zero. None of the five confidence-bin excess-loss intervals
excludes zero. This does not prove ideal calibration, strong predictive inputs,
or an accuracy ceiling: probabilities can be well calibrated but insufficiently
discriminating, and group averages can hide errors.

A large accuracy jump therefore needs stronger separation of the genuinely close
teams, not simply more aggressive confidence numbers or selecting only obvious
favorites. Removing uncertain games changes the evaluated board; it does not
improve the all-game model and is not proposed here.

432 losses finished within three points; 1,177 did not. Those are postgame labels,
not proof the first group was unavoidable or the second systematically predictable.
Overtime accounts for 141 r2 losses, but actual overtime is also unknown pregame.
Outcome-conditioned subsets are not valid calibration tests of the original
unconditional probabilities. All games remain in the record.

## 3. The new winner gains are concentrated in close decisions; spread harms repeat

Of r8's net +34 full-season winners, +35 come from the original 50–60% confidence
group and -1 from the 60–70% group. No winner changes occur above that range.
R8 corrects 172 and harms 137 of those original below-60% games. This is useful
but fragile signal, not a transformation of the model.

The overall calendar-date interval for winner improvement is [-0.017,+1.218]
percentage points. Removing any one date leaves +28 to +38 winners, and removing
all games involving any one team leaves +30 to +38; no single team/date explains
the entire gain. That sensitivity result does not eliminate sampling variation
or the adaptive selection bias of these already-opened outcomes.

At the real archived opening quotes:

- In 353 games, r8 Spread falls from 198–155 to 186–167: 51 corrected decisions,
  63 harms. **Ten of the 12 net harms arise where r2's projection was less than
  one point from the spread.** The regression appears on five separate dates
  (-2,-2,-4,-2,-2), with no improvement on the other two. Leaving any one date
  out still leaves -12 to -8 decisions. This is a recurring small-edge weakness
  in this sample, not a reason to promote those crossings.
- In the broader 635-game Total cohort, r8 falls 341–294→331–304. However,
  February 28 alone contributes -12 net decisions. Removing that date changes
  the remaining net to +2; the date-block interval spans negative and positive
  effects. The Total evidence is substantially more date-sensitive than Spread.
- The narrower three-market cohort gains 11 Totals even as the broader Total
  cohort loses 10. Those overlapping samples must not be added or selected
  based on which looks better.

**Repair direction:** investigate how learned corrections cross real market
thresholds within one coherent game distribution. Do not automatically retain
every old pick or impose a one-point no-flip gate. The audit locates a failure
mode; it does not validate a replacement rule.

## 4. One uncertainty width does not fit all games

R2 uses the same margin SD (11.88) and Total SD (16.99) for every game. The observed
error dispersion differs by *pregame predicted pace* in both seasons examined:

| Pregame pace | Earlier 2024 margin / Total SD | 2025 diagnostic margin / Total SD |
| --- | ---: | ---: |
| Below 65 possessions | 10.73 / 15.50 | 11.11 / 16.46 |
| 65–72 possessions | 11.83 / 16.38 | 11.65 / 17.12 |
| 72+ possessions | 12.50 / 17.80 | 12.57 / 17.70 |

The earlier season was used for model selection, so this repetition is exploratory,
not pristine independent confirmation. On 2025 fast games, the nominal 90% margin
interval covers 87.66%, versus 91.72% on slow games. Aggregate coverage near 90%
conceals this mismatch.

**Repair direction:** test learned game-dependent uncertainty and overtime-aware
score tails. Do not simply subtract confidence from fast games. Changing the
uncertainty width alone does not change a symmetric model's outright winner:
better relative-strength and matchup estimates are still needed for a major
winner-count gain.

## 5. Pace is a contributor to Total misses, not a complete explanation

An explicitly impossible postgame diagnostic substitutes actual regulation tempo
into the same forecast. Total MAE changes 13.64→12.43; also knowing the actual
extra overtime points changes this limited counterfactual to 11.67. These are
**oracles, not candidate forecasts or an achievable error floor**. Arithmetic
pace, remaining scoring-rate/adjustment and overtime components reconcile exactly;
their absolute sizes cannot be added as percentages of error because they offset.

This particular decomposition leaves substantial scoring error even with perfect
pace information. A pace-only patch is not enough to justify the sub-10 Total
target. Positive rescaling by pace cannot flip a predicted outright winner.

## Data integrity and evidence limits

All 5,721 games have exact paired box scores satisfying scoring identities.
No accepted box fixture-date/season mismatch, inconsistent reported OT sum or
incoherent projected score was found. The larger raw-data builder rejected 176
box-score identity mismatches rather than using them. There remain 66 incomplete
forecast inputs: 65 unverified venues and one additional incomplete-history case.
They are retained and individually identified, not called healthy or excluded.

Verified historical pregame injury/roster receipts and qualified movement/splits
paths for the 353-game opening cohort remain unavailable. The audit therefore
does not claim that an individual loss was caused by an injury, a missing sharp
signal or bad luck. Current raw game inputs are not proof of historical ingestion
receipt times; the existing six-hour availability assumption is retained.

## Deliverables, checks and next order of work

1. **First concrete repair:** neutral-site team-swap consistency, then a separately
   versioned predictive and real-line comparison. Do not reuse the r2 identifier.
2. **Next:** conditional uncertainty/tail modeling and near-line correction
   behavior; preserve coherent ML/spread/Total outputs and permit justified flips.
3. **For a larger winner gain:** improve information that separates close teams,
   with verified roster/availability/matchup inputs and qualified market sequences,
   rather than relabeling losses as randomness or increasing confidence alone.

The audit is complete; the model repair is **not implemented or qualified**.
The private r2 preview, production, grades/stakes, locks and live tracking remain
unchanged. Provider calls, prediction changes and production writes are zero.
Audit-unit tests prove the accounting, chronology, identity, uncertainty and
immutability mechanics; they do not make the failing model invariant pass.
All eight focused CBB suites, TypeScript, focused ESLint and the full
`npm run verify:model-change` safety suite passed on base
`41c52c3ece7000cc820c82c878b02701ab4d89a9`. Optional local PostgreSQL proof was
skipped because `MARKET_BRAIN_POSTGRES_URL` is unset. This is software/audit
verification, **not** model-invariance or predictive-upgrade qualification.

Tracked summary: `lib/cbb/artifacts/loss-audit-r1.json`.
Local detailed report/ledger: `/private/tmp/oddsphere-cbb-data/cbb-loss-audit-report.json`
and `cbb-loss-audit-ledger.json`. Each loss/harm includes original/candidate scores,
cutoff, pregame context, postgame-only factors and statistical contribution summaries.
The neutral audit retains every paired comparison in `cbb-neutral-orientation-audit.json`.

Reproduce with cached data:

```bash
npx tsx scripts/operator/benchmark-cbb-independent-candidates.ts --include-maturity
npx tsx scripts/operator/audit-cbb-losses.ts
npx tsx scripts/operator/audit-cbb-neutral-orientation.ts
npx tsx scripts/test-cbb-loss-audit.ts
```

Method context: [Gneiting & Raftery on proper scoring and forecast evaluation](https://sites.stat.washington.edu/people/raftery/Research/PDF/Gneiting2007jasa.pdf)
supports separating probability quality from raw classifications;
[scikit-learn's leakage guidance](https://scikit-learn.org/stable/common_pitfalls.html)
explains why discovering a subgroup on opened outcomes cannot qualify it as an
independently tested prediction rule. No model or financial recommendation is
inferred from these methodological sources.
