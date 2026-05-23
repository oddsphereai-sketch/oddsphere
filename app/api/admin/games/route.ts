/**
 * GET /api/admin/games?sport=mlb&date=2026-05-22
 *
 * Returns tonight's slate for the admin scores-model upload UI. The UI uses
 * this to pre-populate the form with team names + game IDs so Daniel can
 * never mis-match a row (zero text-matching ambiguity).
 *
 * Auth: admin allowlist (validateAdminAuth).
 */

import { supabase } from "@/lib/db/supabase";
import { validateAdminAuth } from "@/lib/auth/admin";
import type { Sport } from "@/lib/types/domain/Sport";

export async function GET(request: Request) {
  const auth = validateAdminAuth(request);
  if (!auth.ok) return auth.response;

  const url = new URL(request.url);
  const sport = url.searchParams.get("sport") as Sport | null;
  const date = url.searchParams.get("date");

  if (!sport || !date) {
    return Response.json(
      { error: "Required query params: sport, date (YYYY-MM-DD)" },
      { status: 400 }
    );
  }
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
    return Response.json(
      { error: "Invalid date format; expected YYYY-MM-DD" },
      { status: 400 }
    );
  }

  // Slate-date convention: games starting before 06:00 UTC on date+1 belong
  // to `date`'s slate (Pacific evening start). Widen the window accordingly.
  const startOfDay = `${date}T00:00:00.000Z`;
  const next = new Date(`${date}T00:00:00.000Z`);
  next.setUTCDate(next.getUTCDate() + 1);
  next.setUTCHours(6, 0, 0, 0);
  const endOfSlate = next.toISOString();

  const { data, error } = await supabase
    .from("games")
    .select(
      "external_id, game_date, status, home_team:home_team_id (abbreviation, display_name), away_team:away_team_id (abbreviation, display_name)"
    )
    .eq("sport", sport)
    .gte("game_date", startOfDay)
    .lt("game_date", endOfSlate)
    .order("game_date", { ascending: true });

  if (error) {
    return Response.json({ error: error.message }, { status: 500 });
  }

  // Supabase's typegen renders FK expansions as arrays; the runtime returns
  // a single object for to-one relationships.
  const games = ((data ?? []) as unknown as Array<{
    external_id: number;
    game_date: string;
    status: string;
    home_team: { abbreviation: string; display_name: string } | null;
    away_team: { abbreviation: string; display_name: string } | null;
  }>).map((g) => ({
    external_id: g.external_id,
    game_date: g.game_date,
    status: g.status,
    home_team: g.home_team ?? { abbreviation: "—", display_name: "—" },
    away_team: g.away_team ?? { abbreviation: "—", display_name: "—" },
  }));

  return Response.json({ sport, date, games });
}
