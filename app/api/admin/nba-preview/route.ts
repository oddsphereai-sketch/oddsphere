/**
 * Phase 7A-7B v0c-DE — NBA Daily Edge admin preview API.
 *
 * GET /api/admin/nba-preview?date=YYYY-MM-DD  (date interpreted as ET)
 *
 * READ-ONLY. No writes. Returns the NbaDailyEdgeDto consumed by
 * the admin Daily Edge preview page. Includes:
 *   • per-game snapshot + model prediction (via featureSnapshot)
 *   • lines from DB (read-only)
 *   • splits + opportunities fetched live from SharpAPI
 *   • per-market intelligence (consensus, no-vig, EV, splits, conflict, grade)
 *
 * Auth: same `validateAdminAuth` (email + token headers) — with a
 * temporary preview-branch-only bypass for the nba-v0a branch. The
 * bypass MUST be removed before merging to main.
 */

import { validateAdminAuth } from "@/lib/auth/admin";
import { buildNbaFeatureSnapshotsWithProvenance } from "@/lib/services/nba/featureSnapshot";
import {
  fetchEspnNbaInjuries,
  isInjuryIngestEnabled,
} from "@/lib/services/nba/espnNbaInjuries";
import { runNbaAutoModelV1 } from "@/lib/automodel/nba/nbaAutoModelV1";
import { runNbaAutoModelV2 } from "@/lib/automodel/nba/nbaAutoModelV2";
import { etSlateDateToUtcWindow } from "@/lib/services/nba/etSlateDate";
import {
  buildNbaDailyEdgeGameDto,
  type NbaDailyEdgeDto,
  type NbaDailyEdgeGameDto,
} from "@/lib/services/nba/buildNbaDailyEdgeDto";
import {
  fetchNbaSplits,
  matchSplitsRow,
  type NbaSplitsRow,
} from "@/lib/services/nba/nbaSplitsClient";
import {
  fetchNbaOpportunities,
  matchOpportunitiesForGame,
  type NbaOpportunity,
} from "@/lib/services/nba/nbaOpportunitiesClient";
import type { NbaLineRow } from "@/lib/services/nba/nbaMarketIntelligence";
import { supabase } from "@/lib/db/supabase";

export const dynamic = "force-dynamic";

