/**
 * POST /api/admin/upload-slate — Fix 7.2 manual slate ingestion.
 *
 * Body: { sport, slate_date, games: [{home_team_abbrev, away_team_abbrev,
 *   game_date, season, season_type?, venue?, notes?}, ...] }
 *
 * Flow:
 *   1. Validate admin auth (email allowlist + token).
 *   2. Validate body shape + sport + date format.
 *   3. Validate every team abbreviation exists in `teams` for the chosen
 *      sport — Flag B1 (no auto-create). Unknown abbrevs return 400 with
 *      a structured `unknown_teams` list so the UI can highlight them.
 *   4. INSERT one row into manual_slate_staging (status='pending').
 *   5. Instantiate `new ManualSlateProvider({ stagingRowId })` and pass it
 *      as the providerOverride to `slateService.refreshGames` — concurrent-
 *      request safe; never touches process.env (Flag E1 / Option 2).
 *   6. UPDATE the staging row with status='ingested' (or 'failed') and
 *      the ingest_result JSON.
 *   7. Return { staging_id, records_updated, skipped, source_type? },
 *      mirroring the scores-model upload route's audit-friendly envelope.
 *
 * Out of scope (intentionally): scores-model predictions (still go through
 * /api/admin/upload-scores-model), player props (auto-generated from
 * propModelOrchestrator when inputs land), sharp signals (Phase 8).
 */

import { supabase } from "@/lib/db/supabase";
import { validateAdminAuth } from "@/lib/auth/admin";
import { slateService } from "@/lib/services/slateService";
import {
  ManualSlateProvider,
  type ManualSlateGameInput,
} from "@/lib/providers/manual/ManualSlateProvider";
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

type RequestBody = {
  sport?: string;
  slate_date?: string;
  games?: ManualSlateGameInput[];
};

function isIsoDate(s: string): boolean {
  return /^\d{4}-\d{2}-\d{2}$/.test(s);
}

function isIsoTimestamp(s: string): boolean {
  // Accept ISO 8601 with milliseconds or seconds, with Z or offset.
  return /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?(Z|[+-]\d{2}:?\d{2})$/.test(s);
}

