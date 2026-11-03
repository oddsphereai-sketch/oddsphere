# NBA market-data continuity repair — November 3, 2026

## Owner requirement

Repair missing NBA line/price tracking and sharp splits across the live Daily
Edge board. The repair must restore real provider evidence, preserve the unified
reader, avoid fabricated movement, and leave every stored locked record exact.

## Reproduced production defect

At 12:02 UTC the published rolling NBA snapshot contained 47 games and 141
markets. The nearest 14-game slate had executable lines on only CLE-OKC. Five
consecutive `nba_daily_refresh` runs were partial because Owl's exposed a
Circa/Pinnacle pair for only one of those games. A read-only provider replay
proved BALLDONTLIE already supplied 276 complete consumer quote rows across five
games, but the writer's intersection gate discarded four complete game boards
solely because a sharp pair was absent.

Owl's `/splits` simultaneously returned 24 real observations for four upcoming
games (PHI-DET, CHA-BKN, MIN-HOU and DAL-SA). The durable feed retained them and
the exact-game overlay matched all four games / 12 markets in memory, but the
member snapshot publisher read a five-minute process cache populated before the
new capture. The upstream split response remained explicitly partial
(`book_unavailable`); no source supplied truthful named-book splits for the
other ten games at audit time.

## Predeclared repair

- Keep BALLDONTLIE as the primary consumer execution source.
- Permit complete consumer and sharp lanes to advance independently. A
  consumer-only scope manages consumer books only; a sharp-only scope manages
  Circa/Pinnacle/Bookmaker only. Neither lane may delete the other.
- If consumer games remain missing, use one current `basketball_nba` The Odds
  API request for eight already approved regulated books and all three official
  markets. Reuse that one board across every rolling slate date. Do not make a
  request per game or date, and do not grant this source sharp-reader or split
  authority.
- Continue rejecting one-sided or incoherent book/market groups. Append only
  actual provider-timestamped quotes to `line_history`; never reconstruct an
  opener or movement stop.
- Expire the Owl's durable split-read cache immediately after a scheduled
  provider capture so the next member publication sees the new exact-game rows.
- Keep missing upstream split rows missing. No percentage, book label or
  availability is inferred.

## Releases

- model/prediction: `nba_professional_unified_2026_11_03_r33_consumer_gap_continuity`
- market marriage: `nba_market_marriage_2026_11_03_r35_consumer_gap_continuity`
- grade: `nba_grade_policy_2026_11_03_r24_consumer_gap_continuity`
- refresh: `nba_daily_refresh_schedule_2026_11_03_r22_consumer_gap_continuity`
- fallback: `nba_the_odds_api_current_2026_11_03_r1_bounded_board_fallback`

The score model, probability calibration, market consequence, reader posture,
grade thresholds, stake rules, cadence, writer and `prediction_pipeline:nba`
lease are unchanged. Release bumps identify the changed live input path.

## Qualification and rollback

The post-repair read-only provider rehearsal covered five of 14 games / 15 of
42 official market scopes from BALLDONTLIE plus Owl's, versus one game / three
scopes actually persisted by the incumbent intersection gate: four games and
12 complete scopes are guaranteed recoverable before the supplemental fallback.
The supplemental production key is intentionally not present in the local
operator environment, so its incremental live event count must be verified from
the deployed request receipt rather than claimed. The candidate makes zero
grade-rule promotions or demotions and introduces no flattening rule; restored
exact prices may legitimately change unlocked dynamic grades when the sole
writer recomputes them. The existing paired reader suite retained its tested
promotion/demotion symmetry (including the clean promotion path) with zero new
nonpositive-EV promotion.

The captured split overlay moved from zero displayed rows in the published
snapshot to four exact games / 12 markets in the same-payload rehearsal. The
remaining ten games stayed empty because neither current Owl's nor the durable
DraftKings source published a named-book pair at the audit instant.

Focused provider, complete-pair, independent-lane, split persistence/cache,
canonical price, reader consequence, T-60 ordering and TypeScript/ESLint checks
passed. `npm run verify:model-change` passed in full; the optional local Market
Brain PostgreSQL proof was skipped because its URL is not configured, as the
repository gate specifies.

Publication still requires latest-`origin/main` integration, a clean committed
worktree, integration safety, protected PR checks and an up-to-date head. After
merge, verify the exact production commit and release, normal cron, consumer
coverage, real selected/opposing trails, captured split attachment and unchanged
locked payloads.

Rollback the r22 refresh/fallback and r33/r35/r24 identifiers together. Preserve
all append-only line history written while live; rollback must not erase real
observations or rewrite any lock.
