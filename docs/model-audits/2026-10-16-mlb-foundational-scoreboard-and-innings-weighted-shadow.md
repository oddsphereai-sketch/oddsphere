# MLB foundational scoreboard and innings-weighted Total shadow

Date: 2026-10-16
Status: **shadow/audit only; not an active MLB release**
Historical window: 2026-06-07 through 2026-10-15
Locked unique games: 1,488
Exact counterfactual cohort: 1,192 games with preserved feature capture and an exactly reconstructable uncapped posterior

## Decision

Do not change the active MLB release from this audit alone.

The audit found and implemented a disabled-by-default structural candidate that fixes one real
independent-score defect: the incumbent applies both the opposing starter factor and bullpen factor
as full-game multipliers even though they divide the same nine innings. The candidate blends those
factors by expected innings, changes only the projected Total, and preserves the incumbent
independent home-away margin exactly. This prevents a Total repair from silently changing the
Moneyline winner.

The structural candidate improves score and Total results in chronological validation and holdout.
The audit now also replays the exact current production writer over frozen lock evidence and tests
a standalone run-line distribution selector. It found a real Total-side and run-line accuracy
improvement, but it also proved that the current Total action classifier does not transfer to the
new probability head: it flattens the board and its resulting actionable subset fails the untouched
validation/holdout gate. The projection and side candidates therefore remain shadow-only pending a
replacement action-calibration rule, frozen run-line prices, owner approval, and live verification.

## Evidence contract

- Source rows are immutable `prediction_records` locks plus their settled scores.
- No stored lock was changed, relabeled, or reconstructed over a stored value.
- The counterfactual reconstructs only rows with preserved feature factors, starter workload,
  independent scores, posterior scores, trust, residual correction, and no active posterior cap.
- Chronology uses one fixed full-window partition:
  - train: 893 games, June 7 through August 16;
  - validation: 298 games, August 16 through September 7;
  - holdout: 297 games, September 7 through October 15.
- The paired counterfactual cohort contains 626 / 282 / 284 games in those partitions.
- Historical output spans many decision releases. It is historical architecture evidence, not a
  claim about the eight settled rows currently stamped r91.
- Competitor figures come from owner-provided screenshots. Dates, prices, pushes, game inclusion,
  and alternate-line construction are not normalized, so percentage comparisons are directional,
  not head-to-head certification.

## Baseline scoreboard

Unique-game historical output across mixed release eras:

| Market | Oddsphere | Screenshot benchmark | Interpretation |
|---|---:|---:|---|
| Moneyline | 864-624, 58.06%, +25.01u | 1366-1081, 55.82% | Oddsphere is higher on an unequal cohort. |
| Total | 746-725-17, 50.71%, -38.70u | 1192-1183, 50.19% | Accuracy is similar; pricing/economics are poor. |
| Total favorable +1 | 868-609-11, 58.77% | 1406-955, 59.55% | Screenshot is higher by 0.78pp. |
| Total favorable +2 | 1005-469-14, 68.18% | 1635-747, 68.64% | Screenshot is higher by 0.46pp. |
| Derived run line | 703-783, 47.31% | 1330-1117, 54.35% | Material unresolved weakness. |
| Derived run line favorable +1 | 938-548, 63.12% | 1626-821, 66.45% | Material unresolved weakness. |
| Derived run line favorable +2 | 960-526, 64.60% | 1762-685, 72.01% | Material unresolved weakness. |

Run-line results are accuracy-only mathematical derivations. Historical locks contain zero spread
rows in `lines_at_lock`, and MLB `line_history` contains no frozen spread observations. Official
run-line ROI, CLV, and exact alternate-price comparisons therefore cannot be claimed from this
history.

## Architecture diagnosis

The independent score equation uses:

`league runs × offense × opposing starter × opposing bullpen × park × weather × handedness`

The starter and bullpen terms are both applied at full strength. That double-counts two components
that share nine innings. It also explains the loss-audit bias pattern:

- good starters were under-projected by 0.735 total runs;
- bad starters were over-projected by 1.296 total runs;
- strong bullpens were under-projected by 0.888 total runs;
- weak bullpens were over-projected by 0.409 total runs.

