# MLB Player Props Owner Launch Checklist

Use this checklist in order. Do not open the three public flags until the
launch gate reports `readyToOpen: true`.

## 0. Prepare the code deployment

The launch work currently exists locally on
`feature/mlb-player-props-engine`. It must be committed, pushed, reviewed, and
merged into the Vercel production branch before any production deployment can
contain it. Do not run `git add .`; the workspace also contains unrelated
changes. Have Codex prepare a scoped launch commit and pull request.

## 1. Apply the Supabase migration

1. Open the Supabase dashboard and select the production OddSphere project.
2. Open **SQL Editor** and create a new query.
3. On the Mac, run this in Terminal to put the exact migration on the clipboard:

   ```bash
   pbcopy < /Users/danielmengel/Projects/oddsphere/lib/db/schema-migration-v37-mlb-player-props-internal-tracking.sql
   ```

4. Paste into the Supabase query and click **Run** once.
5. Run this verification query in a new SQL Editor query:

   ```sql
   SELECT
     to_regclass('public.mlb_prop_tracking_entries') AS tracking_table,
     EXISTS (
       SELECT 1
       FROM information_schema.columns
       WHERE table_schema = 'public'
         AND table_name = 'prop_settlement_runs'
         AND column_name = 'metadata_json'
     ) AS settlement_metadata_ready;
   ```

Expected result: `tracking_table` is
`mlb_prop_tracking_entries` and `settlement_metadata_ready` is `true`.

6. Run the local read-only database check:

   ```bash
   cd /Users/danielmengel/Projects/oddsphere
   npm run smoke:mlb-props-db -- --json
   ```

Expected result: the final JSON contains `"ok": true`.

## 2. Configure the private production phase in Vercel

1. Open Vercel, select the **oddsphere** project, then open
   **Settings > Environment Variables**.
2. Confirm these existing secret variables are present for **Production**.
   Do not replace their values if they already exist:

   - `BALLDONTLIE_API_KEY`
   - `NEXT_PUBLIC_SUPABASE_URL`
   - `NEXT_PUBLIC_SUPABASE_ANON_KEY`
   - `SUPABASE_SERVICE_ROLE_KEY`
   - `CRON_SECRET`

3. Import or add the following block for **Production**:

   ```dotenv
   ODDSPHERE_MLB_PROVIDER=real
   MLB_PLAYER_PROPS_CRON_ENABLED=true
   ODDSPHERE_PROPS_INTERNAL_TRACKING_ENABLED=true
   MLB_PLAYER_PROPS_SETTLEMENT_CRON_ENABLED=true
   # Player-prop membership is locked site-wide at T-60; no lock-window
   # environment variables should be configured.
   ODDSPHERE_PROPS_MAX_PENDING_SETTLEMENTS=500
   ODDSPHERE_PROPS_LAUNCH_CONSECUTIVE_SNAPSHOTS=3
   ODDSPHERE_PROPS_LAUNCH_MIN_SEQUENCE_SPAN_MINUTES=15
   ODDSPHERE_PROPS_MODEL_VERSION=mlb_props_distribution_v1
   ODDSPHERE_PROPS_MAX_ODDS_AGE_MINUTES=45
   ODDSPHERE_PROPS_MAX_SNAPSHOT_AGE_MINUTES=25
   ODDSPHERE_PROPS_SIGNAL_MIN_AMERICAN_ODDS=-500
   ODDSPHERE_PROPS_SIGNAL_MAX_AMERICAN_ODDS=1000
   ODDSPHERE_PROPS_DISPLAY_ODDS_ABSOLUTE_LIMIT=10000
   ODDSPHERE_PROPS_MAX_SOURCE_ODDS_ROWS=8000
   ODDSPHERE_PROPS_MAX_BOARD_ROWS=4000
   ODDSPHERE_PROPS_MAX_SNAPSHOT_JSON_BYTES=16000000
   ODDSPHERE_PROPS_MAX_SNAPSHOT_GZIP_BYTES=1250000
   ODDSPHERE_PROPS_MAX_BDL_CALLS_PER_REFRESH=300
   ODDSPHERE_PROPS_MAX_NEW_MATCHUP_HISTORY_CALLS=60
   ODDSPHERE_PROPS_MATCHUP_HISTORY_CONCURRENCY=4
   ODDSPHERE_PROPS_MATCHUP_HISTORY_TIMEOUT_MS=7000
   ODDSPHERE_PROPS_GAME_LOG_CONCURRENCY=8
   ODDSPHERE_PROPS_PITCHER_STATS_CONCURRENCY=6
   ODDSPHERE_PROPS_DISPLAY_ENABLED=false
   ODDSPHERE_PROPS_PUBLIC_API_ENABLED=false
   ODDSPHERE_PROPS_REAL_PUBLISH_ENABLED=false
   ```

All three public variables must remain `false` during this phase.

## 3. Deploy the private phase

1. Merge the scoped Player Props pull request into the Vercel production
   branch, normally `main`.
2. Confirm Vercel creates a successful Production deployment. Environment
   variable changes only affect a new deployment.
3. Leave the public flags closed and wait for at least three scheduled
   ten-minute refreshes. Allow about 25 minutes.

## 4. Verify the launch gate

1. Sign in to OddSphere.
2. Open:
   `https://www.oddsphereai.com/admin/mlb/props-review`
3. Confirm the page says **Launch gate passed** and not **Launch blocked**.
4. Confirm a current board snapshot exists, tracking is enabled, the tracking
   table is available, and settlement is enabled.
5. A lineup warning before official lineups post is acceptable. Missing odds,
   stale prices, missing tracking, or a failed settlement control is not.

The command-line equivalent is:

```bash
cd /Users/danielmengel/Projects/oddsphere
MLB_PLAYER_PROPS_CRON_ENABLED=true \
ODDSPHERE_PROPS_INTERNAL_TRACKING_ENABLED=true \
MLB_PLAYER_PROPS_SETTLEMENT_CRON_ENABLED=true \
npm run readiness:mlb-props-launch -- --date=2026-07-16 --persist=true
```

Do not continue unless the result contains `"readyToOpen": true`.

## 5. Open the member product

1. Return to **Vercel > oddsphere > Settings > Environment Variables**.
2. Edit these three **Production** values together:

   ```dotenv
   ODDSPHERE_PROPS_DISPLAY_ENABLED=true
   ODDSPHERE_PROPS_PUBLIC_API_ENABLED=true
   ODDSPHERE_PROPS_REAL_PUBLISH_ENABLED=true
   ```

3. Redeploy the latest Production deployment so the new values take effect.
4. Sign in and open `https://www.oddsphereai.com/mlb/props`.
5. Confirm the board timestamp is fresh, the Reader opens, search and filters
   work, and the page does not show the internal preview notice.

## 6. Roll back if anything is wrong

Set only these three values back to `false` and redeploy:

```dotenv
ODDSPHERE_PROPS_DISPLAY_ENABLED=false
ODDSPHERE_PROPS_PUBLIC_API_ENABLED=false
ODDSPHERE_PROPS_REAL_PUBLISH_ENABLED=false
```

Keep refresh, private tracking, and settlement enabled so data collection and
diagnosis continue while the member page is closed.
