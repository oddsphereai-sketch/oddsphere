/**
 * predictionService — orchestrates the prediction layer for crons.
 *
 *   • generateGamePredictions(sport, date)
 *     Reads predictions from the scores-model source. Manual source's
 *     predictions are already in game_predictions (written by the admin
 *     upload endpoint). Auto sources (Phase 10+) would re-ingest here.
 *
 *   • generatePropPredictions(sport, date)
 *     Heavy lifting: reads tonight's prop lines, runs propModelOrchestrator
 *     per unique (game, player, market, line) opportunity, writes
 *     prop_predictions + prediction_breakdowns. DELETE-then-INSERT scoped
 *     to tonight's game IDs for idempotency.
 *
 *   • regenerateSharpVerdicts(gameIds) — REMOVED in Fix 4.1 (Gap-18+19).
 *     The legacy sharpSignalEvaluator + verdictGenerator pipeline was
 *     deleted; signal_strength + signal_summary are no longer written to
 *     the sharp_signals table. signalSummaryGenerator now derives text at
 *     API response time from the per-pick grade + evidence. See K1
 *     architecture in lib/services/signalSummaryGenerator.ts header.
 */

import { supabase } from "../db/supabase";
import {
  getOddsProvider,
  getPlayerStatsProvider,
  getWeatherProvider,
} from "../providers/factory";
import { getScoresModelSource } from "../scoresModel/factory";
import { predictPlayerProp } from "../models/props/propModelOrchestrator";
import type {
  BallparkContext,
  PropPredictionInput,
  WeatherContext,
} from "../models/props/propModelOrchestrator";
import * as signalDerivationService from "./signalDerivationService";
import type { Sport } from "../types/domain/Sport";
import type { PropMarketType } from "../types/domain/Lines";
import type { CronHandlerResult } from "../cron/runCron";
import type { WindRelative } from "../models/props/contextAdjustments";
import {
  loadBallparkMetadata,
  loadGameIdMap,
  loadPlayerMetadata,
} from "./_idMaps";

