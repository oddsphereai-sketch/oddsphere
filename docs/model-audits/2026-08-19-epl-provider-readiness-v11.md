# EPL provider and launch-readiness release v11

Date: 2026-08-19
Status: local production candidate; all production gates remain disabled

## Scope and release identity

- Projection model is unchanged: `epl_club_dixon_coles_2026_08_18_r8`.
- Calibration/runtime policy is bumped to `epl_grade_policy_2026_08_19_v11` because the new BALLDONTLIE fallback can supply a missing Match Result market input.
- Authoritative writer remains `/api/cron/epl-daily-refresh` under the soccer `prediction_pipeline` lease.
- Targeted T-60 writer remains `/api/cron/epl-pregame-lock` under the same lease.
- No public visibility, database writes, cache writes, settlement, or provider cron was activated during this work.

## Provider findings

Read-only probes against the configured accounts returned:

- BALLDONTLIE current EPL odds: 30 rows, all 10 Gameweek 1 matches, with home/draw/away fields.
- BALLDONTLIE dedicated opening endpoint: zero rows for all 10 matches.
- Sharp events and current odds: present, but the same fixture is represented by sportsbook-specific and proposition-heavy duplicate event buckets.
- Sharp splits: authenticated HTTP 200 with zero rows for `sport=soccer`, EPL league only, combined sport+league, and a concrete EPL event ID.
- Playbook: remains unsupported for EPL following the prior live alias probe that returned the wrong league.

The old `bdlOdds=pending` health label was incorrect because it represented only the dedicated opening call. v11 reports current and opening coverage separately.

## Runtime changes

- Sharp remains the primary current-price source for Match Result, Double Chance, Total, and BTTS.
- Each primary fixture event is read with four narrow official-market filters. This prevents large player-prop catalogs from pushing tracked markets beyond a pagination cap.
- Duplicate events are ranked first by exact fixture identity, then full-game market breadth. External-ID count is only a tiebreaker.
- Compound Double Chance selections and unrelated score/total combinations are rejected.
- `tie` is accepted as the draw component of a valid Double Chance selection.
- BALLDONTLIE supplies a coherent same-vendor three-way fallback only when Sharp lacks a complete 1X2 book. It never fabricates Double Chance, Total, BTTS, or an opening price.
- Split normalization is ready for three-way Match Result, Total, and BTTS rows. An empty successful response is `unavailable`, not an error and not evidence for a grade.
- Current slate stat health is separated from four-season xG completeness. Recent score rates remain available when xG is absent; promoted clubs remain visibly identified as proxy priors.

## Board-count impact

Latest full-slate v11 dry run:

- 40/40 selected current prices.
- 100/100 current outcome rows/trails: 30 Match Result, 30 Double Chance, 20 Total, and 20 BTTS.
- 5 Best Angles, 2 Leans, 7 Watchlists, 26 No Plays, 0 Cautions.
- Match Result: 5 Best Angles, 2 Leans, 2 Watchlists, 1 No Play.
- Double Chance: 4 Watchlists, 6 No Plays.
- Total: 1 Watchlist, 9 No Plays.
- BTTS: 10 No Plays.

The Match Result actionable board is unchanged from the immediately preceding fresh probe. No Total, BTTS, or Double Chance actionability threshold was added. The apparent reduction from earlier secondary-market Watchlists is price-response state, not a new demotion rule; all three markets remain non-actionable by release contract.

## Cost and failure boundary

- Historical foundation remains persistently cached and process-deduplicated.
- Slate assembly remains cached for five minutes with three workers.
- Primary Sharp usage is capped at four narrow calls per fixture; duplicate-event fallback is capped at ten additional calls per weekly slate.
- Splits remain one league-wide call per slate assembly.
- Scheduled refresh cadence is 30 minutes; the T-60 sweep is every five minutes during 10:00–22:59 UTC and calls paid providers only when an unlocked game enters the window.
- Member reads use the stored weekly snapshot and make zero provider calls.
- Any provider or writer error prevents publication and preserves the last coherent member snapshot.

## Known limitations and rollback

- Provider-native opening coverage is zero. The product must say `First Captured`; it must not label that observation `Opening`.
- Sharp public split rows are not presently available. The UI retains an unavailable state and will populate automatically only after a normalized non-empty provider response.
- Total and BTTS validation remains below the betting-quality baseline, so their forecasts cannot be promoted to Lean or Best Angle.
- Rollback is the previous v10 policy plus disabling all seven EPL gates. No World Cup reader, release, or writer is replaced.
