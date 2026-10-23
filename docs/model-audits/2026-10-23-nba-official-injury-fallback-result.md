# NBA official injury fallback — result — 2026-10-23

## Same-input result

The read-only October 23 comparison covered 12 games and 36 markets, holding
the active roster snapshot constant between ESPN-only baseline and the exact
official-report candidate.

| Measure | ESPN only | Candidate |
| --- | ---: | ---: |
| Games with both teams verified | 11 | 12 |
| Published player rows | 57 | 63 |
| Pick changes | 0 | 0 |
| Projection changes | 0 | 0 |
| Selected-price changes | 0 | 0 |
| Actionable promotions | 0 | 0 |
| Actionable demotions | 0 | 0 |

Detroit-Miami became the one newly verified game. The independent winner and
coherent score remained Detroit, 120.74-113.84; selected prices were unchanged.
The existing complete-evidence gate moved Detroit Moneyline from Lean to Best
Angle and confidence from 60 to 70, while Detroit spread remained Watchlist
and confidence moved from 60 to 67. That is one within-actionable grade change,
not an actionable promotion or demotion. No injury count or player status
directly adjusted the score.

## Exact source proof

The official 2:00 PM ET PDF parsed the exact `DET@MIA` sections as:

- Detroit: Elijah Harkless Out, Isaac Jones Out, Ugonna Onyenso Out, Taurean
  Prince Available.
- Miami: Vladislav Goldin Available, Dru Smith Available.

The three Detroit Out rows are G League two-way listings and did not match an
active rotation impact in the roster-regime head. That is why the score and
winner remain unchanged; the repair supplies authoritative availability rather
than inventing a team-strength adjustment.

## Release

- Model / prediction record:
  `nba_professional_unified_2026_10_23_r18_official_injury_fallback`
- Market marriage remains:
  `nba_market_marriage_2026_10_22_r19_roster_winner_confirmation`
- Grade policy remains:
  `nba_grade_policy_2026_10_22_r11_roster_winner_confirmation`

Publication and live evidence are recorded in the pull request and the Daily
Edge production-health report. Existing locked payloads retain exact stored
precedence.
