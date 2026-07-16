# MLB Player Props Real Provider Contract Findings

Inspection date: 2026-07-07

This document summarizes the redacted real-provider contract inspection for the
MLB player props engine. It is documentation only. It does not enable paper
trading, member display, cron behavior, or Supabase writes.

## Source Plan

- Sharp API: MLB player prop odds, market prices, sportsbooks, lines, and odds timestamps.
- Ball Don't Lie: MLB games, players, teams, stats, lineups, settlement stat fields, and explicit MLB player-prop odds fallback.
- Playbook: optional context only. Useful for public splits, consensus lines, probable pitchers, injuries, and venue/weather context. It is not the player-prop odds source.
- MLB Stats API: schedule and probable-pitcher helper.

Do not use The Odds API or SportsDataIO for this props path.

## Sharp API Contract

Endpoint pattern confirmed:

- `GET /events?sport=mlb`
- `GET /odds?event_id=<event_id>&market=<market_key>`

Confirmed fields on player-prop odds rows:

- `event_id`
- `sportsbook`
- `market_type`
- `selection`
- `selection_type`
- `odds_american`
- `odds_decimal`
- `odds_probability`
- `line`
- `timestamp`
- `player_name`
- `stat_category`
- `is_main_line`
- `is_alternate_line`
- `is_player_prop`
- `is_stale_pregame_price`

Confirmed mapped markets:

- `player_strikeouts` -> `pitcher_strikeouts`
- `player_pitching_outs` -> `pitcher_outs`
- `player_hits_allowed` -> `pitcher_hits_allowed`
- `player_earned_runs` -> `pitcher_earned_runs`
- `player_batting_strikeouts` -> `batter_strikeouts`
- `player_hits` -> `batter_hits`
- `player_total_bases` -> `batter_total_bases`
- `player_home_runs` -> `batter_home_runs`
- `player_rbis` -> `batter_rbis`
- `player_runs` -> `batter_runs_scored`
- `player_hits_+_runs_+_rbis` -> `batter_hits_runs_rbis`
- `player_singles` -> `batter_singles`
- `player_doubles` -> `batter_doubles`
- `player_triples` -> `batter_triples`
- `player_walks` -> `batter_walks`
- `player_stolen_bases` -> `batter_stolen_bases`

Confirmed books from inspection:

- betway
- bovada
- draftkings
- fanatics
- fanduel
- hardrock
- novig
- pinnacle
- stake

Confirmed notes:

- Hard Rock appears in the actual detected book set.
- American odds and decimal odds are both present.
- Odds timestamp is present.
- Over/under side labels are present.
- Main-line and alternate-line flags are present.
- Current snapshots are confirmed. Opening/closing snapshots are not yet confirmed for props.
- Both over and under were present for many rows, but two-way pairing must remain required before scoring.

## Ball Don't Lie Contract

Confirmed BDL player-props endpoint:

- `GET https://api.balldontlie.io/mlb/v1/odds/player_props?game_id=<game_id>`
- Optional filters include `player_id`, `prop_type`, and `vendors[]`.
- BDL docs describe MLB player props as live from the 2026 season, real-time,
  not historical, and potentially removed as games near completion.

Confirmed BDL player-prop odds fields:

- `id`
- `game_id`
- `player_id`
- `vendor`
- `prop_type`
- `line_value`
- `market.type`
- `market.over_odds`
- `market.under_odds`
- `market.odds` for milestone markets
- `updated_at`

Supported pitcher prop types include:

- `pitcher_strikeouts`
- `pitcher_outs`
- `pitcher_hits_allowed`
- `pitcher_walks`
- `pitcher_earned_runs`

Current scoring promotes only `pitcher_strikeouts` and `pitcher_outs`.
Milestone markets are ignored for scoring in this pass. Listed BDL vendors
include BetMGM, BetRivers, Caesars, DraftKings, Fanatics, and FanDuel. Hard
Rock must not be assumed from BDL unless a live payload contains it.

Confirmed BDL fields:

- Games: `id`, teams, season, date, venue, status.
- Players: `id`, name fields, position, active, bats/throws, team.
- Season stats: batting and pitching fields.
- Lineups: `game_id`, player, team, batting order, position, `is_probable_pitcher`.

