/**
 * GET /api/admin/teams?sport=mlb
 *
 * Fix 7.2 — read-only admin endpoint listing teams for the chosen sport so
 * the manual slate UI can populate its home/away team dropdowns. Returns
 * empty array for sports without seeded teams (Flag H1 multi-sport empty
 * state — the UI uses this to render the "no teams seeded for {sport}"
 * hint pointing at Fix 7.2.1).
 *
 * Auth: admin email allowlist + token (matches /api/admin/games + /api/admin/upload-scores-model).
 */

import { supabase } from "@/lib/db/supabase";
import { validateAdminAuth } from "@/lib/auth/admin";
import type { Sport } from "@/lib/types/domain/Sport";

const VALID_SPORTS: ReadonlySet<Sport> = new Set([
  "mlb",
  "nba",
  "nfl",
  "cbb",
  "cfb",
  "nhl",
  "ucl",
]);

export async function GET(request: Request) {
  const auth = validateAdminAuth(request);
  if (!auth.ok) return auth.response;

  const url = new URL(request.url);
  const sport = url.searchParams.get("sport");
  if (!sport) {
    return Response.json(
      { error: "Required query parameter: sport" },
      { status: 400 }
    );
  }
  if (!VALID_SPORTS.has(sport as Sport)) {
    return Response.json(
      { error: `Unknown sport '${sport}'. Valid: mlb, nba, nfl, cbb, cfb, nhl, ucl` },
      { status: 400 }
    );
  }

  const { data, error } = await supabase
    .from("teams")
    .select("external_id, abbreviation, display_name, location, league, division")
    .eq("sport", sport)
    .order("abbreviation", { ascending: true });
  if (error) {
    return Response.json(
      { error: `Team lookup failed: ${error.message}` },
      { status: 500 }
    );
  }

  return Response.json({
    sport,
    count: (data ?? []).length,
    teams: data ?? [],
  });
}
