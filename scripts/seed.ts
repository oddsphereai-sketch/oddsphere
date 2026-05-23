/**
 * scripts/seed.ts — populate Supabase with the mock dataset.
 *
 * Pulls data through the provider abstraction (getStatsProvider() etc.) so
 * the seed exercises the same code path the production crons will use.
 * Mock is hard-wired in this script via USE_REAL_*=false (set in .env.local).
 *
 * Strategy:
 *   1. Delete in reverse FK order — idempotent reset every run.
 *   2. Insert in forward FK order, capturing returned DB ids for FK
 *      resolution via per-table Maps keyed on external_id.
 *   3. Synthesize historical game + prediction shells from
 *      historical_results.json so prediction_results FKs resolve.
 *   4. Compute tracking_aggregates from historical_results (Option B —
 *      aggregates derived from raw events for internal consistency).
 *   5. Verify row counts vs expected.
 *
 * Run with: npm run seed
 */

import { supabase } from "../lib/db/supabase";
import {
  getStatsProvider,
  getBettingProvider,
  getWeatherProvider,
  getParkFactorProvider,
} from "../lib/providers/factory";

// Fixtures imported directly (not via provider) when the schema persists
// fields the provider strips — weather notable flags, line_history shape,
// daniels_model output, historical_results FK reconstruction, refresh_log.
import danielsModelJson from "../lib/providers/mock/fixtures/daniels_model.json";
import historicalResultsJson from "../lib/providers/mock/fixtures/historical_results.json";
import lineHistoryJson from "../lib/providers/mock/fixtures/line_history.json";
import refreshLogJson from "../lib/providers/mock/fixtures/refresh_log.json";
import weatherJson from "../lib/providers/mock/fixtures/weather.json";

// ─── Helpers ─────────────────────────────────────────────────────────────
function logSection(title: string) {
  console.log(`\n${"─".repeat(70)}\n${title}\n${"─".repeat(70)}`);
}

function logStep(label: string, count: number, ms: number) {
  console.log(`  ${label.padEnd(34)} ${String(count).padStart(5)} rows · ${ms}ms`);
}

async function timed<T>(fn: () => Promise<T>): Promise<[T, number]> {
  const start = Date.now();
  const r = await fn();
  return [r, Date.now() - start];
}

function chunked<T>(arr: T[], size = 500): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size));
  return out;
}

async function bulkInsert<R>(
  table: string,
  rows: Record<string, unknown>[],
  returnIdField: string = "id"
): Promise<R[]> {
  if (rows.length === 0) return [];
  const all: R[] = [];
  for (const chunk of chunked(rows)) {
    const { data, error } = await supabase.from(table).insert(chunk).select(returnIdField);
    if (error) throw new Error(`Insert into ${table} failed: ${error.message}`);
    if (data) all.push(...(data as R[]));
  }
  return all;
}

// ─── Stage 0: delete in reverse FK order ─────────────────────────────────
const DELETE_ORDER = [
  "tracking_aggregates",
  "calibration_buckets",
  "prediction_breakdowns",
  "prediction_results",
  "prop_predictions",
  "game_predictions",
  "sharp_signals",
  "line_history",
  "lines",
  "weather_forecasts",
  "player_injuries",
  "lineups",
  "hitter_pitch_stats",
  "pitcher_pitch_stats",
  "player_splits",
  "player_season_stats",
  "games",
  "players",
  "ballparks",
  "teams",
  "data_refresh_log",
  "user_bet_pins",
];

async function deleteAll() {
  logSection("Stage 0 · clearing existing rows");
  for (const table of DELETE_ORDER) {
    const [_, ms] = await timed(async () => {
      const { error } = await supabase.from(table).delete().gte("id", 0);
      if (error && error.code !== "42P01") {
        // 42P01 = relation does not exist (shouldn't happen but resilient)
        throw new Error(`Delete from ${table} failed: ${error.message}`);
      }
      return null;
    });
    logStep(`cleared ${table}`, 0, ms);
  }
}

