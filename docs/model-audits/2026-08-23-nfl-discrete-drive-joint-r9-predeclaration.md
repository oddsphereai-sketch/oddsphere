# NFL discrete drive joint r9 predeclaration

Date: 2026-08-23

Status: frozen before r9 execution.

r9 retains the r7 ownership, chronology, coherence, grade, and verification
contract. The r8 concentration selector returned 1.00, reproducing r7 and its
single failed 2024 interval-coverage observation. r9 therefore fixes event
concentration and shared-environment sigma at 1.00 and zero respectively.

Discrete 80% margin and total intervals use the shortest contiguous integer
interval containing at least 80% probability. Ties resolve by lower excess
mass, then closeness to the distribution mean, then lower bound. This rule is
frozen before the r9 confirmation rerun; all 72–88% confirmation bounds remain
unchanged.

The member score is a representative predicted score, not the unconditional
joint mode. Candidates must have positive PMF support, lie inside both 80%
intervals, be non-tied, and agree with the PMF's conditional moneyline winner.
Among candidates, minimize `-log(PMF mass) + w * (absolute margin-center
distance + absolute total-center distance)`. The weight is selected on 2023
only from `0.00, 0.05, 0.10, 0.20, 0.40` by lowest mean absolute team-score
error, then exact-score hit rate, then lower weight. 2024 and 2025 are opened
only after the weight freezes.

The audit must report point MAE, exact-score hit rate, support and winner
fidelity, tie contradictions, Week 1 duplicated-pair count, and distance from
the PMF margin/total centers. The displayed score must never contradict a
non-tie forecast winner.
