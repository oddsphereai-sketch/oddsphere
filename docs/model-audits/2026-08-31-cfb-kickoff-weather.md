# CFB kickoff-weather production qualification

Date: 2026-08-31  
Starting production base: `57e61c3ade334d34eee3b41d828a33c1c13ee0c1`  
Candidate: r48 kickoff-weather release set

## Result

The candidate qualifies for production. It adds verified game-time weather to the existing CFB
forecast before the established 25% independent-football / 75% current-market mixture. It does
not change the Daily Edge grade ladder, stake policy, weekly board scope, public/Circa split
semantics, writer ownership, or lock behavior.

Playbook is used only to identify an exact home venue and coordinates. Its NCAAF future-date
weather response was rejected because it returned current conditions and no game identity.
OpenWeather supplies the forecast nearest kickoff, subject to the frozen six-hour offset and
freshness bounds. Fixed roofs are neutral. Neutral sites, ambiguous venues, provider failures,
and games outside the forecast horizon receive zero weather adjustment and remain publishable.

Playbook's NCAAF injury endpoint returned HTTP 404 with no injury report. The writer therefore
continues to publish the projected active-roster quarterback context and explicitly labels the
timestamped injury feed unavailable. Missing injury or weather evidence never holds a game.

## Frozen current-slate replay

The successful read-only replay covered 87 FBS-involved games in the week-ahead board:

- 49 had a usable kickoff forecast, one was controlled indoor, and 37 were outside the provider
  horizon.
- Six games received a negative independent-total adjustment: LIU@KU (-1.0), NIU@IOWA (-1.5),
  OHIO@NEB (-0.5), TOL@MSU (-0.5), UNT@IU (-0.5), and UTEP@OU (-0.5).
- The largest absolute authoritative expected-total movement was 0.3676 points, consistent with
  the forecast's bounded 25% independent weight.
- Across 166 comparable exact-price markets, grades moved from **13 Best Angles / 31 Leans / 76
  Watchlists / 46 No Plays** to **12 / 32 / 76 / 46**. Actionable markets stayed 44 -> 44.
- There were zero promotions, one demotion, and zero side changes. NIU@IOWA Over 45.5 moved from
  Best Angle to Lean at the same Fanatics -105 quote as model probability fell from 55.605% to
  54.663% and exact offered-price EV fell from 8.563% to 6.723%.

The replay therefore shows a bounded adverse-weather correction without flattening the board or
manufacturing action. Synthetic qualification tests separately prove the rule can move probability
toward Under, promote an economically qualified Under, and reverse a total prediction when the
weather-adjusted PMF genuinely crosses the other side.

## Exact-tuple coherence refinement

An initial replay exposed a bookkeeping hazard: recomputing the weather candidate could select a
different sportsbook even though both evaluations used the same captured board. That could make a
grade appear to improve because the target price changed, rather than because weather improved the
forecast. The writer now first resolves the no-weather target sportsbook for each market and holds
that target fixed while evaluating the weather-adjusted forecast. Weather may change side,
probability, EV, or grade, but it cannot receive a false grade improvement from target-book
rotation. The published tuple remains a coherent named-book, exact-line, exact-price tuple.

## Safety and operations

- The total PMF adjustment is capped at -3 independent points, never increases totals, preserves
  every home-margin group's probability mass, and remains normalized.
- Missing evidence produces a warning and zero adjustment, not a Hold or inferred condition.
- Weather forecasts are reused for at most six hours; T-60 always refreshes.
- The existing sole `prediction_pipeline:cfb` lease and append path remain authoritative. The
  writer adds one Playbook venue-metadata read per run and at most one weather request per eligible
  outdoor game, bounded with concurrency six.
- Existing r17/r26/r24 evidence remains readable. Immutable T-60 and started-game rows keep their
  original releases and exact tuples.
- The complete CFB production suite passed, including venue identity, provider failure, forecast
  horizon/freshness, T-60 refresh, PMF preservation, exact-price decision coherence, publication,
  and tracking contracts.

Rollback is the complete r47 Playbook event-identity release set. No reader-side override or copy
change is part of this release.
