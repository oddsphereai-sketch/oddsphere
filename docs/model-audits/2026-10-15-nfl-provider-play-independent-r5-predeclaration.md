# NFL provider-play independent score r5 — frozen predeclaration

Date: 2026-10-15

Status: research-only challenger; no production or locked-record writes.

## Motivation

The r4 box-state model failed the opened 2026 stress test. Its weakness shows
that ordinary points/yards/volume summaries do not preserve enough play-quality
signal. The paid provider's documented play-by-play and team-stat endpoints can
recreate a richer but still production-safe subset of the original r1 state.

The independent model remains completely market-free. The qualified market
reader runs afterward as a separate categorical authority. No market line,
price, movement, split, or scalar market weight is a model input.

## Frozen features

The model retains the r1 leakage-safe weekly update, opponent matching, fast
and slow windows, offseason carry, Elo, rest, home/neutral/division, roof,
surface, week, and prior-game-count context. It uses only these team-play
metrics:

- success rate;
- explosive-play rate;
- sack rate;
- turnover rate;
- offensive play count;
- red-zone touchdown rate;
- no-huddle rate; and
- points.

These fields are computable from BALLDONTLIE's documented play type, down,
distance, yardage, team, red-zone, text/tempo, score, and team-stat fields. EPA,
pass EPA, rush EPA, early-down pass EPA, pass over expectation, and CPOE are
excluded because the provider does not expose the same fields. No proxy may be
silently substituted in production.

## Frozen tournament and gates

Training is 2016–2022, recipe selection is 2023, and untouched expanding-fit
confirmation is 2024–2025. Candidate estimators and selection order match r4:
Ridge 30/100/300, regularized histogram boosting, 96-tree Extra Trees, the
three-Ridge average, and the all-model average. Margin and Total select
separately. Completed 2026 is reported only after selection.

The candidate advances only if it has finite coherent scores and improves at
least one of the audited fantasy-center margin/Total error scales without a
simultaneous collapse in the other head. The exact paid cohort and qualified
market-reader corrections are separate subsequent audits and cannot select the
recipe.

Production still requires provider pagination/completeness controls, a
checksum-pinned portable artifact, Python/TypeScript feature and prediction
parity, expected-QB and injury eligibility, release bumps, board-impact
accounting, model-change verification, integration safety, owner approval, and
post-deploy proof. Locked snapshots remain immutable.
