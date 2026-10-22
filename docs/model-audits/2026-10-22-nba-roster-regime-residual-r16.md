# NBA roster-regime residual r16 — validation and release record

Date: 2026-10-22

Status: implemented and verified on the candidate branch; not production until protected merge and
post-deploy verification

## Problem and product boundary

The professional NBA score artifact can carry too much prior-team identity into an opening month
after major trades or roster reconstruction. Market reading remains useful but cannot be expected to
repair every stale independent prior, and it must remain a separate qualified evidence layer.

This release does not manually label Philadelphia, Milwaukee, or any other team as stronger or
weaker. It adds no fixed player-points table, injury-count penalty, confidence cap, public-split
authority, or automatic favorite/underdog rule. It preserves the existing market reader and grade
economics downstream of one coherent independent score.

## Selected architecture

The frozen professional model produces the baseline home score, away score, margin, and total. A
separate `nba_roster_regime_residual_2026_10_22_r1` zero-intercept ridge residual then evaluates:

- home and away incoming-versus-outgoing estimated-net difference;
- home and away incoming-versus-outgoing PIE difference;
- home and away rotation-turnover share, decayed over 16 current-season games.

The residual is exactly zero unless at least one team retained no more than 65% of the prior
rotation's minutes. Current rosters come from BALLDONTLIE's active-player endpoint; startup requires
all 30 NBA teams. Prior profiles contain only prior-season games, minutes, estimated net, and PIE.
Verified exact-game OUT players may be removed from the expected top-eight rotation. Questionable,
probable, unknown, or missing reports do not create an absence.

The adjusted independent margin and total rebuild both team scores algebraically. The existing
qualified Spread/Total reader then applies its already-released correction rules, after which the
same final tuple owns winners, spreads, totals, probabilities, prices, and grades.

## Chronological validation

The search compared 360 bounded variants. Training used only earlier out-of-sample score residuals;
selection used 2023 and 2024, and 2025 remained untouched confirmation. Rotation membership for
historical games came from point-in-time game participation rather than full-season contract lists,
preventing later trades from leaking backward.

On 1,230 untouched 2025 games, candidate minus incumbent was:

| Metric | Delta | Result |
| --- | ---: | --- |
| Team-score MAE | -0.01399 | Better |
| Margin MAE | -0.05847 | Better |
| Total MAE | -0.01231 | Better |
| Winner accuracy | +0.001626 | Better; two net winners |
| Home-win Brier | -0.001067 | Better |
| Home-win log loss | -0.002881 | Better |

The candidate corrected 16 incumbent winner errors, harmed 14 incumbent correct winners, and left
1,200 winner calls unchanged. It changed 633 score tuples and changed zero high-continuity games.

## Exact same-input current-board report

The read-only rehearsal at `2026-10-22T13:44:34.274Z` froze the same active-roster snapshot and
exact injury reports for both paths. It covered two games and six official markets.

| Measure | Incumbent | Candidate |
| --- | ---: | ---: |
| Actionable markets | 1 | 0 |
| Promotions | 0 | 0 |
| Demotions | 0 | 1 |
| Pick changes | 0 | 1 |
| Projection changes | 0 | 1 |
| Incoherent score tuples | 0 | 0 |

CLE at PHI is the one changed game. Philadelphia retained 43.46% of prior rotation minutes, while
Cleveland retained 87.03%. The incumbent projected Cleveland 110.35–107.34; the candidate projects
Philadelphia 113.25–110.57. Moneyline therefore flips from Cleveland Lean to Philadelphia Watch:
the model corrects the predicted winner without pretending the current -144 Philadelphia price is
a positive-value action. The chosen executable quote changes only because the selected side changes;
no provider price is rewritten. DEN at OKC remains exactly unchanged because both sides stay above
the continuity boundary.

The paired promotion path is the existing symmetric positive exact-price EV and evidence policy:
the residual may move margin/total in either direction, and those probabilities can promote a row
only when the same released value, quality, availability, and market-evidence gates pass. The
current board contains no qualifying promotion, so the one-actionable contraction is disclosed
rather than masked by a forced play.

## Releases, safety, and rollback

- Model / prediction record: `nba_professional_unified_2026_10_22_r16_roster_regime_residual`
- Roster residual: `nba_roster_regime_residual_2026_10_22_r1`
- Market marriage: `nba_market_marriage_2026_10_22_r18_roster_regime_residual`
- Grade policy: `nba_grade_policy_2026_10_22_r10_roster_regime_residual`
- Daily refresh: `nba_daily_refresh_schedule_2026_10_22_r14_roster_regime_residual`
- Lock publication: `nba_member_lock_publication_2026_10_22_r3_roster_regime_residual`

The live active-roster probe returned complete 30-of-30 team coverage. Focused roster, independent
artifact, candidate, market-reader, site-wiring, lock coherence, locked snapshot, lock metadata,
T-60 lifecycle, legacy-lock recovery, rolling-slate, and refresh-cron tests pass. TypeScript passes.
Stored locked payloads retain exact reader precedence and are never rescored or regraded.

Roll back future unlocked generation on incomplete active-roster coverage, a mixed release, a
high-continuity score change, an incoherent score tuple, a board impact outside the reviewed path,
or any locked-record mutation. A provider failure fails neutral to the frozen independent score and
records the reason; it does not manufacture a roster correction.
