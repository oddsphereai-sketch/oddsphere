# MLB confidence/value/context grade hierarchy — r55

Date: 2026-08-17
Scope: MLB Moneyline and full-game Total public action grades only
Decision release: `mlb_daily_edge_decision_2026_08_17_r55`
Rule bundle: `mlb_daily_edge_rule_bundle_v49_2026_08_17`
Grade policy: `mlb_public_grade_policy_v39_confidence_value_context_hierarchy_2026_08_17`

## What changes

r55 retains the r54 prediction sides, probability heads, calibration, projections,
market-context side policy, validated flip/correction rules, exact prices, stakes, writer,
reader, and shared `prediction_pipeline` lease. It adds one Lean path per market so the
public grade hierarchy can express a strong winner candidate whose price or context does
not earn Best Angle.

- Moneyline requires selected-side probability at least 60%, offered-price edge no worse
  than -3 percentage points versus the exact American break-even probability, same-side
  run projection, and an observed directional move. Public/sharp conflict, signed market
  resistance, missing data, provisional state, distance-cap/confirmation flags, projection
  conflict, and every side change remain blockers. A qualifying adverse move can reduce
  the ceiling to Lean without erasing an otherwise coherent side.
- Total requires calibrated selected-side probability at least 55%, offered-price edge no
  worse than -1 percentage point, same-side total projection, no adverse movement, and no
  public/sharp conflict. Missing data, provisional state, and every correction/side-change
  path remain blockers.
- Neither rule changes a side, manufactures an opposite-side probability, creates a Best
  Angle, changes a stake, or imposes a fixed odds ceiling such as -120 or -200.

## Chronological evidence

The read-only replay used settled, priced, locked MLB `prediction_records`, excluded held,
launch-day, changed-side, and push rows where appropriate, and reconstructed the current
Moneyline and Total probability heads for pre-head records. Dates through July 17 were
development, July 18-31 validation, and August onward holdout. Historical releases were
not blended and called current-release performance; reconstruction was used only to test
the same proposed rule against comparable locked inputs.

### Moneyline selected cohort

| Partition | Record | Accuracy | Units | ROI | Brier | Log loss | Calibration gap |
|---|---:|---:|---:|---:|---:|---:|---:|
| Development | 11-4 | 73.3% | +2.189 | +14.6% | 0.1994 | 0.5847 | -6.7 pp |
| Validation | 11-4 | 73.3% | +1.683 | +11.2% | 0.1974 | 0.5842 | -9.6 pp |
| Holdout | 17-8 | 68.0% | +0.331 | +1.3% | 0.2171 | 0.6254 | -3.0 pp |
| Combined | 39-16 | 70.9% | +4.204 | +7.6% | 0.2069 | 0.6031 | -5.8 pp |

The incremental previously nonactionable Moneyline subset was 28-12, +2.636 units,
+6.6% ROI. The public-conflict veto remains justified: its separate cohort was 15-16,
-4.982 units, -16.1% ROI.

### Total selected cohort

| Partition | Record | Accuracy | Units | ROI | Brier | Log loss | Calibration gap |
|---|---:|---:|---:|---:|---:|---:|---:|
| Development | 25-21-1 | 54.3% | +0.765 | +1.6% | 0.2502 | 0.6935 | +6.1 pp |
| Validation | 9-4 | 69.2% | +3.071 | +23.6% | 0.2305 | 0.6539 | -11.3 pp |
| Holdout | 14-7-1 | 66.7% | +4.538 | +20.6% | 0.2281 | 0.6490 | -9.3 pp |
| Combined | 48-32-2 | 60.0% | +8.374 | +10.2% | 0.2412 | 0.6754 | -0.8 pp |

The incremental previously nonactionable Total subset was 17-10, +4.154 units, +15.4%
ROI. Adverse Total movement remains excluded; its broad separate cohort was 83-80-4 and
essentially flat at +0.098 units.

Release identifiers were also audited separately. Individual recent release slices are
small (for example, Moneyline r22 was 9-2, r24 was 5-2, r25 was 3-3, and r48 was 0-1;
Total r22 was 4-1-1, r24 was 3-1, r25 was 3-1, r38 was 1-2, r48 was 4-0, and r49 was
0-1). There are no settled r54 rows in these cohorts. Accordingly, the combined replay is
reported as a current-head reconstruction across locked timestamps—not as observed r54
performance. The positive predeclared chronological validation and August holdout are the
promotion evidence; no historical release blend is labeled current-release results.

## Paired current-board impact

The August 17 database-only dry run proposed no writes. Across the full 11-game slate it
added two Moneyline actions and one Total action with zero demotions. One Moneyline addition
was an already-locked row and therefore cannot be republished under r55. On the four still
unlocked games, r55 adds one Moneyline Lean (ATH at KC: KC) and one Total Lean (ATH at KC:
Over), with zero demotions. The unlocked board moves from zero to one Moneyline action and
from three to four Total actions. Locked member decisions remain immutable.

## Safety, ownership, and rollback

The authoritative writer remains `lib/services/predictionRecordService.ts`; no refresh,
cron, provider request, or database writer was added. Publication remains under the shared
sport-scoped `prediction_pipeline` lease. Existing missing-data and incoherence states fail
closed.

Rollback is r54, rule bundle v48, and grade policy v38. Rolling back removes only the two
confidence/value/context Lean paths and restores the prior public grade hierarchy; all r54
prediction and market-context behavior is unchanged.
