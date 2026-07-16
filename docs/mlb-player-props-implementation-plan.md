# MLB Player Props Engine Implementation Plan

## Repo Conventions Found

- Framework: Next.js App Router with TypeScript.
- Runtime scripts: `tsx`, usually with `--env-file=.env.local`.
- Database: Supabase/Postgres with checked-in SQL migrations under `lib/db/schema-migration-v*.sql`.
- Providers: existing `lib/providers/*` interfaces and real/mock provider pattern.
- Models: existing pure TypeScript prop-model math under `lib/models/props`.
- API: Next route handlers under `app/api/*`.
- Admin auth: existing admin helpers under `lib/auth` / `lib/auth/admin.ts`.

## Scope

Build the Phase 1 foundation for a production MLB player prop engine without touching Daily Edge game-pick logic, grading, tracking, lock snapshots, or member auth.

## Phase 1 Deliverables

1. Schema
   - Add SQL migration for player prop entities, odds snapshots, time-safe feature snapshots, model versions, predictions, edges, recommendations, backtests, and data-quality events.
   - Use idempotent `CREATE TABLE IF NOT EXISTS` and indexes.

2. Provider Layer
   - Add MLB prop provider interfaces for odds, schedule/game, metadata, probable pitchers, lineups, injuries, weather, historical stats, and settlement.
   - Add mock provider implementations backed by local fixtures.
   - Add real-provider client shells for Sharp API, Ball Don't Lie, Playbook, MLB StatsAPI, Statcast, and Weather with env-key guards.

3. Pricing Utilities
   - Add prop-specific odds utilities:
     - American/decimal/implied conversions
     - two-way devig
     - EV
     - fair odds
     - Kelly/fractional Kelly

4. Time-Safe Features
   - Add a feature snapshot builder that requires `asOfTimestamp`, `gameId`, `playerId`, `marketKey`, and `line`.
   - Reject or ignore records whose timestamps are after `asOfTimestamp`.
   - Produce `features_json`, `data_availability_json`, and a leakage guard hash.

5. Models
   - Add a `BasePropModel` interface.
   - Add baseline `PitcherStrikeoutsModel` using expected batters faced x K probability with Poisson fallback.

6. Backtesting
   - Add a fixture-based walk-forward backtest runner that:
     - reconstructs odds as of bet time
     - builds features as of bet time
     - scores candidates
     - calculates no-vig market probability, edge, EV
     - rejects stale/negative EV/low edge candidates
     - settles from fixture results

7. Recommendations
   - Add recommendation engine with default thresholds and reason codes.
   - Write recommended bets only in mock/dry-run path in Phase 1.

8. API
   - Add mock-capable endpoints:
     - `GET /api/mlb/props/picks?date=YYYY-MM-DD`
     - `GET /api/mlb/props/player/[player_id]`
     - `GET /api/admin/mlb/props/health`
     - `POST /api/admin/mlb/props/score`
     - `POST /api/admin/mlb/props/backtest`

9. Scripts
   - Add CLI entrypoints for ingest/feature/build/train/backtest/score/settle/publish commands.
   - Phase 1 commands use mock provider and dry-run by default.

10. Tests
   - Add fixture tests for odds math, provider parsing, leakage prevention, baseline model validity, recommendation filtering, and fixture backtest.

## Phase 2

- Wire guarded real-provider ingestion scaffolding for Sharp API props/market data,
  Ball Don't Lie stats/identity, Playbook context/splits, MLB schedule/probables,
  and weather readiness.
- Add explicit persistence path behind `--persist`; keep dry-run as the default.
- Add pitcher outs as the second supported scored market.
- Add entity resolution hard gates and data-quality event hooks.
- Add CLV-ready odds snapshot roles.
- Expand health response details and public endpoint safety gates.
- Admin UI remains Phase 3 unless explicitly prioritized.

## Phase 3

- Add batter hits, total bases, calibration dashboards, CLV tracking, exposure optimizer, and production hardening.

## Phase 2.5

- Add additive V36 migration for paper-trading run logs, provider mappings,
  settlement run logs, and recommended-bet result/CLV metadata.
- Add real-provider contract inspector that writes redacted local samples to
  `tmp/mlb-props/provider-samples/` with no Supabase writes.
- Add sanitized parser fixtures under `tests/fixtures/mlb-props/real-contract-samples/`.
- Add hidden paper-trading gates:
  - `ODDSPHERE_PROPS_PAPER_TRADING_ENABLED=true`
  - `--persist`
  - real publishing/display still separately disabled.
- Add CLV comparability utility and settlement scaffold for pitcher strikeouts
  and pitcher outs.
- Add local reports to `tmp/mlb-props/reports/`.

## Safety Rules

- No secrets in code.
- Real provider calls require env keys.
- Mock providers must work without keys.
- Feature queries must be time-safe.
- Do not publish picks if data quality, mapping confidence, stale odds, missing two-way market, inactive model, or EV/edge gates fail.
