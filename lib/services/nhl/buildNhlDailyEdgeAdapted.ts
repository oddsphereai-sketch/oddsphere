/**
 * Phase 7L Phase 3 — NHL Daily Edge pipeline + adapter entry.
 *
 * Single entry point that the /api/lab/daily-edge route's NHL branch
 * calls. Reads all NHL data for the slate, runs the v0 model per game,
 * and returns a DailyEdgeResponse-shaped object the shell can render.
 *
 * Read-only — no DB writes. Pure pipeline.
 */

import { supabase } from "../../db/supabase";
import { buildNhlFeatureSnapshot } from "./featureSnapshot";
import { nhlAutoModelV0 } from "../../automodel/nhlAutoModelV0";
import {
  adaptNhlGameToDto,
  buildNhlDailyEdgeResponse,
  type NhlAdapterGameInput,
} from "./adaptNhlToDailyEdgeResponse";
import { moneyPuckSeasonStartYear } from "../../providers/nhl/_moneyPuckClient";
import type { DailyEdgeResponse } from "../../../app/lab/lib/labTypes";

export async function buildNhlDailyEdgeAdapted(date: string): Promise<DailyEdgeResponse> {
  const season = moneyPuckSeasonStartYear(new Date());

  // Load games on this slate.
  const { data: gamesData, error: gamesErr } = await supabase
    .from("games")
    .select("id, external_id, home_team_id, away_team_id, game_date, status, home_score, away_score")
    .eq("sport", "nhl")
    .eq("slate_date", date);
  if (gamesErr) throw new Error(`NHL games load: ${gamesErr.message}`);
  const games = (gamesData ?? []) as Array<{
    id: number;
    external_id: number;
    home_team_id: number | null;
    away_team_id: number | null;
    game_date: string;
    status: string;
    home_score: number | null;
    away_score: number | null;
  }>;

  if (games.length === 0) {
    return buildNhlDailyEdgeResponse({ date, requestedDate: date, games: [] });
  }

  // Load teams for the games.
  const teamIds = new Set<number>();
  for (const g of games) {
    if (g.home_team_id !== null) teamIds.add(g.home_team_id);
    if (g.away_team_id !== null) teamIds.add(g.away_team_id);
  }
  const { data: teamsData } = await supabase
    .from("teams")
    .select("id, abbreviation")
    .in("id", [...teamIds]);
  const teamById = new Map<number, { id: number; abbreviation: string }>(
    ((teamsData ?? []) as Array<{ id: number; abbreviation: string }>).map((t) => [t.id, t]),
  );

  // For lock state, look up any existing prediction_records.
  const { data: recordsData } = await supabase
    .from("prediction_records")
    .select("game_id, locked_at")
    .eq("sport", "nhl")
    .in("game_id", games.map((g) => g.id));
  const lockedByGame = new Map<number, string | null>();
  for (const r of ((recordsData ?? []) as Array<{ game_id: number; locked_at: string | null }>)) {
    const existing = lockedByGame.get(r.game_id);
    // Prefer non-null locked_at over null when multiple rows exist for a game.
    if (existing === undefined || (existing === null && r.locked_at !== null)) {
      lockedByGame.set(r.game_id, r.locked_at);
    }
  }

  // Per-game pipeline.
  const dtos = [];
  for (const g of games) {
    const homeAbbr = g.home_team_id !== null ? teamById.get(g.home_team_id)?.abbreviation ?? "?" : "?";
    const awayAbbr = g.away_team_id !== null ? teamById.get(g.away_team_id)?.abbreviation ?? "?" : "?";
    try {
      const { snapshot } = await buildNhlFeatureSnapshot({ gameId: g.id, season });
      const model = nhlAutoModelV0(snapshot);

      // Pull lines once for ML + Total best price on the picked side.
      const { data: linesData } = await supabase
        .from("lines")
        .select("market_type, sportsbook, side, line_value, odds_american")
        .eq("game_id", g.id)
        .is("player_id", null)
        .in("market_type", ["moneyline", "total"]);
      const lines = ((linesData ?? []) as Array<{
        market_type: string; sportsbook: string; side: string;
        line_value: number | null; odds_american: number | null;
      }>);

      const mlPickIsHome = model.moneyline.pick.startsWith(homeAbbr);
      const mlSide = mlPickIsHome ? "home" : "away";
      const mlPrices = lines
        .filter((l) => l.market_type === "moneyline" && l.side === mlSide)
        .map((l) => l.odds_american)
        .filter((x): x is number => x !== null);
      const mlPriceAmerican = mlPrices.length > 0
        ? mlPrices.reduce((best, p) => p > best ? p : best, -Infinity)
        : null;

      const totalSide = model.total.pick.startsWith("OVER") ? "over" : "under";
      const totalLineEntries = lines.filter((l) => l.market_type === "total" && l.side === totalSide);
      const totalPrices = totalLineEntries.map((l) => l.odds_american).filter((x): x is number => x !== null);
      const totalPriceAmerican = totalPrices.length > 0
        ? totalPrices.reduce((best, p) => p > best ? p : best, -Infinity)
        : null;
      const marketTotalLine = totalLineEntries.find((l) => l.line_value !== null)?.line_value ?? null;

      const input: NhlAdapterGameInput = {
        gameId: g.id,
        externalId: g.external_id,
        homeAbbr,
        awayAbbr,
        gameDateIso: g.game_date,
        status: g.status,
        homeScore: g.home_score,
        awayScore: g.away_score,
        model,
        snapshot,
        mlPriceAmerican,
        totalPriceAmerican,
        marketTotalLine,
        lockedAt: lockedByGame.get(g.id) ?? null,
      };
      dtos.push(adaptNhlGameToDto(input));
    } catch (e) {
      console.warn(`nhl daily-edge: game ${g.id} failed: ${(e as Error).message}`);
    }
  }

  return buildNhlDailyEdgeResponse({ date, requestedDate: date, games: dtos });
}
