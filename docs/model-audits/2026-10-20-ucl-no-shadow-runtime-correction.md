# UCL no-shadow runtime correction

Date: 2026-10-20

## Owner direction

Oddsphere does not deploy or persist shadow models. Failed challengers may be
kept as reproducible offline audit evidence, but they may not consume the live
writer, member snapshot, tracking record, or production database and may not be
treated as a substitute for a validated model improvement.

## Exact correction

Starting base: `63595f5393f3692a129e6bf27acccbca53bd0cb7`.

This change removes the UCL BTTS three-lane shadow from the production code
path:

- deletes the runtime shadow derivation and its shadow-only test and operator
  report;
- removes the candidate payload from coherent UCL output, the member DTO, and
  the general UCL market-reader report;
- stops computing BTTS vectors and history solely for that candidate;
- advances the member snapshot lifecycle from r9 to
  `ucl_member_snapshot_lifecycle_2026_10_20_r10_no_shadow_payload`;
- records the repository-wide rule that a failed model change remains an
  offline audit rather than a live shadow.

The active public UCL model remains
`ucl_goals_coherent_2026_10_14_r8u_elo_late_consensus`, coherent reader remains
`ucl_coherent_market_outcome_2026_10_14_r4_target_excluded_late_consensus`, and
the active calibration remains the registry release. The correction changes no
probability, side, projected score, grade, stake, price, provider call, writer,
lease, tracking row, or settlement rule.

## Locked-record boundary

Existing locked payloads are immutable. If an older lock already contains the
retired provenance field, the lock-safe reader preserves and renders that exact
legacy payload. The r10 lifecycle applies only to newly generated unlocked
snapshots and future locks; it does not delete or rewrite historical records.

## Acceptance gates

- same-input UCL public outputs are identical before and after removal;
- new unlocked member payloads contain no BTTS shadow field;
- existing locked payloads retain exact precedence;
- focused UCL production and lock suites, TypeScript, and
  `npm run verify:model-change` pass;
- latest-main integration safety and protected pull-request checks pass;
- post-deploy production readback shows r10, no new shadow payload, one healthy
  writer/lease path, complete board coverage, and unchanged public predictions.
