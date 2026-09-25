# NFL current-season score calibration result

Date: 2026-09-25

Decision: rejected; research and production diagnosis only; no prediction,
projection, probability, side, grade, stake, writer, tracking, or member behavior
changed.

## Frozen candidate

The candidate followed
`2026-09-25-nfl-current-season-score-calibration-predeclaration.md`: a
chronological, same-season scoring state was blended into the market margin and
total after selecting its weight on 2021-2023. Both markets selected the minimum
tested independent weight, 10%.

On 2024-2025 confirmation, the Spread candidate had 50.83% side accuracy but
worsened point MAE from 9.6664 to 9.6812. Its one-point exact-price lane went
204-207 for -15.960 units. The Total candidate had 46.77% side accuracy, worsened
point MAE from 10.0616 to 10.0625, and went 198-228 for -44.826 units. It forecast
514 Unders and only 27 Overs across the two seasons. Both candidates failed the
frozen historical gates and are ineligible for production.

## Production accuracy decomposition

A separate read-only checksum-verified audit evaluated the 33 settled 2026 NFL
games and 99 immutable original prediction records available through the
September 24 game. Six append-only Moneyline correction rows were excluded from
the original-row cohort, while the published forecast side was used for accuracy.

- Moneyline: 22-11, 66.67%.
- Spread: 12-19 with two pushes, 38.71% resolved accuracy.
- Total: 14-18 with one push, 43.75% resolved accuracy.
- Expected-margin MAE: 12.048 points; expected-total MAE: 11.263 points.
- Expected-margin bias: +3.874 points to the home team; expected-total bias:
  +0.352 points.

These numbers prove the current problem is upstream forecast accuracy, not merely
the grade distribution. The successful Moneyline engine should not be replaced
indiscriminately; margin and score construction require a separate rebuild.

## Historical component decomposition

The original chronological independent-model artifact was replayed for its 2024
selection and 2025 holdout seasons:

- Spread side accuracy declined from 55.97% to 50.92%. The 3.5-6.5-point band
  moved from 53.85% to 40.22%, so that apparent 2025 inversion is not a stable
  two-season rule.
- Total side accuracy declined from 50.93% to 47.43%.
- Weeks 1-4 were the one repeated Total strength: 60.94% in 2024 and 53.12% in
  2025. Week 10 onward was 46.21% and 43.07%.
- Low totals of 42 or below were 52.87% and 52.94%; high-total performance was
  unstable at 59.09% then 36.51%.
- The previously frozen global spread reliability controller remains rejected:
  its 2024-2025 confirmation accuracy was 46.57%. Post-hoc inversion of the
  current 12-19 record is not a valid release.

The weekly runtime fallback is therefore the architectural gap: after the
precomputed Week 1 artifact, it anchors margin to the market-led Moneyline model,
anchors Total to the market total, and applies a 75% market weight before bounded
evidence shifts. This explains why later-week scores remain close to the market
and cannot express a sufficiently independent matchup view.

## Next release boundary

The next eligible candidate must use the newly durable completed-game team state
to update a weekly independent scoring engine before market evidence is applied.
It should model team scores and their joint distribution, calibrate early- and
late-season uncertainty separately, preserve the qualified Moneyline forecast,
and use target-excluded consensus, movement, and trustworthy splits as bounded
calibration/corroboration inputs. It must be evaluated chronologically by exact
release and locked timestamp. It may not ship as a global side flip, forced
action count, relaxed grade threshold, or member-copy change.
