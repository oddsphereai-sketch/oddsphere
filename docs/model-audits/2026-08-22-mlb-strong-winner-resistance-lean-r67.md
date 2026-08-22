# MLB strong-winner resistance Lean r67

Date: 2026-08-22

Status: release candidate; verification and live deployment proof remain
pending.

## Product problem

The August 10 signed SharpAPI resistance rule treated money at least ten points
below tickets as an unconditional Moneyline stand-down. That was directionally
useful in the mixed historical population, but it flattened today's board by
turning several high-probability, projection-coherent likely winners directly
from an action into No Play even when the exact same-book quote was stable or
improving.

This mixed two different questions:

1. **Outcome confidence:** how likely is the selected team to win?
2. **Bet grade:** how attractive is the exact offered price with all market
   evidence included?

Sharp resistance remains relevant to the second question, but current-head
evidence does not support letting that one warning erase every strong winner.

## Frozen r67 rule

The selected Moneyline side can be retained or promoted only to **Lean** when
all of the following are true:

- active model probability is at least 60%;
- the modeled run projection agrees with the selected winner;
- the exact evaluated price is between -300 and +200 inclusive;
- movement at that evaluated sportsbook is neutral or toward the pick;
- there is no separate public-split conflict;
- there is no inversion, side correction, distance cap, provisional-data hold,
  or missing-required-data blocker.

The existing SharpAPI money-below-ticket warning stays in the snapshot and
reader evidence. The rule never flips a side, changes a probability, changes a
projection, creates a Best Angle, changes a stake, or mutates a locked record.

## Exact probability-head evidence

The read-only audit deduplicated 87 locked game/T-60 observations from August
15-21 and retained only rows from
`mlb_moneyline_away_market_40_45_raw_side_champion_v1_2026_08_15`.

- All signed-resistance rows: 26, 18-8, +2.887u, +11.10% ROI.
- Probability at least 60% with no adverse same-book move: 11, 9-2,
  +2.437u, +22.16% ROI.
- Full r67 coherent, bounded-price candidate: 7, 6-1, +1.652u,
  +23.60% ROI.
- Earlier slice through August 18: 4, 3-1, +0.204u, +5.10% ROI.
- Forward slice August 19-21: 3, 3-0, +1.447u, +48.25% ROI.

The sample is intentionally too small to authorize Best Angle. It is sufficient
for the narrower correction: preserve a guarded Lean instead of asserting that
the likely winner has no usable member-facing signal at all.

## Current-board impact

The read-only August 22 comparison identified three task-owned Moneyline
promotions and zero Moneyline demotions:

- WSH at MIA: MIA, 63.8%, -186, toward pick, Sharp money minus tickets -10 to
  -12 during the audit window, No Play to Lean.
- ATH at HOU: HOU, about 70.7%, -265, neutral, Sharp gap about -10, No Play to
  Lean.
- CIN at ARI: ARI, about 63.5%, -180, toward pick, Sharp gap about -11, No Play
  to Lean.

Other resistance rows remain held when a guard fails. In particular, adverse
same-book movement still blocks MIN at SD and SF at BOS, and independent
conflict/correction conditions remain authoritative. Total and First Inning
behavior is untouched. A Total grade that moved during the live comparison was
an unrelated input refresh and is not an r67 code effect.

## Immutable versions

- Calibration: `mlb_public_calibration_v27_strong_winner_resistance_lean_2026_08_22`
- Decision: `mlb_daily_edge_decision_2026_08_22_r67`
- Rule bundle: `mlb_daily_edge_rule_bundle_v55_2026_08_22`
- Grade: `mlb_public_grade_policy_v45_strong_winner_resistance_lean_2026_08_22`
- Correction: `mlb_prediction_corrections_v19_strong_winner_resistance_lean_2026_08_22`

## Required publication proof

Before declaring success: pass the full model-change gate and focused MLB
tests, integrate from fresh current main, verify the normal leased writer cycle,
confirm r67 on every mutable row while older locked rows remain immutable, and
visually inspect restored Leans plus the preserved Sharp and same-book movement
panels.
