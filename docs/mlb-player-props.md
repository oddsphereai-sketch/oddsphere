# MLB Player Props Engine

## Overview

The MLB player props engine is a modular pipeline for ingesting MLB prop odds and baseball context, creating time-safe feature snapshots, scoring prop markets, calculating edge/EV, backtesting decisions, and exposing premium-site picks.

Phase 1 is mock-safe and can run without API keys. The real-provider dry-run
now represents the full MLB player-props product surface, while actual first
paper eligibility remains conservative and hidden. Public/member display,
public API, real publishing, and private tracking remain disabled by default.

## Providers

Provider contracts live in `lib/mlb/props/providers.ts`.

Supported provider roles:

- Odds provider
- MLB schedule/game provider
- Player/team metadata provider
- Probable pitcher provider
- Lineup provider
- Injury provider
- Weather provider
- Historical stat provider
- Settlement/results provider

Provider clients:

- `MockMLBProvider`
- `MockOddsProvider`
- `SharpApiPropsClient` guarded real props/market ingestion scaffold
- Ball Don't Lie contract-pending scaffold for stats, player identity, and settlement fields
- Playbook contract-pending scaffold for splits, context, lineups, and injury/status fields
- `MLBStatsAPIClient` guarded schedule/probable-pitcher scaffold
- `StatcastClient` shell for future historical stat wiring
- `WeatherClient` guarded shell until venue coordinate mapping is configured

Real-provider source of truth:

- Sharp API supplies MLB player prop odds.
- Ball Don't Lie supplies player/stat identity and settlement fields.
- MLB Stats API supplies schedule and probable-pitcher helpers.
- Playbook remains optional context-only and is not a prop odds source.

Mock remains the default. Real-provider mode fails closed with a clear missing-env
error unless the required keys are present.

## Environment Variables

```env
SHARPAPI_KEY=
BALLDONTLIE_API_KEY=
PLAYBOOK_API_KEY=
ODDSPHERE_WEATHER_API_KEY=
ODDSPHERE_MLB_PROVIDER=mock
ODDSPHERE_PROPS_MARKET_PROVIDER=sharpapi
ODDSPHERE_PROPS_STATS_PROVIDER=balldontlie
ODDSPHERE_PROPS_CONTEXT_PROVIDER=playbook
ODDSPHERE_PROP_MODEL_ENV=development
ODDSPHERE_PROP_BANKROLL_DEFAULT=1000
ODDSPHERE_PROP_MIN_EV=0.05
ODDSPHERE_PROP_MIN_EDGE=0.035
ODDSPHERE_PROP_MAX_ODDS_AGE_SECONDS=60
ODDSPHERE_PROPS_REAL_PUBLISH_ENABLED=false
ODDSPHERE_PROPS_DISPLAY_ENABLED=false
ODDSPHERE_PROPS_PUBLIC_API_ENABLED=false
ODDSPHERE_PROPS_PAPER_TRADING_ENABLED=false
ODDSPHERE_PROPS_INTERNAL_TRACKING_ENABLED=false
MLB_PLAYER_PROPS_SETTLEMENT_CRON_ENABLED=false
ODDSPHERE_PROPS_TRACKING_LOCK_MINUTES=60
ODDSPHERE_PROPS_TRACKING_LOCK_GRACE_MINUTES=15
ODDSPHERE_PROPS_LAUNCH_CONSECUTIVE_SNAPSHOTS=3
ODDSPHERE_PROPS_LAUNCH_MIN_SEQUENCE_SPAN_MINUTES=15
```

Never commit real provider keys.

Player props are a separate product surface from Daily Edge. This engine must
not be imported into Daily Edge readers, cards, tracking, locks, or grade logic.
The public/player-facing props API remains disabled unless both
`ODDSPHERE_PROPS_DISPLAY_ENABLED=true` and
`ODDSPHERE_PROPS_PUBLIC_API_ENABLED=true` are explicitly enabled in a future
Player Props rollout.

## Database Tables

