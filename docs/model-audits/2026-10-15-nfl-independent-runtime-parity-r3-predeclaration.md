# NFL independent runtime parity r3 — frozen predeclaration

Date: 2026-10-15

Status: research-only portability test; no production or locked-record writes.

## Purpose

The selected independent margin head is a 500-tree Extra Trees model. This
audit tests whether a smaller forest can reproduce that already-selected
football model closely enough for a bounded TypeScript runtime. It does not
change the feature family, model family, leaf regularization, feature sampling,
random seed, margin/Total score construction, or market-reader rules.

The independent model remains market-free. The market reader is a separate
post-model authority and is never averaged into this model with a scalar
weight. The earlier scalar-anchor calculations were diagnostics and are not a
candidate architecture.

## Frozen candidates and evidence boundary

- Reference: 500 trees.
- Candidates, evaluated smallest first: 48, 72, 96, and 160 trees.
- `min_samples_leaf=12`, `max_features=0.65`, and random seed `15102026` are
  unchanged.
- The already-frozen r1 `core` feature family is used for margin.
- Historical parity uses the same expanding 2024 and 2025 fits as r1. It can
  select only the smallest portable forest that clears every parity gate.
- Completed 2026 is reported only after the tree count is selected and cannot
  choose the count.

Relative to the 500-tree reference, a compact candidate must:

1. worsen pooled 2024–2025 margin MAE by no more than 0.10 points;
2. worsen pooled Moneyline, Spread, Spread +3, or Spread +6 hit rate by no more
   than 0.50 percentage points;
3. worsen either individual season's margin MAE by no more than 0.15 points;
4. produce finite coherent score components for every row; and
5. preserve the exact feature column order required by the portable artifact.

The smallest candidate passing every gate is selected. Failure does not
authorize tuning on 2026.

## Production restrictions

Passing this audit proves only model compaction. Production still requires:

- a checksum-pinned portable artifact and Python/TypeScript parity fixtures;
- the same pregame feature semantics in the sole NFL writer;
- verified injury and expected-quarterback eligibility;
- the existing qualified market reader applied categorically after the
  independent score, with every correction and harm attributed;
- release bumps, focused tests, full model-change verification, board-impact
  reporting, integration safety, owner approval, and live release proof; and
- immutable precedence for every existing locked payload.