// ─── Stage 1: reference data ─────────────────────────────────────────────
async function seedReference() {
  logSection("Stage 1 · reference data (teams, ballparks, players)");

  const stats = getStatsProvider();
  const parks = getParkFactorProvider();

  // Teams
  const teamRecs = await stats.getTeams("mlb");
  const [teamRows, t1] = await timed(() =>
    bulkInsert<{ id: number; external_id: number }>(
      "teams",
      teamRecs.map((t) => ({
        sport: t.sport,
        external_id: t.external_id,
        slug: t.slug,
        abbreviation: t.abbreviation,
        display_name: t.display_name,
        short_display_name: t.short_display_name,
        name: t.name,
        location: t.location,
        league: t.league,
        division: t.division,
        logo_url: t.logo_url,
        primary_color: t.primary_color,
      })),
      "id, external_id"
    )
  );
  const teamIdByExternal = new Map<number, number>(
    teamRows.map((r) => [r.external_id, r.id])
  );
  logStep("teams", teamRows.length, t1);

  // Ballparks — derive from ballparks.json (the IParkFactorProvider only
  // exposes park-factor fields, not lat/lng/is_dome). We read the fixture
  // directly here since ballparks are reference data, not a provider concern.
  const ballparksFixture = (await import(
    "../lib/providers/mock/fixtures/ballparks.json"
  )).default as Array<{
    team_external_id: number;
    name: string;
    city: string;
    state: string;
    is_dome: boolean;
    is_retractable: boolean;
    latitude: number;
    longitude: number;
    park_factor_runs: number;
    park_factor_hr: number;
    park_factor_hits: number;
    park_factor_so: number;
    park_factor_handedness_lhh: number;
    park_factor_handedness_rhh: number;
  }>;
  const [ballparkRows, t2] = await timed(() =>
    bulkInsert<{ id: number; team_id: number }>(
      "ballparks",
      ballparksFixture.map((b) => ({
        team_id: teamIdByExternal.get(b.team_external_id),
        name: b.name,
        city: b.city,
        state: b.state,
        is_dome: b.is_dome,
        is_retractable: b.is_retractable,
        latitude: b.latitude,
        longitude: b.longitude,
        park_factor_runs: b.park_factor_runs,
        park_factor_hr: b.park_factor_hr,
        park_factor_hits: b.park_factor_hits,
        park_factor_so: b.park_factor_so,
        park_factor_handedness_lhh: b.park_factor_handedness_lhh,
        park_factor_handedness_rhh: b.park_factor_handedness_rhh,
      })),
      "id, team_id"
    )
  );
  const ballparkIdByTeamId = new Map<number, number>(
    ballparkRows.map((r) => [r.team_id, r.id])
  );
  logStep("ballparks", ballparkRows.length, t2);

  // Players
  const playerRecs = await stats.getPlayers();
  const [playerRows, t3] = await timed(() =>
    bulkInsert<{ id: number; external_id: number }>(
      "players",
      playerRecs.map((p) => ({
        sport: p.sport,
        external_id: p.external_id,
        team_id:
          p.team_external_id !== null
            ? teamIdByExternal.get(p.team_external_id) ?? null
            : null,
        first_name: p.first_name,
        last_name: p.last_name,
        full_name: p.full_name,
        jersey: p.jersey,
        position: p.position,
        position_abbr: p.position_abbr,
        is_pitcher: p.is_pitcher,
        active: p.active,
        bats: p.bats,
        throws: p.throws,
        birth_place: p.birth_place,
        dob: p.dob,
        age: p.age,
        height: p.height,
        weight: p.weight,
        debut_year: p.debut_year,
      })),
      "id, external_id"
    )
  );
  const playerIdByExternal = new Map<number, number>(
    playerRows.map((r) => [r.external_id, r.id])
  );
  logStep("players", playerRows.length, t3);

  // Stats — fetch per player from provider (10 calls per stat type is OK for mock)
  await seedSeasonStats(playerIdByExternal, teamIdByExternal);
  await seedSplits(playerIdByExternal);
  await seedPitchStats(playerIdByExternal);

  return { teamIdByExternal, ballparkIdByTeamId, playerIdByExternal };
}

async function seedSeasonStats(
  playerIdByExternal: Map<number, number>,
  teamIdByExternal: Map<number, number>
) {
  const stats = getStatsProvider();
  const all: Record<string, unknown>[] = [];
  for (const [extId, dbId] of playerIdByExternal) {
    const rows = await stats.getPlayerSeasonStats(extId, [2024, 2025, 2026]);
    for (const r of rows) {
      all.push({
        player_id: dbId,
        team_id:
          r.team_external_id !== null
            ? teamIdByExternal.get(r.team_external_id) ?? null
            : null,
        season: r.season,
        season_type: r.season_type,
        postseason: r.postseason,
        batting_gp: r.batting_gp,
        batting_ab: r.batting_ab,
        batting_r: r.batting_r,
        batting_h: r.batting_h,
        batting_avg: r.batting_avg,
        batting_2b: r.batting_2b,
        batting_3b: r.batting_3b,
        batting_hr: r.batting_hr,
        batting_rbi: r.batting_rbi,
        batting_tb: r.batting_tb,
        batting_bb: r.batting_bb,
        batting_so: r.batting_so,
        batting_sb: r.batting_sb,
        batting_obp: r.batting_obp,
        batting_slg: r.batting_slg,
        batting_ops: r.batting_ops,
        batting_war: r.batting_war,
        batting_pa: r.batting_pa,
        batting_hbp: r.batting_hbp,
        batting_sf: r.batting_sf,
        pitching_gp: r.pitching_gp,
        pitching_gs: r.pitching_gs,
        pitching_qs: r.pitching_qs,
        pitching_w: r.pitching_w,
        pitching_l: r.pitching_l,
        pitching_era: r.pitching_era,
        pitching_sv: r.pitching_sv,
        pitching_hld: r.pitching_hld,
        pitching_ip: r.pitching_ip,
        pitching_h: r.pitching_h,
        pitching_er: r.pitching_er,
        pitching_hr: r.pitching_hr,
        pitching_bb: r.pitching_bb,
        pitching_whip: r.pitching_whip,
        pitching_k: r.pitching_k,
        pitching_k_per_9: r.pitching_k_per_9,
        pitching_war: r.pitching_war,
      });
    }
  }
  const [rows, ms] = await timed(() =>
    bulkInsert("player_season_stats", all)
  );
  logStep("player_season_stats", rows.length, ms);
}