Migration: `lib/db/schema-migration-v35-mlb-player-props-engine.sql`

Tables added:

- `sportsbooks`
- `mlb_teams`
- `mlb_players`
- `mlb_games`
- `mlb_probable_pitchers`
- `mlb_lineups`
- `mlb_injuries`
- `mlb_weather`
- `player_game_logs`
- `statcast_pitches`
- `prop_markets`
- `prop_odds_snapshots`
- `prop_results`
- `feature_snapshots`
- `model_versions`
- `prop_predictions`
- `prop_edges`
- `recommended_bets`
- `backtest_runs`
- `backtest_results`
- `data_quality_events`

V36 adds:

- `prop_scoring_runs`
- `provider_entity_mappings`
- `prop_settlement_runs`
- result/CLV metadata columns on `recommended_bets`

V37 adds:

- `mlb_prop_tracking_entries`, a service-role-only immutable tracking ledger
- settlement-run metadata for bounded official MLB settlement audits

`prop_odds_snapshots.snapshot_role` stores `opening`, `current`, `closing`, or
`reference` so backtests can compare bet price to a later closing/reference
number when available.

The migration is additive and does not alter Daily Edge, tracking, auth, subscriptions, or lock-snapshot tables.

## Market Keys

Supported keys are defined in `lib/mlb/props/config.ts`:

- `pitcher_strikeouts`
- `pitcher_outs`
- `pitcher_hits_allowed`
- `pitcher_walks`
- `pitcher_earned_runs`
- `pitcher_record_a_win`
- `batter_strikeouts`
- `batter_hits`
- `batter_total_bases`
- `batter_home_runs`
- `batter_rbis`
- `batter_runs_scored`
- `batter_hits_runs_rbis`
- `batter_singles`
- `batter_doubles`
- `batter_triples`
- `batter_walks`
- `batter_stolen_bases`
- `first_home_run`

Alternate lines should map to the same `market_key` with a different `line`.

Market metadata lives in `lib/mlb/props/marketCatalog.ts`. Each market declares
its family and group, settlement key, model family, required/preferred/optional
features, confidence gates, display group, default grade, recommendation
eligibility, missing-feature reasons, and whether it is two-way or milestone.

The canonical Player Props grades are `BEST_ANGLE`, `LEAN`, `WATCHLIST`,
`NO_PLAY`, `PENDING_DATA`, and `RESEARCH`. User labels are Best Angle, Lean,
Watchlist, No Play, Pending Data, and Research. Grade is separate from numeric
model edge, expected value, and probability fields.

## Odds and Pricing

Odds utilities live in `lib/mlb/props/oddsMath.ts`.

Functions:

- `american_to_decimal`
- `decimal_to_american`
- `american_to_implied_probability`
- `remove_vig_two_way`
- `expected_value`
- `fair_decimal_odds`
- `fair_american_odds`
- `kelly_fraction`
- `recommended_fractional_kelly_stake`

## Leakage Prevention

Feature snapshots must be built with:

- `asOfTimestamp`
- `gameId`
- `playerId`
- `marketKey`
- `line`

No feature builder may use:

- game logs after `asOfTimestamp`
- lineup updates after `asOfTimestamp`
- injury updates after `asOfTimestamp`
- closing odds in a pregame feature
- postgame result fields

Each snapshot includes a `leakageGuardHash`.

## Model Overview

Model families:

- `pitcher_strikeouts_distribution`: verified season K rate, expected batters
  faced, starter confidence, two-way price, overdispersed count distribution.
- `pitcher_outs_workload_distribution`: verified season outs/start, workload
  proxy, starter confidence, rest when available, overdispersed count model.
- `pitcher_hits_allowed_distribution`: hits/IP times expected innings; watchlist
  unless opponent/contact/recent context is verified.
- `pitcher_walks_distribution`: BB/IP times expected innings; watchlist unless
  opponent walk/control context is verified.
- `pitcher_earned_runs_distribution`: ER/IP times expected innings; low
  confidence until team total, park/weather, and opponent run context exist.
