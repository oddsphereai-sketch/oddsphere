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
import { buildNbaFeatureSnapshotsWithProvenance } from "@/lib/services/nba/featureSnapshot";
import {
  fetchEspnNbaInjuries,
  isInjuryIngestEnabled,
} from "@/lib/services/nba/espnNbaInjuries";
import { runNbaAutoModelV1 } from "@/lib/automodel/nba/nbaAutoModelV1";
import { buildGameReview, type GameReview } from "@/lib/services/nba/buildMarketReviewRows";
import { etSlateDateToUtcWindow } from "@/lib/services/nba/etSlateDate";
import { supabase } from "@/lib/db/supabase";
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
  slate_date_et: string;          // Phase 7B v0c — ET-interpreted date
  utc_window: { startISO: string; endISO: string };
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
  /** Phase 7B v0c — per-game market review with line/odds/no-vig/edge/conflict/grade. */
  game_reviews: GameReview[];
  /** Phase 7B v0c — per-market raw lines pulled for each game (book-by-book). */
  raw_lines_by_game: Record<
    number,
    Array<{
      market_type: string;
      sportsbook: string;
      side: string | null;
      line_value: number | null;
      odds_american: number | null;
      updated_at: string | null;
    }>
  >;
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
    // Phase 7B v0c — interpret `date` param as ET slate date and search
    // games within the ET-day UTC window. So `date=2026-06-08` finds
    // tonight's Game 3 even though its UTC game_date is 2026-06-09.
    const etWindow = etSlateDateToUtcWindow(date);
    // The featureSnapshot builder still queries by UTC day internally; we
    // need to pass it a date that spans the ET window. We use the UTC
    // date of the window's MIDPOINT to get a single-day query that covers
    // the bulk of the ET evening; for full safety, the builder caller
    // would ideally accept a UTC window. v0c minimum: pass the UTC date
    // that corresponds to the ET evening (start + 12 hours so tonight's
    // late game is centered).
    const midpointMs =
      (new Date(etWindow.startISO).getTime() +
        new Date(etWindow.endISO).getTime()) /
      2;
    const queryDateUtc = new Date(midpointMs).toISOString().slice(0, 10);

    const injuryResolver = async (opts: {
      teamAbbreviation: string;
      teamExternalId: number;
    }) => {
      const result = await fetchEspnNbaInjuries(opts.teamAbbreviation);
      return result === null ? null : result.players;
    };
    const { snapshots, provenance } =
      await buildNbaFeatureSnapshotsWithProvenance(queryDateUtc, {
        injuryResolver,
      });
    const provenanceByGame = new Map(
      provenance.map((p) => [p.game_external_id, p]),
    );

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

    // Phase 7B v0c — per-game review with full market context.
    const reviews: GameReview[] = entries
      .map((e) => {
        const prov = provenanceByGame.get(e.game_external_id);
        if (prov === undefined) return null;
        return buildGameReview(e.snapshot, e.prediction, prov);
      })
      .filter((r): r is GameReview => r !== null);

    // Phase 7B v0c — fetch raw per-book lines so the operator can audit
    // exactly which sportsbook supplied which price. Keyed by game_external_id
    // so the UI can render a per-game lines table.
    const rawLinesByGame: AdminNbaPreviewResponse["raw_lines_by_game"] = {};
    const gameExternalIds = entries.map((e) => e.game_external_id);
    if (gameExternalIds.length > 0) {
      // Resolve external_id → games.id first
      const { data: gameRows } = await supabase
        .from("games")
        .select("id, external_id")
        .eq("sport", "nba")
        .in("external_id", gameExternalIds);
      const idToExt = new Map<number, number>(
        (gameRows ?? []).map(
          (g: { id: number; external_id: number }) => [g.id, g.external_id],
        ),
      );
      const dbGameIds = (gameRows ?? []).map((g: { id: number }) => g.id);
      if (dbGameIds.length > 0) {
        const { data: lineRows } = await supabase
          .from("lines")
          .select(
            "game_id, market_type, sportsbook, side, line_value, odds_american, updated_at",
          )
          .in("game_id", dbGameIds)
          .in("market_type", ["moneyline", "spread", "total"]);
        for (const l of (lineRows ?? []) as {
          game_id: number;
          market_type: string;
          sportsbook: string;
          side: string | null;
          line_value: number | null;
          odds_american: number | null;
          updated_at: string | null;
        }[]) {
          const ext = idToExt.get(l.game_id);
          if (ext === undefined) continue;
          const arr = rawLinesByGame[ext] ?? [];
          arr.push({
            market_type: l.market_type,
            sportsbook: l.sportsbook,
            side: l.side,
            line_value: l.line_value,
            odds_american: l.odds_american,
            updated_at: l.updated_at,
          });
          rawLinesByGame[ext] = arr;
        }
      }
    }

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
      slate_date_et: date,
      utc_window: etWindow,
      provisional: true,
      notice:
        "INTERNAL PREVIEW — NBA v0b — PROVISIONAL, NOT MEMBER-FACING. Thresholds are v0 placeholders.",
      injury_ingest_enabled: isInjuryIngestEnabled(),
      totals,
      games: entries,
      game_reviews: reviews,
      raw_lines_by_game: rawLinesByGame,
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
