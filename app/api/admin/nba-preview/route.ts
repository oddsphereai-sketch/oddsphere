/**
 * Phase 7A — NBA Finals v0a — admin-only API for the internal preview page.
 *
 * GET /api/admin/nba-preview?date=YYYY-MM-DD
 *
 * Reads NBA games for the requested date from the DB, fetches ESPN
 * injuries (best-effort), runs the pure NBA model, returns a JSON
 * payload suitable for the raw admin grid at /admin/nba-preview.
 *
 * READ-ONLY. No writes, no overrides, no publish. v0a is internal preview
 * only — payload is always flagged provisional.
 *
 * Auth: same `validateAdminAuth` (email + token in headers) as the other
 * admin routes.
 */

import { validateAdminAuth } from "@/lib/auth/admin";
import { buildNbaFeatureSnapshots } from "@/lib/services/nba/featureSnapshot";
import {
  fetchEspnNbaInjuries,
  isInjuryIngestEnabled,
} from "@/lib/services/nba/espnNbaInjuries";
import { runNbaAutoModelV1 } from "@/lib/automodel/nba/nbaAutoModelV1";
import type {
  NbaAutoModelOutput,
  NbaGameSnapshot,
} from "@/lib/automodel/nba/types";

export const dynamic = "force-dynamic";

type AdminGameEntry = {
  game_external_id: number;
  matchup: string;
  away_abbr: string;
  home_abbr: string;
  game_time_iso: string | null;
  snapshot: NbaGameSnapshot;
  prediction: NbaAutoModelOutput;
};

type AdminNbaPreviewResponse = {
  as_of: string;
  sport: "nba";
  slate_date: string;
  provisional: true;
  notice: string;
  injury_ingest_enabled: boolean;
  totals: {
    games_count: number;
    tier_high: number;
    tier_medium: number;
    tier_low: number;
    tier_fallback: number;
  };
  games: AdminGameEntry[];
};

// ─── TEMPORARY PREVIEW-BRANCH AUTH BYPASS ─────────────────────────────
//
// !!!  MUST BE REMOVED BEFORE MERGING nba-v0a -> main  !!!
//
// Phase 7B follow-up: for the operator to review the Game 3 internal
// admin preview without locating their admin token, we bypass
// `validateAdminAuth` ONLY when ALL of these hold:
//
//   1. Running on Vercel (VERCEL=1 set by the platform — guards against
//      a local server accidentally bypassing).
//   2. Vercel environment is "preview" (NOT "production", NOT "development").
//   3. The git branch being previewed is exactly "nba-v0a".
//   4. The request path is the NBA admin preview (this route handler).
//
// Production deployments (main branch) have VERCEL_ENV="production" and
// VERCEL_GIT_COMMIT_REF="main" — neither match. All other preview
// branches (e.g. a hypothetical "fix/something" branch) have a
// different ref — they keep full auth. The bypass is therefore scoped
// to this one branch and this one route.
//
// To remove: delete this block + the page-side bypass in
// app/admin/nba-preview/page.tsx, then verify the route returns 401
// without credentials.
function isPreviewBranchAuthBypassEnabled(): boolean {
  return (
    process.env.VERCEL === "1" &&
    process.env.VERCEL_ENV === "preview" &&
    process.env.VERCEL_GIT_COMMIT_REF === "nba-v0a"
  );
}

export async function GET(request: Request): Promise<Response> {
  if (!isPreviewBranchAuthBypassEnabled()) {
    const auth = validateAdminAuth(request);
    if (!auth.ok) return auth.response;
  }

  const url = new URL(request.url);
  const date = url.searchParams.get("date");
  if (date === null || !/^\d{4}-\d{2}-\d{2}$/.test(date)) {
    return new Response(
      JSON.stringify({ error: "Missing or invalid `date` (expected YYYY-MM-DD)." }),
      { status: 400, headers: { "content-type": "application/json" } },
    );
  }

  try {
    const injuryResolver = async (opts: {
      teamAbbreviation: string;
      teamExternalId: number;
    }) => {
      const result = await fetchEspnNbaInjuries(opts.teamAbbreviation);
      return result === null ? null : result.players;
    };
    const snapshots = await buildNbaFeatureSnapshots(date, { injuryResolver });
    const entries: AdminGameEntry[] = snapshots.map((s) => {
      const pred = runNbaAutoModelV1(s, "t60_locked");
      return {
        game_external_id: s.game_external_id,
        matchup: `${s.away_team.abbreviation} @ ${s.home_team.abbreviation}`,
        away_abbr: s.away_team.abbreviation,
        home_abbr: s.home_team.abbreviation,
        game_time_iso: s.game_time_iso,
        snapshot: s,
        prediction: pred,
      };
    });

    const totals = {
      games_count: entries.length,
      tier_high: 0,
      tier_medium: 0,
      tier_low: 0,
      tier_fallback: 0,
    };
    for (const e of entries) {
      const tier = e.prediction.audit.data_quality_tier;
      if (tier === "high") totals.tier_high += 1;
      else if (tier === "medium") totals.tier_medium += 1;
      else if (tier === "low") totals.tier_low += 1;
      else totals.tier_fallback += 1;
    }

    const body: AdminNbaPreviewResponse = {
      as_of: new Date().toISOString(),
      sport: "nba",
      slate_date: date,
      provisional: true,
      notice:
        "INTERNAL PREVIEW — NBA v0 — PROVISIONAL, NOT MEMBER-FACING. Confidence ceilings + thresholds are v0 placeholders.",
      injury_ingest_enabled: isInjuryIngestEnabled(),
      totals,
      games: entries,
    };
    return new Response(JSON.stringify(body), {
      status: 200,
      headers: { "content-type": "application/json" },
    });
  } catch (e) {
    return new Response(
      JSON.stringify({ error: `nba-preview failed: ${(e as Error).message}` }),
      { status: 500, headers: { "content-type": "application/json" } },
    );
  }
}
