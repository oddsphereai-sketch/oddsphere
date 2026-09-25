# NFL possession-efficiency score engine r3 predeclaration

Date: 2026-09-25

Tournament: `nfl_possession_efficiency_score_engine_tournament_2026_09_25_r3`

Status: development research only

r1 and r2 rejected direct team-score regression. r3 changes the prediction
object itself. It estimates offensive plays and points per play for each team,
using the team's offense and its opponent's defense, then multiplies those
quantities to obtain independent team points. Home/away points are paired into
one margin and total before any market calibration.

The frozen candidate grid varies only:

- fast, slow, opponent-adjusted, or equal fast/slow team state;
- offense-versus-opponent-defense efficiency weight;
- regression of expected plays and scoring efficiency toward league priors;
- bounded home-field points;
- independent post-model market weights for margin and total, followed by
  coherent reconstruction of the two team scores.

All state is locked before the complete week update. Inputs are limited to
points, plays, red-zone TD rate, turnovers, sacks, Elo, rest, injuries,
continuity, venue, and weather. Market data is excluded from the independent
stage. Training/state development ends in 2022; 2023 selects the recipe;
2024-2025 is development replay only because those outcomes were already
opened by r1. Production remains forbidden without frozen 2026 forward proof.

The report must include independent and calibrated team-score/margin/total
MAE, ML/spread/total direction, probability calibration, exact-price action
economics, both-direction coverage, and early/mid/late-season slices. No grade,
threshold, side-flip, copy, label, layout, stake, reader, writer, cron, or
tracking change is authorized.
