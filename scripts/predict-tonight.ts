/**
 * scripts/predict-tonight.ts — run the prop model orchestrator against
 * tonight's slate, write predictions to Supabase, verify outputs.
 *
 * Run with: npm run predict
 *
 * Pipeline:
 *   1. Load tonight's games + build external_id → DB id maps
 *   2. For each unique prop opportunity (group lines by game+player+market+line):
 *        — Gather all context (player, pitcher, park, weather, lineup, stats)
 *        — Call predictPlayerProp(input)
 *   3. Delete any stale prop_predictions for tonight's games (idempotency)
 *   4. Bulk insert prop_predictions (surfaced tiers only: good/strong/premium)
 *   5. Bulk insert prediction_breakdowns referencing prop_predictions.id
 *   6. Verify: tier distribution + Aaron Judge spot-check
 */

import { supabase } from "../lib/db/supabase";
import {
  getBettingProvider,
  getStatsProvider,
} from "../lib/providers/factory";
import { predictPlayerProp } from "../lib/models/props/propModelOrchestrator";
import type {
  BallparkContext,
  WeatherContext,
} from "../lib/models/props/propModelOrchestrator";
import type {
  HitterPitchRecord,
  PitcherPitchRecord,
  StatsPlayerRecord,
  StatsSeasonRecord,
  StatsSplitRecord,
} from "../lib/providers/interfaces/IStatsProvider";
import type { LineRecord } from "../lib/providers/interfaces/IBettingProvider";
import type { PropMarketType, Sportsbook } from "../lib/types/domain/Lines";
import type { WindRelative } from "../lib/models/props/contextAdjustments";

const SLATE_DATE = "2026-05-22";
const SEASON = 2026;

// ─── Helpers ──────────────────────────────────────────────────────────────
async function ensureOrThrow<T>(
  promise: PromiseLike<{ data: T | null; error: { message: string } | null }>
): Promise<T> {
  const { data, error } = await promise;
  if (error) throw new Error(error.message);
  if (data === null) throw new Error("Query returned null data");
  return data;
}

function logSection(title: string) {
  console.log(`\n${"─".repeat(70)}\n${title}\n${"─".repeat(70)}`);
}

// ─── Load tonight's slate from Supabase + build resolution maps ──────────
type GameRow = {
  id: number;
  external_id: number;
  home_team_id: number;
  away_team_id: number;
  home_pitcher_id: number;
  away_pitcher_id: number;
  ballpark_id: number;
  game_date: string;
};

async function loadSlate(): Promise<GameRow[]> {
  // Tonight's games are external_id 18599100-18599111
  const games = await ensureOrThrow(
    supabase
      .from("games")
      .select(
        "id, external_id, home_team_id, away_team_id, home_pitcher_id, away_pitcher_id, ballpark_id, game_date"
      )
      .gte("external_id", 18599100)
      .lte("external_id", 18599111)
  );
  return games as GameRow[];
}

async function loadPlayerIdMap(): Promise<Map<number, number>> {
  const players = await ensureOrThrow(
    supabase.from("players").select("id, external_id")
  );
  return new Map<number, number>(
    (players as { id: number; external_id: number }[]).map((p) => [
      p.external_id,
      p.id,
    ])
  );
}

async function loadBallparkContexts(
  ballparkIds: number[]
): Promise<Map<number, BallparkContext>> {
  const parks = await ensureOrThrow(
    supabase
      .from("ballparks")
      .select(
        "id, park_factor_runs, park_factor_hr, park_factor_hits, park_factor_so, park_factor_handedness_lhh, park_factor_handedness_rhh"
      )
      .in("id", ballparkIds)
  );
  return new Map<number, BallparkContext>(
    (parks as Array<{ id: number } & BallparkContext>).map((p) => [
      p.id,
      {
        park_factor_runs: p.park_factor_runs,
        park_factor_hr: p.park_factor_hr,
        park_factor_hits: p.park_factor_hits,
        park_factor_so: p.park_factor_so,
        park_factor_handedness_lhh: p.park_factor_handedness_lhh,
        park_factor_handedness_rhh: p.park_factor_handedness_rhh,
      },
    ])
  );
}

