# NHL coherent exact-price package r22 result

Date: 2026-10-23

Status: rejected. Never received live authority.

The fixed package combined the seven-game score-head handoff, frozen puck
calibration, and a universal demotion when an actionable's exact-price edge was
negative. On the full 2026 replay it contracts actionables from 319 to 250 but
falls from 187-131-1 / -3.31u to 150-100 / +3.36u. Total actionables finish
23-34 / -12.91u. The universal price rule removes useful Total winners because
exact-price edge is not a valid standalone Total selector.

This fails the predeclared selection and market-lane gates. Production code
does not include the universal exact-edge demotion or frozen puck calibration.

