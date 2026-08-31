# CFB kickoff-weather predeclaration

Date: 2026-08-31  
Starting production base: `57e61c3ade334d34eee3b41d828a33c1c13ee0c1`  
Status at declaration: implementation not started; thresholds below frozen before current-slate impact replay

## Problem and invariant

The CFB forward writer currently labels venue weather unavailable even though the configured football runtime already has an authenticated OpenWeather forecast provider and Playbook publishes exact NCAAF home-venue metadata. Playbook's NCAAF venue-weather response was verified read-only on 2026-08-31: all 138 rows had venue coordinates, but its conditions were current-time conditions even when a future `date` was requested and therefore are not valid kickoff forecasts. Playbook's NCAAF injury endpoint returned HTTP 404 with no report.

The production change may use Playbook only for uniquely matched home-venue identity/coordinates and the established OpenWeather provider only for the forecast nearest the scheduled kickoff. It must never use Playbook's current conditions as future weather. A neutral-site or ambiguous venue, missing provider, out-of-horizon forecast, or provider failure remains explicitly unavailable and never holds or suppresses a prediction.

## Frozen forecast semantics

- Match the venue to the exact home team by Playbook team ID or normalized full team name; accept exactly one row. Neutral-site games do not inherit the nominal home team's venue.
- Fixed-roof venues are weather-neutral without an external forecast call.
- A forecast must be within six hours of scheduled kickoff, carry its provider forecast/fetch timestamps, and be no more than six hours old when reused. T-60 always requests a fresh forecast.
- Only adverse, football-relevant kickoff conditions adjust the independent total PMF:
  - sustained wind 15-19 mph: -1.0 independent expected-total point;
  - sustained wind 20-24 mph: -2.0 points;
  - sustained wind at least 25 mph: -3.0 points;
  - precipitation probability at least 60% with rain, thunderstorm, snow, sleet, or freezing conditions: an additional -0.5 point;
  - temperature at or below 25 F: an additional -0.5 point;
  - combined adjustment capped at -3.0 points; no positive weather adjustment.
- The adjustment reweights score cells within each existing home-margin group. It may change the total distribution but must preserve the independent margin distribution exactly. It is applied before the existing 25% independent / 75% canonical market-sharp-public mixture, so its maximum direct shift to the authoritative expected total is bounded by the independent weight.
- The authoritative forecast, exact-price economics, and existing Daily Edge grade ladder then run normally. Weather can therefore change a total side or grade only through the versioned forecast probabilities; it cannot directly promote a grade.
- Existing T-60 rows and tracking tuples remain immutable. Missing weather or injury evidence never becomes a health hold.

## Availability semantics

The writer continues to project the expected quarterback from the active BALLDONTLIE team roster and previous-season passing attempts. If the active roster changes, the next natural writer cycle recomputes the quarterback context and forecast inputs. No provider currently supplies a timestamped NCAAF questionable/doubtful/out report, so the product must say that injury-report context is unavailable rather than fabricating or holding a game. A future injury integration requires exact player/team identity, a source timestamp, and a separately versioned model rule.

## Required evaluation before publication

- Unit tests for venue identity, neutral sites, fixed roofs, provider failure, horizon/freshness, T-60 refresh, and request bounds.
- PMF tests proving total movement, exact margin-distribution preservation, normalization, capped adjustment, and no change when unavailable.
- A read-only same-slate replay reporting weather coverage, affected totals, side/grade changes, promotions and demotions, total actionable count, and maximum forecast shift.
- Existing full CFB production suite, model-change verification, typecheck, focused lint, production build, clean diff, and fresh-main integration safety.
- Protected PR, exact-tree verification, deployment success, natural writer-cycle release/coverage verification, lock integrity, and signed-in live-reader QA.

