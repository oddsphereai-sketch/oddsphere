# CFB r7 compact runtime parity r14 — predeclaration

Date: 2026-10-01

Status: research-only; frozen before scoring compact artifacts

## Purpose

The selected r7 independent model uses 360-tree ExtraTrees heads. This audit
tests whether a smaller forest can reproduce the selected architecture closely
enough for a bounded production runtime without changing its features,
shrinkage, model family, score construction, domain-correction rule, or market
arbitration.

The frozen candidate tree counts are 48, 72, and 96. Every candidate retains
`min_samples_leaf=18`, `max_features=0.65`, the frozen random seed, the shared
ElasticNet score head, the 25% direct-margin weight, the nonlinear total-family
domain detector, and the seven-point weekly activation rule.

## Selection and evidence boundaries

The smallest candidate that clears every historical parity gate is selected.
Historical 2023–2025 may validate only independent score and line-relative
direction because complete market-reading evidence was not retained for those
seasons. No 2026 outcome may choose the tree count. After selection is frozen,
2026 is reported as an opened current-season stress test and the existing r8
market rule is replayed unchanged.

Relative to the 360-tree r7 reference, the compact candidate must:

- worsen pooled margin MAE by no more than 0.10 points;
- worsen pooled team-score MAE by no more than 0.05 points;
- worsen pooled Moneyline, Spread, or Total direction by no more than 0.20
  percentage points;
- worsen no individual season's margin MAE by more than 0.20 points; and
- preserve the same weekly domain-correction activation state.

This audit cannot authorize production by itself. Current-season full market
marriage, board impact, release versioning, focused tests, integration safety,
and live verification remain mandatory.
