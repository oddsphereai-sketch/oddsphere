# NFL personnel coverage repair predeclaration — 2026-10-15

## Objective

Remove two false Week 6 personnel holds without weakening the NFL fail-closed contract:

- `PIT@TB`: Baker Mayfield is unavailable, Jalon Daniels is the selected replacement, and the
  existing current-season store contains his exact provider player ID with passing attempts in
  completed Weeks 3-5. The frozen preseason quarterback map cannot contain a 2026 rookie and must
  not be the only valid history authority.
- `WSH@SF`: exact-game designation rows exist, but the scheduled writer captured a null report
  even after the provider returned its updated designation rows. The collector currently makes no
  transient retry and its continuity layer also conflates a verified clear report with an omitted
  report whenever every exact-game row normalizes to healthy/full participation.

This is a personnel-evidence correctness repair, not a forecast-accuracy claim or a model-weight
experiment.

## Candidate declared before result inspection

1. Preserve the frozen quarterback state whenever the selected player has an exact artifact match.
2. Otherwise qualify the selected player only by exact depth-chart provider player ID, exact
   prediction season and team, and at least one passing attempt in a completed current-season game
   with `week < predictionWeek`.
3. Use only observed prior passing attempts for the current-season player's experience input. Keep
   EPA/CPOE/sack/turnover inputs at neutral priors because the current store does not contain those
   player-level fields. Do not infer them from headlines, betting lines, or team outcomes.
4. Keep an unmatched or future-only player fail-closed and persist the quarterback history source.
5. Give each designation and legacy injury team batch a shared two-retry budget for transient
   network, 408, 425, 429, and 5xx failures. Cap any Retry-After sleep at two seconds and use
   bounded 250/1,000-millisecond fallback delays when the provider omits that header.
6. Preserve exact-game designation coverage as `verifiedClear` when source rows exist for both
   scheduled teams but no player remains reportable. A one-team or complete row omission stays unavailable and cannot erase
   the last verified report.
7. Increase the declared worst-case availability request ceiling from 16 to 20 calls per team
   batch. Do not change cadence, endpoints, team scope, pagination depth, or fallback identity.

## Release boundary

- Production model/calibration remain r28/r27 because no forecast coefficient or calibration
  function changes.
- Decision/grade/member advance to r36/r36/r33 because previously held future rows may become
  evaluated.
- Collector/writer/fixture/snapshot advance to r22/r63/r45/r37.
- The frozen r6 quarterback artifact remains byte-identical. Its surrounding shadow decision
  schema/eligibility wrapper advance to r2/r7 so the new history authority is never emitted under
  the prior decision identity.

## Acceptance gates

1. A frozen-artifact quarterback remains identical and reports `frozen_artifact` history.
2. An exact current-season player with completed pregame attempts clears the history hold and
   reports `current_season_completed_games`.
3. Wrong player ID, wrong team, zero attempts, same-week, future-week, or absent state remains
   `unmatched` and held.
4. A transient failed designation request recovers within the batch budget without invoking the
   legacy endpoint. A persistent failure exhausts exactly two retries and falls back only the
   unresolved games.
5. An exact-game all-clear designation response remains a verified available report; a true row
   omission remains unavailable and preserves prior evidence.
6. Same-input Week 6 rehearsal writes zero rows and reports all game/market holds, side/probability/
   score changes, actionables, promotions, and demotions against the live r32 snapshot.
7. Focused tests, `npm run verify:model-change`, latest-main integration safety, protected PR checks,
   and post-deploy release/coverage/lock verification pass.

## Explicit non-goals

- No coefficient fitting, threshold tuning, scalar market weighting, market-reader change, manual
  player allowlist, public-web scraping in the production writer, second writer, or lock rewrite.
- Public team reports are corroborating audit evidence, not an unversioned runtime input.
