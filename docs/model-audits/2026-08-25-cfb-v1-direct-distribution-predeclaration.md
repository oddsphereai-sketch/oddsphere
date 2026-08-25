# CFB v1 direct margin/total distribution predeclaration

Date: 2026-08-25

Status: frozen before rerunning confirmation

The r1 separate-team-score tournament passed its accuracy, calibration,
stability, and bias gates but failed the predeclared dispersion gate. On 2024
and 2025 its predicted total standard deviations were 5.75 and 5.49 points
versus 16.79 and 16.29 actual. The next experiment does not lower that gate or
rescale a displayed score cosmetically.

r2 is a materially different target architecture:

- one model directly estimates home margin;
- a second model directly estimates game total;
- each head selects independently among ridge, elastic net, histogram gradient
  boosting, and extra trees using 2023 only;
- a 2023-only affine calibration for each head corrects level and signal
  attenuation, with slope frozen to the bounded interval 0.75-2.50;
- expected home/away points are algebraically derived from the calibrated
  margin and total;
- one paired empirical home/away residual distribution produces reachable
  scores and all ML/spread/total probabilities.

The original 2021-2022 fit and 2023 selection boundary remains. Because r1 has
now reported 2024-2025, those seasons are explicitly repeated confirmation,
not pristine holdout. All r1 gates remain unchanged. The current 2026 immutable
captures remain the true forward holdout.
