# NFL player props Passing Attempts hierarchical opportunity result

Date: 2026-10-15
Decision: reject; no production or board change

## Result

The partially pooled team/QB opportunity model does not qualify. It is a materially different
architecture from the earlier fixed blends: a common state model is pooled with shifted last-eight
offense tendency, opponent-allowed tendency, and quarterback workload share according to evidence
counts. All 18 frozen pseudo-count/opponent-weight identities are market-free.

None improved both MAE and RMSE on the 2024 selection window, so chronology stopped the tournament
before any identity could be frozen. The closest identity, `team_16__qb_8__opp_25`, improved RMSE
from `8.95568` to `8.93136` but worsened MAE from `6.72470` to `6.77938`.

This is not a case where the architecture simply failed everywhere. The 2025 window favored the
pooling idea strongly: `team_4__qb_2__opp_25` improved MAE/RMSE from `6.85638/8.68379` to
`6.65248/8.51933`. Chronology prevents selecting that later success after the 2024 failure.

The exact 16-row current replay was not opened for a challenger identity. The incumbent remains
`8.94463` MAE, `11.26457` RMSE, and `56.25%` offered-line direction in this immutable replay. The
largest current miss is a four-attempt in-game exit, confirming that unpredictable role survival
is important tail risk but not evidence for lowering every healthy starter's mean.

No artifact, projection, probability, grade, stake, writer, reader, lease, or stored locked field
changes. Board impact is exactly zero.
