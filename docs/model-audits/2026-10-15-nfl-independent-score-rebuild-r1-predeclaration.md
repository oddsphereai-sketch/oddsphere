# NFL independent score rebuild r1 — frozen predeclaration

Date: 2026-10-15

Status: research-only challenger. This release cannot write predictions, grades,
stakes, tracking records, or locked member payloads.

## Why this tournament exists

The live paid-score fallback is not a trained NFL game-score model. It maps
third-party fantasy-defense `points_allowed` projections to opponent team
scores and then recenters a pooled score distribution around those values. The
2026 audit found that its margin signal is weak and that the alternative
player-component reconstruction is effectively the same signal. This tournament
rebuilds the independent center from actual, timestamp-disciplined NFL team and
quarterback state.

## Frozen data contract

- Regular seasons 2016–2025 from checksum-pinned nflverse schedules, play by
  play, weekly rosters, snap counts, and injury reports.
- A feature row is locked before any result from that entire week updates team,
  quarterback, roster, or snap-share state.
- Training: 2016–2022.
- Architecture selection: 2023 only.
- Confirmation: 2024 and 2025. The selected recipe is refit on the expanding
  prior-season window before each confirmation season; recipe and weights do
  not change.
- A separate exact-timestamp 2026 replay is required after this historical
  architecture gate. It is not part of this tournament.

## Independent feature families

Both families exclude betting lines, prices, moneylines, outcomes, team names,
season identity, and current-game completed-game quarterback identity.

1. `core`: opponent-adjusted fast and slow states for EPA, pass EPA, rush EPA,
   success rate, early-down pass EPA, explosives, sack rate, turnover rate,
   play volume, red-zone touchdown rate, no-huddle rate, pass over expectation,
   and points; Elo; rest; neutral/division/roof/surface context; and prior games.
2. `availability`: every `core` field plus prior-quarterback EPA/CPOE/sack/
   turnover/dropback state, roster and coach continuity, raw injury burden,
   prior-snap-weighted injury burden, and the report status of the last known
   starter at quarterback.

Actual game temperature and wind are deliberately excluded because this source
does not prove an archived pregame forecast timestamp. Live weather can enter
only through the existing timestamped evidence path.

## Frozen model families

Margin and total are modeled as separate coherent heads and converted to team
scores with `(total + margin) / 2` and `(total - margin) / 2`.

- Ridge regression with penalties 30, 100, and 300.
- Histogram gradient boosting with shallow leaves and strong regularization.
- Extra Trees with a minimum of 12 samples per leaf.
- A frozen average of the three Ridge models.
- A frozen average of all five base models.

The 2023 selector minimizes MAE, then RMSE, then model complexity separately for
margin and total. It may select different feature/model recipes for the two
heads. No 2024 or 2025 result may change that choice.

## Market-stage diagnostic

After the independent recipes are frozen, a simple consensus-anchor blend is
selected on 2023 from independent weights 0.0 through 1.0 in 0.1 increments,
separately for margin and total. This is only an incremental-value diagnostic;
it is not a replacement for the richer qualified market reader. The exact 2026
replay must subsequently feed the independent distribution into that market
reader and attribute every correction and harm.

## Reported outcomes and gates

The report must include team-score, margin, and total MAE/RMSE/bias/correlation;
moneyline direction; direct spread and total direction; and selected-side
results after 3- and 6-point line improvements. Results are shown for 2023,
2024, 2025, and combined 2024–2025.

The challenger advances to the exact 2026 replay only if:

1. its independent combined 2024–2025 margin MAE and total MAE both improve on
   the audited 2026 fantasy-projection center's corresponding error scale;
2. it produces coherent home/away scores with finite values for every game;
3. at least one of margin or total adds positive 2024–2025 incremental value to
   the market anchor without the other materially regressing;
4. availability inputs are retained only if the frozen `availability` family
   wins selection and does not exhibit a material confirmation collapse; and
5. no claim against the supplied competitor screenshots is made until the same
   games, timestamps, pushes, and line semantics are matched.

Failure does not authorize tuning on confirmation seasons. A failed recipe is
rejected or a new release is predeclared.
