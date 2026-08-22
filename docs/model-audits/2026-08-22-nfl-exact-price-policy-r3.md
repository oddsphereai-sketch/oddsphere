# NFL exact-price policy tournament r3

Date: 2026-08-22
Scope: NFL regular-season moneyline and spread; isolated historical shadow research only
Production predictions, grades, stakes, tracking, readers, crons, and release pointers changed: **no**

## Decision

Reject `nfl_exact_price_policy_shadow_2026_08_22_r3`. It does not authorize a
Lean, Best Angle, stake, published decision, or tracking row.

The audit tested the missing price-band layer over the accepted r2 opening-stage
margin shadow. Its purpose was to prevent large American-odds payouts and
favorite/longshot calibration error from masquerading as repeatable expected
value. The policy family was frozen on 2023 and then evaluated once on 2024-2025.

## Reproducible boundary

- Tournament: `nfl_exact_price_policy_tournament_2026_08_22_r3`
- Decision: `nfl_exact_price_policy_shadow_2026_08_22_r3`
- Forecast source: `nfl_pregame_market_residual_shadow_2026_08_21_r2`
- Reference: `nfl_market_reference_core_2026_08_20_r1`
- Provider prices: 1,358 genuine DraftKings regular-season openings, 2021-2025
- Policy selection: 2023
- Confirmation: 2024-2025
- Candidate policies: 1,080
- Public/sharp split history: unavailable and excluded
- Preseason: excluded

The source manifests retain their immutable checksums. The small portability
repair in `tournament_nfl_opening_residual_v2.py` resolves a missing absolute
cache path against the explicitly supplied research root; it does not alter an
input checksum, feature, prediction, candidate, or metric.

## Forecast rerun

The exact current-main rerun reproduced the accepted and rejected r2 heads:

- Margin correction: +0.01509 MAE over the opening reference across 543
  confirmation games; 2024 +0.02781 and 2025 +0.00242.
- Opening moneyline Brier: 0.20695 versus 0.20813 market-only.
- Opening spread Brier: 0.24950 versus 0.24964 market-only.
- Total correction: -0.04048 MAE and rejected; the total falls back to the
  market reference.
- Terminal moneyline and spread proper scores did not beat their terminal
  market references.

This remains a small opening-stage forecast correction, not a proven wager.

## Selected exact-price policy

The 2023 selection chose moneyline only, prices from -300 through +200, model
probability at least 55%, expected value at least 1%, and at most two actions per
week.

| Period | Actions | Record | Units | ROI | Positive CLV rate |
|---|---:|---:|---:|---:|---:|
| 2023 selection | 36 | 27-9 | +10.677 | +29.7% | 52.8% |
| 2024 confirmation | 33 | 18-15 | -0.664 | -2.0% | 45.5% |
| 2025 confirmation | 36 | 20-16 | -1.312 | -3.6% | 44.4% |
| 2024-2025 pooled | 69 | 38-31 | -1.976 | -2.9% | 44.9% |

The policy achieved full weekly coverage but failed positive locked-price value,
positive value in each confirmation season, and positive-CLV-rate gates. A
winning record did not overcome the offered-price distribution. The rule is
rejected rather than relabeled as a Watchlist or Lean.

## Product implication

The empty Week 1 evaluated-decision arrays are not a missing grader call. The
only historically tested decision releases fail their frozen value gates. The
forward evidence writer must continue collecting immutable prices, splits,
availability, weather, and T-60 rows, but its healthy operation does not make the
betting model launch-ready.

The next clean promotion partition is timestamp-locked 2026 evidence. Current
Week 1 public presentation may show schedule, market context, and explicitly
non-actionable outcome confidence, but it cannot claim this rejected policy as a
play grade.

## Board impact

- Promotions: 0
- Demotions: 0
- Net actionable change: 0
- Production behavior changed: no
- Official tracking changed: no

## Verification

- Python compilation for both tournament scripts.
- Full 1,358-game r2 chronological rerun from checksum-verified inputs.
- Full 1,080-policy r3 selection tournament and 2024-2025 confirmation.
- Report invariants confirm that minimum action count and weekly coverage pass,
  while locked-price value, per-season value, and positive-CLV-rate gates fail;
  `actionablePolicyAccepted` therefore remains false.

## Rollback

Delete the r3 tournament script, this audit, and ignored local report. No
database, member snapshot, grade, stake, tracking row, or production release
requires repair.