Confirmed pitcher settlement/stat fields:

- `pitching_ip`
- `pitching_k`
- `pitching_h`
- `pitching_er`
- `pitching_bb`
- `pitching_k_per_9`

Confirmed batter stat fields:

- `batting_h`
- `batting_2b`
- `batting_3b`
- `batting_hr`
- `batting_tb`
- `batting_bb`
- `batting_so`
- `batting_sb`

BDL is suitable as a same-day pitcher-prop odds fallback when SharpAPI returns
MLB events but zero normalized player-prop rows. BDL `game_id` and `player_id`
must be preserved even when internal IDs are not yet persisted.

## Playbook Contract

Confirmed useful context:

- public betting splits
- consensus lines
- probable pitchers
- injuries/status values
- venue/weather context

Playbook should remain optional/context-only for props until we deliberately wire
specific fields into the feature builder.

## Real Dry-Run Readiness Result

Command:

```bash
npm run score:mlb-props -- --date=2026-07-07 --provider=real --dry-run
```

Latest no-write result after promoting real event/player mapping and the
conservative pitcher feature bundle:

- Slate count: 16
- Probable pitchers: 32
- Props detected: 3,948
- Supported pitcher props: 331
- Mapped pitcher props: 239
- Unmapped pitcher props: 92
- Two-way pitcher markets: 50
- Stale odds count: 0
- Candidates scored: 50
- Recommendations passing EV/edge: 26
- Hard Rock rows detected: 42
- Public display enabled: false
- Supabase writes: none

Only `pitcher_strikeouts` and `pitcher_outs` are promoted for real dry-run
scoring. Batter props and other pitcher props are detected but ignored or
blocked from candidate scoring for now.

Conservative feature quality gates remain active. Low-confidence starter
profiles, missing two-way odds, unmapped games, non-probable pitchers, and
alternate-line grouping gaps are surfaced in rejected reason counts rather than
published or persisted.

The real mapping bridge uses:

- Sharp event team/start metadata to map to MLB Stats games.
- Robust MLB team aliases for provider naming differences.
- Sharp player names mapped to MLB probable pitchers for the matched game.
- Internal `players.provider_ids.mlb_stats.id` to attach BDL season pitching
  stats to MLB probable pitchers.

## Paper Trading Gate

Do not enable persisted real paper trading until:

- Hidden paper scoring is explicitly approved.
- Paper trading is enabled with `ODDSPHERE_PROPS_PAPER_TRADING_ENABLED=true`.
- The operator uses `--persist --dry-run=false`.
- Admin review accepts the current data-quality rejection mix.
- Public display remains disabled unless separately approved.

Current dry-run scoring is safe for review only: no public/member display, no
Supabase writes, and no real paper persistence.

## SharpAPI Prop Availability Diagnostic

SharpAPI `/events?sport=mlb` can be healthy while prop odds are temporarily
unavailable from `/odds`. When this happens, real scoring must fail safe with
`PROVIDER_PROP_ODDS_UNAVAILABLE` instead of treating the slate as a valid
zero-candidate slate.

Diagnostic command:

```bash
npm run diagnose:mlb-props-provider -- --date=YYYY-MM-DD --provider=sharpapi
```

Optional market discovery:

```bash
npm run diagnose:mlb-props-provider -- --date=YYYY-MM-DD --provider=sharpapi --discover-markets
```

Controlled multi-window sweep:

```bash
npm run diagnose:mlb-props-provider -- --date=YYYY-MM-DD --provider=sharpapi --sweep
```

Deep contract discovery:

```bash
npm run diagnose:mlb-props-provider -- --date=YYYY-MM-DD --provider=sharpapi --deep
npm run diagnose:mlb-props-provider -- --date=YYYY-MM-DD --provider=sharpapi --sweep --deep
```

Sweep mode uses `/events?sport=mlb` as the provider source of truth, groups all
returned MLB events by scheduled date, and tests the known pitcher and batter
prop market keys against each returned event. It also records a small endpoint
variant sample:

- `/odds?event_id=...`
- `/odds?event_id=...&market=...`
- `/odds?event_id=...&market=...&sport=mlb`

