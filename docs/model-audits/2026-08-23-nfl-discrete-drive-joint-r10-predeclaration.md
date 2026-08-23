# NFL discrete drive joint r10 predeclaration

Date: 2026-08-23

Status: frozen before r10 execution.

r10 retains the passing r9 discrete PMF, scoring-event concentration `1.00`,
shared-environment sigma `0.00`, shortest-contiguous interval rule, chronology,
coherence requirements, and Bet-grade boundary. It changes only the
representative-score point functional used for the member display.

The same frozen weights `0.00, 0.05, 0.10, 0.20, 0.40` are evaluated on 2023.
A candidate is eligible only with 100% positive PMF support, 100% forecast-
winner fidelity, zero tie contradictions, and combined team-score MAE no more
than `0.05` points above the best 2023 candidate. Among eligible candidates,
select the lowest mean weekly duplicated-pair rate, then the lowest combined
margin/total center distance, then the highest exact-score hit rate, then the
lower weight. This allows a statistically immaterial point-MAE difference to
resolve toward a more differentiated and center-faithful weekly slate.

After the weight freezes, 2024 and 2025 are opened. Each season must retain
100% support and winner fidelity with zero tie contradictions. Its team-score
MAE may not worsen by more than `0.15` points versus the r9 `0.05` functional,
and its mean weekly duplicate rate may not exceed that r9 baseline.

For current Week 1, the representative scores must retain all r9 structural
dispersion gates, contain zero tie/winner contradictions, and reuse no more
than six of the sixteen away/home score pairs. Every displayed score must be a
positive-support integer pair from the same PMF supplying moneyline, spread,
and total probabilities. No market price or game result enters point selection.

This candidate changes no exact-price grading contract. An r6-qualifying
coherent moneyline tuple may be a Lean; a coherent nonqualifier is No Play;
only a genuine price, identity, availability, or data-health failure is Held.
Spread and Total predictions remain visible even when their Bet grade is
No Play. No Best Angle or forced action count is authorized.
