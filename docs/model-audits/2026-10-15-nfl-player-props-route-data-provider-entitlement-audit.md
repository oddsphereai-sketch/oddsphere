# NFL player-props route-data provider and entitlement audit

Date: 2026-10-15

Mode: read-only source and contract audit
Production changes: none

## Decision

Do not tune Receiving Yards or Anytime TD around the missing route variables and do not enable TD actionability. The currently active, already-paid football feeds do not expose the complete receiver-level route participation, alignment, end-zone target, and red-zone route data needed to test the intended independent architectures. The gap is an input-entitlement gap, not evidence that another coefficient search is justified.

The best first commercial-data diligence target is SportsDataIO's NFL Advanced Metrics package. Its published dictionary explicitly lists route participation, red-zone targets, end-zone targets, yards per pass route, slot percentage, and target separation. Sportradar is the second diligence target: its NFL documentation exposes play-level `pass_route` and alignment-adjacent fields, but the public documentation does not prove a complete player-game routes-run table. Obtain written data dictionaries, historical samples, update SLAs, derived-product rights, and quotes from both before selecting either one.

## Existing OddSphere sources

| Source | Local status | Relevant capability actually present | Route-data conclusion | Incremental cost conclusion |
|---|---|---|---|---|
| BALLDONTLIE NFL | Active key; production integrations use games, player stats, team stats, plays, injuries/designations, rosters, snap counts/advanced stats, and player props | Stable provider player/game IDs, box-score targets, red-zone inference from plays, roster/injury state | The official NFL API documentation does not publish routes run, route participation, receiver alignment, red-zone routes, or end-zone targets as fields/endpoints. Existing access does not close the gap. | $0 to reuse current entitlements; no route-gap closure. The public GOAT plan is $39.99/month, but the repository does not authoritatively prove the account's billing tier. |
| SharpAPI | Active key; market odds, props, splits/opportunities | Price/line history and market-reading inputs | Market feed only. It is not a player-performance route feed. | $0 to use current market entitlement. Public plans are Free, $79, $229, and $399 per month; streaming is a $99 add-on. No plan closes the route gap. |
| nflverse / FTN / NGS / PFR retained datasets | Approved public research inputs | Play-by-play targets and touchdowns; FTN public charting; NGS receiving metrics; snap counts; rosters; stable GSIS IDs | The retained schemas contain no complete routes-run/route-participation or alignment table. FTN's public dictionary includes QB sneak and other charted play fields, but not receiver routes. | $0, subject to each dataset's attribution/license terms; no route-gap closure. |
| Playbook, CollegeFootballData, The Odds API | Code paths exist, but no active key was present in the local environment audited | Lines/splits, college data, or odds fallback | None is a route-participation source for this NFL use case. | Enabling them would not close the gap, so no purchase is recommended for this purpose. |

Credential values were never printed or tested in this audit. Key presence was checked locally only.

## Commercial options that could close the gap

### 1. SportsDataIO NFL Advanced Metrics — preferred first diligence target

Published capability: the official advanced-metrics dictionary lists route participation, red-zone targets, end-zone targets, yards per pass route, slot percentage, target separation, and related matchup/injury fields. SportsDataIO also advertises stable player/game IDs and historical NFL archives.

Licensing/cost: a public consumer price is not a valid basis for OddSphere. SportsDataIO states that public/commercial applications require a commercial license quoted per client and that API request volume is not the pricing basis. No public commercial price was available. NFL access requires a subscription or sales engagement rather than the free soccer trial.

Items that must be confirmed in writing:

- exact seasons available for every required field, ideally 2016-2026;
- whether the deliverable is player-game routes run, player-route events, or both;
- stable crosswalk to GSIS/provider IDs and team/game identifiers;
- regular-season and postseason coverage, null semantics, corrections, and update SLA;
- live/in-week versus postgame availability;
- rights to use the inputs in a paid public product and in derived probabilities/projections;
- commercial quote and any redistribution/display constraints.

Official references: [NFL API documentation](https://sportsdata.io/developers/api-documentation/nfl), [NFL data product](https://sportsdata.io/nfl-api), [Advanced Metrics field guide](https://sportsdata.io/files/SDio_NFL_Advanced_Metrics.pdf), and [commercial licensing FAQ](https://sportsdata.io/help/data-rights-and-licensing-questions).

### 2. Sportradar NFL — second diligence target

Published capability: the official NFL material documents subjective statistics including pass route and tight-end location, and its play schema exposes `pass_route`, stable GUID event/play identifiers, quarterback-at-snap, and alignment-adjacent fields. Subjective statistics are documented as arriving by Tuesday at 6 p.m. ET.

Open question: public documentation does not establish that every eligible receiver's route is recorded on every dropback or that a complete player-game route-participation table is included. A sample payload and explicit confirmation are mandatory before treating it as a solution.

Licensing/cost: pricing is quote-based. Push delivery is an add-on; a historical/postgame model may only need REST or bulk access, subject to the quote. Confirm derived-product and public-display rights.

Official references: [NFL FAQ and subjective-stat timing](https://developer.sportradar.com/football/v5/reference/nfl-faq) and [NFL play/event fields](https://developer.sportradar.com/football/v6/reference/nfl-push-events).

### 3. PFF enterprise — only with a separate commercial agreement

PFF advertises an API and a $199.99/year PFF Pro consumer subscription, but its official terms restrict consumer API/PFF Pro data to personal, noncommercial use. That price is therefore not a usable OddSphere product-data price. Only a separately negotiated enterprise/commercial agreement could be considered, with an exact field dictionary and redistribution/derived-model rights in writing.

Official references: [PFF developer API](https://developer.pff.com/), [consumer subscription pricing](https://www.pff.com/subscribe), and [PFF terms](https://www.pff.com/terms).

### 4. FantasyData / Fantasy Points consumer products — not approved product feeds

FantasyData's public advanced-WR page displays routes run, snap share, and red-zone/end-zone targets. Fantasy Points publicly describes route share, alignment/routes, coverage, and line-matchup data with Monday updates. Neither public page establishes a licensed commercial product feed for OddSphere. Do not ingest consumer downloads or pages; consider only if the vendor supplies written API access and commercial/derived-product rights.

Official references: [FantasyData advanced WR metrics](https://fantasydata.com/nfl/advanced-wr-metrics) and [Fantasy Points Data description and timing](https://newsletter.fantasypoints.com/p/fantasy-points-data-free-this-week).

## Minimum vendor sample and acceptance test

Ask SportsDataIO and Sportradar for the same small historical sample before any purchase: all offensive players for two specified completed games, plus the full season-to-date player-game table. Require player ID, game ID, team, position, team dropbacks, routes run, route participation, targets, end-zone targets, red-zone routes/targets, slot/wide alignment, and revision timestamp.

Accept a provider only if the sample proves:

1. exhaustive rows for eligible receivers, including zero-target participants;
2. internally consistent denominators (`routes_run <= team_dropbacks`, with documented exceptions);
3. stable identity crosswalks and correction semantics;
4. historical availability sufficient for release-pure training and testing;
5. timely availability for the intended weekly product;
6. explicit commercial rights for OddSphere's paid public predictions.

No provider purchase, account change, production ingestion, prediction change, or public-site change was made by this audit.