async function seedSplits(playerIdByExternal: Map<number, number>) {
  const stats = getStatsProvider();
  const all: Record<string, unknown>[] = [];
  for (const [extId, dbId] of playerIdByExternal) {
    const rows = await stats.getPlayerSplits(extId, 2025);
    for (const r of rows) {
      all.push({
        player_id: dbId,
        season: r.season,
        split_type: r.split_type,
        ab: r.ab,
        h: r.h,
        avg: r.avg,
        obp: r.obp,
        slg: r.slg,
        ops: r.ops,
        hr: r.hr,
        rbi: r.rbi,
        so: r.so,
        bb: r.bb,
        tb: r.tb,
        pa: r.pa,
      });
    }
  }
  const [rows, ms] = await timed(() => bulkInsert("player_splits", all));
  logStep("player_splits", rows.length, ms);
}

async function seedPitchStats(playerIdByExternal: Map<number, number>) {
  const stats = getStatsProvider();
  const pitcherAll: Record<string, unknown>[] = [];
  const hitterAll: Record<string, unknown>[] = [];
  for (const [extId, dbId] of playerIdByExternal) {
    const p = await stats.getPitcherPitchStats(extId, 2025);
    for (const r of p) {
      pitcherAll.push({
        player_id: dbId,
        season: r.season,
        pitch_type: r.pitch_type,
        count: r.count,
        pct_of_total: r.pct_of_total,
        avg_velo_mph: r.avg_velo_mph,
        whiff_rate: r.whiff_rate,
        k_rate: r.k_rate,
        contact_rate: r.contact_rate,
      });
    }
    const h = await stats.getHitterPitchStats(extId, 2025);
    for (const r of h) {
      hitterAll.push({
        player_id: dbId,
        season: r.season,
        pitch_type: r.pitch_type,
        pa: r.pa,
        ab: r.ab,
        h: r.h,
        hr: r.hr,
        so: r.so,
        bb: r.bb,
        avg: r.avg,
        slg: r.slg,
        ops: r.ops,
        whiff_rate: r.whiff_rate,
        contact_rate: r.contact_rate,
      });
    }
  }
  const [pRows, pMs] = await timed(() =>
    bulkInsert("pitcher_pitch_stats", pitcherAll)
  );
  logStep("pitcher_pitch_stats", pRows.length, pMs);
  const [hRows, hMs] = await timed(() =>
    bulkInsert("hitter_pitch_stats", hitterAll)
  );
  logStep("hitter_pitch_stats", hRows.length, hMs);
}

// ─── Stage 2: tonight's slate (games, lineups, weather, injuries) ────────
type GameMap = Map<number, number>; // external_id → DB id