async function loadWeatherByGameId(
  gameIds: number[]
): Promise<Map<number, WeatherContext>> {
  const rows = await ensureOrThrow(
    supabase
      .from("weather_forecasts")
      .select("game_id, wind_speed_mph, wind_direction_relative, temperature_f")
      .in("game_id", gameIds)
  );
  return new Map<number, WeatherContext>(
    (
      rows as Array<{
        game_id: number;
        wind_speed_mph: number;
        wind_direction_relative: string | null;
        temperature_f: number;
      }>
    ).map((r) => [
      r.game_id,
      {
        wind_speed_mph: r.wind_speed_mph,
        wind_direction_relative: r.wind_direction_relative as WindRelative,
        temperature_f: r.temperature_f,
      },
    ])
  );
}

type LineupRow = {
  game_id: number;
  player_id: number;
  batting_position: number | null;
  starting_position: string | null;
  is_confirmed: boolean;
  is_dh: boolean;
};

async function loadLineupsByGame(
  gameIds: number[]
): Promise<Map<string, LineupRow>> {
  const rows = await ensureOrThrow(
    supabase
      .from("lineups")
      .select(
        "game_id, player_id, batting_position, starting_position, is_confirmed, is_dh"
      )
      .in("game_id", gameIds)
  );
  return new Map<string, LineupRow>(
    (rows as LineupRow[]).map((r) => [`${r.game_id}::${r.player_id}`, r])
  );
}

