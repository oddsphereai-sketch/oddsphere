# NFL player props opportunity × share × efficiency predeclaration

Date: 2026-10-08  
Status: frozen shadow follow-up; 2026 Weeks 1-4 are already opened and remain diagnostic only

## Reason for this follow-up

The externally enriched direct heads selected and confirmed historical candidates for all three
passing markets, but their exact 2026 locked-board replay failed the full point, probability, and
retention gates. Rushing and receiving direct heads did not confirm in 2025. This follow-up does not
alter those results or reuse 2026 performance to select a candidate.

Published football modeling separates opportunity from execution. The next fixed hypothesis is that
Rushing Attempts, Rushing Yards, Receptions, and Receiving Yards should be modeled as:

1. an independent team rush/target opportunity budget;
2. a player share of that budget using strictly shifted workload, snap, role, and external features;
3. for yards and receptions, a conditional execution rate using the applicable pressure/box,
   expected-rushing, separation, expected-YAC, catchability, and position-matchup features.

No prop line, price, market probability, result, or movement signal enters a component.

## Frozen candidates and chronology

- Train through 2023 and select in 2024.
- Require non-regression in both MAE and RMSE in 2025.
- Candidate component models are fixed as regularized histogram gradient boosting:
  - Poisson team budgets;
  - squared-error player opportunity shares, clipped to `[0, 1]`;
  - squared-error bounded execution rates.
- Test the pure hierarchy and 25%, 50%, and 75% blends with the exact released point head.
- Open 2026 Weeks 1-4 only after the candidate name is frozen. Because that season has already been
  inspected in earlier audits, it is diagnostic evidence and cannot by itself authorize production.

## Gates

Each market must improve 2024 MAE and RMSE, not regress either metric in 2025, avoid a material bias
or underprediction failure, and then improve both point metrics with consistent weekly direction in
the 2026 diagnostic. Any exact locked replay must also preserve at least 80% of existing actionables
with symmetric promotion evidence and complete prices. Failure leaves the released market unchanged.

The tournament must separately report team-budget error, opportunity-share error, final-stat error,
coherence, feature coverage, and 2026 row coverage. This is shadow research only; no production
release identifier is reserved.