// ─── TEMPORARY PREVIEW-BRANCH AUTH BYPASS ─────────────────────────────
//
// !!!  MUST BE REMOVED BEFORE MERGING nba-v0a -> main  !!!
//
// Scoped to: VERCEL=1 AND VERCEL_ENV="preview" AND
// VERCEL_GIT_COMMIT_REF="nba-v0a". Production (main) and all other
// preview branches keep full auth.
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
      JSON.stringify({ error: "Missing or invalid `date` (expected YYYY-MM-DD, interpreted as ET slate date)." }),
      { status: 400, headers: { "content-type": "application/json" } },
    );
  }

  try {
    const etWindow = etSlateDateToUtcWindow(date);
    // The ET window can span two UTC days (e.g. 2026-06-08 ET covers
    // 04:00Z 2026-06-08 → 03:59:59Z 2026-06-09). The featureSnapshot
    // builder queries one UTC day at a time, so we call it for BOTH
    // UTC dates that overlap the window and merge/dedupe by game id.
    const startUtcDate = etWindow.startISO.slice(0, 10);
    const endUtcDate = etWindow.endISO.slice(0, 10);
    const utcDatesToQuery = startUtcDate === endUtcDate
      ? [startUtcDate]
      : [startUtcDate, endUtcDate];

    const injuryResolver = async (opts: {
      teamAbbreviation: string;
      teamExternalId: number;
    }) => {
      const result = await fetchEspnNbaInjuries(opts.teamAbbreviation);
      return result === null ? null : result.players;
    };

    type SnapshotBuildResult = Awaited<
      ReturnType<typeof buildNbaFeatureSnapshotsWithProvenance>
    >;
    const buildResults: SnapshotBuildResult[] = [];
    for (const d of utcDatesToQuery) {
      buildResults.push(
        await buildNbaFeatureSnapshotsWithProvenance(d, { injuryResolver }),
      );
    }

    const seen = new Set<number>();
    const snapshots: SnapshotBuildResult["snapshots"] = [];
    const provenance: SnapshotBuildResult["provenance"] = [];
    for (const r of buildResults) {
      for (const s of r.snapshots) {
        if (seen.has(s.game_external_id)) continue;
        // Drop games whose start time falls outside the ET window
        // (e.g. an earlier-day UTC query may return an unrelated game).
        if (s.game_time_iso !== null) {
          const t = new Date(s.game_time_iso).getTime();
          const lo = new Date(etWindow.startISO).getTime();
          const hi = new Date(etWindow.endISO).getTime();
          if (t < lo || t > hi) continue;
        }
        seen.add(s.game_external_id);
        snapshots.push(s);
      }
      for (const p of r.provenance) {
        if (!seen.has(p.game_external_id)) continue;
        if (provenance.some((existing) => existing.game_external_id === p.game_external_id)) continue;
        provenance.push(p);
      }
    }
    const provenanceByGame = new Map(
      provenance.map((p) => [p.game_external_id, p]),
    );

    // Resolve external_id → games.id so we can pull lines from DB.
    const gameExternalIds = snapshots.map((s) => s.game_external_id);
    const { data: gameRows } =
      gameExternalIds.length > 0
        ? await supabase
            .from("games")
            .select("id, external_id")
            .eq("sport", "nba")
            .in("external_id", gameExternalIds)
        : { data: [] as Array<{ id: number; external_id: number }> };
    const extToDbId = new Map<number, number>(
      (gameRows ?? []).map(
        (g: { id: number; external_id: number }) => [g.external_id, g.id],
      ),
    );
    const dbIdToExt = new Map<number, number>(
      (gameRows ?? []).map(
        (g: { id: number; external_id: number }) => [g.id, g.external_id],
      ),
    );

    // Bulk-pull lines for all games on the slate.
    const linesByExtId = new Map<number, NbaLineRow[]>();
    if ((gameRows ?? []).length > 0) {
      const dbIds = (gameRows ?? []).map((g) => g.id);
      const { data: lineRows } = await supabase
        .from("lines")
        .select(
          "game_id, market_type, sportsbook, side, line_value, odds_american, fetched_at",
        )
        .in("game_id", dbIds)
        .in("market_type", ["moneyline", "spread", "total"]);
      for (const l of (lineRows ?? []) as Array<{
        game_id: number;
        market_type: string;
        sportsbook: string;
        side: string | null;
        line_value: number | null;
        odds_american: number | null;
        fetched_at: string | null;
      }>) {
        const ext = dbIdToExt.get(l.game_id);
        if (ext === undefined) continue;
        const arr = linesByExtId.get(ext) ?? [];
        arr.push({
          market_type: l.market_type,
          sportsbook: l.sportsbook,
          side: l.side,
          line_value: l.line_value,
          odds_american: l.odds_american,
          fetched_at: l.fetched_at,
        });
        linesByExtId.set(ext, arr);
      }
    }

    // Fetch /splits and /opportunities/ev for NBA (best-effort).
    const sharpKey = process.env.SHARPAPI_KEY;
    let splits: NbaSplitsRow[] = [];
    let opportunities: NbaOpportunity[] = [];
    if (sharpKey !== undefined && sharpKey !== "") {
      try {
        splits = await fetchNbaSplits(sharpKey);
      } catch (e) {
        console.warn(`nba-preview: /splits fetch failed: ${(e as Error).message}`);
      }
      try {
        opportunities = await fetchNbaOpportunities(sharpKey);
      } catch (e) {
        console.warn(`nba-preview: /opportunities fetch failed: ${(e as Error).message}`);
      }
    }

    const games: NbaDailyEdgeGameDto[] = snapshots.flatMap((s) => {
      const prov = provenanceByGame.get(s.game_external_id);
      if (prov === undefined) return [];
      const lines = linesByExtId.get(s.game_external_id) ?? [];
      // Phase 7C — v1 (research-prior, calibration-pending) is the
      // ACTIVE preview model. v0 is automatically computed inside v2
      // as the v0_comparison field for the audit script. The route
      // forwards the v1 prediction shape (which is a superset of v0's
      // NbaAutoModelOutput) to the DTO builder. ADMIN-ONLY language;
      // member-facing UI must not surface "v1"/"v0".
      const bookCount = new Set(lines.map((l) => l.sportsbook)).size;
      const v1 = runNbaAutoModelV2(s, "t60_locked", { isPlayoffs: true, bookCount });
      const splitsRow = matchSplitsRow(
        splits,
        s.home_team.abbreviation,
        s.away_team.abbreviation,
      );
      const gameOpps = matchOpportunitiesForGame(
        opportunities,
        s.home_team.abbreviation,
        s.away_team.abbreviation,
      );
      return [
        buildNbaDailyEdgeGameDto({
          snapshot: s,
          prediction: v1,
          provenance: prov,
          lines,
          splitsRow,
          opportunities: gameOpps,
        }),
      ];
    });
    void runNbaAutoModelV1;

    const body: NbaDailyEdgeDto = {
      as_of: new Date().toISOString(),
      slate_date_et: date,
      utc_window: etWindow,
      provisional: true,
      notice:
        "INTERNAL PREVIEW — NBA v0c — PROVISIONAL, NOT MEMBER-FACING. " +
        "Thresholds are v0 placeholders. No opener/RLM/steam (SharpAPI does not provide).",
      injury_ingest_enabled: isInjuryIngestEnabled(),
      games,
    };
    // ensure extToDbId silently helps the linter without an unused binding:
    void extToDbId;
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