- `pitcher_win_context_proxy`: research-only until team win probability,
  run support, bullpen context, and win-qualification inputs are verified.
- Batter count/opportunity models for strikeouts, walks, hits, total bases,
  singles, doubles, triples, RBIs, runs, HRR, and stolen bases. These produce
  watchlist/no-play output with missing lineup/opponent/context reasons until
  verified batter and lineup features are available.
- `batter_home_runs_rare_event` and `first_home_run_field_model` are
  research-only milestone models. First HR is not promoted without a true
  field-wide/order-aware model.

Every market outputs a model path. Missing verified data becomes Watchlist,
No Play, Pending Data, or Research; markets are not hidden because they are
immature.

Calibration layer:

- independent model probability
- no-vig market probability when a complete two-way pair exists
- confidence-aware market-prior shrinkage
- final blended probability
- probability buckets for later settlement calibration
- capped first-paper decision report

No claim of profitability is made before settled paper/live results and CLV.

## Backtesting

Phase 1 fixture backtest:

```bash
npm run backtest:mlb-props -- --date=2026-07-07 --provider=mock --dry-run
```

The backtester:

- reconstructs odds as of bet time
- builds features as of bet time
- scores candidates
- devigs two-way markets
- applies EV/edge/staleness filters
- settles against mock results
- calculates CLV when a closing/reference snapshot exists

## CLI Jobs

All commands are mock-safe by default:

```bash
npm run ingest-mlb-slate -- --date=2026-07-07 --provider=mock --dry-run
npm run ingest-mlb-odds -- --date=2026-07-07 --provider=mock --dry-run
npm run ingest-mlb-lineups -- --date=2026-07-07 --provider=mock --dry-run
npm run ingest-mlb-injuries -- --date=2026-07-07 --provider=mock --dry-run
npm run ingest-mlb-weather -- --date=2026-07-07 --provider=mock --dry-run
npm run build-mlb-prop-features -- --date=2026-07-07 --provider=mock --dry-run
npm run train-mlb-prop-models -- --date=2026-07-07 --provider=mock --dry-run
npm run backtest-mlb-prop-models -- --date=2026-07-07 --provider=mock --dry-run
npm run score-mlb-prop-slate -- --date=2026-07-07 --provider=mock --dry-run
npm run settle-mlb-props -- --date=2026-07-07 --provider=mock --dry-run
npm run publish-mlb-prop-picks -- --date=2026-07-07 --provider=mock --dry-run
```

Phase 2 aliases:

```bash
npm run ingest:mlb-props -- --date=2026-07-07 --provider=mock --dry-run
npm run score:mlb-props -- --date=2026-07-07 --provider=mock --dry-run
npm run backtest:mlb-props -- --date=2026-07-07 --provider=mock --dry-run
```

Persistence is opt-in:

```bash
npm run score:mlb-props -- --date=2026-07-07 --provider=mock --persist --dry-run=false
```

## Local Product Preview

Local no-auth route:

```bash
npm run dev
open http://localhost:3000/dev/mlb-props-preview
```

The preview route is disabled with `notFound()` in production. It reads
`tests/fixtures/mlb-props/player-props-preview-full.json`, performs no Supabase
writes, uses no secrets, and renders inside the same `ProductAppFrame` and
`LabAppNav` as Daily Edge. It shows every product grade: Best Angle, Lean,
Watchlist, No Play, Pending Data, and Research. It opens in the card-first
Today's Prop Angles mode, with Full Board and Player View plus search, filters,
sorting, best-price deduplication, and an on-demand model detail drawer. Product
behavior is documented in
`docs/mlb-player-props-product-ux.md`.

The canonical future member destination is `/mlb/props`. It is protected by
the existing member middleware and requires both props display/API flags. It
does not import the practice fixture. The legacy `/lab/player-props` route
redirects to the canonical route.

Reusable component structure:

