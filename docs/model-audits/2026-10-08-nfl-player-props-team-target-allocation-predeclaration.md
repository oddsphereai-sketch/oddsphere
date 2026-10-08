# NFL player props team-target allocation predeclaration

Date: 2026-10-08  
Foundation: `nfl_player_props_expected_role_system_2026_10_08_r1`  
Status: frozen before candidate implementation

## Hypothesis

The foundation predicts BACK, WR, and TE target budgets separately and then normalizes player share
inside each role group. That prevents a roster change from transferring opportunity naturally across
position labels—for example, a receiving back or tight end absorbing targets vacated by a wide
receiver. It also asks three independent group-budget models to reproduce one team passing process.

Test one coherent alternative for Receptions and Receiving Yards:

1. forecast a single team target budget from strictly shifted team/opponent state;
2. estimate active participation and conditional target share across BACK, WR, and TE players;
3. normalize all receiving shares to the same team target budget;
4. condition every player with an actual pregame prop offer active, without consuming its line,
   price, side, or outcome; and
5. retain the foundation's frozen catch-rate and yards-per-target heads so this test isolates target
   allocation rather than mixing an efficiency change back in.

## Chronology and candidates

- train only seasons before the evaluated season;
- compare foundation/control blends of 25%, 50%, 75%, and 100% team-wide allocation on 2024;
- confirm the single frozen choice on 2025;
- then score all exact 2026 locked Receptions and Receiving Yards scopes;
- preserve the other five markets byte-for-byte from the foundation; and
- never use 2026 outcomes to select a weight or formula.

## Retention gates

The receiving head advances as the next research foundation only if it improves 2024 and 2025 MAE
and RMSE, then improves exact 2026 MAE and RMSE without regressing direction or Brier. Coverage must
remain 100%, the complete-board point and probability metrics may not worsen, and team shares must
sum to one whenever the predicted active receiving corps has positive mass.

Production remains separately gated against the published point forecast and market probability,
current-week feature parity, the sole writer and NFL lease, symmetric board impact, locked-record
immutability, and the full model-change safety suite.
