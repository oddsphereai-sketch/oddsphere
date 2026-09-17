# NFL player props touchdown pairwise-ranker result

Date: 2026-09-17

## Decision

No production or shadow promotion. Both pairwise teammate rankers failed the frozen confirmation
gates. The active probability-plus-market ordering and team-scoped expected-scorer count remain
unchanged.

## Results

The audit trained on 250,608 balanced scorer-versus-nonscorer teammate differences from
2016-2022. Regularization / tree size was selected on 2023 only. Every comparison used the exact
same team-level selected-player count as the incumbent.

The linear pairwise ranker improved 2023 F1 from 36.56% to 36.84%, but regressed in 2024
(37.43% to 36.80%), 2025 (37.39% to 36.31%), and Week 1 2026 (50.68% to 43.06%).

The nonlinear seven-leaf pairwise ranker did not beat the incumbent in 2023 and regressed in
2024 (37.43% to 36.89%), 2025 (37.39% to 36.22%), and Week 1 2026 (50.68% to 41.96%). On the
production-shaped Week 1 cohort it found 30 of 70 scorers; the incumbent found 37.

No probability, market residual, scorer count, member prediction, price, grade, action, stake,
lock, tracking row, writer, cron, lease, copy, or label changed. Activating either candidate would
knowingly reduce scorer quality.