- `PlayerPropsDashboard`
- `PropsSlateSummary`
- `PropsViewToggle`
- `PropRecommendationCard`
- `PropsTable`
- `PropDetailDrawer`
- `PropWatchlistCard`
- `PropDataQualityBadge`
- `PropSourceBadge`
- `PropConfidenceBadge`

Member route scaffold:

- `/mlb/props`
- currently always renders disabled state
- requires future display flag, public API flag, and member auth integration
  before showing props

Private control room:

- `/admin/mlb/props-review`
- admin-token protected launch readiness and tracking report
- immutable lock, same-book closing-price, CLV, result, units, ROI, and calibration views
- manual settlement control backed by the same bounded service as the cron
- never imported by or exposed through member routes

## Real Dry-Run Reports

When verified prop rows exist, a real dry-run writes local reports under
`tmp/mlb-props/reports/`:

- `YYYY-MM-DD-market-feature-inventory.json`
- `YYYY-MM-DD-pitcher-feature-inventory.json`
- `YYYY-MM-DD-model-comparison.json`
- `YYYY-MM-DD-recommendation-sanity-audit.json`
- `YYYY-MM-DD-first-paper-run-decision.json`
- `YYYY-MM-DD-calibration-readiness.json`
- `YYYY-MM-DD-provider-market-comparison.json`
- `YYYY-MM-DD-props-splits-context-audit.json`

SharpAPI diagnostics also write:

- `YYYY-MM-DD-sharpapi-product-proof.json`

These reports are local files only and include no Supabase writes.

## Thursday Workflow

Run on Thursday, July 16, 2026:

```bash
npm run readiness:mlb-props -- --date=2026-07-16
npm run diagnose:mlb-props-provider -- --date=2026-07-16 --provider=sharpapi --deep --discover-markets
npm run diagnose:mlb-props-provider -- --date=2026-07-16 --provider=balldontlie --deep
npm run score:mlb-props -- --date=2026-07-16 --provider=real --dry-run
npm run dev
```

Review:

- `/dev/mlb-props-preview`
- `/admin/mlb/props-review`
- local reports in `tmp/mlb-props/reports/`

Only if explicitly approved after a clean dry-run:

```bash
ODDSPHERE_PROPS_PAPER_TRADING_ENABLED=true ODDSPHERE_PROPS_REAL_PUBLISH_ENABLED=false ODDSPHERE_PROPS_DISPLAY_ENABLED=false ODDSPHERE_PROPS_PUBLIC_API_ENABLED=false npm run score:mlb-props -- --date=2026-07-16 --provider=real --persist --dry-run=false
```

Postgame internal settlement:

```bash
npm run settle:mlb-props-internal -- --date=2026-07-16
```

Real-provider persisted scoring is hidden-paper only. It is blocked unless all
of these are true:

- `--provider=real`
- `--persist`
- `--dry-run=false`
- `ODDSPHERE_PROPS_PAPER_TRADING_ENABLED=true`
- `ODDSPHERE_PROPS_REAL_PUBLISH_ENABLED=false`
- `ODDSPHERE_PROPS_DISPLAY_ENABLED=false`

Real publish and public/member display remain disabled.

## Thursday Slate Runbook

For the Thursday, July 16, 2026 slate, do not wait until game day to verify the
plumbing. Run readiness before odds appear, then repeat diagnostics as books
open pitcher markets.

Now / no games today:

```bash
npm run readiness:mlb-props -- --date=2026-07-16
```

Expected status before the market window can be `pending`, not failed, when the
schedule is visible but prop rows are not posted yet. Readiness must report no
Supabase writes, public display disabled, public API disabled, real publish
disabled, and paper trading disabled.

Thursday morning:

```bash
npm run diagnose:mlb-props-provider -- --date=2026-07-16 --provider=sharpapi --deep --discover-markets
npm run diagnose:mlb-props-provider -- --date=2026-07-16 --provider=balldontlie --deep
```

Three to six hours pregame:

