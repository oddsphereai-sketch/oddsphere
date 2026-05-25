/**
 * scripts/daily-edge.ts — Phase 4-style chained run of the Daily Edge pipeline.
 *
 *   1. Ingest Daniel's scores-model output (daniels_model.json) into
 *      game_predictions via scoresModelIngester (idempotent UPSERT).
 *   2. Evaluate each sharp_signals row for tonight's slate via
 *      sharpSignalEvaluator and compose brand-voice text via
 *      verdictGenerator. Write OUR signal_strength + signal_summary back
 *      to the sharp_signals table.
 *
 * Run with: npm run daily-edge
 */

import { supabase } from "../lib/db/supabase";
import {
  ingestScoresModel,
  type DanielsModelRow,
} from "../lib/scoresModel/ingester";
import { evaluateSignal } from "../lib/models/dailyEdge/sharpSignalEvaluator";
import { generateVerdictText } from "../lib/models/dailyEdge/verdictGenerator";
import danielsModelJson from "../lib/providers/mock/fixtures/daniels_model.json";
import type { SharpSignalRecord } from "../lib/providers/interfaces/ISharpSignalProvider";

function logSection(title: string) {
  console.log(`\n${"─".repeat(70)}\n${title}\n${"─".repeat(70)}`);
}

async function main() {
  console.log("Daily Edge runner · slate 2026-05-22\n");
  const startedAt = Date.now();

  // ── Stage 1: scores model ingestion ─────────────────────────────────────
  logSection("Stage 1 · ingest Daniel's scores model");

  // Load game_external_id → game_id map for tonight's slate
  const { data: games, error: gErr } = await supabase
    .from("games")
    .select("id, external_id, home_team:home_team_id (abbreviation), away_team:away_team_id (abbreviation)")
    .gte("external_id", 18599100)
    .lte("external_id", 18599111);
  if (gErr) throw new Error(gErr.message);
  if (!games) throw new Error("no games returned");

  const gameIdByExternal = new Map<number, number>(
    games.map((g) => [g.external_id, g.id])
  );
  // Supabase typegen renders FK expansions as arrays; the runtime returns a
  // single object for to-one relationships. Cast through `unknown` to access.
  const gameContextByExtId = new Map<
    number,
    { homeTeamAbbr: string; awayTeamAbbr: string; id: number }
  >(
    games.map((g) => {
      const home = g.home_team as unknown as { abbreviation: string } | null;
      const away = g.away_team as unknown as { abbreviation: string } | null;
      return [
        g.external_id,
        {
          id: g.id,
          homeTeamAbbr: home?.abbreviation ?? "—",
          awayTeamAbbr: away?.abbreviation ?? "—",
        },
      ];
    })
  );

  console.log(`  loaded ${gameIdByExternal.size} games`);

  const rows = danielsModelJson as DanielsModelRow[];
  const result = await ingestScoresModel(supabase, "mlb", rows, gameIdByExternal);
  console.log(`  ingested ${rows.length} rows: ${result.inserted} inserted, ${result.updated} updated, ${result.failed.length} failed`);
  if (result.failed.length > 0) {
    result.failed.forEach((f) =>
      console.log(`    failed game_external_id=${f.row.game_external_id}: ${f.errors.join("; ")}`)
    );
  }

  // Demonstrate idempotency by re-running
  const second = await ingestScoresModel(supabase, "mlb", rows, gameIdByExternal);
  console.log(
    `  re-ingest (idempotency check): ${second.inserted} inserted, ${second.updated} updated, ${second.failed.length} failed`
  );
  if (second.inserted !== 0) {
    throw new Error(
      `Idempotency violated — re-ingest should produce 0 inserts but produced ${second.inserted}`
    );
  }

  // ── Stage 2: sharp signal evaluation + verdict composition ──────────────
  logSection("Stage 2 · evaluate sharp signals + compose verdicts");

  const gameIds = Array.from(gameIdByExternal.values());
  const { data: signals, error: sErr } = await supabase
    .from("sharp_signals")
    .select(
      "id, game_id, market_type, side, pinnacle_fair_probability, is_plus_ev, ev_pct, has_steam_move, steam_detected_at, steam_books_count, has_reverse_line_movement, rlm_direction, public_betting_pct, public_money_pct, computed_at, weather:game_id!inner (weather_forecasts(wind_speed_mph, wind_direction_relative))"
    )
    .in("game_id", gameIds);
  if (sErr) throw new Error(sErr.message);
  if (!signals) throw new Error("no signals returned");
  console.log(`  loaded ${signals.length} signal rows`);

  // Load weather context per game for HR / wind references in verdicts
  const { data: weatherRows } = await supabase
    .from("weather_forecasts")
    .select("game_id, wind_speed_mph, wind_direction_relative")
    .in("game_id", gameIds);
  const weatherByGameId = new Map<
    number,
    { wind_speed_mph: number; wind_direction_relative: string | null }
  >(
    ((weatherRows ?? []) as Array<{
      game_id: number;
      wind_speed_mph: number;
      wind_direction_relative: string | null;
    }>).map((w) => [w.game_id, w])
  );

  // Reverse-map game_id → external_id for context lookup
  const gameIdToCtxExtId = new Map<number, number>(
    Array.from(gameContextByExtId.entries()).map(([extId, ctx]) => [ctx.id, extId])
  );

  const updates: Array<{ id: number; signal_strength: string | null; signal_summary: string | null }> = [];

  for (const raw of signals as Array<{
    id: number;
    game_id: number;
    market_type: string;
    side: string;
    pinnacle_fair_probability: number | null;
    is_plus_ev: boolean;
    ev_pct: number | null;
    has_steam_move: boolean;
    steam_detected_at: string | null;
    steam_books_count: number | null;
    has_reverse_line_movement: boolean;
    rlm_direction: string | null;
    public_betting_pct: number | null;
    public_money_pct: number | null;
    computed_at: string;
  }>) {
    // Coerce to SharpSignalRecord shape (provider Record types)
    const signalRec: SharpSignalRecord = {
      game_external_id: gameIdToCtxExtId.get(raw.game_id) ?? 0,
      market_type: raw.market_type as SharpSignalRecord["market_type"],
      side: raw.side as SharpSignalRecord["side"],
      pinnacle_fair_probability: raw.pinnacle_fair_probability,
      is_plus_ev: raw.is_plus_ev,
      ev_pct: raw.ev_pct,
      has_steam_move: raw.has_steam_move,
      steam_detected_at: raw.steam_detected_at,
      steam_books_count: raw.steam_books_count,
      has_reverse_line_movement: raw.has_reverse_line_movement,
      rlm_direction: raw.rlm_direction,
      public_betting_pct: raw.public_betting_pct,
      public_money_pct: raw.public_money_pct,
      signal_strength: null,
      signal_summary: null,
      computed_at: raw.computed_at,
    };

    const ctxExtId = gameIdToCtxExtId.get(raw.game_id);
    const ctx = ctxExtId !== undefined ? gameContextByExtId.get(ctxExtId) : undefined;
    if (!ctx) {
      console.log(`  skipping signal id=${raw.id}: no game context`);
      continue;
    }

    const weather = weatherByGameId.get(raw.game_id);
    const evalResult = evaluateSignal(signalRec);
    const verdictText = generateVerdictText(evalResult, signalRec, {
      homeTeamAbbr: ctx.homeTeamAbbr,
      awayTeamAbbr: ctx.awayTeamAbbr,
      weatherWindMph: weather?.wind_speed_mph ?? null,
      weatherWindDirRelative: weather?.wind_direction_relative ?? null,
    });

    updates.push({
      id: raw.id,
      signal_strength: evalResult.signalStrength,
      signal_summary: verdictText,
    });
  }

  console.log(`  evaluated ${updates.length} signals`);

  // Per-verdict breakdown
  const counts = updates.reduce<Record<string, number>>((acc, u) => {
    const key = u.signal_strength ?? "neutral";
    acc[key] = (acc[key] ?? 0) + 1;
    return acc;
  }, {});
  console.log(
    `  verdict distribution: STRONG ${counts.strong ?? 0}, CAUTION ${counts.caution ?? 0}, neutral ${counts.neutral ?? 0}`
  );

  // ── Stage 3: persist updated signal_strength + signal_summary ───────────
  logSection("Stage 3 · write evaluated verdicts back to sharp_signals");

  let written = 0;
  for (const u of updates) {
    const { error } = await supabase
      .from("sharp_signals")
      .update({
        signal_strength: u.signal_strength,
        signal_summary: u.signal_summary,
      })
      .eq("id", u.id);
    if (error) {
      console.log(`    update id=${u.id} failed: ${error.message}`);
    } else {
      written++;
    }
  }
  console.log(`  updated ${written} rows`);

  // ── Stage 4: verify + show the composed verdicts ────────────────────────
  logSection("Stage 4 · verify · composed verdicts on tonight's slate");

  const { data: final } = await supabase
    .from("sharp_signals")
    .select(
      "game_id, market_type, side, signal_strength, signal_summary, ev_pct"
    )
    .in("game_id", gameIds)
    .order("signal_strength", { nullsFirst: false });

  (final ?? []).forEach((s) => {
    const gameExtId = gameIdToCtxExtId.get(s.game_id);
    const ctx = gameExtId !== undefined ? gameContextByExtId.get(gameExtId) : null;
    const matchup = ctx ? `${ctx.awayTeamAbbr}@${ctx.homeTeamAbbr}` : `game_id=${s.game_id}`;
    console.log(`  ${matchup} · ${s.market_type} ${s.side} · ${(s.signal_strength ?? "neutral").toUpperCase()}`);
    if (s.signal_summary) console.log(`    "${s.signal_summary}"`);
  });

  const elapsed = ((Date.now() - startedAt) / 1000).toFixed(1);
  console.log(`\n✅ Daily Edge run complete · ${elapsed}s total\n`);
}

main().catch((e) => {
  console.error("\n❌ Daily Edge runner failed:", e.message);
  if (e.stack) console.error(e.stack);
  process.exit(1);
});
