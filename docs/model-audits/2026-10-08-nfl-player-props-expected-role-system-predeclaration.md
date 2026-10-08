# NFL player props expected-role system predeclaration

Date: 2026-10-08  
Starting production base: `e998e5211b634f0fd3f3dae776300f97137e6010`  
Status: frozen before candidate implementation

## Diagnosed failure

The preceding availability candidate improved average independent error but failed the exact 2026
offered board. Residual analysis localizes the failure:

- QB scopes had candidate-minus-published MAE of +5.92, versus +0.71 for RB, +0.05 for TE, and
  +0.21 for WR;
- the worst candidate-to-line-distance quartile produced +10.33 MAE versus published, while the
  closest quartile improved published MAE by 0.13; and
- replacement/new starters were projected from their historical backup workloads instead of the
  expected role for the offered game.

The prior direct passing feature path also omitted the already cached point-in-time depth fields.
This is a target-population and role-state architecture failure, not evidence that another generic
market blend is needed.

## Frozen architecture

Build one roster-constrained, market-free opportunity system:

1. **Passing opportunity:** forecast the team's pass-attempt budget, then forecast the expected lead
   passer's share. Train the share and efficiency heads on the team lead-passer population rather
   than averaging starting and backup appearances. Passing Completions equal attempts times a bounded
   completion-rate head. Passing Yards equal attempts times a bounded yards-per-attempt head.
2. **Rushing opportunity:** forecast position-group rush budgets separately for QB, RB/FB, and
   WR/TE, then allocate a normalized player share within the applicable group. Model yards per carry
   separately by position group so ordinary quarterback kneel/scramble behavior is not pooled with
   running backs.
3. **Receiving opportunity:** forecast team targets, allocate normalized shares separately for WR,
   TE, and RB/FB roles, then model catch rate and yards per target conditionally.
4. **Expected role:** consume point-in-time depth listing, slot, rank, starter flag, prior snap/share
   state, and pregame availability. The presence of a valid current prop offer may identify the player
   whose role is being forecast, but line and price values remain forbidden model inputs.
5. **Coherence:** completions cannot exceed attempts; passing/rushing/receiving yardage must derive
   from its corresponding opportunity and efficiency heads; allocated role shares are normalized
   within team and role group.

## Chronology and variants

- train through 2023;
- select regularization and blend variants on 2024;
- confirm once on 2025;
- report rolling-origin 2026 Weeks 1-4 and the exact immutable locked replay separately; and
- generate a current-week proposal only after the candidate identity is frozen.

The exact 2026 set has already been inspected and is diagnostic, not pristine. It may reject an
immediate release but cannot be used to choose among variants. Variant selection remains 2024-only
and 2025 confirmation remains binding.

## Immediate release gates

A market can advance only if it:

1. improves 2025 MAE and RMSE over the prior independent reference;
2. improves exact 2026 locked MAE and RMSE over both the locked independent and published point;
3. does not regress exact direction, covers at least 90% of locked scopes, and improves at least
   three of four reported 2026 weeks;
4. has a game-clustered candidate-minus-published MAE interval with upper endpoint at or below zero;
5. improves or preserves Brier score and calibration gap without consuming line or price values;
6. produces symmetric promotion and demotion evidence without collapsing actionables; and
7. can populate the identical current-week feature contract through the sole existing writer and
   `prediction_pipeline:nfl` lease.

Failing markets remain unchanged. Existing locked payloads are never recomputed or reinterpreted.