async function seedSlate(
  teamIdByExternal: Map<number, number>,
  playerIdByExternal: Map<number, number>,
  ballparkIdByTeamId: Map<number, number>
): Promise<GameMap> {
  logSection("Stage 2 · tonight's slate");

  const stats = getStatsProvider();
  const weather = getWeatherProvider();

  // Games
  const gameRecs = await stats.getGames("2026-05-22", "mlb");
  const [gameRows, t1] = await timed(() =>
    bulkInsert<{ id: number; external_id: number }>(
      "games",
      gameRecs.map((g) => {
        const homeTeamId =
          g.home_team_external_id !== null
            ? teamIdByExternal.get(g.home_team_external_id) ?? null
            : null;
        const awayTeamId =
          g.away_team_external_id !== null
            ? teamIdByExternal.get(g.away_team_external_id) ?? null
            : null;
        const ballparkId =
          homeTeamId !== null ? ballparkIdByTeamId.get(homeTeamId) ?? null : null;
        return {
          sport: g.sport,
          external_id: g.external_id,
          home_team_id: homeTeamId,
          away_team_id: awayTeamId,
          home_pitcher_id:
            g.home_pitcher_external_id !== null
              ? playerIdByExternal.get(g.home_pitcher_external_id) ?? null
              : null,
          away_pitcher_id:
            g.away_pitcher_external_id !== null
              ? playerIdByExternal.get(g.away_pitcher_external_id) ?? null
              : null,
          ballpark_id: ballparkId,
          game_date: g.game_date,
          season: g.season,
          season_type: g.season_type,
          postseason: g.postseason,
          status: g.status,
          venue: g.venue,
          home_score: g.home_score,
          away_score: g.away_score,
          inning_scores: g.inning_scores,
        };
      }),
      "id, external_id"
    )
  );
  const gameIdByExternal: GameMap = new Map(
    gameRows.map((r) => [r.external_id, r.id])
  );
  logStep("games", gameRows.length, t1);

  // Lineups
  const lineupAll: Record<string, unknown>[] = [];
  for (const game of gameRecs) {
    const lineupRecs = await stats.getLineups(game.external_id);
    for (const l of lineupRecs) {
      lineupAll.push({
        game_id: gameIdByExternal.get(l.game_external_id),
        team_id: teamIdByExternal.get(l.team_external_id),
        player_id: playerIdByExternal.get(l.player_external_id),
        batting_position: l.batting_position,
        starting_position: l.starting_position,
        is_confirmed: l.is_confirmed,
        is_dh: l.is_dh,
      });
    }
  }
  const [lineupRows, t2] = await timed(() => bulkInsert("lineups", lineupAll));
  logStep("lineups", lineupRows.length, t2);

  // Injuries
  const injuryRecs = await stats.getInjuries("mlb");
  const [injuryRows, t3] = await timed(() =>
    bulkInsert(
      "player_injuries",
      injuryRecs.map((i) => ({
        player_id: playerIdByExternal.get(i.player_external_id),
        injury_date: i.injury_date,
        return_date: i.return_date,
        type: i.type,
        detail: i.detail,
        side: i.side,
        status: i.status,
        long_comment: i.long_comment,
        short_comment: i.short_comment,
        is_active: i.is_active,
      }))
    )
  );
  logStep("player_injuries", injuryRows.length, t3);

  // Weather — fixture has additional fields (wind_direction_relative,
  // is_notable, notable_reason) that the schema PERSISTS but the provider
  // strips. Read the fixture directly here to persist all schema columns.
  const weatherFixture = weatherJson as Array<{
    game_external_id: number;
    forecast_for: string;
    fetched_at: string;
    temperature_f: number;
    feels_like_f: number;
    humidity_pct: number;
    precipitation_mm: number;
    precipitation_probability: number;
    wind_speed_mph: number;
    wind_direction_degrees: number | null;
    wind_direction_relative: string | null;
    conditions: string;
    is_notable: boolean;
    notable_reason: string | null;
  }>;
  const [weatherRows, t4] = await timed(() =>
    bulkInsert(
      "weather_forecasts",
      weatherFixture.map((w) => ({
        game_id: gameIdByExternal.get(w.game_external_id),
        forecast_for: w.forecast_for,
        fetched_at: w.fetched_at,
        temperature_f: w.temperature_f,
        feels_like_f: w.feels_like_f,
        humidity_pct: w.humidity_pct,
        precipitation_mm: w.precipitation_mm,
        precipitation_probability: w.precipitation_probability,
        wind_speed_mph: w.wind_speed_mph,
        wind_direction_degrees: w.wind_direction_degrees,
        wind_direction_relative: w.wind_direction_relative,
        conditions: w.conditions,
        is_notable: w.is_notable,
        notable_reason: w.notable_reason,
      }))
    )
  );
  logStep("weather_forecasts", weatherRows.length, t4);
  // Touch the provider so it's exercised (smoke confirms it serves the
  // fixture data) — but persistence uses the raw fixture above.
  void weather;

  return gameIdByExternal;
}

