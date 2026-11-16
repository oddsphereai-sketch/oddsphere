# NFL player props Anytime Touchdown r3 data contract and predeclaration

Date: 2026-10-09

## Evidence status

The r1/r2 2025 and 2026 aggregate results are known. R3 is a bounded data-dependency test, not a
pristine holdout. No 2026 Week 5 play-by-play file or outcome has been downloaded or opened for
this candidate. Candidate definitions and gates are frozen here before the current upstream asset
is read. Week 5 remains the required new forward confirmation before any production activation.

## Upstream data contract

- **Owner and asset:** nflverse `nflverse-data`, release tag `pbp`, seasonal asset
  `play_by_play_2026.csv.gz` at
  `https://github.com/nflverse/nflverse-data/releases/download/pbp/play_by_play_2026.csv.gz`.
- **License:** the official repository applies Creative Commons Attribution 4.0. Production use and
  adaptation are allowed with attribution, license notice, source link, and modification notice.
  OddSphere must retain those notices in repository/data-source documentation and must not imply
  NFL or nflverse endorsement. This is an engineering license review, not legal advice.
- **Required fields only:** `season`, `season_type`, `week`, `game_id`, `home_team`, `away_team`,
  `posteam`, `yardline_100`, `goal_to_go`, `pass_attempt`, `rush_attempt`, `receiver_player_id`, and
  `rusher_player_id`. No score, touchdown outcome, EPA, spread, total, price, or market field may
  enter the r3 feature path.
- **Documented semantics:** nflverse defines `yardline_100` as distance from the opponent end zone,
  `goal_to_go` as the goal situation flag, and the player IDs as the rusher/receiver on the play.
- **Update and corrections:** parsed PBP is updated nightly after game days. nflverse recommends the
  Wednesday-night/Thursday version because it incorporates the NFL's early-week stat corrections.
  The upstream workflow also refreshes the preceding week at 02:00 UTC Wednesday.
- **Live object metadata observed without downloading outcomes:** at 2026-10-09 10:14 UTC, the
  compressed CSV was 4,448,216 bytes, last modified 2026-10-09 09:03:41 UTC, with ETag
  `0x8DF25E436DC2808`. The Parquet variant was 4,920,288 bytes. The locally frozen Weeks 1-4
  Parquet used for the contract audit was 4,849,370 bytes with SHA-256
  `9229849dc5bb221890beb64682707a9af9c0c872a60767c2614a48f12a4b83fe`.
- **Completeness:** the frozen local file has exactly 16 regular-season games in each of Weeks 1-4.
  It contains 1,205 red-zone/goal-to-go rush or target opportunities across 592 unique
  player-games. All 1,205 opportunities match the existing game/team/player identity substrate;
  unmatched opportunities: zero. Weekly matched counts are 282, 272, 339, and 312.
- **Positions after identity join:** QB 119 opportunities, RB 610, WR 319, and TE 157.

Official sources: [nflverse data license](https://github.com/nflverse/nflverse-data/blob/main/LICENSE.md),
[data availability schedule](https://nflreadr.nflverse.com/articles/nflverse_data_schedule.html),
[PBP data dictionary](https://nflreadr.nflverse.com/articles/dictionary_pbp.html), and
[`load_pbp()` reference](https://nflreadr.nflverse.com/reference/load_pbp.html).

## Proposed bounded production ingestion

This section is a data contract, not authorization to edit the writer before the model passes.

1. Extend the sole NFL player-props current-season state with a source ETag, SHA-256, attribution,
   completed-through week, and per-player/game red-zone and goal-line rush/target counts.
2. On the first eligible writer run after the documented Thursday correction window, perform one
   conditional GET for the compressed seasonal CSV. A matching ETag is a zero-byte no-op. A changed
   object has a 25 MB compressed hard ceiling, a 30-second timeout, and a maximum of one successful
   download per completed week. Persist failure/backoff metadata so cadence retries cannot become a
   provider loop.
3. Stream gunzip and CSV parsing; retain only the thirteen allowlisted fields. Do not keep or write
   the raw file to the database. Reject a missing header, non-regular-season row in the selected
   slice, malformed game/week/team identity, future/current target-week row, duplicate play key, or
   incomplete expected prior-week game set.
4. Join player IDs and game/team identities before aggregation. Any unmatched eligible opportunity
   fails the opportunity refresh closed; it cannot silently become zero usage.
5. Replace derived prior-game opportunity evidence only before a future slate is scored. Existing
   locked snapshots and tracking records remain immutable. A corrected upstream file may change
   future rolling state, but never rewrites a locked prediction.
6. Keep the existing `prediction_pipeline:nfl` lease and writer. Add no schedule, per-card call,
   browser request, independent refresh job, or member-facing raw-data surface.

At current size this is one roughly 4.45 MB compressed weekly payload. The full-season ceiling and
streaming parser keep memory and bandwidth bounded as the seasonal object grows. Production must
record bytes, ETag, SHA-256, parsed rows, accepted games/weeks, identity coverage, and refresh age.

## Leakage boundary

For a target Week N prediction, opportunity features may use only final regular-season plays from
weeks less than N whose kickoff and completion precede the feature timestamp. The current game's
plays, Week N outcomes, scores, touchdown labels, closing prices, spread, total, and touchdown odds
are forbidden. Red-zone is `yardline_100 <= 20`; goal-line is `yardline_100 <= 10 OR goal_to_go`.
Only rush attempts with a rusher ID and pass attempts with a receiver ID count. Rolling averages and
EWMs are updated after the previous game, never during the target game.

## Frozen r3 candidates

All tree settings, calibration families, team-budget model, and scorer-policy family remain frozen
from r1/r2. The only new information is prior-game current-season player opportunity.

1. Re-score `market_free_incumbent_team_budget` with current-season red-zone/goal-line features
   refreshed before each 2026 target week.
2. Re-score `market_free_incumbent_direct_hierarchy_50` identically.
3. `market_free_current_opportunity_team_budget`: the frozen r1 role-expanded player head and
   football-only team budget, now with genuinely current prior-game red-zone/goal-line opportunity.

Model shape is selected on 2023; Platt versus beta calibration and scorer policy are selected on
2024; 2025 remains chronological holdout; Weeks 1-4 2026 are disclosed diagnostic confirmation.
No candidate or coefficient may be selected from Week 5.

## Frozen acceptance gates

- 2025 Brier and log loss both improve versus the market-free incumbent, with no worse absolute
  expected-scorer error.
- 2026 Weeks 1-4 Brier and log loss both improve versus the released independent model; Brier
  improves in at least three of four weeks and in Weeks 2-4 combined.
- The chronologically selected scorer policy is no worse than released 2026 F1 and improves 2025
  F1 versus the market-free incumbent. Report weekly selected/correct counts.
- QB, RB/FB, WR, and TE each tie or improve released AUC; no group with at least 100 rows regresses
  both Brier and log loss.
- Game-clustered Brier and log-loss point deltas are favorable; at least one 95% interval excludes
  zero in the favorable direction.
- Before production, the frozen winner must pass a new Week 5 forward confirmation, current exact-
  price board replay, promotions/demotions and actionable counts, all lock/writer/lease/provider
  budget tests, `npm run verify:model-change`, latest-main integration safety, protected PR checks,
  deployment checks, and a naturally refreshed live snapshot.

If no r3 candidate passes the known chronological gates, no ingestion code will be added. If a
candidate passes the known gates but Week 5 is not complete, implementation remains unactivated
until that one new forward slice passes; this is not a shadow-board requirement and does not alter
this week's member predictions.
