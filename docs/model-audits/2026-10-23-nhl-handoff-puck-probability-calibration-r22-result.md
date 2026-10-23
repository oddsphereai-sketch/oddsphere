# NHL handoff puck-line probability calibration r22 result

Date: 2026-10-23

Status: rejected. Never received live authority.

The frozen Platt fit selected ridge 40 on 2024 after fitting 2023. Its
intercept is `0.9295113063140249` and slope is `0.002986632490336848` on raw
selected-side log odds. On untouched 2025 it improves puck-line Brier from
0.16738 to 0.16310 and log loss from 0.51963 to 0.51045. Exact-price
actionables move 43 at 35-8 / +10.72u to 47 at 38-9 / +10.94u.

The transform is nevertheless almost flat at approximately 71.7% and expands
the full 2026 board from 319 to 328 actionables. The complete package therefore
fails the predeclared no-board-expansion gate and is not a professional
probability surface. No cutoff, ridge, or alternate transform was tried after
opening the result. Production code does not include this calibration.

