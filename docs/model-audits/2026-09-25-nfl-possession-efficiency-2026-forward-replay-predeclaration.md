# NFL possession-efficiency 2026 forward replay predeclaration

Date: 2026-09-25

Replay: `nfl_possession_efficiency_2026_forward_replay_2026_09_25_r1`

The r3 recipe is frozen exactly as selected on 2023 before this replay reads a
2026 result: slow state; 75% offense / 25% opposing defense; full pace signal;
50% scoring-efficiency signal; two home-field points; and 90% market
calibration for both margin and total. No parameter, threshold, side, or market
weight may change after opening the 2026 rows.

The replay starts from the checksum-pinned post-2025 state, applies the declared
65% offseason carry, predicts every Week 1 game, applies the complete Week 1
BALLDONTLIE team box scores with the historical 0.16 slow-state update, predicts
every Week 2 game, and only then evaluates the settled outcomes. Within-week
games cannot update one another. T-60 market lines and prices come from the
immutable evidence payload attached to each original tracking row.

Report ML, spread, and total direction; team-score, margin, and total error;
both-side coverage; exact-price two-point action economics; and comparison to
the published original release record. Thirty-two games are insufficient for
normal promotion by themselves. The replay may support a narrowly bounded
owner-reviewed early-season shadow or provisional release only if it improves
the current release without score/market incoherence, one-direction collapse,
or a model-safety exception being recorded. No live change is authorized by
this document.