// ─── Main ─────────────────────────────────────────────────────────────────
async function main() {
  console.log(`Predict-tonight · slate ${SLATE_DATE}\n`);
  const startedAt = Date.now();

  const stats = getStatsProvider();
  const betting = getBettingProvider();

  // ── 1. Load DB resolution maps ──────────────────────────────────────────
  logSection("Stage 1 · load slate + resolution maps");
  const slate = await loadSlate();
  console.log(`  loaded ${slate.length} games for tonight`);
  const gameByExtId = new Map(slate.map((g) => [g.external_id, g]));

  const playerByExtId = await loadPlayerIdMap();
  console.log(`  loaded ${playerByExtId.size} players in DB`);

  const gameIds = slate.map((g) => g.id);
  const ballparkIds = [...new Set(slate.map((g) => g.ballpark_id))];

  const parkById = await loadBallparkContexts(ballparkIds);
  console.log(`  loaded ${parkById.size} ballparks`);

  const weatherById = await loadWeatherByGameId(gameIds);
  console.log(`  loaded ${weatherById.size} weather forecasts`);

  const lineupByGamePlayer = await loadLineupsByGame(gameIds);
  console.log(`  loaded ${lineupByGamePlayer.size} lineup entries`);

  // ── 2. Get prop lines from the betting provider ─────────────────────────
  logSection("Stage 2 · load prop lines + group by unique opportunity");
  const allPropLines = await betting.getPlayerProps(SLATE_DATE, "mlb");
  console.log(`  loaded ${allPropLines.length} prop-line records`);

  // Group by (game, player, market, line)
  type PropKey = string;
  const propGroups = new Map<PropKey, LineRecord[]>();
  for (const line of allPropLines) {
    if (line.player_external_id === null) continue;
    const key = `${line.game_external_id}::${line.player_external_id}::${line.market_type}::${line.line_value}`;
    const arr = propGroups.get(key) ?? [];
    arr.push(line);
    propGroups.set(key, arr);
  }
  console.log(`  grouped into ${propGroups.size} unique props`);

  // ── 3. Run orchestrator per prop ────────────────────────────────────────
  logSection("Stage 3 · run propModelOrchestrator per opportunity");

  // Pre-fetch stats for the unique players appearing in props (and the
  // opposing starting pitchers). Cache to avoid duplicate provider calls.
  const playerCache = new Map<number, StatsPlayerRecord>();
  const seasonStatsCache = new Map<number, StatsSeasonRecord[]>();
  const splitsCache = new Map<number, StatsSplitRecord[]>();
  const pitcherPitchCache = new Map<number, PitcherPitchRecord[]>();
  const hitterPitchCache = new Map<number, HitterPitchRecord[]>();

  async function getPlayer(extId: number): Promise<StatsPlayerRecord | null> {
    if (playerCache.has(extId)) return playerCache.get(extId)!;
    const p = await stats.getPlayer(extId);
    if (p) playerCache.set(extId, p);
    return p;
  }
  async function getSeasonStats(extId: number): Promise<StatsSeasonRecord[]> {
    if (seasonStatsCache.has(extId)) return seasonStatsCache.get(extId)!;
    const s = await stats.getPlayerSeasonStats(extId, [2024, 2025, 2026]);
    seasonStatsCache.set(extId, s);
    return s;
  }
  async function getSplits(extId: number): Promise<StatsSplitRecord[]> {
    if (splitsCache.has(extId)) return splitsCache.get(extId)!;
    const s = await stats.getPlayerSplits(extId, 2025);
    splitsCache.set(extId, s);
    return s;
  }
  async function getPitcherPitch(extId: number): Promise<PitcherPitchRecord[]> {
    if (pitcherPitchCache.has(extId)) return pitcherPitchCache.get(extId)!;
    const s = await stats.getPitcherPitchStats(extId, 2025);
    pitcherPitchCache.set(extId, s);
    return s;
  }
  async function getHitterPitch(extId: number): Promise<HitterPitchRecord[]> {
    if (hitterPitchCache.has(extId)) return hitterPitchCache.get(extId)!;
    const s = await stats.getHitterPitchStats(extId, 2025);
    hitterPitchCache.set(extId, s);
    return s;
  }

  // For each prop, prepare input and call orchestrator
  type PreparedPrediction = Awaited<ReturnType<typeof predictPlayerProp>> & {
    game_external_id: number;
    player_external_id: number;
  };
  const predictions: PreparedPrediction[] = [];
  let skipped = 0;

  for (const [_, lines] of propGroups) {
    const first = lines[0]!;
    const gameExtId = first.game_external_id;
    const playerExtId = first.player_external_id!;
    const market = first.market_type as PropMarketType;
    const line = first.line_value ?? 0;

    const game = gameByExtId.get(gameExtId);
    if (!game) { skipped++; continue; }
    const park = parkById.get(game.ballpark_id);
    if (!park) { skipped++; continue; }
    const weather = weatherById.get(game.id);
    if (!weather) { skipped++; continue; }

    const subjectPlayer = await getPlayer(playerExtId);
    if (!subjectPlayer) { skipped++; continue; }

    // Determine pitcher external id: if the subject is a pitcher, the
    // subject IS the pitcher; otherwise, the opposing team's starter.
    const isPitcherMkt =
      market === "pitcher_strikeouts" ||
      market === "pitcher_earned_runs" ||
      market === "pitcher_hits_allowed";

    let batter: StatsPlayerRecord;
    let pitcher: StatsPlayerRecord;

    if (isPitcherMkt) {
      batter = subjectPlayer;   // not used by pitcher markets
      pitcher = subjectPlayer;
    } else {
      batter = subjectPlayer;
      // Determine which team the batter is on by querying the player's
      // team_id from Supabase and comparing to game.home_team_id.
      const batterDbId = playerByExtId.get(playerExtId)!;
      const { data: playerRow } = await supabase
        .from("players")
        .select("team_id")
        .eq("id", batterDbId)
        .single();
      const isBatterHome = playerRow?.team_id === game.home_team_id;
      const opposingPitcherDbId = isBatterHome
        ? game.away_pitcher_id
        : game.home_pitcher_id;

      // Resolve the opposing pitcher's external_id by reverse lookup
      const oppExtIdEntry = [...playerByExtId.entries()].find(
        ([, dbId]) => dbId === opposingPitcherDbId
      );
      if (!oppExtIdEntry) { skipped++; continue; }
      const oppExtId = oppExtIdEntry[0];
      const oppPitcher = await getPlayer(oppExtId);
      if (!oppPitcher) { skipped++; continue; }
      pitcher = oppPitcher;
    }

    const batterStats = isPitcherMkt ? [] : await getSeasonStats(playerExtId);
    const batterSplits = isPitcherMkt ? [] : await getSplits(playerExtId);
    const batterPitchStats = isPitcherMkt ? [] : await getHitterPitch(playerExtId);

    const pitcherStats = await getSeasonStats(pitcher.external_id);
    const pitcherPitchStats = await getPitcherPitch(pitcher.external_id);

    // Lineup position + confirmation
    let lineupPosition: number | null = null;
    let isLineupConfirmed = false;
    let isDH = false;
    if (!isPitcherMkt) {
      const batterDbId = playerByExtId.get(playerExtId);
      const lineup = batterDbId
        ? lineupByGamePlayer.get(`${game.id}::${batterDbId}`)
        : null;
      if (lineup) {
        lineupPosition = lineup.batting_position;
        isLineupConfirmed = lineup.is_confirmed;
        isDH = lineup.is_dh;
      }
    }

    const result = predictPlayerProp({
      market,
      line,
      batter,
      pitcher,
      ballpark: park,
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
      currentSeason: SEASON,
    });

    predictions.push({
      ...result,
      game_external_id: gameExtId,
      player_external_id: playerExtId,
    });
  }

  console.log(
    `  produced ${predictions.length} predictions · skipped ${skipped}`
  );

  // Tier distribution preview
  const tiers = predictions.reduce<Record<string, number>>((acc, p) => {
    acc[p.tier] = (acc[p.tier] ?? 0) + 1;
    return acc;
  }, {});
  console.log(
    `  tier distribution: PREMIUM ${tiers.premium ?? 0}, STRONG ${tiers.strong ?? 0}, GOOD ${tiers.good ?? 0}, skip ${tiers.skip ?? 0}`
  );

  if (process.env.PREDICT_VERBOSE === "1") {
    console.log("\n  Top-20 by edge_pct (model vs fair):");
    const sorted = [...predictions].sort((a, b) => b.edge_pct - a.edge_pct);
    sorted.slice(0, 20).forEach((p) => {
      const pname = playerCache.get(p.player_external_id)?.full_name ?? `pid:${p.player_external_id}`;
      console.log(
        `    ${pname.padEnd(22)} · ${p.prop_market.padEnd(20)} ${p.prop_line} · model ${p.model_probability.toFixed(3)} vs fair ${p.fair_probability.toFixed(3)} · edge ${p.edge_pct.toFixed(2).padStart(7)}% · ${p.tier}`
      );
    });
  }

  // ── 4. Persist to Supabase ──────────────────────────────────────────────
  logSection("Stage 4 · persist to Supabase");

  // Idempotency: delete existing prop_predictions for tonight's games
  // (CASCADE removes any linked prediction_breakdowns)
  const { error: delErr } = await supabase
    .from("prop_predictions")
    .delete()
    .in("game_id", gameIds);
  if (delErr) throw new Error(`Delete failed: ${delErr.message}`);
  console.log(`  cleared existing prop_predictions for tonight`);

  // Write ALL graded predictions to prop_predictions — tier IS the filter,
  // not write-time gatekeeping. Two modes consume this table:
  //   • Tonight's Best:    WHERE tier IN ('premium','strong','good')
  //   • Search & Filter:   no tier filter (members see our analysis on every prop)
  // Skip-tier rows also feed calibration analysis in Phase 3E (does the
  // 3% threshold correctly separate +EV from -EV picks?).
  const allGraded = predictions;
  console.log(
    `  writing all ${allGraded.length} graded predictions (tier classification at query time)`
  );

  // Insert prop_predictions
  const propRows = allGraded.map((p) => ({
    game_id: gameByExtId.get(p.game_external_id)!.id,
    player_id: playerByExtId.get(p.player_external_id)!,
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

  const insertedProps = await ensureOrThrow(
    supabase.from("prop_predictions").insert(propRows).select("id")
  );
  console.log(`  inserted ${(insertedProps as { id: number }[]).length} prop_predictions rows`);

  // Insert prediction_breakdowns referencing the inserted prop_predictions
  const breakdownRows = allGraded.map((p, i) => ({
    prop_prediction_id: (insertedProps as { id: number }[])[i]!.id,
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
  const insertedBd = await ensureOrThrow(
    supabase.from("prediction_breakdowns").insert(breakdownRows).select("id")
  );
  console.log(
    `  inserted ${(insertedBd as { id: number }[]).length} prediction_breakdowns rows`
  );

  // ── 5. Verify ───────────────────────────────────────────────────────────
  logSection("Stage 5 · verification");

  // Tier counts from DB — all graded rows
  const { data: tierRows } = await supabase
    .from("prop_predictions")
    .select("tier")
    .in("game_id", gameIds);
  const tierCounts = (tierRows ?? []).reduce<Record<string, number>>(
    (acc, r) => {
      acc[r.tier] = (acc[r.tier] ?? 0) + 1;
      return acc;
    },
    {}
  );
  const surfacedCount =
    (tierCounts.premium ?? 0) + (tierCounts.strong ?? 0) + (tierCounts.good ?? 0);
  console.log(
    `  DB tier distribution: PREMIUM ${tierCounts.premium ?? 0}, STRONG ${tierCounts.strong ?? 0}, GOOD ${tierCounts.good ?? 0}, skip ${tierCounts.skip ?? 0}`
  );
  console.log(
    `    Tonight's Best mode → ${surfacedCount} surfaced cards`
  );
  console.log(
    `    Search & Filter mode → ${(tierRows ?? []).length} props visible`
  );

  // Sanity: tier ↔ edge_pct alignment
  const { data: tierBounds } = await supabase
    .from("prop_predictions")
    .select("tier, edge_pct")
    .in("game_id", gameIds);
  if (tierBounds) {
    const stats: Record<string, { min: number; max: number; n: number }> = {};
    for (const r of tierBounds) {
      const t = r.tier;
      if (!stats[t]) stats[t] = { min: Infinity, max: -Infinity, n: 0 };
      stats[t].min = Math.min(stats[t].min, r.edge_pct);
      stats[t].max = Math.max(stats[t].max, r.edge_pct);
      stats[t].n++;
    }
    Object.entries(stats).forEach(([tier, s]) => {
      console.log(
        `    ${tier.padEnd(8)} · n=${s.n} · edge range [${s.min.toFixed(2)}, ${s.max.toFixed(2)}]`
      );
    });
  }

  // Aaron Judge over 1.5 hits
  const judgePlayerId = playerByExtId.get(592450);
  const judgeGameId = gameByExtId.get(18599100)!.id;
  if (judgePlayerId) {
    const { data: judgePred } = await supabase
      .from("prop_predictions")
      .select(
        "prop_market, prop_line, model_probability, fair_probability, edge_pct, tier, confidence_score, best_sportsbook, best_odds_american, ev_pct, reasoning, caveat"
      )
      .eq("game_id", judgeGameId)
      .eq("player_id", judgePlayerId);
    console.log(`  Aaron Judge predictions for tonight:`);
    (judgePred ?? []).forEach((p) => {
      const cav = p.caveat ? ` · "${p.caveat.slice(0, 50)}..."` : "";
      console.log(
        `    • ${p.prop_market} over ${p.prop_line}: model ${p.model_probability} / fair ${p.fair_probability} · edge ${p.edge_pct}% · ${p.tier.toUpperCase()} · conf ${p.confidence_score} · ${p.best_sportsbook} ${(p.best_odds_american ?? 0) > 0 ? "+" : ""}${p.best_odds_american}${cav}`
      );
      console.log(`      reasoning: ${p.reasoning}`);
    });
  }

  // Verify FK integrity — every breakdown points to a real prop_prediction
  const { count: orphanCount } = await supabase
    .from("prediction_breakdowns")
    .select("*", { count: "exact", head: true })
    .is("prop_prediction_id", null);
  console.log(
    `  orphan breakdowns (prop_prediction_id IS NULL): ${orphanCount ?? 0} (expected 0)`
  );

  const elapsed = ((Date.now() - startedAt) / 1000).toFixed(1);
  console.log(`\n✅ predict-tonight complete · ${elapsed}s total\n`);
}

main().catch((e) => {
  console.error("\n❌ predict-tonight failed:", e.message);
  if (e.stack) console.error(e.stack);
  process.exit(1);
});