```bash
npm run diagnose:mlb-props-provider -- --date=2026-07-16 --provider=balldontlie --deep
npm run score:mlb-props -- --date=2026-07-16 --provider=real --dry-run
```

One to two hours pregame:

```bash
npm run score:mlb-props -- --date=2026-07-16 --provider=real --dry-run
```

Review the local reports before any persistence:

```text
tmp/mlb-props/reports/2026-07-16-bdl-scoring-rejection-trace.json
tmp/mlb-props/reports/2026-07-16-bdl-recommendation-sanity-audit.json
```

Hidden paper persistence is optional and only after a clean current-slate
dry-run. The first hidden paper run uses a capped review set: pitcher
strikeouts and pitcher outs only, max 25 picks, max one per player, max one per
player/market, max two per game, best EV per player/market/side/line, no
over/under conflicts, no stale odds, no odds sanity anomalies, and no
low-confidence starter/data rows.

Do not run this until the dry-run is clean:

```bash
ODDSPHERE_PROPS_PAPER_TRADING_ENABLED=true ODDSPHERE_PROPS_REAL_PUBLISH_ENABLED=false ODDSPHERE_PROPS_DISPLAY_ENABLED=false ODDSPHERE_PROPS_PUBLIC_API_ENABLED=false npm run score:mlb-props -- --date=2026-07-16 --provider=real --persist --dry-run=false
```

Postgame settlement review remains dry-run:

```bash
npm run settle-mlb-props -- --date=2026-07-16 --provider=real --dry-run
```

Hidden paper persist readiness requires:

- DB smoke ok
- Current slate games found
- Current prop rows found
- Pitcher strikeout or pitcher outs rows found
- Starter confirmation available
- BDL/Sharp odds timestamps not stale
- No odds sanity anomalies
- No no-vig anomalies
- No over/under conflicts
- Sanity audit generated
- Public display false
- Public API false
- Real publish false
- Paper trading true only for the explicit persist command

Real dry-run scoring for pitcher props:

```bash
npm run score:mlb-props -- --date=2026-07-07 --provider=real --dry-run
```

This maps Sharp event metadata to MLB Stats games, maps Sharp pitcher prop names
to probable starters, attaches BDL season pitching stats through
`players.provider_ids.mlb_stats.id`, groups two-way over/under markets, and
scores only `pitcher_strikeouts` and `pitcher_outs`. It does not write to
Supabase and does not enable member display.

If SharpAPI events are available but prop odds return empty payloads, run the
availability diagnostic before any paper-trading decision:

```bash
npm run diagnose:mlb-props-provider -- --date=YYYY-MM-DD --provider=sharpapi
```

For a broader current/upcoming provider sweep:

```bash
npm run diagnose:mlb-props-provider -- --date=YYYY-MM-DD --provider=sharpapi --sweep
```

For docs-driven SharpAPI contract discovery:

```bash
npm run diagnose:mlb-props-provider -- --date=YYYY-MM-DD --provider=sharpapi --deep
npm run diagnose:mlb-props-provider -- --date=YYYY-MM-DD --provider=sharpapi --sweep --deep
```

The diagnostic queries MLB events, tests known pitcher and batter prop market
keys against `/odds`, records HTTP status/shape/row counts/rate-limit headers,
and writes a redacted local support report under `tmp/mlb-props/reports/`.
Secrets and raw provider payloads are not written. If all prop market requests
succeed but return no rows, the blocker is `PROVIDER_PROP_ODDS_UNAVAILABLE`.

The support report includes event-level summaries, endpoint variant probes
(`event_id` only, `event_id+market`, and `event_id+market+sport`), row counts by
market/date, likely cause, and recommended action. Use it to confirm with
SharpAPI whether the issue is account/plan access, market-key mismatch,
endpoint usage, timing window, or provider coverage.

Deep mode expands the same no-write diagnostic into:

- SharpAPI reference probes for `/sports`, `/leagues`, `/markets`,
  `/sportsbooks`, `/account`, and `/account/usage`
