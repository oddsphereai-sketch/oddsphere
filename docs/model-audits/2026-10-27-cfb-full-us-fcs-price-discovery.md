# CFB paid FCS full-US price discovery

Date: 2026-10-27

Status: production correctness candidate; future unlocked rows only.

## Scope and authority

This change affects only the CFB FCS-only paid price fallback and the existing
sole CFB forward-evidence writer. It does not change an independent model,
calibration, probability, decision policy, grade threshold, market-reader
rule, stake, lock, tracking rule, cron, or member layout. The authoritative
write path remains `cfb-forward-evidence` under the shared
`prediction_pipeline:cfb` lease.

Starting production base:
`81e99c5ac99b76fdc7db89f5b19f28a3cd9861db`.

## Production finding

The read-only current-board audit contained 100 CFB games. Fifty-six games,
all with at least one FBS participant, had paired Moneyline, Spread, and Total
prices. Forty-four FCS-only games had none of the three markets from any stored
provider, for 132 held market slots.

The latest paid fallback attempt was current and authenticated:

- requests: 1;
- provider events returned: 0;
- credits used: 0;
- credits remaining: 2,985;
- matched games: 0.

This was not a team-name rejection: the provider returned no event to match.
The request selected ten specific sportsbooks. The provider's current contract
has additional US and US2 books and explicitly states that an odds response
contains only events listed by the requested bookmakers; an empty response
costs zero credits. Therefore a game listed only outside that ten-book subset
was invisible to the fallback.

## Repair

Release
`cfb_the_odds_api_fcs_fallback_2026_10_27_r5_full_us_region_discovery` requests
the complete `us,us2` regions in one slate-level call. It normalizes the
additional current provider keys for BetUS, Bovada, LowVig, MyBookie,
BetAnySports, betPARX, Courtside, Fliff, and Hard Rock Bet state feeds.

The response is partitioned before it reaches the model:

1. `booksByGame` contains the exact same normalized ten-book lane used before
   this repair;
2. `displayBooksByGame` also contains any newly discovered complete paired
   book quote;
3. every newly discovered book is explicitly non-target and non-reader;
4. the writer uses the broader set only in its already existing display-price
   hierarchy.

This closes a source-discovery gap without granting an unevaluated book model
authority. It also preserves the higher-tier same-book precedence: a lower
The Odds API quote cannot replace an existing BALLDONTLIE, SharpAPI, or CFBD
quote for that book.

## Load and budget

The request count, cadence, and concurrency do not increase. Two regions and
three markets cost at most six credits per current pull. The existing 176
ordinary / 192 total weekly request ceilings are unchanged. A complete
worst-case week is therefore 1,152 credits, and the two-week reserve is 2,304.
Historical transition snapshots, if ever eligible under their already frozen
one-time gate, declare a 60-credit maximum each.

## Same-input impact and verification contract

The focused deterministic fixture returns two strict exact events:

- an event with the existing FanDuel/BetRivers/Caesars/BetOnline lane;
- an event available only at newly discovered Bovada.

The first event retains its exact model inputs. The second moves from no
display quote to a complete display quote but remains absent from
`booksByGame`, non-target, and non-reader. Therefore model-output changes, side
changes, grade changes, promotions, demotions, and actionable-count changes are
all zero. No synthetic event, line, price, or timestamp is accepted.

Required publication gates:

- `npm run test:cfb-v1-production`;
- TypeScript;
- `npm run verify:model-change`;
- latest-main integration safety and no-overlap proof;
- protected PR checks and up-to-date branch;
- production release identity, current paid-provider request/credit telemetry,
  coverage, one-writer/one-lease, member price-map, and locked-hash proof.

## Rollback

Roll back r5/r140 to r4/r139 for future-unlocked collection only. Do not delete,
rewrite, reinterpret, or replace any stored locked payload or tracking record.
Rollback is mandatory if a newly discovered display book enters model
authority, the current request costs more than six credits, the production
writer overlaps, release identities mix, coverage regresses, or a lock changes.