The candidate uses an arithmetic innings blend for every starter/bullpen pair, then recomposes team
scores from the new Total and the exact incumbent margin. Moneyline margin, winner direction, and
margin MAE are therefore unchanged by construction.

## Paired structural result

### Score accuracy

| Partition | Stored Total MAE | Candidate Total MAE | Stored bias | Candidate bias | Margin MAE change |
|---|---:|---:|---:|---:|---:|
| All 1,192 | 3.451 | **3.413** | -0.143 | **-0.014** | 3.414 → 3.414 |
| Train 626 | 3.438 | **3.432** | -0.073 | +0.105 | 3.547 → 3.547 |
| Validation 282 | 3.658 | **3.601** | -0.167 | **-0.080** | 3.263 → 3.263 |
| Holdout 284 | 3.276 | **3.185** | -0.273 | **-0.211** | 3.269 → 3.269 |

### Total direction from the repaired posterior mean

| Partition | Record | Accuracy | Units | ROI |
|---|---:|---:|---:|---:|
| All | 626-558-8 | **52.87%** | +20.08u | +1.70% |
| Train | 330-288-8 | 53.40% | +13.80u | +2.24% |
| Validation | 149-133 | 52.84% | +3.63u | +1.31% |
| Holdout | 147-137 | 51.76% | +2.65u | +0.93% |

Paired favorable-line accuracy is 60.98% at +1 and 70.79% at +2. On the unequal screenshot
comparison, that is +2.68pp for the main Total, +1.43pp at +1, and +2.15pp at +2.

### Moneyline preservation

The candidate's independent and posterior margins equal the stored margins. On the paired cohort,
the stored posterior winner is 692-500 (58.05%) and remains 692-500. The shipped final Moneyline is
691-501 (57.97%). The candidate does not discard the market reader or create a new Moneyline head.

### Standalone run-line selector

Reusing the Moneyline side for the run line is the architectural error behind the 47% baseline.
The shadow now evaluates each actual market favorite/underdog ±1.5 pair with the joint Poisson run
distribution and chooses the higher cover-probability side independently of the Moneyline pick.

| Window | Standard run line | Favorable +1 | Favorable +2 |
|---|---:|---:|---:|
| All 1,192 | **692-500, 58.05%** | **844-348, 70.81%** | **913-279, 76.59%** |
| Train 626 | 58.31% | 69.97% | 75.88% |
| Validation 282 | 58.87% | 73.05% | 79.43% |
| Holdout 284 | 56.69% | 70.42% | 75.35% |
| Screenshot benchmark | 54.35% | 66.45% | 72.01% |

This is a stable accuracy improvement in every chronological block and exceeds each screenshot
percentage on the unequal cohort. It is not yet an ROI or value claim: historical locks did not
store run-line prices, so the price-aware market reader, units, CLV, and actionable tiers cannot be
validated retrospectively. Forward run-line line/price capture is still a production prerequisite.

## Probability, market reader, and final-board findings

The current Total pipeline is not one decision layer. It contains the score posterior, Poisson
probability, target-excluded price regularization, the trailing run-environment prior, score/side
reconciliation, and later writer market arbitration.

The repaired mean-direction candidate stays positive in train, validation, and holdout. The current
probability/regularization path does not: on the paired holdout it is 137-147 and -7.81% ROI. Market
price direction itself is 147-149 and -8.30% ROI on the full holdout. This is evidence that market
context is useful but cannot automatically own direction in every era.

Whole-number totals expose an additional probability defect: `P(over)` excludes pushes, but the
existing complement `1 - P(over)` assigns push mass to Under. Removing push mass before normalizing
the two decision probabilities improves the paired candidate only slightly (623-561-8 to
624-560-8) and weakens the candidate Best Angle cohort overall. It remains a documented shadow
finding, not a production change.

Current historical layer attribution also shows:

- stored posterior mean direction: 51.60%, approximately flat at available prices;
- stored raw probability direction: 50.42%, -3.30% ROI;
- stored holistic direction: 51.06%, -0.79% ROI;
- shipped final direction: 50.71%, -2.64% ROI;
- replacing shipped historical sides with the stored mean direction corrects 12 net losses over
  the full window and improves holdout from 46.80% to 51.18%.

