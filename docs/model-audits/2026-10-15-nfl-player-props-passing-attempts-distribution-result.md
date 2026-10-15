# NFL Player Props Passing Attempts distribution recalibration result

Date: 2026-10-15
Status: rejected on current-season replay; research only

## Decision

Reject the frozen Gaussian-kernel residual candidate. It improved both proper scores in chronological
historical selection and confirmation, but performed materially worse on every available exact
stored 2026 independent-probability comparison. It cannot change production probabilities, grades,
stakes, or releases.

## Chronological result

The selected candidate was a global empirical residual CDF smoothed with a two-attempt Gaussian
kernel. It preserved the released independent point projection exactly.

| Window | Distribution | CRPS | Exact-count log score |
| --- | --- | ---: | ---: |
| 2024 five-fold game cross-fit | unsmoothed global empirical | 4.88325 | 3.88475 |
| 2024 five-fold game cross-fit | two-attempt kernel | 4.88136 | 3.60289 |
| 2025 confirmation | unsmoothed global empirical | 4.79662 | 3.64556 |
| 2025 confirmation | two-attempt kernel | 4.79323 | 3.56913 |

Historical smoothing helped density scoring, but that did not transfer to the current offered
thresholds. On the five rows with exact stored locked independent probabilities, incumbent versus
candidate was:

| Metric | Locked independent | Kernel candidate |
| --- | ---: | ---: |
| Brier | 0.14111 | 0.33857 |
| Log loss | 0.44044 | 1.40774 |
| Direction | 80.0% | 60.0% |

The candidate's descriptive result on all 16 offered rows was 0.22999 Brier, 0.81168 log loss, and
62.5% direction. It has no exact all-row incumbent comparison and is not a promotion result.

## Locked-evidence limitation

Only five of the 16 offered Passing Attempts rows stored `rawProvenance=locked_independent`. The
other 11 preserve `rawProvenance=unavailable_market_dominant_point`: their independent point
projection exists, but an independent threshold probability was never stored. Those missing values
were not reconstructed onto, written into, or allowed to take precedence over the locked payload.
The predeclared 16-row probability gate is therefore incomplete and is forced closed independently
of the candidate's five-row failure.

Future locks now carry explicit independent probabilities under the member decision-evidence
contract, so later weeks can evaluate this denominator honestly without altering history.

## Reproducibility and safety

The research script is
`scripts/operator/tournament_nfl_player_props_passing_attempts_distribution.py`; its ignored output
records both source checksums and the exact missing-baseline provenance. The evaluated line was used
only as a threshold after the independent distribution was complete. No price, side, book, movement,
split, spread, total, or market consensus entered the forecast.