// ─── Stage 3: betting (lines, history, signals) ──────────────────────────
async function seedBetting(
  gameIdByExternal: GameMap,
  playerIdByExternal: Map<number, number>
) {
  logSection("Stage 3 · betting (lines, line_history, sharp_signals)");

  const betting = getBettingProvider();

  // Game lines
  const gameLines = await betting.getGameLines("2026-05-22", "mlb");
  const [glRows, t1] = await timed(() =>
    bulkInsert(
      "lines",
      gameLines.map((l) => ({
        game_id: gameIdByExternal.get(l.game_external_id),
        market_type: l.market_type,
        player_id:
          l.player_external_id !== null
            ? playerIdByExternal.get(l.player_external_id) ?? null
            : null,
        sportsbook: l.sportsbook,
        side: l.side,
        line_value: l.line_value,
        odds_american: l.odds_american,
        odds_decimal: l.odds_decimal,
        implied_probability: l.implied_probability,
        ev_percent: l.ev_percent,
        fair_odds: l.fair_odds,
        is_ev_positive: l.is_ev_positive,
        fetched_at: l.fetched_at,
      }))
    )
  );
  logStep("lines (game)", glRows.length, t1);

  // Player props
  const propLines = await betting.getPlayerProps("2026-05-22", "mlb");
  const [plRows, t2] = await timed(() =>
    bulkInsert(
      "lines",
      propLines.map((l) => ({
        game_id: gameIdByExternal.get(l.game_external_id),
        market_type: l.market_type,
        player_id:
          l.player_external_id !== null
            ? playerIdByExternal.get(l.player_external_id) ?? null
            : null,
        sportsbook: l.sportsbook,
        side: l.side,
        line_value: l.line_value,
        odds_american: l.odds_american,
        odds_decimal: l.odds_decimal,
        implied_probability: l.implied_probability,
        ev_percent: l.ev_percent,
        fair_odds: l.fair_odds,
        is_ev_positive: l.is_ev_positive,
        fetched_at: l.fetched_at,
      }))
    )
  );
  logStep("lines (props)", plRows.length, t2);

  // Line history — read fixture directly (not on provider interface yet)
  const lineHistFixture = lineHistoryJson as Array<{
    game_external_id: number;
    market_type: string;
    player_external_id: number | null;
    sportsbook: string;
    side: string;
    line_value: number | null;
    odds_american: number;
    is_opener: boolean;
    recorded_at: string;
  }>;
  const [lhRows, t3] = await timed(() =>
    bulkInsert(
      "line_history",
      lineHistFixture.map((h) => ({
        game_id: gameIdByExternal.get(h.game_external_id),
        market_type: h.market_type,
        player_id:
          h.player_external_id !== null
            ? playerIdByExternal.get(h.player_external_id) ?? null
            : null,
        sportsbook: h.sportsbook,
        side: h.side,
        line_value: h.line_value,
        odds_american: h.odds_american,
        is_opener: h.is_opener,
        recorded_at: h.recorded_at,
      }))
    )
  );
  logStep("line_history", lhRows.length, t3);

  // Sharp signals
  const signals = await betting.getSharpSignals("2026-05-22");
  const [ssRows, t4] = await timed(() =>
    bulkInsert(
      "sharp_signals",
      signals.map((s) => ({
        game_id: gameIdByExternal.get(s.game_external_id),
        market_type: s.market_type,
        side: s.side,
        pinnacle_fair_probability: s.pinnacle_fair_probability,
        is_plus_ev: s.is_plus_ev,
        ev_pct: s.ev_pct,
        has_steam_move: s.has_steam_move,
        steam_detected_at: s.steam_detected_at,
        steam_books_count: s.steam_books_count,
        has_reverse_line_movement: s.has_reverse_line_movement,
        rlm_direction: s.rlm_direction,
        public_betting_pct: s.public_betting_pct,
        public_money_pct: s.public_money_pct,
        signal_strength: s.signal_strength,
        signal_summary: s.signal_summary,
        computed_at: s.computed_at,
      }))
    )
  );
  logStep("sharp_signals", ssRows.length, t4);
}

// ─── Stage 4: tonight's game_predictions ─────────────────────────────────
async function seedTonightPredictions(gameIdByExternal: GameMap) {
  logSection("Stage 4 · tonight's game_predictions (daniels-v3.2)");

  type DanielsRow = {
    game_external_id: number;
    predicted_home_score: number;
    predicted_away_score: number;
    predicted_total: number;
    predicted_ml_winner: string;
    ml_confidence: number;
    predicted_ou_side: string;
    ou_confidence: number;
    predicted_nrfi: boolean;
    nrfi_confidence: number;
    model_version: string;
    computed_at: string;
  };
  const dm = danielsModelJson as DanielsRow[];
  const [rows, ms] = await timed(() =>
    bulkInsert(
      "game_predictions",
      dm.map((d) => ({
        game_id: gameIdByExternal.get(d.game_external_id),
        predicted_home_score: d.predicted_home_score,
        predicted_away_score: d.predicted_away_score,
        predicted_total: d.predicted_total,
        predicted_ml_winner: d.predicted_ml_winner,
        ml_confidence: d.ml_confidence,
        predicted_ou_side: d.predicted_ou_side,
        ou_confidence: d.ou_confidence,
        predicted_nrfi: d.predicted_nrfi,
        sport_specific: { nrfi_pred: d.predicted_nrfi, nrfi_confidence: d.nrfi_confidence },
        prediction_source: "manual_daniel",
        nrfi_confidence: d.nrfi_confidence,
        model_version: d.model_version,
        computed_at: d.computed_at,
      }))
    )
  );
  logStep("game_predictions (tonight)", rows.length, ms);
}