This does not authorize deleting the market reader. It identifies where the current score,
probability, and reader layers need distinct responsibilities instead of blending the offered price
into the independent probability and then reading that market a second time.

## Exact current-writer replay

The audit reconstructs the current r91 writer inputs from immutable lock snapshots and replays both
the incumbent and candidate with identical frozen lines, openers, splits, prices, and game metadata.
It covers 1,180 of 1,192 candidate games; 12 are explicitly omitted because `lines_at_lock` is empty.
No database writes occur.

### Candidate A: repaired score plus incumbent Poisson/regime head

| Output | Incumbent current-writer replay | Candidate A |
|---|---:|---:|
| Final Total record | 600-573-7, 51.15%, -23.80u | **616-557-7, 52.51%, -5.16u** |
| Actionable Totals | 130-112, 53.72%, +3.30u | 88-80, 52.38%, -0.50u |
| Best Angles | 26-16, 61.90%, +6.56u | 4-1, 80.00%, +2.47u |
| Actionable board size | 242 | 168 |
| Best Angle count | 42 | 5 |

Candidate A corrects 16 net final Total decisions, but its holdout final record remains 138-146 and
the action board gets both smaller and worse. This fails the promotion gate even though aggregate
side accuracy improves.

### Candidate B: train-only independent score-gap probability

The second replay removes market-price regularization and trailing regime weighting from the
independent probability head. Direction comes from the repaired score relative to the line. A
zero-intercept logistic slope (0.084810) is fitted on 618 decided training games only; validation
and holdout are untouched. The market remains fully available to the downstream writer as a reader,
price, movement, and split signal.

| Partition | Incumbent final record | Candidate B final record |
|---|---:|---:|
| All replayed | 600-573-7, 51.15%, -23.80u | **616-557-7, 52.51%, +21.49u** |
| Train | 326-293-7, 52.67%, +9.57u | **330-289-7, 53.31%, +19.38u** |
| Validation | 136-134, 50.37%, -14.04u | **139-131, 51.48%, -1.14u** |
| Holdout | 138-146, 48.59%, -19.34u | **147-137, 51.76%, +3.26u** |

This is the strongest exact final-side candidate: it improves accuracy and price-weighted units in
all three chronological blocks, keeps every Moneyline side unchanged, and converts the full replay
from -2.47% to +2.23% ROI. It is not ready to promote because action calibration is not transferable:

- actionable Totals fall from 242 to 43 and Best Angles from 42 to zero;
- the 43 candidate Leans are 25-17-1 overall, but only 6-7 in validation and 0-2 in holdout;
- 12 newly promoted rows are 9-2-1, while 211 demoted incumbent actions are still 114-97 and +3.16u;
- Moneyline side is invariant, but 37 Moneyline grades/actions move because `computeConfidence`
  currently couples Moneyline confidence to the Total probability.

That last point is a cross-market architecture defect: changing the Total probability must not
silently retier a Moneyline whose side, win probability, and projected margin are unchanged.

### Unit accounting and claim boundary

The +45.30u difference between the incumbent (-23.80u) and Candidate B (+21.49u) is a diagnostic
flat-stake replay of **every priced final Total prediction**, not the return of the recommended
action board. Of 1,180 replayed games, 964 decided rows have a frozen price and 216 rows are either
unpriced or pushes. Candidate B flips 317 sides:

| Side relationship | Rows | Both sides priced | Incumbent units | Candidate units | Delta |
|---|---:|---:|---:|---:|---:|
| Unchanged side | 863 | 718 | +6.57u | +6.57u | 0.00u |
| Corrected loss to win | 166 | 132 | -132.00u | +128.92u | +260.92u |
| Harmed win to loss | 150 | 114 | +101.63u | -114.00u | -215.63u |
| Other flip/push | 1 | 0 | 0.00u | 0.00u | 0.00u |
| **All** | **1,180** | **964** | **-23.80u** | **+21.49u** | **+45.30u** |

