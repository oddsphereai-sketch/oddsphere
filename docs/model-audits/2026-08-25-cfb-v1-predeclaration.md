# CFB Daily Edge v1 predeclaration

Date: 2026-08-25

Status: frozen before confirmation scoring

## Product and release boundary

This is a materially college-football-specific model. It may reuse OddSphere's
football contracts, exact-price semantics, reader components, leased writer
pattern, and tracking lifecycle, but it may not reuse NFL coefficients,
calibration, score residuals, grade thresholds, or personnel assumptions.

The first production candidate must provide one coherent joint score
distribution per game. Expected home and away points, representative reachable
score, winner probability, spread probability, and total probability must all
come from that same distribution. The independent head excludes every current
or historical sportsbook price, line, fair probability, split, and movement
field.

## Frozen chronology

- Fit: 2021-2022 regular/postseason games.
- Select model family, hyperparameters, calibration, market blend, and grade
  thresholds: 2023 only.
- Confirmation: 2024 and 2025, reported separately and pooled. These seasons
  remain unopened until the complete selection policy is fixed in code.
- True forward holdout: immutable 2026 opening, unlocked, T-60, and settlement
  observations written by the single CFB prediction writer.

Every feature is built as of kickoff from the previous season and games that
finished earlier in the same season. Full-season summaries from the target
season, final starter/injury data, postgame roster changes, and the target
game's own play or box-score rows are forbidden.

## Candidate families

The same frozen pregame matrix is evaluated with:

1. standardized ridge score heads;
2. standardized elastic-net score heads;
3. histogram gradient-boosted score heads;
4. an equal-weight calibrated ridge/boosted ensemble.

Home and away points are modeled separately. Candidate selection minimizes the
2023 composite of team-score MAE, margin MAE, total MAE, moneyline Brier score,
and 80% interval miss rate. A past-only paired empirical residual distribution
creates the joint PMF; it preserves football scoring support and correlation
rather than independently rounding two point means.

## Independent feature families

- opponent- and schedule-strength-adjusted rolling Elo;
- points scored/allowed, margin, and total with offseason and early-week
  shrinkage;
- offensive and opponent-allowed EPA/play, passing EPA, rushing EPA, early-down
  EPA, success rate, and explosiveness;
- pace, drives, field position, red-zone success, third-down success, havoc,
  line yards, stuff/opportunity rate, and special-teams EPA;
- expected turnovers and turnover-luck regression;
- roster continuity, returning starting-quarterback signal, and roster
  experience where the preseason roster source has stable identity;
- conference/division strength, FBS/FCS partial pooling, home field, neutral
  site, rest, and travel/venue context where timestamp-valid.

Unknown personnel or venue fields remain missing with an explicit health flag;
they are never silently treated as healthy or neutral.

## Frozen forecast gates

The football-only candidate may advance only if all are true:

- on 2023 selection it improves the composite proper-score/error objective by
  at least 2% versus the simple past-only football baseline;
- on each of 2024 and 2025 it is no more than 2% worse than that football
  baseline on the composite and is better on at least three of the five
  component metrics;
- moneyline ECE is at most 0.08 in each confirmation season;
- mean home, away, margin, and total bias is within 2.5 points;
- forecast team-score, margin, and total dispersion is at least 70% of actual
  dispersion, preventing another clustered-score surface;
- source integrity, chronological checksums, and score/probability coherence
  pass.

Market blending is selected on 2023 from frozen independent weights of 15%,
25%, 35%, and 50%. It is reported beside the independent head, never in its
place. A blend may advance only if it improves 2023 Brier/log loss over the
opening market and does not materially regress either confirmation season.

## Frozen exact-price grades

Historical selection uses the archived synchronized consensus line and a
conservative -110 execution assumption because named-book prices are not
present in the research archive. Forward decisions use the real evaluated
named sportsbook, line, and price plus a target-excluded same-line consensus.

- `Best Angle`: a selection-qualified, direction-stable subgroup with at least
  3% expected value, at least 3 percentage points of target-excluded edge,
  positive 2024 and 2025 units after removing each season's largest win, and
  positive weekly-cluster median bootstrap ROI.
- `Lean`: at least 1% expected value, at least 1 percentage point of
  target-excluded edge, positive pooled 2024-2025 units, and no materially
  negative confirmation season after largest-win review.
- `Watchlist`: complete exact-price tuple with positive model edge that misses
  the Lean robustness gate or has actionable sensitivity to a key number,
  total zone, personnel, or price.
- `No Play`: complete tuple without positive actionability.
- `Held`: only a genuine identity, current-price, independent-feature, QB,
  injury, weather, or lock-health failure.

Bet count is an output. There is no minimum, maximum, weekly quota, forced side,
reader-side regrade, or forced Best Angle.