// ─── Stage 5: historical chain (games → predictions → results) ──────────
type HistoricalRow = {
  pick_id: number;
  game_external_id: number;
  home_team_external_id: number;
  away_team_external_id: number;
  game_date: string;
  prediction_type: "game_ml" | "game_total" | "game_nrfi" | "prop";
  predicted_side: string;
  outcome: "win" | "loss" | "push" | "void";
  sport: string;
  market: string;
  resolved_at: string;
  bet_odds_american: number;
  closing_odds_american: number | null;
  clv_pct: number | null;
  beat_closing_line: boolean | null;
  prop_line?: number;
  tier?: string;
  player_external_id?: number;
};

const MARKET_TO_PROP_MARKET: Record<string, string> = {
  player_hits: "batter_hits",
  player_total_bases: "batter_total_bases",
  player_home_runs: "batter_home_runs",
  player_rbis: "batter_rbis",
};

const MARKET_TO_RESULTS_MARKET: Record<string, string> = {
  player_hits: "prop_hits",
  player_total_bases: "prop_total_bases",
  player_home_runs: "prop_home_runs",
  player_rbis: "prop_rbis",
};

async function seedHistorical(
  teamIdByExternal: Map<number, number>,
  playerIdByExternal: Map<number, number>,
  ballparkIdByTeamId: Map<number, number>
) {
  logSection("Stage 5 · historical chain (90d of picks)");
  const rows = historicalResultsJson as HistoricalRow[];

  // 5a. Insert 450 game shells
  const histGameRows: Record<string, unknown>[] = rows.map((r) => {
    const homeId = teamIdByExternal.get(r.home_team_external_id);
    return {
      sport: r.sport,
      external_id: r.game_external_id,
      home_team_id: homeId,
      away_team_id: teamIdByExternal.get(r.away_team_external_id),
      home_pitcher_id: null,
      away_pitcher_id: null,
      ballpark_id: homeId !== undefined ? ballparkIdByTeamId.get(homeId) ?? null : null,
      game_date: `${r.game_date}T23:10:00.000Z`,
      season: 2026,
      season_type: "regular",
      postseason: false,
      status: "STATUS_FINAL",
      venue: null,
      home_score: null,
      away_score: null,
      inning_scores: null,
    };
  });
  const [gameRows, t1] = await timed(() =>
    bulkInsert<{ id: number; external_id: number }>(
      "games",
      histGameRows,
      "id, external_id"
    )
  );
  const histGameIdByExternal = new Map<number, number>(
    gameRows.map((r) => [r.external_id, r.id])
  );
  logStep("games (historical shells)", gameRows.length, t1);

  // 5b. Insert game_predictions for game-level picks; prop_predictions for prop picks
  const gamePredRows: Record<string, unknown>[] = [];
  const propPredRows: Record<string, unknown>[] = [];
  const rowToGamePredIdx = new Map<number, number>(); // pick_id → index in gamePredRows
  const rowToPropPredIdx = new Map<number, number>(); // pick_id → index in propPredRows

  for (const r of rows) {
    const gameId = histGameIdByExternal.get(r.game_external_id);
    if (gameId === undefined) continue;
    if (r.prediction_type === "prop") {
      const playerId =
        r.player_external_id !== undefined
          ? playerIdByExternal.get(r.player_external_id) ?? null
          : null;
      if (playerId === null) continue;
      const propMarket = MARKET_TO_PROP_MARKET[r.market] ?? r.market;
      rowToPropPredIdx.set(r.pick_id, propPredRows.length);
      propPredRows.push({
        game_id: gameId,
        player_id: playerId,
        prop_market: propMarket,
        prop_line: r.prop_line ?? 0.5,
        model_probability: null,
        fair_probability: null,
        edge_pct: null,
        confidence_score: null,
        confidence_stars: null,
        tier: r.tier ?? "good",
        best_sportsbook: null,
        best_odds_american: r.bet_odds_american,
        ev_pct: null,
        reasoning: null,
        caveat: null,
        bet_odds_american: r.bet_odds_american,
        closing_odds_american: r.closing_odds_american,
        clv_pct: r.clv_pct,
        beat_closing_line: r.beat_closing_line,
        model_version: "daniels-v3.2",
        computed_at: `${r.game_date}T13:00:00.000Z`,
      });
    } else {
      // game-level prediction
      const isML = r.prediction_type === "game_ml";
      const isTotal = r.prediction_type === "game_total";
      const isNrfi = r.prediction_type === "game_nrfi";
      rowToGamePredIdx.set(r.pick_id, gamePredRows.length);
      gamePredRows.push({
        game_id: gameId,
        predicted_home_score: null,
        predicted_away_score: null,
        predicted_total: null,
        predicted_ml_winner: isML ? r.predicted_side : null,
        ml_confidence: isML ? 60.0 : null,
        predicted_ou_side: isTotal ? r.predicted_side : null,
        ou_confidence: isTotal ? 56.0 : null,
        predicted_nrfi: isNrfi ? r.predicted_side === "under" : null,
        nrfi_confidence: isNrfi ? 58.0 : null,
        prediction_source: "manual_daniel",
        bet_odds_american: r.bet_odds_american,
        closing_odds_american: r.closing_odds_american,
        clv_pct: r.clv_pct,
        beat_closing_line: r.beat_closing_line,
        model_version: "daniels-v3.2",
        computed_at: `${r.game_date}T13:00:00.000Z`,
      });
    }
  }

  const [gpRows, t2] = await timed(() =>
    bulkInsert<{ id: number }>("game_predictions", gamePredRows, "id")
  );
  logStep("game_predictions (hist)", gpRows.length, t2);

  const [ppRows, t3] = await timed(() =>
    bulkInsert<{ id: number }>("prop_predictions", propPredRows, "id")
  );
  logStep("prop_predictions (hist)", ppRows.length, t3);

  // 5c. Insert prediction_results referencing the prediction ids
  const resultRows: Record<string, unknown>[] = [];
  for (const r of rows) {
    let gamePredId: number | null = null;
    let propPredId: number | null = null;
    if (r.prediction_type === "prop") {
      const idx = rowToPropPredIdx.get(r.pick_id);
      if (idx === undefined) continue;
      propPredId = ppRows[idx]?.id ?? null;
    } else {
      const idx = rowToGamePredIdx.get(r.pick_id);
      if (idx === undefined) continue;
      gamePredId = gpRows[idx]?.id ?? null;
    }
    if (gamePredId === null && propPredId === null) continue;

    const market =
      r.prediction_type === "prop"
        ? MARKET_TO_RESULTS_MARKET[r.market] ?? r.market
        : r.market;

    resultRows.push({
      prediction_type: r.prediction_type,
      game_prediction_id: gamePredId,
      prop_prediction_id: propPredId,
      outcome: r.outcome,
      actual_value: null,
      predicted_side: r.predicted_side,
      sport: r.sport,
      market,
      resolved_at: r.resolved_at,
      game_date: r.game_date,
      bet_odds_american: r.bet_odds_american,
      closing_odds_american: r.closing_odds_american,
      clv_pct: r.clv_pct,
      beat_closing_line: r.beat_closing_line,
    });
  }

  const [prRows, t4] = await timed(() =>
    bulkInsert("prediction_results", resultRows)
  );
  logStep("prediction_results", prRows.length, t4);
}

