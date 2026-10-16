# NFL player-props route-data entitlement audit

Date: 2026-10-16

Mode: read-only credential-presence, repository-contract, retained-schema, and official-documentation audit

Production changes: none

## Decision

The active paid-provider estate does not contain the complete receiver-level route participation, alignment, red-zone-route, and end-zone-target history required to test a materially better independent Receiving Yards or touchdown-opportunity model. This is an input-entitlement gap, not a reason to keep searching coefficients in the same incomplete feature set.

Do not purchase another odds feed for this purpose. First request a licensed sample and commercial quote for SportsDataIO NFL Advanced Metrics. Use Sportradar as the second diligence target. Neither source is approved for ingestion until the sample, historical coverage, delivery timing, identities, correction semantics, and paid-product/derived-projection rights pass the acceptance test below.

## Existing paid providers

Credential values were never printed or tested. Local key-name presence on 2026-10-16 showed only `BALLDONTLIE_API_KEY` and `SHARPAPI_KEY` among the audited football/provider candidates.

| Source | Verified local use | What it supplies | Entitlement conclusion |
|---|---|---|---|
| BALLDONTLIE NFL | Active key and production integrations for games, player/team stats, plays, injuries, rosters, snap/advanced statistics, and player props | Stable game/player identities, box-score usage, roster and injury state, play-derived red-zone evidence | The local integrations and retained payload contracts contain no exhaustive routes-run, route-participation, receiver-alignment, red-zone-route, or end-zone-target table. Current entitlement does not close the gap. |
| SharpAPI | Active key and production integrations for prices, lines, openings, and reference-book market reading | Market observations, not player-performance tracking | Useful for reading movement after the independent forecast exists; it cannot supply route participation or matchup-performance inputs. |
| nflverse, FTN, NGS, and PFR retained research data | Existing approved research cache | Play-by-play, targets/touchdowns, charting, Next Gen receiving measures, snaps, rosters, and stable identities | Audited retained schemas contain no complete receiver-game routes-run/participation plus alignment/end-zone table. No incremental cost, but no closure of the missing-data problem. |
| Playbook, CollegeFootballData, and The Odds API | No matching active credential found in the local key-name audit | Context, college data, or odds | None is an entitled NFL route-performance feed for this use case. Enabling an odds/context source would not close the gap. |

## Commercial diligence order

### 1. SportsDataIO NFL Advanced Metrics

The published field guide explicitly lists route participation, red-zone targets, end-zone targets, yards per pass route, slot percentage, target separation, and other receiver/matchup fields. Public documentation does not establish OddSphere's commercial price or redistribution rights; those require a vendor quote and written license.

Request exact season coverage (preferably 2016-2026), player-game and/or route-event grain, stable ID crosswalks, zero-route/zero-target rows, correction history, weekly availability, and explicit rights to use the fields in paid public projections.

Official references: [NFL API documentation](https://sportsdata.io/developers/api-documentation/nfl), [NFL Advanced Metrics field guide](https://sportsdata.io/files/SDio_NFL_Advanced_Metrics.pdf), and [data-rights/licensing FAQ](https://sportsdata.io/help/data-rights-and-licensing-questions).

### 2. Sportradar NFL

The official NFL FAQ documents `Pass Route` among subjective statistics and states those statistics are delivered by Tuesday at 6 p.m. ET. Public documentation does not prove that every eligible receiver is recorded on every dropback or that a complete player-game route-participation table is included. Require a sample payload and explicit completeness statement before treating this as a solution.

Official references: [NFL FAQ and subjective-stat timing](https://developer.sportradar.com/football/v5/reference/nfl-faq), [seasonal statistics](https://developer.sportradar.com/football/reference/nfl-seasonal-statistics), and [statistics summary](https://developer.sportradar.com/football/v6/reference/nfl-statistics-summary).

SharpAPI's official product remains an odds/player-props feed rather than a performance-tracking feed: [SharpAPI NFL odds](https://sharpapi.io/odds/nfl).

## Vendor sample acceptance test

Ask both vendors for the same sample: all offensive players for two named completed games plus the complete season-to-date player-game table. Require player/game/team/position IDs, team dropbacks, routes run, route participation, targets, red-zone routes and targets, end-zone targets, slot/wide alignment, and revision timestamp.

Accept only if the sample proves:

1. exhaustive participants, including zero-target receivers;
2. documented and internally consistent denominators;
3. stable crosswalks and correction semantics;
4. historical depth sufficient for release-pure training and evaluation;
5. delivery timing compatible with the weekly product; and
6. written commercial rights for paid public predictions and derived probabilities.

No provider purchase, account change, production ingestion, model change, or public-site change was made by this audit.
