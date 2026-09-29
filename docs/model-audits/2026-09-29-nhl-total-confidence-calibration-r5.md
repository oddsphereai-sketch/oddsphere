# NHL total-confidence calibration r5 — 2026-09-29

## Scope and predeclaration

The opening-night board exposed a legitimate calibration question: all five
Total directions were Under, four were Best Angles, and raw joint-Poisson
confidences ranged from 58.36% to 68.88%. This release does not balance sides,
move scores toward the market, or change the existing grade thresholds. It asks
only whether the conditional Poisson confidence is empirically calibrated.

Release identifiers:

- Model: `nhl_regular_2026_r5_total_confidence_calibration`
- Calibration: `nhl_regular_calibration_2026_r5_total_confidence_calibration`
- Decision: `nhl_regular_decision_2026_r5_total_confidence_calibration`

The score model is trained on 2023, the one-dimensional Platt transform and its
regularization are selected on chronological 2024, the score model is refit on
2023-24, and all priced 2025 games are report-only. The transform is:

`logit(p_calibrated) = 0.05706714956351745 + 0.514946128177911 * logit(p_raw)`

## Results

On 1,303 non-push 2025 Totals, direction remains 54.9501%. Calibration improves:

| Metric | Raw Poisson | Calibrated |
| --- | ---: | ---: |
| Brier score | 0.247512 | 0.246984 |
| Log loss | 0.688161 | 0.687084 |
| Mean confidence | 56.62% | 54.86% |

The grade surface was audited separately and retained. Best Angle Totals were
130/223 (58.30%) in 2024 and 199/346 (57.51%) in 2025. Leans were 365/681
(53.60%) and 408/738 (55.28%). The opening-night board remains four Best Angles
and one Lean. All five directions remain Under because the independent score
means remain below the posted lines; no quota or cosmetic side balancing is
introduced.

Current confidence changes are FLA-CAR 68.88% to 61.45%, MTL-TOR 64.75% to
59.15%, NYR-BOS 58.36% to 55.75%, VAN-EDM 65.81% to 59.73%, and CHI-VGK 66.44%
to 60.08%. Scores, sides, prices, verdicts, public copy, and layout are unchanged.
These are release-only replays of the r4 snapshots. A normal writer refresh may
still move a score, side, price, or grade when its underlying team, goalie, or
market inputs have changed; the calibration transform itself cannot do so.

## Winner-model audit

The parallel raw-winner audit did not clear release gates. A regularized
independent classifier reached 58.61% on 2024 but 55.00% on all priced 2025
games. A learned 2024 independent/market disagreement layer fell to 54.46% in
2025 and failed to improve the independent 55.00%. Goalie-workload and richer
team-context variants were also rejected during 2024 selection. None of those
experiments enters production; r5 retains the r4 winner and score architecture.

## Board impact and safety

- Scores changed: 0
- Total sides changed: 0
- Best Angle promotions/demotions: 0 / 0
- Lean promotions/demotions: 0 / 0
- Games or markets removed: 0
- Provider calls, schedules, leases, writers, locks, copy, labels, and layout changed: 0

The sole NHL writer and shared `prediction_pipeline:nhl` lease remain
authoritative. Previously locked rows are immutable. Roll back to r4 if the live
writer does not produce the r5 identifiers, if any score/side/grade changes, if
coverage drops below 15 records for the five-game slate, or if the reader cannot
serve one coherent card per game.

Machine evidence:
`nhl-research/nhl_total_confidence_calibration_2026_09_29_r1.json`.