This reconciles exactly: 166 corrections minus 150 harms create 16 net wins, while unequal plus-
money payouts on the priced flips produce the additional unit difference. It does not justify a
production profit claim. The actual Candidate B actionable board is only 25-17-1 and +6.50u overall,
then 6-7 in validation and 0-2 in holdout; its Best Angle count is zero. Competitor screenshots do
not include prices or units, and the historical run-line locks do not contain run-line prices, so
neither competitor-unit comparisons nor run-line unit claims are available.

## Best Angle and board impact

The structural candidate's pure-model Total grades, before writer-time confirmation and quality
gates, are:

| Grade | Record | Accuracy | Units | ROI |
|---|---:|---:|---:|---:|
| Best Angle | 45-30 | **60.00%** | +9.05u | **+12.07%** |
| Lean | 56-62-2 | 47.46% | -4.60u | -3.90% |
| Market Aligned | 414-376-5 | 52.41% | -4.51u | -0.57% |

Candidate Best Angles are 21-17 in train, 13-8 in validation, and 11-5 in holdout. The 75-game
candidate base board is smaller and stronger than the 193-game incumbent base-eligible cohort
(104-87-2, 54.45%, +1.83% ROI). Relative to incumbent base eligibility, the candidate adds 31
rows at 18-13 (+9.12% ROI) and removes 149 rows at 77-70-2 (-1.85% ROI); the removed cohort is
19-19 in validation and 11-17 in holdout.

Those base grades looked encouraging in isolation, but the exact writer replay above supersedes
them for production decisions. It proves that the current writer suppresses most of the candidate
board and that the remaining action cohort is not stable out of sample. This is precisely why the
candidate is not being promoted from its pure-model numbers.

## Feature coverage still missing from the independent model

The existing model uses team OPS, starter ERA/WHIP/K9 or pitch-quality proxy, bullpen ERA proxy,
starter workload, park, weather, and lineup availability. It does not yet provide a professional
complete MLB feature set:

- expected batting quality such as xwOBA/wRC+ rather than OPS alone;
- expected pitching estimators such as xERA/FIP/xFIP/SIERA;
- bullpen availability, leverage, and recent workload;
- implemented platoon/handedness aggregation (`handednessFactor` currently returns 1.0);
- defense and baserunning run value;
- travel, rest, series, and schedule interactions.

These gaps should enter through versioned, prior-only feature capture and chronological shadow
tests. They are not permission to add many correlated factors at once.

## Implemented shadow boundary

- `projectIndependent` accepts disabled option
  `useInningsWeightedTotalPreserveMargin`.
- The option blends starter/bullpen factors by expected innings for every starter.
- It recomposes team scores from candidate Total plus incumbent margin.
- V2.2 records enabled/applied, legacy Total, and candidate Total in audit output.
- The operator audit now includes the exact frozen-evidence r91 writer A/B, train-only score-gap
  calibration, cross-market grade-integrity count, and standalone run-line distribution replay.
- Default behavior remains disabled.
- Focused MLB model tests: 182 passed, 0 failed.
- TypeScript: passed.
- Targeted ESLint: passed.
- No release identifier, writer, lease, schedule, lock, stored prediction, or live board changed.

## Promotion requirements

Before this candidate can affect a member forecast:

1. Replace and chronologically validate the Total action classifier so the improved final side does
   not flatten the board or promote a validation/holdout-negative Lean cohort.
2. Decouple Moneyline confidence/grade from Total probability and prove the Moneyline public tuple
   remains invariant when only the Total head changes.
3. Freeze and capture run-line prices/history forward; replay the new 58.05% run-line selector
   through price, market-reader, grade, alternate-line, and Best Angle logic before publication.
4. Report the final paired promotion/demotion cohorts and board-count impact for every market.
5. Bump every affected release identifier and update `docs/current-model-releases.md` in the same
   production commit.
6. Run `npm run verify:model-change`, focused MLB suites, the no-write current-board rehearsal,
   latest-main integration safety, protected PR checks, and post-deploy live proof.
7. Obtain explicit owner approval for the production promotion.

Rollback for the current shadow work is deletion of the disabled option and audit script; active
production remains the October 9 r91 family with October 16 input-eligibility v3.
