# NBA targeted player/rotation margin repair predeclaration

Date: 2026-10-20

Status: research only; zero production authority.

## Question

Can a small set of leakage-safe player-impact and expected-rotation summaries
add matchup separation to the NBA margin forecast without sacrificing the
incumbent Total head or winner accuracy?

The broad historical rotation/tracking candidates contained 183-501 features
and were vulnerable to overfit. This audit tests targeted subsets only. The
incumbent Total prediction is frozen for every candidate so the experiment
cannot manufacture a gain by changing both score dimensions.

## Frozen chronology and candidates

- Rolling selection origins: 2022, 2023, and 2024.
- Confirmation: 2025, opened only after one recipe is selected by code.
- Incumbent: `ratings_schedule`, margin-plus-Total ridge, alpha 1,000.
- Margin ridge penalties: 100, 300, 1,000, and 3,000.
- Optional adjusted-rating margin contribution: 0% or 30%.
- Feature groups:
  - incumbent ratings/schedule control;
  - player impact: player-impact estimate, rotation-estimated net rating, and
    usage concentration summaries;
  - rotation shape: expected rotation size/top minutes, recent continuity,
    latest-versus-recent minutes, and top-three/top-eight minute shares;
  - combined player impact plus rotation shape;
  - combined group plus the existing matchup four-factor edge summaries.

Every feature is derived only from games available before the forecast cutoff.
No market line, split, price, injury outcome, or evaluation-game box score is a
candidate input.

## Gates

Selection requires mean margin MAE improvement, improvement in at least two of
three origins, improved mean calibration-slope error, winner accuracy no worse
by 0.25 percentage points, winner Brier no worse by 0.001, and team-score MAE
no worse by 0.02 points. Total predictions must be byte-for-byte numerically
identical to the incumbent.

Confirmation requires at least 0.10 points of margin-MAE improvement, improved
team-score MAE, no winner-accuracy or Brier regression, at least 20% lower
calibration-slope error, a smaller dispersion gap, no regression on the
incumbent's fixed close-game cohort, and no regression against available
opening Spreads.

The 2025 season has been examined by earlier project audits, so even a passing
result is a prospective-shadow candidate, not immediate production authority.