- controlled event filters for MLB/baseball sport and league casing
- event-scoped probes for `/events/:eventId`, `/events/:eventId/markets`, and
  `/events/:eventId/odds`
- singular filter checks such as `/odds?event=...`
- `/odds/best`, `/odds/comparison`, and a small `POST /odds/batch`
- bounded cursor scanning with `--max-pages`, `--max-events`, and
  `--max-markets`
- discovered market classification into team/game markets, pitcher props,
  batter props, alternate lines, unknown, and unsupported

Do not patch `SharpApiPropsClient` based on guesses. Patch it only after deep
diagnostics return non-empty player-prop rows or prove a specific endpoint or
filter mismatch from live responses.

Latest live finding:

- On `2026-07-09`, deep discovery and real dry-run confirmed SharpAPI player
  prop availability.
- The real dry-run detected pitcher markets, including `pitcher_strikeouts`
  and `pitcher_outs`, and found Hard Rock rows.
- This removes the provider-empty blocker for that slate, but does not approve
  public display, paper persistence, batter scoring, or UI work.

Hidden paper trading is separately gated:

```bash
ODDSPHERE_PROPS_PAPER_TRADING_ENABLED=true ODDSPHERE_PROPS_REAL_PUBLISH_ENABLED=false ODDSPHERE_PROPS_DISPLAY_ENABLED=false ODDSPHERE_PROPS_PUBLIC_API_ENABLED=false npm run score:mlb-props -- --date=YYYY-MM-DD --provider=real --persist --dry-run=false
```

Paper-trading recommendations are persisted with `recommendation_status =
paper`, `provider_mode = real`, and no public/member visibility. Only
`pitcher_strikeouts` and `pitcher_outs` are eligible. Batter markets and
unsupported pitcher markets are blocked from hidden paper persistence.

Safe same-day retry flow when provider props are empty:

Provider check:

```bash
npm run diagnose:mlb-props-provider -- --date=YYYY-MM-DD --provider=sharpapi --deep --discover-markets
```

BDL player-props fallback check:

```bash
npm run diagnose:mlb-props-provider -- --date=YYYY-MM-DD --provider=balldontlie --deep
```

Real dry-run:

```bash
npm run score:mlb-props -- --date=YYYY-MM-DD --provider=real --dry-run
```

Hidden paper persist only after non-empty props and a clean dry-run:

```bash
ODDSPHERE_PROPS_PAPER_TRADING_ENABLED=true ODDSPHERE_PROPS_REAL_PUBLISH_ENABLED=false ODDSPHERE_PROPS_DISPLAY_ENABLED=false ODDSPHERE_PROPS_PUBLIC_API_ENABLED=false npm run score:mlb-props -- --date=YYYY-MM-DD --provider=real --persist --dry-run=false
```

Provider strategy:

- SharpAPI remains first priority when it returns MLB player prop rows,
  especially if Hard Rock rows are present.
- Ball Don't Lie is the same-day real odds fallback when SharpAPI event odds
  returns MLB events but zero normalized player props.
- BDL player props use
  `GET https://api.balldontlie.io/mlb/v1/odds/player_props?game_id=<game_id>`.
  BDL docs describe these props as live from the 2026 season, real-time, not
  historical, and subject to disappearing near completion.
- Supported BDL pitcher markets include `pitcher_strikeouts`, `pitcher_outs`,
  `pitcher_hits_allowed`, `pitcher_walks`, and `pitcher_earned_runs`; the real
  scorer still promotes only `pitcher_strikeouts` and `pitcher_outs`.
- BDL listed vendors include BetMGM, BetRivers, Caesars, DraftKings, Fanatics,
  and FanDuel. Do not assume Hard Rock from BDL unless the live payload proves
  it.

Review hidden paper records:

```text
/api/admin/mlb/props/paper?date=YYYY-MM-DD
```

Confirm public display remains disabled:

```text
/api/mlb/props/picks?date=YYYY-MM-DD
```

This route returns disabled/empty unless
`ODDSPHERE_PROPS_PUBLIC_API_ENABLED=true` and display is explicitly enabled.

