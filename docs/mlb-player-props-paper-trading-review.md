# MLB Player Props Paper-Trading Review

Use this after V35/V36 are applied and after a hidden paper-trading run has
persisted records. These queries are for review only.

## Real Provider Source Plan

OddSphere does not use The Odds API or SportsDataIO for this props path.
Real-provider readiness must be confirmed against:

- Sharp API for MLB props markets, odds, books, lines, side labels, and odds timestamps.
- Ball Don't Lie for MLB stats, player/team/game identity, settlement stat fields, and explicit MLB player-prop odds fallback.
- Playbook for context/splits/lineup/injury-style supporting fields where available.

If any runbook output mentions The Odds API or SportsDataIO, treat that as stale
scaffold language and fix it before hidden paper trading.

## Safe Run Flow

1. DB smoke:

```bash
npm run smoke:mlb-props-db -- --json
```

2. Real provider inspect only:

```bash
npm run inspect:mlb-props-real -- --date=YYYY-MM-DD
```

3. SharpAPI prop availability diagnostic:

```bash
npm run diagnose:mlb-props-provider -- --date=YYYY-MM-DD --provider=sharpapi --deep --discover-markets
```

BDL player-props fallback diagnostic:

```bash
npm run diagnose:mlb-props-provider -- --date=YYYY-MM-DD --provider=balldontlie --deep
```

SharpAPI remains first priority when it returns player-prop rows, especially if
Hard Rock rows are present. If SharpAPI shows MLB events but only team/game
markets or zero normalized player props, classify the Sharp path as
`SHARPAPI_PLAYER_PROPS_EMPTY` and check BDL. BDL uses
`/odds/player_props?game_id=<game_id>` and may return only live same-day 2026+
props. If both SharpAPI and BDL return zero player prop rows, classify the
blocker as `PROVIDER_PROP_ODDS_UNAVAILABLE` and do not persist paper picks.

4. Review redacted local samples:

```text
tmp/mlb-props/provider-samples/YYYY-MM-DD/
tmp/mlb-props/reports/YYYY-MM-DD-sharpapi-prop-availability-deep.json
tmp/mlb-props/reports/YYYY-MM-DD-balldontlie-prop-availability-deep.json
```

5. Dry-run score:

```bash
npm run score:mlb-props -- --date=YYYY-MM-DD --provider=real --dry-run
```

Expected real dry-run behavior today:

- Scores only `pitcher_strikeouts` and `pitcher_outs`.
- Uses Sharp API prop odds when Sharp returns normalized player props.
- Falls back to Ball Don't Lie player props when Sharp returns MLB events but
  zero normalized player props.
- Uses MLB Stats schedule/probables for event and pitcher mapping.
- Uses Ball Don't Lie season pitching stats through `players.provider_ids.mlb_stats.id`.
- Requires two-way over/under odds before devig.
- Blocks low-confidence starter histories, non-probable pitchers, unmapped
  events, stale odds, and missing two-way pairs.
- Blocks provider-empty prop slates with `PROVIDER_PROP_ODDS_UNAVAILABLE`.
- Performs no Supabase writes.
- Leaves member display disabled.
- Writes local-only BDL review artifacts when BDL is selected:
  - `tmp/mlb-props/reports/YYYY-MM-DD-bdl-scoring-rejection-trace.json`
  - `tmp/mlb-props/reports/YYYY-MM-DD-bdl-recommendation-sanity-audit.json`

Before first hidden paper persistence, review the sanity audit for duplicate
vendor lines, same-player side conflicts, no-vig anomalies, stale/missing
`updated_at`, model-probability/EV/edge ranges, deduped review count, and
conservative cap scenario counts. Raw recommendations are not automatically the
first paper run size.

6. Hidden paper-trading persist only after the above is clean and explicitly approved:

```bash
ODDSPHERE_PROPS_PAPER_TRADING_ENABLED=true ODDSPHERE_PROPS_REAL_PUBLISH_ENABLED=false ODDSPHERE_PROPS_DISPLAY_ENABLED=false ODDSPHERE_PROPS_PUBLIC_API_ENABLED=false npm run score:mlb-props -- --date=YYYY-MM-DD --provider=real --persist --dry-run=false
```

Confirm:

