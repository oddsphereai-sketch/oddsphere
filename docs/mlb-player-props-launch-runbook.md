# MLB Player Props Launch Runbook

## Prelaunch ingest

Apply `lib/db/schema-migration-v37-mlb-player-props-internal-tracking.sql`, then
run the read-only database smoke check:

```bash
npm run smoke:mlb-props-db -- --json
```

Set these production variables and deploy while member display remains closed:

```text
ODDSPHERE_MLB_PROVIDER=real
MLB_PLAYER_PROPS_CRON_ENABLED=true
ODDSPHERE_PROPS_INTERNAL_TRACKING_ENABLED=true
MLB_PLAYER_PROPS_SETTLEMENT_CRON_ENABLED=true
# Player-prop membership is locked by the application at T-60 for every game.
# There is no environment override or late-lock grace window.
ODDSPHERE_PROPS_MAX_PENDING_SETTLEMENTS=500
ODDSPHERE_PROPS_LAUNCH_CONSECUTIVE_SNAPSHOTS=3
ODDSPHERE_PROPS_LAUNCH_MIN_SEQUENCE_SPAN_MINUTES=15
ODDSPHERE_PROPS_MODEL_VERSION=mlb_props_distribution_v1
ODDSPHERE_PROPS_DISPLAY_ENABLED=false
ODDSPHERE_PROPS_PUBLIC_API_ENABLED=false
ODDSPHERE_PROPS_REAL_PUBLISH_ENABLED=false
ODDSPHERE_PROPS_MAX_ODDS_AGE_MINUTES=45
ODDSPHERE_PROPS_MAX_SNAPSHOT_AGE_MINUTES=25
ODDSPHERE_PROPS_SIGNAL_MIN_AMERICAN_ODDS=-500
ODDSPHERE_PROPS_SIGNAL_MAX_AMERICAN_ODDS=1000
ODDSPHERE_PROPS_MAX_SOURCE_ODDS_ROWS=35000
ODDSPHERE_PROPS_MAX_BOARD_ROWS=7500
ODDSPHERE_PROPS_MAX_SNAPSHOT_JSON_BYTES=16000000
ODDSPHERE_PROPS_MAX_SNAPSHOT_GZIP_BYTES=1250000
ODDSPHERE_PROPS_MAX_NEW_MATCHUP_HISTORY_CALLS=60
ODDSPHERE_PROPS_MATCHUP_HISTORY_CONCURRENCY=4
ODDSPHERE_PROPS_MATCHUP_HISTORY_TIMEOUT_MS=7000
```

The fast cron refreshes odds, starters, lineups, and weather twice per hour during the configured active windows. Park factors use a daily server cache, NWS point metadata uses a weekly cache, and member snapshot reads use a one-minute server cache. Bounded full refreshes run four times per day and refresh player identities, game logs, opponent profiles, pitch research, and missing official batter-versus-pitcher totals. A starter change invalidates hitter matchup evidence for that game until the next bounded full refresh instead of turning a price refresh into a full-slate rebuild. A full refresh also admits a same-day game log only after MLB Stats marks that game final. The daily cleanup job retains two days of compressed member-board snapshots; immutable result tracking remains in the private ledger.

The hourly full refresh also reads BDL's official opening player-prop endpoint once per game. Opening quotes are stored in compact form and joined to the current feed by game, player, sportsbook, market, side, and line. Ten-minute snapshots preserve the intermediate audit trail without adding opening-feed calls to normal fast refreshes. If the opening endpoint is temporarily unavailable, the board remains valid and movement begins with the first verified OddSphere snapshot instead of fabricating an opener.

The 16-game request-budget fixture covers 320 player identities, 40 pitchers, 280 hitters, all 16 lineups, and one opening-feed request per game. With an already-warm snapshot, a normal 16-game fast refresh is expected to use about 20 BDL requests and an hourly full refresh about 49. Across the configured 19-hour window, that is roughly 3,200 BDL requests on a full-slate day, with no single refresh allowed past the 300-request circuit breaker.

Direct batter-versus-pitcher history is descriptive research only and never blocks the board or enters the model. Verified empty responses display `No prior MLB plate appearances`; provider failures display an updating state. The full board is held when required recent form, player identity, opposing-starter context, pitch-mix research, or environment context is missing for an active pregame prop.

Valid extreme quotes remain visible with implied probability and payout context. Prices shorter than `-500` or longer than `+1000` are excluded from Radar and positive model signals by default. This is a product risk policy, not a claim that the sportsbook quote is invalid.

Private tracking is independent of public display. It stays on before and after
launch. The first valid refresh inside the T-75 to first-pitch window locks one
canonical modeled side per game/player/market. Actionable rows keep their model
stake; Watchlist rows are retained as zero-stake calibration observations.
Later refreshes capture the newest verified price from the same sportsbook.
Same-line CLV is measured in no-vig probability; moved lines are retained but
marked non-comparable. No tracking table or payload is exposed to member APIs.

Settlement is a separate bounded job. It loads at most 500 pending entries,
groups official MLB game-log requests by player, settles only games marked
final, and uses the locked price for unit returns. A missing final game log is
retried once before a probable non-start is voided. This prevents a short MLB
Stats publication delay from becoming a false void.

## Launch gate

Run a full persisted refresh after Thursday prices post:

```bash
npm run readiness:mlb-props-launch -- --date=2026-07-16 --persist=true
```

Wait for at least three scheduled refreshes spanning 15 minutes, then do not
open member display unless `launch.readyToOpen` is `true`. The gate requires:

- three distinct consecutive persisted snapshots
- the sequence spans at least 15 minutes
- `publishable: true` on every snapshot
- `sourceRows > 0`
- `mappedRows / sourceRows >= 0.90`
- no validation errors
- no stale board prices
- no payload or row circuit-breaker errors
- no actionable row outside the configured signal price interval
- live games, books, markets, and member rows
- the private tracking table available
- refresh, tracking, and settlement jobs enabled
- display, public API, and real-publish flags all closed or all open

Confirm `/admin/mlb/props-review` shows the same launch decision and that
`/api/admin/mlb/props/health` reports a fresh board. Probable-pitcher and
environment gaps are visible warnings; missing odds, stale prices, tracking,
or settlement controls are launch blockers.

## Open member display

After the gate passes, set and deploy:

```text
ODDSPHERE_PROPS_REAL_PUBLISH_ENABLED=true
ODDSPHERE_PROPS_DISPLAY_ENABLED=true
ODDSPHERE_PROPS_PUBLIC_API_ENABLED=true
```

The member page and API serve only the newest valid snapshot. If a refresh fails, the previous valid snapshot remains in place. If that snapshot exceeds the configured freshness limit, both member surfaces fail closed instead of serving stale data.

Keep `ODDSPHERE_PROPS_INTERNAL_TRACKING_ENABLED=true` and
`MLB_PLAYER_PROPS_SETTLEMENT_CRON_ENABLED=true` after launch. They are private
operational controls, not public-publishing flags.

## Rollback

Set all three public flags to false:

```text
ODDSPHERE_PROPS_REAL_PUBLISH_ENABLED=false
ODDSPHERE_PROPS_DISPLAY_ENABLED=false
ODDSPHERE_PROPS_PUBLIC_API_ENABLED=false
```

Leave refresh, tracking, and settlement enabled so diagnosis, immutable result
history, and snapshot recovery continue without member exposure. The launch
health response sets `mustClosePublic: true` whenever a critical gate fails
while all public flags are open.
