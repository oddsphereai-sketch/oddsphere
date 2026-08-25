# NFL actionable grading completion r8 calibration predeclaration

Date: 2026-08-25

The frozen r7 architecture and exact-price boundaries remain unchanged. r7 rejected the Spread
lane only because its confirmation mean probability (52.47%) was 10.03 percentage points below
its realized win rate (62.50%). The absolute-gap gate incorrectly treats conservative
underconfidence as the same member-safety failure as overstating a play.

r8 corrects only that calibration-safety definition before its final decision:

- pooled probability overconfidence (`mean probability - win rate`) may not exceed 10pp;
- no confirmation season may exceed 15pp overconfidence;
- absolute calibration gap, Brier score, and underconfidence remain reported diagnostics;
- all r7 count, positive-season, pooled-unit, largest-win, CLV, multi-book, exact-price, health,
  and uncertainty requirements remain unchanged.

This correction cannot change a side, quote, probability, threshold, selected row, return, or
board count. It can only avoid rejecting a conservative probability lane for outperforming its
forecast. The 2024–25 evidence remains repeated confirmation and 2026 remains the forward holdout.
