# MLB props home-run discipline hotfix — 2026-07-23

- Release: `mlb_props_2026_07_23_r4`
- Home-run model stamp: `batter_home_runs_rare_event_integrated_read_v4_downstream_discipline_fixed`
- Scope: home-run grading only.

## Problem

The home-run qualification pass correctly promoted every best-priced offer
meeting the probability, EV, confidence, and price gates. A later generic
hitter-discipline mapping step then demoted those promoted rows because home
runs were excluded from its candidate set but not from its final downgrade
mapping.

## Fix

Qualified home-run Leans now bypass the generic hitter concentration discipline
through both stages. Best-price discipline and the dedicated home-run
qualification gates remain active.

No other player-prop market, probability model, provider refresh, tracking
contract, or update cadence changed.