export const predictionService = {
  /**
   * Verify scores-model predictions exist for the sport+date.
   *
   * For ManualScoresModelSource: predictions are already in game_predictions
   * (the admin upload endpoint wrote them). This method confirms the upload
   * happened and returns the count; the morning-slate cron uses this to
   * decide whether to skip prop predictions.
   *
   * For AutoScoresModelSource (future): would ingest the fresh predictions
   * via scoresModelIngester. V1 raises early via factory.
   *
   * Returns { partial: true } when no predictions exist — signals the cron
   * to log a warning + defer downstream work.
   */
  async generateGamePredictions(
    sport: Sport,
    date: string
  ): Promise<CronHandlerResult> {
    const source = getScoresModelSource(sport, supabase);
    const predictions = await source.getPredictionsForDate(date);
    if (predictions.length === 0) {
      return {
        records_updated: 0,
        api_calls_made: 1,
        partial: true,
        details: {
          reason: `no scores-model predictions for ${sport} on ${date} (source: ${source.metadata.source})`,
        },
      };
    }
    return {
      records_updated: predictions.length,
      api_calls_made: 1,
      details: {
        source: source.metadata.source,
        isAutomated: source.isAutomated,
      },
    };
  },

  /**
   * Generate prop predictions for the slate.
   *
   * For each unique (game, player, market, line) prop opportunity:
   *   1. Load all context (player + pitcher + ballpark + weather + lineup)
   *   2. Load stats (season + splits + pitch types for both)
   *   3. Call predictPlayerProp(input)
   *
   * Then DELETE existing prop_predictions for tonight's games (CASCADE
   * clears prediction_breakdowns) and bulk INSERT fresh predictions +
   * breakdowns. Idempotent.
   *
   * Returns counts; details include the surfaced-tier distribution.
   */
  async generatePropPredictions(
    sport: Sport,
    date: string
  ): Promise<CronHandlerResult> {
    const stats = getPlayerStatsProvider();
    const odds = getOddsProvider();

    const gameIdByExternal = await loadGameIdMap(sport, date);
    if (gameIdByExternal.size === 0) {
      return { records_updated: 0, api_calls_made: 0 };
    }
    const gameIds = [...gameIdByExternal.values()];

    const playerMeta = await loadPlayerMetadata(sport);
    // Need external_id-keyed access AND db_id reverse lookup
    const playerIdByExternal = new Map<number, number>(
      [...playerMeta.entries()].map(([ext, p]) => [ext, p.id])
    );

    const ballparks = await loadBallparkMetadata();

    // Pull tonight's games for context (home/away pitchers, ballpark, etc.)
    const { data: gamesData, error: gErr } = await supabase
      .from("games")
      .select("id, external_id, home_team_id, away_team_id, home_pitcher_id, away_pitcher_id, ballpark_id")
      .in("id", gameIds);
    if (gErr) {
      throw new Error(`generatePropPredictions games fetch failed: ${gErr.message}`);
    }
    type GameContextRow = {
      id: number;
      external_id: number;
      home_team_id: number;
      away_team_id: number;
      home_pitcher_id: number | null;
      away_pitcher_id: number | null;
      ballpark_id: number | null;
    };
    const gameById = new Map<number, GameContextRow>(
      ((gamesData ?? []) as GameContextRow[]).map((g) => [g.id, g])
    );

    // Weather per game_id
    const { data: weatherData } = await supabase
      .from("weather_forecasts")
      .select("game_id, wind_speed_mph, wind_direction_relative, temperature_f")
      .in("game_id", gameIds);
    const weatherByGameId = new Map<number, WeatherContext>(
      ((weatherData ?? []) as Array<{
        game_id: number;
        wind_speed_mph: number;
        wind_direction_relative: string | null;
        temperature_f: number;
      }>).map((r) => [r.game_id, {
        wind_speed_mph: r.wind_speed_mph,
        wind_direction_relative: r.wind_direction_relative as WindRelative,
        temperature_f: r.temperature_f,
      }])
    );

    // Lineup positions per (game_id, player_id)
    const { data: lineupsData } = await supabase
      .from("lineups")
      .select("game_id, player_id, batting_position, is_confirmed, is_dh")
      .in("game_id", gameIds);
    const lineupByKey = new Map<string, { batting_position: number | null; is_confirmed: boolean; is_dh: boolean }>(
      ((lineupsData ?? []) as Array<{
        game_id: number;
        player_id: number;
        batting_position: number | null;
        is_confirmed: boolean;
        is_dh: boolean;
      }>).map((l) => [`${l.game_id}::${l.player_id}`, l])
    );

    // Prop lines for tonight (player_id NOT NULL filters to props)
    const allLines = await odds.getPlayerProps(date, sport);
    let apiCalls = 1;

    // Group lines by unique (game, player, market, line)
    type LineForOrchestrator = (typeof allLines)[0];
    const propGroups = new Map<string, LineForOrchestrator[]>();
    for (const l of allLines) {
      if (l.player_external_id === null) continue;
      const key = `${l.game_external_id}::${l.player_external_id}::${l.market_type}::${l.line_value}`;
      const arr = propGroups.get(key) ?? [];
      arr.push(l);
      propGroups.set(key, arr);
    }

    // Per-player caches for season stats / splits / pitch stats
    const seasonStatsCache = new Map<number, Awaited<ReturnType<typeof stats.getPlayerSeasonStats>>>();
    const splitsCache = new Map<number, Awaited<ReturnType<typeof stats.getPlayerSplits>>>();
    const pitcherPitchCache = new Map<number, Awaited<ReturnType<typeof stats.getPitcherPitchStats>>>();
    const hitterPitchCache = new Map<number, Awaited<ReturnType<typeof stats.getHitterPitchStats>>>();
    const playerByExtCache = new Map<number, Awaited<ReturnType<typeof stats.getPlayer>>>();

    async function getSeasons(ext: number) {
      if (seasonStatsCache.has(ext)) return seasonStatsCache.get(ext)!;
      apiCalls++;
      const r = await stats.getPlayerSeasonStats(ext, [2024, 2025, 2026]);
      seasonStatsCache.set(ext, r);
      return r;
    }
    async function getSplits(ext: number) {
      if (splitsCache.has(ext)) return splitsCache.get(ext)!;
      apiCalls++;
      const r = await stats.getPlayerSplits(ext, 2025);
      splitsCache.set(ext, r);
      return r;
    }
    async function getPitcherPitch(ext: number) {
      if (pitcherPitchCache.has(ext)) return pitcherPitchCache.get(ext)!;
      apiCalls++;
      const r = await stats.getPitcherPitchStats(ext, 2025);
      pitcherPitchCache.set(ext, r);
      return r;
    }
    async function getHitterPitch(ext: number) {
      if (hitterPitchCache.has(ext)) return hitterPitchCache.get(ext)!;
      apiCalls++;
      const r = await stats.getHitterPitchStats(ext, 2025);
      hitterPitchCache.set(ext, r);
      return r;
    }
    async function getPlayerByExt(ext: number) {
      if (playerByExtCache.has(ext)) return playerByExtCache.get(ext)!;
      apiCalls++;
      const r = await stats.getPlayer(ext);
      playerByExtCache.set(ext, r);
      return r;
    }

    type PredictionWithContext = Awaited<ReturnType<typeof predictPlayerProp>> & {
      game_db_id: number;
      player_db_id: number;
    };
    const predictions: PredictionWithContext[] = [];
    let skipped = 0;

    for (const lines of propGroups.values()) {
      const first = lines[0]!;
      const gameDbId = gameIdByExternal.get(first.game_external_id);
      if (!gameDbId) { skipped++; continue; }
      const gameRow = gameById.get(gameDbId);
      if (!gameRow) { skipped++; continue; }
      const ballparkRow = gameRow.ballpark_id !== null ? ballparks.get(gameRow.home_team_id) : null;
      if (!ballparkRow) { skipped++; continue; }
      const weather = weatherByGameId.get(gameDbId);
      if (!weather) { skipped++; continue; }

      const subjectExtId = first.player_external_id!;
      const subjectPlayer = await getPlayerByExt(subjectExtId);
      if (!subjectPlayer) { skipped++; continue; }

      const isPitcherMkt =
        first.market_type === "pitcher_strikeouts" ||
        first.market_type === "pitcher_earned_runs" ||
        first.market_type === "pitcher_hits_allowed";

      let batter, pitcher;
      if (isPitcherMkt) {
        batter = subjectPlayer;
        pitcher = subjectPlayer;
      } else {
        batter = subjectPlayer;
        const subjectDbId = playerIdByExternal.get(subjectExtId);
        const subjectMeta = subjectDbId !== undefined ? [...playerMeta.values()].find((p) => p.id === subjectDbId) : undefined;
        const isHome = subjectMeta?.team_id === gameRow.home_team_id;
        const opposingPitcherDbId = isHome ? gameRow.away_pitcher_id : gameRow.home_pitcher_id;
        if (opposingPitcherDbId === null) { skipped++; continue; }
        const oppExtEntry = [...playerIdByExternal.entries()].find(([_, dbId]) => dbId === opposingPitcherDbId);
        if (!oppExtEntry) { skipped++; continue; }
        const oppPlayer = await getPlayerByExt(oppExtEntry[0]);
        if (!oppPlayer) { skipped++; continue; }
        pitcher = oppPlayer;
      }

      const batterStats = isPitcherMkt ? [] : await getSeasons(subjectExtId);
      const batterSplits = isPitcherMkt ? [] : await getSplits(subjectExtId);
      const batterPitchStats = isPitcherMkt ? [] : await getHitterPitch(subjectExtId);
      const pitcherStats = await getSeasons(pitcher.external_id);
      const pitcherPitchStats = await getPitcherPitch(pitcher.external_id);

      // Lineup lookup
      let lineupPosition: number | null = null;
      let isLineupConfirmed = false;
      let isDH = false;
      if (!isPitcherMkt) {
        const subjectDbId = playerIdByExternal.get(subjectExtId);
        const lineup = subjectDbId !== undefined ? lineupByKey.get(`${gameDbId}::${subjectDbId}`) : null;
        if (lineup) {
          lineupPosition = lineup.batting_position;
          isLineupConfirmed = lineup.is_confirmed;
          isDH = lineup.is_dh;
        }
      }

      const ballparkContext: BallparkContext = {
        park_factor_runs: 100, park_factor_hr: 100, park_factor_hits: 100,
        park_factor_so: null, park_factor_handedness_lhh: null, park_factor_handedness_rhh: null,
      };
      // Fetch actual park factors from DB
      const { data: parkRow } = await supabase
        .from("ballparks")
        .select("park_factor_runs, park_factor_hr, park_factor_hits, park_factor_so, park_factor_handedness_lhh, park_factor_handedness_rhh")
        .eq("id", ballparkRow.id)
        .single();
      if (parkRow) Object.assign(ballparkContext, parkRow);

      const input: PropPredictionInput = {
        market: first.market_type as PropMarketType,
        line: first.line_value ?? 0,
        batter,
        pitcher,
        ballpark: ballparkContext,
        weather,
        lineupPosition,
        isLineupConfirmed,
        isDH,
        batterSeasonStats: batterStats,
        batterSplits,
        batterPitchStats,
        pitcherSeasonStats: pitcherStats,
        pitcherPitchStats,
        offeredLines: lines,
        currentSeason: 2026,
      };
      const result = predictPlayerProp(input);
      predictions.push({
        ...result,
        game_db_id: gameDbId,
        player_db_id: playerIdByExternal.get(subjectExtId)!,
      });
    }

    // Persist: clear existing prop_predictions for tonight's games.
    // prediction_results FK to prop_predictions has no CASCADE — if results
    // already reference tonight's predictions (rare: only happens after a
    // mid-day re-run AFTER outcomes resolved), we have to delete the
    // referencing result rows first. In the normal cron flow predictions
    // refresh BEFORE outcomes resolve so there's nothing to clean up.
    const { data: tonightPropIds } = await supabase
      .from("prop_predictions")
      .select("id")
      .in("game_id", gameIds);
    const propIdList = ((tonightPropIds ?? []) as { id: number }[]).map((r) => r.id);
    if (propIdList.length > 0) {
      const { error: resDelErr } = await supabase
        .from("prediction_results")
        .delete()
        .in("prop_prediction_id", propIdList);
      if (resDelErr) {
        throw new Error(`prediction_results scope-delete failed: ${resDelErr.message}`);
      }
    }
    const { error: delErr } = await supabase
      .from("prop_predictions")
      .delete()
      .in("game_id", gameIds);
    if (delErr) {
      throw new Error(`prop_predictions delete failed: ${delErr.message}`);
    }

    if (predictions.length === 0) {
      return { records_updated: 0, api_calls_made: apiCalls, details: { skipped } };
    }

    const propRows = predictions.map((p) => ({
      game_id: p.game_db_id,
      player_id: p.player_db_id,
      prop_market: p.prop_market,
      prop_line: p.prop_line,
      model_probability: p.model_probability,
      fair_probability: p.fair_probability,
      edge_pct: p.edge_pct,
      confidence_score: p.confidence_score,
      confidence_stars: p.confidence_stars,
      tier: p.tier,
      best_sportsbook: p.best_sportsbook,
      best_odds_american: p.best_odds_american,
      ev_pct: p.ev_pct,
      reasoning: p.reasoning,
      caveat: p.caveat,
      bet_odds_american: p.bet_odds_american,
      model_version: "daniels-v3.2",
      computed_at: new Date().toISOString(),
    }));

    const { data: inserted, error: insErr } = await supabase
      .from("prop_predictions")
      .insert(propRows)
      .select("id");
    if (insErr) {
      throw new Error(`prop_predictions insert failed: ${insErr.message}`);
    }
    const insertedRows = (inserted ?? []) as { id: number }[];

    const breakdownRows = predictions.map((p, i) => ({
      prop_prediction_id: insertedRows[i]!.id,
      marcel_base_rate: p.breakdown.marcel_base_rate,
      matchup_log5_rate: p.breakdown.matchup_log5_rate,
      park_adjustment: p.breakdown.park_adjustment,
      weather_adjustment: p.breakdown.weather_adjustment,
      platoon_adjustment: p.breakdown.platoon_adjustment,
      recency_adjustment: p.breakdown.recency_adjustment,
      expected_plate_appearances: p.breakdown.expected_plate_appearances,
      lineup_position: p.breakdown.lineup_position,
      reliability_score: p.breakdown.reliability_score,
      lineup_confirmation_score: p.breakdown.lineup_confirmation_score,
      weather_certainty_score: p.breakdown.weather_certainty_score,
      workload_certainty_score: p.breakdown.workload_certainty_score,
      market_liquidity_score: p.breakdown.market_liquidity_score,
      calibration_score: p.breakdown.calibration_score,
    }));
    const { error: bdErr } = await supabase
      .from("prediction_breakdowns")
      .insert(breakdownRows);
    if (bdErr) {
      throw new Error(`prediction_breakdowns insert failed: ${bdErr.message}`);
    }

    // 5F.2: derive + persist signals for the inserted props. Runs as a
    // separate pass (rather than inline) so predictionService doesn't need
    // to plumb the full context assembly that signalDerivationService
    // already does over the slate's joined DB state. Idempotent.
    let signalCounts: Record<string, number> = {};
    try {
      const sigResult = await signalDerivationService.updateSignalsForSlate(sport, date);
      signalCounts = sigResult.signalCounts;
    } catch (e) {
      // Don't fail the whole prediction run on signal-derivation issues —
      // props are already persisted and useful without the chips populated.
      console.error("signal derivation failed:", (e as Error).message);
    }

    // Tier distribution for caller diagnostics
    const tierCounts = predictions.reduce<Record<string, number>>((acc, p) => {
      acc[p.tier] = (acc[p.tier] ?? 0) + 1;
      return acc;
    }, {});

    return {
      records_updated: predictions.length,
      api_calls_made: apiCalls,
      details: { tier_counts: tierCounts, skipped, signal_counts: signalCounts },
    };
  },

  // regenerateSharpVerdicts removed in Fix 4.1 (Gap-18+19).
  // The legacy sharpSignalEvaluator + verdictGenerator pipeline was deleted;
  // signal_strength + signal_summary are no longer cron-written to the
  // sharp_signals table. The DB columns are orphaned post-Fix-4.1 and a
  // future V15 migration drops them. signalSummaryGenerator now produces
  // member-facing text at API response time per the K1 architecture.
};

// Silence unused-import lint for the weather provider (we only use it
// transitively via predictPlayerProp's input — weather is loaded from DB).
void getWeatherProvider;
