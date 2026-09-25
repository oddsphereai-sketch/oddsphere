# NFL possession-efficiency engine r3 result

Date: 2026-09-25

Verdict: rejected for production; retained as a bounded shadow component

The 2023 selection chose slow state, 75% offense / 25% opposing defense,
full pace adjustment, 50% efficiency adjustment, two home-field points, and
90% market weight on both margin and total. On the opened 2024-2025 replay it
did not improve team-score, margin, or total MAE; total direction was 49.91%,
spread direction was 50.28%, and probability non-regression failed.

The early-season Week 1-4 slice was better (54.33% spread and 50.78% total),
which makes the mechanism suitable for prospective shadow measurement, not a
live cutover. Production predictions, grades, stakes, tracking, and member
presentation remain unchanged.