- `recommended_bets.recommendation_status = 'paper'`
- no `recommended_bets.recommendation_status = 'recommended'` rows are created by real paper mode
- `/api/mlb/props/picks` still returns disabled/empty unless both `ODDSPHERE_PROPS_DISPLAY_ENABLED=true` and `ODDSPHERE_PROPS_PUBLIC_API_ENABLED=true`
- `/api/admin/mlb/props/paper?date=YYYY-MM-DD` returns sanitized paper rows only
- `/api/admin/mlb/props/health` shows the latest run
- `tmp/mlb-props/reports/YYYY-MM-DD-real-paper-run.json` exists
- `ODDSPHERE_PROPS_REAL_PUBLISH_ENABLED=false`
- `ODDSPHERE_PROPS_DISPLAY_ENABLED=false`
- `ODDSPHERE_PROPS_PUBLIC_API_ENABLED=false`
- no Daily Edge route, card, tracking, lock, or grade logic imports the Player Props engine

7. Settlement review, dry-run only until explicitly approved:

```bash
npm run settle:mlb-props -- --date=YYYY-MM-DD --provider=real --dry-run
```

Do not fake final stats. Until Ball Don't Lie final pitcher stats are available
and mapped, paper picks should remain pending or unresolved. CLV can remain
pending and must not block paper trading.

## SQL Query Pack

Today’s scoring run:

```sql
select *
from public.prop_scoring_runs
where sport = 'mlb'
  and slate_date = current_date
order by created_at desc
limit 5;
```

All recommendations for a date:

```sql
select rb.*
from public.recommended_bets rb
where rb.created_at::date = date 'YYYY-MM-DD'
order by rb.created_at desc;
```

Recommendations by market:

```sql
select pp.market_key, rb.recommendation_status, count(*) as picks
from public.recommended_bets rb
join public.prop_edges pe on pe.id = rb.edge_id
join public.prop_predictions pp on pp.id = pe.prediction_id
where rb.created_at::date = date 'YYYY-MM-DD'
group by pp.market_key, rb.recommendation_status
order by pp.market_key, rb.recommendation_status;
```

Rejected picks by reason code:

```sql
select reason_code, count(*) as count
from public.recommended_bets rb
cross join lateral jsonb_array_elements_text(rb.reason_codes_json) as reason_code
where rb.created_at::date = date 'YYYY-MM-DD'
group by reason_code
order by count desc;
```

Unresolved mappings:

```sql
select *
from public.data_quality_events
where component = 'mlb_props'
  and event_type in ('unresolved_player_mapping', 'ambiguous_player_mapping')
order by created_at desc
limit 50;
```

Stale odds count:

```sql
select count(*) as stale_edges
from public.prop_edges
where stale_line_flag = true
  and created_at::date = date 'YYYY-MM-DD';
```

Odds timestamps by book:

```sql
select sportsbook_id, snapshot_role, min(as_of_timestamp), max(as_of_timestamp), count(*)
from public.prop_odds_snapshots
where created_at::date = date 'YYYY-MM-DD'
group by sportsbook_id, snapshot_role
order by sportsbook_id, snapshot_role;
```

Feature snapshots by market:

```sql
select market_key, feature_version, count(*)
from public.feature_snapshots
where created_at::date = date 'YYYY-MM-DD'
group by market_key, feature_version
order by market_key, feature_version;
```

Prop edges by EV/edge bucket:

```sql
select
  width_bucket(coalesce(expected_value, 0), -0.25, 0.50, 5) as ev_bucket,
  width_bucket(coalesce(edge, 0), -0.10, 0.20, 6) as edge_bucket,
  count(*) as rows
from public.prop_edges
where created_at::date = date 'YYYY-MM-DD'
group by ev_bucket, edge_bucket
order by ev_bucket, edge_bucket;
```

Settlement status:

```sql
select *
from public.prop_settlement_runs
where slate_date = date 'YYYY-MM-DD'
order by created_at desc;
```

Pending CLV:

```sql
select *
from public.recommended_bets
where created_at::date = date 'YYYY-MM-DD'
  and coalesce(clv_status, 'pending') = 'pending';
```

Exact-line CLV:

```sql
select id, recommendation_status, clv_status, clv_value, created_at
from public.recommended_bets
where created_at::date = date 'YYYY-MM-DD'
  and clv_status = 'comparable'
order by clv_value desc nulls last;
```

Moved-line non-comparable CLV:

```sql
select *
from public.recommended_bets
where created_at::date = date 'YYYY-MM-DD'
  and clv_status = 'line_moved_not_comparable';
```

Data-quality events by severity:

```sql
select severity, event_type, count(*) as events
from public.data_quality_events
where component = 'mlb_props'
  and created_at::date = date 'YYYY-MM-DD'
group by severity, event_type
order by severity, events desc;
```
