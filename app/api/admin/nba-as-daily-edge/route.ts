/**
 * Phase 7F (Path A) — NBA-as-DailyEdge admin route.
 *
 * GET /api/admin/nba-as-daily-edge?date=YYYY-MM-DD  (date interpreted as ET)
 *
 * READ-ONLY. Wraps the existing NBA preview pipeline and returns the
 * SAME shape as /api/lab/daily-edge — so the existing DailyEdgeShell can
 * render NBA games through MLB's components unchanged. v0 is the active
 * model (nbaAutoModelV1); v1 stays parked.
 *
 * Auth: same admin gate + the existing nba-v0a preview-branch bypass
 * already used by /api/admin/nba-preview. NEVER member-facing.
 *
 * Internal call graph: this route invokes the GET handler of
 * /api/admin/nba-preview via fetch to /api/admin/nba-preview?date=...
 * is intentionally avoided — both routes share the same admin auth
 * surface and we want the adapter to live server-side without an
 * extra round-trip. Instead we duplicate the orchestration here
 * (small inline call to buildNbaFeatureSnapshotsWithProvenance +
 * the existing builders) and feed the resulting NbaDailyEdgeDto
 * straight into the adapter.
 */

import { validateAdminAuth } from "@/lib/auth/admin";
import { buildNbaFeatureSnapshotsWithProvenance } from "@/lib/services/nba/featureSnapshot";
import {
  fetchEspnNbaInjuries,
  isInjuryIngestEnabled,
} from "@/lib/services/nba/espnNbaInjuries";
import { runNbaAutoModelV1 } from "@/lib/automodel/nba/nbaAutoModelV1";
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
import { adaptNbaToDailyEdgeResponse } from "@/lib/services/nba/adaptNbaToDailyEdgeResponse";
import { supabase } from "@/lib/db/supabase";

export const dynamic = "force-dynamic";

// ─── TEMPORARY PREVIEW-BRANCH AUTH BYPASS ─────────────────────────────
//
// !!!  MUST BE REMOVED BEFORE MERGING nba-v0a -> main  !!!
//
// Same scope as /api/admin/nba-preview: VERCEL_ENV=preview +
// VERCEL_GIT_COMMIT_REF=nba-v0a only. Production main always requires
// admin auth.
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
  // Phase 7F follow-up: when the caller doesn't supply ?date=, default
  // to today's ET slate date. The shared useDailyEdge hook does this
  // client-side too; this server-side default makes the route forgiving
  // when poked directly (e.g. a manual curl with no params).
  const rawDate = url.searchParams.get("date");
  const date = rawDate !== null && /^\d{4}-\d{2}-\d{2}$/.test(rawDate)
    ? rawDate
    : new Intl.DateTimeFormat("en-CA", {
        timeZone: "America/New_York",
        year: "numeric",
        month: "2-digit",
        day: "2-digit",
      }).format(new Date());
  if (rawDate !== null && !/^\d{4}-\d{2}-\d{2}$/.test(rawDate)) {
    return new Response(
      JSON.stringify({
        error: "Invalid `date` format (expected YYYY-MM-DD, interpreted as ET slate date).",
      }),
      { status: 400, headers: { "content-type": "application/json" } },
    );
  }

  try {
    const etWindow = etSlateDateToUtcWindow(date);
    const startUtcDate = etWindow.startISO.slice(0, 10);
    const endUtcDate = etWindow.endISO.slice(0, 10);
    const utcDatesToQuery =
      startUtcDate === endUtcDate ? [startUtcDate] : [startUtcDate, endUtcDate];

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
    const provenanceByGame = new Map(provenance.map((p) => [p.game_external_id, p]));

    const gameExternalIds = snapshots.map((s) => s.game_external_id);
    const { data: gameRows } =
      gameExternalIds.length > 0
        ? await supabase
            .from("games")
            .select("id, external_id")
            .eq("sport", "nba")
            .in("external_id", gameExternalIds)
        : { data: [] as Array<{ id: number; external_id: number }> };
    const dbIdToExt = new Map<number, number>(
      (gameRows ?? []).map((g: { id: number; external_id: number }) => [g.id, g.external_id]),
    );

    const linesByExtId = new Map<number, NbaLineRow[]>();
    if ((gameRows ?? []).length > 0) {
      const dbIds = (gameRows ?? []).map((g) => g.id);
      const { data: lineRows } = await supabase
        .from("lines")
        .select("game_id, market_type, sportsbook, side, line_value, odds_american, fetched_at")
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

    const sharpKey = process.env.SHARPAPI_KEY;
    let splits: NbaSplitsRow[] = [];
    let opportunities: NbaOpportunity[] = [];
    if (sharpKey !== undefined && sharpKey !== "") {
      try { splits = await fetchNbaSplits(sharpKey); } catch (e) {
        console.warn(`nba-as-daily-edge: /splits fetch failed: ${(e as Error).message}`);
      }
      try { opportunities = await fetchNbaOpportunities(sharpKey); } catch (e) {
        console.warn(`nba-as-daily-edge: /opportunities fetch failed: ${(e as Error).message}`);
      }
    }

    const games: NbaDailyEdgeGameDto[] = snapshots.flatMap((s) => {
      const prov = provenanceByGame.get(s.game_external_id);
      if (prov === undefined) return [];
      const lines = linesByExtId.get(s.game_external_id) ?? [];
      const pred = runNbaAutoModelV1(s, "t60_locked");
      const splitsRow = matchSplitsRow(splits, s.home_team.abbreviation, s.away_team.abbreviation);
      const gameOpps = matchOpportunitiesForGame(
        opportunities,
        s.home_team.abbreviation,
        s.away_team.abbreviation,
      );
      return [
        buildNbaDailyEdgeGameDto({
          snapshot: s,
          prediction: pred,
          provenance: prov,
          lines,
          splitsRow,
          opportunities: gameOpps,
        }),
      ];
    });

    const marketSignalsCapability =
      sharpKey !== undefined && sharpKey !== ""
        ? ("available" as const)
        : ("unavailable_no_api_key" as const);

    const nbaDto: NbaDailyEdgeDto = {
      as_of: new Date().toISOString(),
      slate_date_et: date,
      utc_window: etWindow,
      provisional: true,
      notice:
        "INTERNAL PREVIEW — NBA — PROVISIONAL, NOT MEMBER-FACING. v0 active.",
      injury_ingest_enabled: isInjuryIngestEnabled(),
      market_signals_capability: marketSignalsCapability,
      games,
    };

    // Adapt to MLB-shaped DailyEdgeResponse so the shared shell renders it.
    const adapted = adaptNbaToDailyEdgeResponse(nbaDto);
    return new Response(JSON.stringify(adapted), {
      status: 200,
      headers: { "content-type": "application/json" },
    });
  } catch (e) {
    return new Response(
      JSON.stringify({ error: `nba-as-daily-edge failed: ${(e as Error).message}` }),
      { status: 500, headers: { "content-type": "application/json" } },
    );
  }
}
