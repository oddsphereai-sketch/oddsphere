# CFB paid FCS odds-gap fallback r38

Status: owner-approved production correctness repair.

## Problem

The generalized CFB slate and independent forecasts were present, but primary providers left many
FCS-only games without complete named-book Moneyline, Spread and Total quotes. The October 8
zero-write baseline contained paired sportsbook coverage for only 2 / 1 / 0 of 31 FCS-only games.
That prevented a real opening/current trail, exact line-specific prediction publication and exact-
price evaluation even though the owner had purchased a paid The Odds API tier with historical odds.

## Frozen provider contract

The existing authority remains primary:

1. paid BALLDONTLIE named books;
2. bounded exact-event SharpAPI named books;
3. CFBD named books;
4. The Odds API FanDuel, DraftKings and Rebet rows for remaining FCS-only gaps.

The fallback is allowed only after strict away/home orientation, canonical team identity, kickoff-
within-three-hours, unique provider event, supported sport key, complete two-sided price/line pair,
valid market timestamp and pregame chronology checks. A lower tier fills an absent named book but
cannot replace the same named book from a higher tier. Anonymous, synthetic, incomplete, reversed or
ambiguous rows are rejected.

The October 9–11 r38 transition slate may query two historical snapshots, oldest first, to recover
the earliest retained same-book context. It is stored as `first_observed`; it is not represented as a
provider opening. Later current observations form the ordinary same-book trail. Future weeks prefer
the true primary-provider opening and otherwise begin with the first verified observation.

## Budget and cadence

- One current FCS sport-level request costs three credits and covers every eligible event returned.
- Current pulls occur at most hourly only while an upcoming FCS gap exists; T-60 may force one due
  pull so locks use the freshest allowed quote.
- Ordinary pulls are capped at 176 per active Tuesday–Monday CFB window; 16 additional pulls are
  reserved for T-60, for a hard ceiling of 192 pulls / 576 credits per week.
- A 5,000-credit reserve stops optional pulls before exhausting the paid 20,000-credit plan.
- Historical recovery is transition-only and costs at most 60 credits for the two slate snapshots.
- Request counts and remaining-credit headers are stamped into the existing evidence payload budget.

## Replay evidence

The read-only October 8 live-provider replay produced:

| Cohort | Moneyline before → after | Spread before → after | Total before → after |
| --- | ---: | ---: | ---: |
| Full slate baseline / upcoming r38 | 59/88 → 85/86 | 58/88 → 84/86 | 57/88 → 84/86 |
| FCS-only, 31 games | 2 → 30 | 1 → 29 | 0 → 29 |

Montana–Northern Arizona had no strictly matchable supported quote and remains unavailable. No price
is fabricated. The exact candidate replay retains 91 actionables with zero promotions and zero
demotions; existing target-excluded consensus requirements prevent a fallback quote from becoming an
unsupported action by itself. This is coverage and chronology evidence, not a future accuracy claim.

## Lock and tracking transition

Completed games, settled tracking rows and valid prior T-60 locks are immutable. The member reader
has an explicit r37 → r38 bridge: a valid r37 locked row remains the authority while a sibling
unlocked game may advance to r38. The immediately preceding r36/r41 family remains readable with its
actual release tuple. Recovery accepts these supported prior immutable prediction payloads, while new
official tracking writes remain strict to the current r38/r42/r30 tuple.

## Unchanged behavior

The independent score equations, market-reading/arbitration logic, probabilities, sides, grade
thresholds, stakes, copy, labels, layout, sole writer, `prediction_pipeline:cfb` lease, lock timing,
tracking denominator and settlement behavior are unchanged. Release identifiers are bumped because
new verified market inputs can affect unlocked exact-price evaluation.

## Rollback

Remove `THE_ODDS_API_KEY` from the production runtime and roll back evidence/member/writer/fixture/
outcome/snapshot/reader/tracking r38/r52/r105/r78/r68/r38/r23/r39 together to r37. Preserve every
existing immutable lock and tracking result.