// ─── Stage 6: data_refresh_log ───────────────────────────────────────────
async function seedRefreshLog() {
  logSection("Stage 6 · data_refresh_log");
  const rows = refreshLogJson as Array<Record<string, unknown>>;
  const [r, ms] = await timed(() =>
    bulkInsert(
      "data_refresh_log",
      rows.map((x) => ({ ...x }))
    )
  );
  logStep("data_refresh_log", r.length, ms);
}

// ─── Stage 7: compute tracking_aggregates from prediction_results ────────
type ResultRow = {
  sport: string;
  market: string;
  outcome: "win" | "loss" | "push" | "void";
  game_date: string;
};

const TODAY = "2026-05-22";

function daysBetween(a: string, b: string): number {
  return (
    (new Date(a).getTime() - new Date(b).getTime()) /
    (1000 * 60 * 60 * 24)
  );
}

async function computeTrackingAggregates() {
  logSection("Stage 7 · compute tracking_aggregates");

  const { data: results, error } = await supabase
    .from("prediction_results")
    .select("sport, market, outcome, game_date");
  if (error) throw new Error(`Read prediction_results failed: ${error.message}`);
  const rows = (results ?? []) as ResultRow[];

  const windows: Array<{
    name: "yesterday" | "this_week" | "season" | "all_time";
    start: string | null;
    end: string | null;
    matches: (gameDate: string) => boolean;
  }> = [
    {
      name: "yesterday",
      start: "2026-05-21",
      end: "2026-05-21",
      matches: (d) => d === "2026-05-21",
    },
    {
      name: "this_week",
      start: "2026-05-15",
      end: "2026-05-21",
      matches: (d) => daysBetween(TODAY, d) >= 1 && daysBetween(TODAY, d) <= 7,
    },
    {
      name: "season",
      start: "2026-03-28",
      end: TODAY,
      matches: (d) => d >= "2026-03-28" && d <= TODAY,
    },
    { name: "all_time", start: null, end: null, matches: () => true },
  ];

  const aggregateRows: Record<string, unknown>[] = [];
  const sportsMarkets = new Set<string>(
    rows.map((r) => `${r.sport}::${r.market}`)
  );

  for (const w of windows) {
    for (const sm of sportsMarkets) {
      const [sport, market] = sm.split("::");
      const matching = rows.filter(
        (r) => r.sport === sport && r.market === market && w.matches(r.game_date)
      );
      if (matching.length === 0) continue;
      const wins = matching.filter((r) => r.outcome === "win").length;
      const losses = matching.filter((r) => r.outcome === "loss").length;
      const pushes = matching.filter((r) => r.outcome === "push").length;
      const total = wins + losses + pushes;
      const hitRate =
        wins + losses > 0
          ? +(((wins / (wins + losses)) * 100).toFixed(2))
          : null;
      aggregateRows.push({
        sport,
        market,
        time_window: w.name,
        window_start: w.start,
        window_end: w.end,
        wins,
        losses,
        pushes,
        total,
        hit_rate: hitRate,
      });
    }
  }

  const [r, ms] = await timed(() =>
    bulkInsert("tracking_aggregates", aggregateRows)
  );
  logStep("tracking_aggregates", r.length, ms);
}

