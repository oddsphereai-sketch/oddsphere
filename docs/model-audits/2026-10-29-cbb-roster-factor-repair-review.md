# CBB roster and Four-Factor repair: private review

Scope: men's college basketball independent score research only. The active CBB
publication switch remains off. This work changes no member prediction, grade,
stake, writer, cron, lock, or market reader. `cbb_candidate_2026_10_28_r2_score_precision`
is the comparison model; `cbb_private_2026_10_29_r19_schedule_factors` is a
distinct, rejected research release. All 2024 results below are selection results,
not a new untouched holdout, and 2025 has already been opened.

## Repairs tested

The r2 matchup correction uses raw, unadjusted team Four-Factor means. R19
replaced those eight matchup features with recency-weighted, ridge-shrunk
offensive and opponent-allowed factors estimated from games completed at least
six hours before each forecast. Three ridge values were declared and compared.
The model's shared score and probability equations were unchanged.

| 2024 selection, 5,710 games | Winners | Margin MAE | Total MAE | Brier | Winner corrections / harms |
| --- | ---: | ---: | ---: | ---: | ---: |
| r2 | 4,113 | 9.2420 | 12.9061 | 0.181406 | — |
| r19 ridge 2 | 4,113 | 9.2445 | 12.9765 | 0.181378 | 40 / 40 |
| r19 ridge 5 | 4,113 | 9.2533 | 12.9802 | 0.181492 | 37 / 37 |
| r19 ridge 10 | 4,110 | 9.2651 | 12.9805 | 0.181661 | 36 / 39 |

Source: `/private/tmp/oddsphere-cbb-data/schedule-factor-r19-report.json`.
The r19 changes are real, but none improve the selection score, and the best
variant merely exchanges 40 corrected winners for 40 harmed winners. We reject
r19; exact-quote ML/Spread/Total evaluation is not a reason to revive a
candidate that already fails the preregistered independent-score gate.

The 2026 active-roster and 2025 player-season caches have fetch timestamps.
The private preview now verifies both receipts predate its forecast. This closes
an as-of evidence hole, not the roster-strength accuracy gap. In particular,
the roster collector now has an explicit refresh mode that preserves prior
receipts. A new 23,487-player pre-opening snapshot was captured on
2026-10-29 at 15:29:06 UTC; the previous 2026-10-28 receipt remains archived.
This is evidence for upcoming 2026 forecasts, not a retrospective accuracy
result. The 2026 active-player feed cannot be used to reconstruct 2023–25 pregame
membership. A full target-season player-season file likewise leaks future
participation. The roster context remains descriptive, with no numerical
adjustment. Opening-night historical roster calibration requires timestamped
preseason rosters that we do not currently possess. A partial in-season replay
could be built from prior-season production and historical per-game player
appearances strictly before each as-of, but cannot establish opening-night
newcomers. See [BALLDONTLIE NCAAB API](https://ncaab.balldontlie.io/) for the
documented player-stat endpoints; it does not document historical as-of active
rosters.

We implemented that partial historical capture and tested r20, a private
attenuation of the prior team rating based on *observed prior-minute share*.
This is not verified roster retention: a player who has not played yet might
still be rostered, injured, or temporarily unused. The reviewer found provider
DNP rows, which are now excluded unless minutes are positive. The provider also
lacks player boxes for two 2023 and three 2024 final games. Those games have no
team boxes and are outside the score cohort; every team involved has its roster
adjustment disabled for the entire affected season, with IDs recorded in the
report. All input files now have SHA-256 receipts and exact selection-season
game-ID checks.

| 2024 selection, 5,710 games | Winners | Margin MAE | Total MAE | Brier | Winner corrections / harms |
| --- | ---: | ---: | ---: | ---: | ---: |
| r2 | 4,113 | 9.2420 | 12.9061 | 0.181406 | — |
| r20 effect 0.5 | 4,114 | 9.2597 | 12.9081 | 0.181702 | 15 / 14 |
| r20 effect 1.0 | 4,118 | 9.2809 | 12.9123 | 0.182069 | 37 / 32 |

Source: `/private/tmp/oddsphere-cbb-data/roster-prior-r20-report.json`.
The five-win maximum gain is 0.09 percentage points, and all other score and
probability metrics worsen. r20 is rejected, not combined with r19 or activated.

## Independent AI review

Three separate read-only AI reviews inspected the candidates and evidence. They
found no apparent future-game leakage in r19's six-hour cutoff, but confirmed
its 2024 loss and the absent historical preseason roster receipts. The final
review caught two real r20 evidence bugs before the result was finalized:
provider DNP rows counted as participation, and missing player-game boxes not
handled explicitly. Both were repaired and tested. It also requested input
hashes, exact cohort checks, positive-minute coverage on both teams, and a
source-commit receipt, now required. Remaining ideas are hypotheses,
not proven fixes: Four-Factor rates currently ignore attempt/opportunity
denominators and venue effects. Focused cutoff/swap tests pass.
No reviewer recommended activating a numerical change from these results.
This was automated independent review, not a human external audit.

## Decision and next evidence

Keep r2 and r17 private and unchanged. Do not activate r19 or r20 roster carryover
factor. The next *different* evidence to acquire is historical timestamped
roster membership for a pregame cohort, or at minimum game-by-game appearances
for a post-opener cohort, plus factor-denominator counts. Freeze a candidate
before testing on a genuinely new chronological season. Assess winner, quoted
ML/Spread/Total picks, margin and Total errors, Brier/log loss, and play-grade
board impact before any production proposal. This audit does not claim that
the requested sub-6 margin and sub-10 Total MAE have been achieved.
