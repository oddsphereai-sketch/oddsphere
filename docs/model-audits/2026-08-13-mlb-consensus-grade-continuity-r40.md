# MLB Moneyline consensus-grade continuity — r40

Date: 2026-08-13

Scope: MLB full-game Moneyline member-facing grades only

Decision release: `mlb_daily_edge_decision_2026_08_13_r40`

Rule bundle: `mlb_daily_edge_rule_bundle_v39_2026_08_13`

Grade policy: `mlb_public_grade_policy_v30_consensus_grade_continuity_2026_08_13`

## Problem

R37 independently validated a neutral-movement 70/70 SharpAPI Best Angle and an unchanged-side
1.5-point toward-movement Lean. A selected side could therefore be a Best Angle while movement
was neutral, then fall directly to Watchlist when a small favorable move appeared: it was no
longer neutral but had not cleared the separate movement sleeve. Texas on August 13 exposed this
gap. The pick, price coverage, data quality, and supportive split evidence remained intact.

## Decision

Preserve the existing Best Angle only for neutral movement. When the exact same high-quality,
fresh, -200 through +200 selected side still has at least 70% SharpAPI tickets and 70% SharpAPI
money but movement is now toward the pick, grade it Lean. Movement against the pick remains
ineligible. The rule changes no side, probability, projection, price, stake, hold, no-bet, or
data-quality decision.

## Chronological evidence

The read-only audit used locked and settled MLB Moneyline records from June 7 through August 12,
exact source-aware SharpAPI rows, recorded selected-side prices, frozen movement, high-quality and
fresh data, and excluded holds, no-bets, market corrections, and inversions.

The full favorable-movement 70/70 cohort went 40-18 (+6.374 units, +11.0% ROI):

- train: 7-2, +27.4% ROI;
- validation: 18-8, +11.3% ROI;
- holdout: 15-8, +4.2% ROI.

The previously nonactionable incremental cohort went 24-8 (+5.689 units, +17.8% ROI):

- train: 4-1, +28.8% ROI;
- validation: 10-4, +12.0% ROI;
- holdout: 10-3, +19.8% ROI.

A 20,000-resample slate-date bootstrap for that incremental cohort estimated an 89.47%
probability of positive ROI; its fifth-percentile ROI was -5.7%, so the evidence supports Lean,
not Best Angle. The 1.0-to-1.5-point sub-band was only 6-5 and negative ROI, independently
confirming that Texas should not retain Best Angle solely because its move is favorable.

## Paired board impact and rollback

At the August 13 current snapshot, r40 adds Texas Moneyline as one Lean and creates no demotions;
the existing neutral Best Angles and movement Leans retain their current grades. The single
authoritative writer remains `lib/services/predictionRecordService.ts` under the shared MLB
`prediction_pipeline` lease.

Rollback is r39 with rule bundle v38 and grade policy v29. Roll back for mixed current-slate
release identifiers, a missing exact SharpAPI pair, adverse movement receiving protection,
unexpected board flattening, or writer/reader disagreement.

Reproduce the read-only evidence with:

```bash
npx tsx --env-file=.env.local scripts/operator/audit-mlb-neutral-consensus-continuity.ts
```