export async function POST(request: Request) {
  const auth = validateAdminAuth(request);
  if (!auth.ok) return auth.response;

  let body: RequestBody;
  try {
    body = (await request.json()) as RequestBody;
  } catch {
    return Response.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  // ─── 1. Body shape validation ──────────────────────────────────────────
  const sport = body.sport;
  const slate_date = body.slate_date;
  const games = body.games;

  if (!sport || !slate_date || !Array.isArray(games)) {
    return Response.json(
      {
        error:
          "Required body fields: sport (one of mlb/nba/nfl/cbb/cfb/nhl/ucl), slate_date (YYYY-MM-DD), games[] (array)",
      },
      { status: 400 }
    );
  }
  if (!VALID_SPORTS.has(sport as Sport)) {
    return Response.json(
      {
        error: `Unknown sport '${sport}'. Valid: mlb, nba, nfl, cbb, cfb, nhl, ucl`,
      },
      { status: 400 }
    );
  }
  if (!isIsoDate(slate_date)) {
    return Response.json(
      { error: `slate_date must be YYYY-MM-DD (got '${slate_date}')` },
      { status: 400 }
    );
  }
  if (games.length === 0) {
    return Response.json(
      { error: "games[] must contain at least one game" },
      { status: 400 }
    );
  }

  // Per-game shape validation
  const shapeErrors: Array<{ index: number; errors: string[] }> = [];
  for (let i = 0; i < games.length; i++) {
    const g = games[i]!;
    const errs: string[] = [];
    if (typeof g.home_team_abbrev !== "string" || !g.home_team_abbrev) {
      errs.push("home_team_abbrev is required (string)");
    }
    if (typeof g.away_team_abbrev !== "string" || !g.away_team_abbrev) {
      errs.push("away_team_abbrev is required (string)");
    }
    if (typeof g.game_date !== "string" || !isIsoTimestamp(g.game_date)) {
      errs.push("game_date must be an ISO 8601 timestamp");
    }
    if (typeof g.season !== "number" || !Number.isInteger(g.season)) {
      errs.push("season must be an integer");
    }
    if (
      g.home_team_abbrev &&
      g.away_team_abbrev &&
      g.home_team_abbrev === g.away_team_abbrev
    ) {
      errs.push("home_team_abbrev and away_team_abbrev must differ");
    }
    if (errs.length > 0) shapeErrors.push({ index: i, errors: errs });
  }
  if (shapeErrors.length > 0) {
    return Response.json(
      { error: "Invalid game(s)", details: shapeErrors },
      { status: 400 }
    );
  }

  // ─── 2. Team abbreviation resolution (Flag B1) ─────────────────────────
  const requestedAbbrevs = new Set<string>();
  for (const g of games) {
    requestedAbbrevs.add(g.home_team_abbrev);
    requestedAbbrevs.add(g.away_team_abbrev);
  }
  const { data: teamRows, error: teamErr } = await supabase
    .from("teams")
    .select("abbreviation")
    .eq("sport", sport)
    .in("abbreviation", Array.from(requestedAbbrevs));
  if (teamErr) {
    return Response.json(
      { error: `Team lookup failed: ${teamErr.message}` },
      { status: 500 }
    );
  }
  const foundAbbrevs = new Set(
    ((teamRows ?? []) as Array<{ abbreviation: string }>).map(
      (r) => r.abbreviation
    )
  );
  const unknownAbbrevs = Array.from(requestedAbbrevs).filter(
    (a) => !foundAbbrevs.has(a)
  );
  if (unknownAbbrevs.length > 0) {
    // Multi-sport empty state (Flag H1): if zero teams are seeded for this
    // sport, surface that distinctly so the UI can render the right hint.
    const { count: totalForSport } = await supabase
      .from("teams")
      .select("*", { count: "exact", head: true })
      .eq("sport", sport);
    const hint =
      (totalForSport ?? 0) === 0
        ? `No teams seeded for sport='${sport}'. Manual slate uploads require teams to exist first (Fix 7.2.1 will seed the remaining sports).`
        : `Unknown team abbreviation(s) for sport='${sport}'.`;
    return Response.json(
      {
        error: hint,
        unknown_teams: unknownAbbrevs,
        sport,
        teams_seeded_for_sport: totalForSport ?? 0,
      },
      { status: 400 }
    );
  }

  // ─── 3. INSERT staging row ─────────────────────────────────────────────
  const { data: stagingInsert, error: stagingErr } = await supabase
    .from("manual_slate_staging")
    .insert({
      sport,
      slate_date,
      payload: { games },
      status: "pending",
      created_by: auth.email,
    })
    .select("id")
    .single();
  if (stagingErr || !stagingInsert) {
    return Response.json(
      {
        error: `Failed to record staging row: ${stagingErr?.message ?? "unknown"}`,
      },
      { status: 500 }
    );
  }
  const stagingRowId = (stagingInsert as { id: number }).id;

  // ─── 4. Inline refresh via explicit provider override ──────────────────
  // Concurrent-request safe: each request constructs its own provider
  // bound to its own staging row (no shared singleton, no env mutation).
  const provider = new ManualSlateProvider({ stagingRowId });

  try {
    const result = await slateService.refreshGames(
      sport as Sport,
      slate_date,
      provider
    );

    await supabase
      .from("manual_slate_staging")
      .update({
        status: "ingested",
        ingested_at: new Date().toISOString(),
        ingest_result: result,
      })
      .eq("id", stagingRowId);

    return Response.json({
      sport,
      slate_date,
      staging_id: stagingRowId,
      records_updated: result.records_updated,
      api_calls_made: result.api_calls_made,
      details: result.details ?? null,
      source: "manual_slate_upload",
    });
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    await supabase
      .from("manual_slate_staging")
      .update({
        status: "failed",
        ingested_at: new Date().toISOString(),
        ingest_result: { error: message },
      })
      .eq("id", stagingRowId);

    return Response.json(
      {
        error: `Slate refresh failed: ${message}`,
        staging_id: stagingRowId,
      },
      { status: 500 }
    );
  }
}