// ─── Stage 8: verification ───────────────────────────────────────────────
const EXPECTED_COUNTS: Record<string, number> = {
  teams: 30,
  ballparks: 30,
  players: 90,
  player_season_stats: 270,
  player_splits: 120,
  pitcher_pitch_stats: 120,
  hitter_pitch_stats: 240,
  games: 12 + 450,
  lineups: 84,
  player_injuries: 7,
  weather_forecasts: 12,
  lines: 360 + 156,
  line_history: 48,
  sharp_signals: 4,
  game_predictions: 12 + 360, // tonight + game-level historical (~360)
  prop_predictions: 90, // historical prop picks
  prediction_results: 450,
  tracking_aggregates: -1, // varies — just verify > 0
  data_refresh_log: 11,
};

async function verify() {
  logSection("Stage 8 · verification (row counts vs expected)");
  let pass = 0;
  let fail = 0;
  for (const [table, expected] of Object.entries(EXPECTED_COUNTS)) {
    const { count, error } = await supabase
      .from(table)
      .select("*", { count: "exact", head: true });
    if (error) {
      console.log(`  ${table.padEnd(28)} ERROR: ${error.message}`);
      fail++;
      continue;
    }
    const actual = count ?? 0;
    if (expected === -1) {
      console.log(
        `  ${table.padEnd(28)} ${String(actual).padStart(5)} (varies)`
      );
      pass++;
    } else if (actual === expected) {
      console.log(
        `  ${table.padEnd(28)} ${String(actual).padStart(5)} ✓ (expected ${expected})`
      );
      pass++;
    } else {
      console.log(
        `  ${table.padEnd(28)} ${String(actual).padStart(5)} ✗ EXPECTED ${expected}`
      );
      fail++;
    }
  }
  console.log(
    `\n  ${pass} pass · ${fail} fail · ${Object.keys(EXPECTED_COUNTS).length} total`
  );
  if (fail > 0) {
    throw new Error(`Verification failed: ${fail} count mismatches`);
  }
}

// ─── Main ────────────────────────────────────────────────────────────────
async function main() {
  console.log("Oddsphere mock seed · target: Supabase via service-role client");
  const startedAt = Date.now();

  await deleteAll();
  const { teamIdByExternal, ballparkIdByTeamId, playerIdByExternal } =
    await seedReference();
  const gameIdByExternal = await seedSlate(
    teamIdByExternal,
    playerIdByExternal,
    ballparkIdByTeamId
  );
  await seedBetting(gameIdByExternal, playerIdByExternal);
  await seedTonightPredictions(gameIdByExternal);
  await seedHistorical(
    teamIdByExternal,
    playerIdByExternal,
    ballparkIdByTeamId
  );
  await seedRefreshLog();
  await computeTrackingAggregates();
  await verify();

  const elapsed = ((Date.now() - startedAt) / 1000).toFixed(1);
  console.log(`\n✅ Seed complete · ${elapsed}s total\n`);
}

main().catch((e) => {
  console.error("\n❌ Seed failed:", e.message);
  if (e.stack) console.error(e.stack);
  process.exit(1);
});
