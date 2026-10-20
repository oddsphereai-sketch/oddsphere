# CFB midweek availability and FCS polling continuity

Date: 2026-10-20

## Owner direction

Repair the actual Tuesday/Wednesday college-football injury-report and FCS-only
market gaps. Do not substitute copy, warnings, synthetic injuries, synthetic
prices, or arbitrary promotions for missing evidence.

## Root causes

1. The official Sun Belt JSON named schools as `South Alabama` and `Marshall`,
   while the schedule used mascot-bearing names. The availability collector's
   private matcher rejected that valid event even though the shared CFB team
   resolver already handled it.
2. Faktor can publish an availability card as either an `article` or `section`.
   The production parser accepted only `article`. CUSA also uses `NM State`,
   which was missing from the centralized NMSU alias list.
3. The paid FCS fallback retained a hard 5,000-credit reserve. With 3,470 paid
   credits remaining, that reserve disabled every current request even though
   a complete worst-case week costs at most 576 credits.

## Repairs

- Availability release
  `cfb_official_conference_availability_2026_10_20_r3_shared_team_identity_container_compatibility`
  uses the shared strict identity resolver, adds the explicit NMSU aliases
  `NM State` and `New Mexico State`, and accepts both Faktor container types.
- Fallback release
  `cfb_the_odds_api_fcs_fallback_2026_10_20_r4_bounded_month_end_continuity`
  keeps the existing one-request, hourly, 176-ordinary / 192-total weekly
  controls and sets the reserve to 1,152 credits: two complete worst-case
  weekly budgets.
- Collector/writer releases advance to r61/r131 so unlocked rows refresh under
  one authoritative `prediction_pipeline:cfb` lease. No model equation,
  probability, side, grade threshold, stake, or reader semantic changes.
- The temporary authenticated audit endpoint and all candidate-only switches
  are removed from the production release.

## Zero-write acceptance evidence

The current board contained 96 games: 56 with an FBS participant and 40
FCS-only. The isolated official-availability rehearsal increased exact report
matches from 0 to 2, recovering South Alabama–Marshall (18 unavailable players)
and James Madison–App State (11 unavailable players). CUSA's signed official
embed returned its empty report state at audit time, so no CUSA injury was
invented.

The full current-board before/candidate decision replay produced:

| Measure | Before | Candidate |
| --- | ---: | ---: |
| Best Angle | 15 | 15 |
| Lean | 35 | 34 |
| Watchlist | 97 | 97 |
| No Play | 18 | 20 |
| Held | 123 | 122 |
| Promotions | — | 0 |
| Demotions | — | 1 |

There were five fresh-input changes, all outside the FCS recovery lane. The
FCS-only lane remained 120 Held market slots and recovered zero paired
Moneyline, Spread, or Total markets.

An authenticated provider-only diagnostic explained the zero recovery:

- requested FCS games: 40
- provider events returned: 0
- matched games: 0
- credits used: 0
- credits remaining: 3,470

Therefore the recurring production defect was the reserve blocking future
polling, not event normalization in the current response. The lower reserve
allows bounded hourly attempts when the vendor publishes; it does not assert
that current FCS prices exist and cannot create a synthetic market.

## Safety and rollback

Official conference availability is member-panel evidence only and is excluded
from the prediction and grade equations. FCS prices retain strict away/home
orientation, kickoff tolerance, team identity, complete two-sided quotes,
provider precedence, target-exclusion, pregame chronology, and exact-price
actionability requirements. Missing evidence remains missing/Held.

Locked projection, probability, side, grade, price, stake, and evidence fields
must remain byte-identical. Roll back collector/writer/fallback/availability
r61/r131/r4/r3 to r60/r130/r3/r2 without touching existing locked rows.