Every real paper run writes a local ignored report:

```text
tmp/mlb-props/reports/YYYY-MM-DD-real-paper-run.json
```

The report includes prop rows detected, mapped pitcher rows, two-way markets,
recommendations persisted, rejected reason counts, Hard Rock rows/books,
stale-odds count, mapping failures, feature warnings, flag status, Supabase
write count, and run ID.

Private settlement:

```bash
npm run settle:mlb-props-internal -- --date=YYYY-MM-DD
```

Settlement writes only to the private V37 ledger. Official MLB Stats game logs
are loaded only after the schedule marks a game final. Missing logs are retried
before a non-start is voided; missing final stats remain unresolved. Unit return
uses the locked American price. Changed-line CLV remains non-comparable.

Do not enable hidden paper persistence until a real dry-run has been reviewed
for mapping failures, low-confidence starter profiles, stale odds, and
two-way-market completeness. Also do not enable it while provider availability
is blocked by `PROVIDER_PROP_ODDS_UNAVAILABLE`.

Real persisted scoring also requires a successful provider inspection sample for
the same date under `tmp/mlb-props/provider-samples/YYYY-MM-DD/`. The emergency
override `ODDSPHERE_PROPS_REAL_CONTRACT_OVERRIDE=true` exists for operator use
only and should remain false during normal rollout.

Real provider contract inspection:

```bash
npm run inspect:mlb-props-real -- --date=2026-07-07
```

The inspector writes redacted local samples to
`tmp/mlb-props/provider-samples/` and prints a compact schema summary. It never
writes to Supabase.

Local score/backtest reports are written to `tmp/mlb-props/reports/`; that
folder is ignored.

## Pick Publishing Rules

Default gates:

- minimum EV: `0.05`
- minimum edge: `0.035`
- max odds age: `60` seconds
- minimum mapping confidence: `0.98`
- max stake per pick: `0.5%` bankroll
- max slate exposure: `5%` bankroll
- fractional Kelly: `0.15`

Do not publish if:

- odds are stale
- player mapping confidence is low
- lineup status is risky for batter props
- probable pitcher changed and features are stale
- injury status is high-risk
- market lacks both over and under prices
- model version is inactive
- data-quality alerts exist
- EV or edge is below threshold

## API

Endpoints:

- `GET /api/mlb/props/picks?date=YYYY-MM-DD`
- `GET /api/mlb/props/player/[player_id]`
- `GET /api/admin/mlb/props/health`
- `POST /api/admin/mlb/props/score`
- `POST /api/admin/mlb/props/backtest`
- `GET|POST /api/admin/mlb/props/tracking`

Admin endpoints use existing admin-token/email auth.

The public picks endpoint marks mock/non-production responses clearly and does
not expose raw provider payloads. Real picks are not returned unless the display
flag is explicitly enabled.

## CLV and Settlement Readiness

CLV utility rules:

- Same player/game/market/side/line: compare bet odds to closing/reference odds.
- Different line: mark line moved and not directly comparable.
- Missing close: pending.
- Closing snapshot after start: rejected unless provider verified.

Private settlement supports:

- Pitcher strikeouts
- Pitcher outs
- Pushes
- Player did not start
- Missing final stat unresolved
- Innings pitched to outs conversion
- locked-price unit returns
- retry-before-void handling for missing final pitcher logs
- idempotent result updates

## Data Licensing Warning

Provider data may have licensing restrictions. Do not expose raw provider payloads, premium slate data, or sportsbook/provider internals publicly unless the provider contract allows it.

## Known Limitations

- Phase 1 is mock-first.
- Real provider clients are ready for guarded ingestion, but production mapping
  and provider contract review are still required before member launch.
- Pitcher strikeouts and pitcher outs are implemented; batter markets remain
  future work.
- Persisted writes require `--persist`; no Supabase writes happen by default.
- V37 must be applied and the private tracking/settlement flags enabled before
  the launch gate can pass.
