# NFL direct side-classifier result

Date: 2026-09-21

Tournament: `nfl_direct_side_classifier_tournament_2026_09_21_r1`

Decision: rejected; research only; no production behavior changed

The direct classifier found a small and directionally stable spread signal:
pooled 2024-2025 MAE improved from 9.666360 to 9.662345, Brier improved from
0.250325 to 0.250070, and correction direction was right 53.80% of the time.
The applied correction was only 0.0980 points on average, however, and produced
one action in two seasons at the predeclared edge threshold.  It therefore
failed action sample, cross-season ROI, and both-direction action gates.

The total classifier was rejected outright: MAE worsened from 10.061581 to
10.179609, Brier from 0.250094 to 0.253321, direction accuracy was 47.50%, and
341 simulated actions lost 34.044 units for -9.98% ROI.

Neither model is eligible for production.  The result also rejects a broad
post-hoc side inversion: the only stable spread improvement is too small to
support a meaningful actionable lane, while the larger total displacements are
anti-predictive.

