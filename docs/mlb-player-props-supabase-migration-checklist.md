# MLB Player Props Supabase Migration Checklist

## Scope

Apply the MLB player props migrations only. These migrations are additive and
should not affect Daily Edge predictions, grades, tracking, lock snapshots,
member auth, or existing production recommendation logic.

## Apply Order

1. Apply `lib/db/schema-migration-v35-mlb-player-props-engine.sql`.
2. Apply `lib/db/schema-migration-v36-mlb-player-props-paper-trading.sql`.
3. Apply `lib/db/schema-migration-v37-mlb-player-props-internal-tracking.sql`.
4. Run the read-only smoke check:

```bash
npm run smoke:mlb-props-db -- --json
```

## Idempotency / No-Op Behavior

All migrations use `CREATE TABLE IF NOT EXISTS`, `CREATE INDEX IF NOT EXISTS`,
and `ADD COLUMN IF NOT EXISTS` patterns. Running once manually should be safe.
If run again, the expected behavior is no-op or duplicate-safe index/table
checks.

## Rollback Notes

There is no automatic destructive rollback. Because V35/V36/V37 are additive, the
preferred rollback is to disable all MLB props flags:

```env
ODDSPHERE_PROPS_PAPER_TRADING_ENABLED=false
ODDSPHERE_PROPS_INTERNAL_TRACKING_ENABLED=false
MLB_PLAYER_PROPS_SETTLEMENT_CRON_ENABLED=false
ODDSPHERE_PROPS_REAL_PUBLISH_ENABLED=false
ODDSPHERE_PROPS_DISPLAY_ENABLED=false
```

Dropping the new tables would remove paper-trading/test data and should only be
done manually after confirming nothing depends on it.

## Required Verification SQL

Tables:

```sql
select to_regclass('public.prop_scoring_runs') as prop_scoring_runs;
select to_regclass('public.provider_entity_mappings') as provider_entity_mappings;
select to_regclass('public.prop_settlement_runs') as prop_settlement_runs;
select to_regclass('public.mlb_prop_tracking_entries') as mlb_prop_tracking_entries;
select to_regclass('public.data_quality_events') as data_quality_events;
select to_regclass('public.model_versions') as model_versions;
select to_regclass('public.feature_snapshots') as feature_snapshots;
select to_regclass('public.prop_predictions') as prop_predictions;
select to_regclass('public.prop_edges') as prop_edges;
```

V35 odds snapshot role:

```sql
select column_name
from information_schema.columns
where table_schema = 'public'
  and table_name = 'prop_odds_snapshots'
  and column_name = 'snapshot_role';
```

V36 `recommended_bets` result/CLV columns:

```sql
select column_name
from information_schema.columns
where table_schema = 'public'
  and table_name = 'recommended_bets'
  and column_name in (
    'result_status',
    'result_units',
    'clv_status',
    'clv_value',
    'metadata_json'
  )
order by column_name;
```

Read-only row probes:

```sql
select count(*) from public.prop_scoring_runs;
select count(*) from public.provider_entity_mappings;
select count(*) from public.prop_settlement_runs;
select count(*) from public.recommended_bets;
select count(*) from public.mlb_prop_tracking_entries;
```

## Expected Result

- All required tables resolve to non-null `public.*` names.
- `prop_odds_snapshots.snapshot_role` exists.
- `recommended_bets` includes result/CLV metadata columns.
- `mlb_prop_tracking_entries` exists with RLS enabled and no member policy.
- `prop_settlement_runs.metadata_json` exists.
- `npm run smoke:mlb-props-db -- --json` exits `0`.
- No Daily Edge/member tables are altered by these migrations.
