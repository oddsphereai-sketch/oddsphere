# NFL projected-QB score context r11 audit

Date: 2026-08-25

## Decision

The bounded forward scenario passed every predeclared integrity and structural gate. It found no
concrete failure in the qualified r10 score forecast or r9 actionable-grade release candidate.
The r9 candidate may proceed toward the authoritative production release after the shared MLB
reader/type consolidation lands and the full candidate is rebased and reverified.

The projected-QB scenario is not a second public model or writer. Comparable historical as-of
starter-designation snapshots do not exist, so its score changes remain prospective context rather
than a replacement historical release. The authoritative scorer can collect the scenario beside
r10 and reconsider it only after real opening/T-60/settlement evidence exists.

## Result

- Exact Week 1 identity: 16 games and 32 projected quarterbacks; every quarterback resolved to
  the immutable historical QB state.
- All expected points and probabilities were finite and passed through the frozen r10 discrete
  drive/scoring-event law.
- Team-score range 17.98-28.07, SD 2.28.
- Margin range -3.68 to +10.08, SD 3.53.
- Total range 39.98-48.98, SD 2.29.
- Directions: 6 Over and 10 Under.
- Maximum team expected-score movement versus r10: 1.216 points.
- Maximum expected-margin movement: 0.731 points.
- Winner flips: 0.
- Representative-score winner fidelity: 16/16.

The largest adjustment was GB at MIN: Green Bay +1.216 expected points, Minnesota +0.485, moving
the expected home margin by -0.731. No game approached the frozen 3-point team or 5-point margin
extrapolation caps.

## Input truth audit

The independent r10 score head explicitly models opponent-adjusted rolling pass and rush EPA and
success, early-down efficiency, explosiveness, pressure/sack and QB-hit proxies, turnover and
fumble regression, pace/no-huddle/pass tendency, red-zone and first/third-down performance,
special teams, penalties, strength/Elo, home/away, rest, travel/time-zone direction, surface,
coach continuity, and lagged roster/snap/QB-room strength. Offense-versus-defense matchup features
are directional rather than simple team averages.

The r6 Moneyline/player-value layer additionally resolves the current projected quarterback and
current injury/depth context, including QB, offensive-line, skill-position, front-seven, and
secondary role groups. Those inputs can hold an unhealthy decision and inform the exact-price
Moneyline correction; they are not falsely represented as calibrated player-level point changes
inside r10.

Target-game weather remains a live health/context input until a real forecast is in range. It is
not injected into the opening score head from realized game weather. Individual WR-CB, OL-DL, and
LB/coverage grades remain indirect through team efficiency, pressure, explosiveness, and roster
continuity because the owned historical cache lacks timestamp-valid player-on-field matchup and
historical forecast snapshots.

## Source integrity

- Projected-QB report: `football-research/reports/nfl_projected_qb_score_context_2026_08_25_r11.json`.
- The report pins SHA-256 values for the comprehensive research operator, r10 drive-law report,
  r6 runtime artifact, latest forward evidence, and baseline r10 artifact.
- No provider, cron, writer, database mutation, publication, grade, stake, tracking, or reader
  change occurred in this audit.