Deep mode does not assume the old endpoint contract is correct. It probes
SharpAPI reference and discovery endpoints first:

- `/sports`
- `/leagues`
- `/markets`
- `/sportsbooks`
- `/account`
- `/account/usage`

It then tests controlled event filters with `sport=mlb`, `sport=baseball`,
`league=mlb`, `league=MLB`, combined sport/league filters, and date-only
filters. For each discovered MLB event it tests:

- `/events/:eventId`
- `/events/:eventId/markets`
- `/events/:eventId/odds`

Deep mode also tests singular `/odds` filter names:

- `/odds?event=...`
- `/odds?event=...&market=...`
- `/odds?league=mlb`
- `/odds?sport=baseball`
- `/odds?market=...`
- selected sportsbook variants, including Hard Rock spellings

It additionally probes `/odds/best`, `/odds/comparison`, and a small
`POST /odds/batch` request if the endpoint is available. Pagination is scanned
with bounded defaults of three pages and local report-only output.

The diagnostic writes a redacted local report to:

```text
tmp/mlb-props/reports/YYYY-MM-DD-sharpapi-prop-availability.json
tmp/mlb-props/reports/YYYY-MM-DD-sharpapi-prop-availability-sweep.json
tmp/mlb-props/reports/YYYY-MM-DD-sharpapi-prop-availability-deep.json
tmp/mlb-props/reports/YYYY-MM-DD-sharpapi-prop-availability-sweep-deep.json
```

The report is support-ready and excludes API keys/raw provider payloads. It
records MLB event count, event IDs tested, markets tested, endpoint paths,
HTTP statuses, response row counts, shape summaries, rate-limit headers when
present, empty/non-empty markets, discovered books when present, and a final
blocker classification. The support packet includes dates tested, endpoint
variants tested, row counts by market/date, empty payload shape examples, prior
expected prop markets, likely cause, recommended action, and a question list for
SharpAPI support.

Deep reports also include discovered sports/leagues, account/book endpoint
availability, sportsbook samples, event-filter comparison, event-scoped market
and odds probes, `/odds?event_id` versus `/odds?event`, pagination status,
discovered market keys, player-prop classification, pitcher strikeouts/outs
presence, Hard Rock presence, and a precise blocker such as
`WRONG_EVENT_FILTER_PARAM_CONFIRMED`, `EVENT_ODDS_ENDPOINT_REQUIRED`,
`MARKET_KEYS_DIFFER_FROM_ASSUMED`, or
`PROVIDER_PROPS_EMPTY_AFTER_DEEP_DISCOVERY`.

Current provider-empty outcomes should be interpreted carefully:

- Historical dates may not be available through `/events`.
- Current/future dates can return events while every prop odds query returns
  HTTP 200 with zero rows.
- SharpAPI public coverage may support MLB player props, but this account and
  integration still need confirmation from live discovery for access, exact
  market keys, endpoint parameters, response wrapping, pagination, sportsbook
  selection, and timing window.

Paper trading remains blocked when:

- MLB events exist.
- Market queries return successful empty payloads.
- No prop odds rows are returned for promoted pitcher markets.
- The summary blocker is `PROVIDER_PROP_ODDS_UNAVAILABLE`.

2026-07-09 deep-discovery update:

- SharpAPI returned MLB events and player prop market names, including
  `player_strikeouts`, `player_pitching_outs`, `player_hits_allowed`,
  `player_earned_runs`, `player_hits`, `player_total_bases`,
  `player_home_runs`, `player_rbis`, `player_runs`,
  `player_hits_+_runs_+_rbis`, `player_singles`, `player_doubles`,
  `player_triples`, `player_walks`, and `player_stolen_bases`.
- The existing real dry-run path found real prop odds, including pitcher
  strikeouts and pitcher outs, with sportsbooks including Hard Rock.
- `/events/:eventId/markets` and `/events/:eventId/odds` are useful discovery
  endpoints, but the production provider client should not be changed solely
  because event-scoped endpoints return rows; the current dry-run must be
  reviewed first.
- Public display and hidden paper persistence remain disabled until explicitly
  approved.
