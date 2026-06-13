/**
 * Phase 7G (launch prep) — NBA → adapted Daily Edge response builder.
 *
 * Single shared service that runs the full NBA pipeline and returns a
 * `DailyEdgeResponse` shaped exactly like MLB's /api/lab/daily-edge
 * payload. Called by:
 *
 *   • /api/lab/daily-edge?sport=nba  — member-safe route (launch path)
 *   • /api/admin/nba-as-daily-edge   — admin debug route (kept for ops)
 *
 * Pipeline:
 *   1. Build NBA feature snapshots (DB-only) for the ET slate window
 *   2. Resolve injuries via ESPN (best-effort)
 *   3. Run v0 model (runNbaAutoModelV1) per game
 *   4. Pull lines + splits + opportunities (lines from DB; splits + opps
 *      live via SharpAPI if SHARPAPI_KEY is set, else gracefully missing)
 *   5. Compose per-game NbaDailyEdgeGameDto
 *   6. Adapt to MLB-shaped DailyEdgeResponse
 *
 * Read-only. No DB writes. No prediction_records. No cron.
 *
 * Member-safe: no admin headers required, no preview-branch bypass.
 * Hosting auth gates (middleware beta cookie etc.) sit in front of
 * the calling routes and are unaffected by this helper.
 */

import { buildNbaFeatureSnapshotsWithProvenance } from "./featureSnapshot";
import { fetchEspnNbaInjuries } from "./espnNbaInjuries";
import { runNbaAutoModelV1 } from "../../automodel/nba/nbaAutoModelV1";
import { applyNbaGroundingOverlay } from "./applyNbaGrounding";
import { etSlateDateToUtcWindow } from "./etSlateDate";
import {
  buildNbaDailyEdgeGameDto,
  type NbaDailyEdgeDto,
  type NbaDailyEdgeGameDto,
} from "./buildNbaDailyEdgeDto";
import {
  fetchNbaSplits,
  matchSplitsRow,
  type NbaSplitsRow,
} from "./nbaSplitsClient";
import {
  fetchNbaOpportunities,
  matchOpportunitiesForGame,
  type NbaOpportunity,
} from "./nbaOpportunitiesClient";
import type { NbaLineRow } from "./nbaMarketIntelligence";
import {
  adaptNbaToDailyEdgeResponse,
  type NbaPickSideOpenPrices,
} from "./adaptNbaToDailyEdgeResponse";
import { supabase } from "../../db/supabase";
import type { DailyEdgeResponse } from "../../../app/lab/lib/labTypes";

/**
 * Phase 7H — internal NBA pipeline result. Returned by
 * `buildNbaDailyEdgePipeline` so callers that need the raw NbaDailyEdgeDto
 * (the NBA tracking writer, regression tests) can read it without
 * re-running the pipeline. The adapter consumes `nbaDto` + the
 * `openPricesByGame` map; tracking just needs `nbaDto` (for picks +
 * markets) plus a lookup of NBA external_id → DB game id (for the
 * prediction_records FK).
 */
export type NbaDailyEdgePipelineResult = {
  nbaDto: NbaDailyEdgeDto;
  openPricesByGame: Map<number, NbaPickSideOpenPrices>;
  /** Map of NBA game external_id → games.id (DB primary key). */
  dbIdByExternalId: Map<number, number>;
};

/**
 * Phase 7H — extracted pipeline (no adaptation step). The adapter
 * wrapper below stays the canonical entry point for the daily-edge
 * route; tracking + tests use this directly when they need the raw DTO.
 *
 * Pure read-only — no DB writes anywhere in the pipeline.
 */
export async function buildNbaDailyEdgePipeline(date: string): Promise<NbaDailyEdgePipelineResult> {
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
  const dbIdToExt = new Map<number, number>(
    (gameRows ?? []).map((g: { id: number; external_id: number }) => [g.id, g.external_id]),
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
      // Never log the key. Only the failure message.
      console.warn(`nba daily-edge: /splits fetch failed: ${(e as Error).message}`);
    }
    try {
      opportunities = await fetchNbaOpportunities(sharpKey);
    } catch (e) {
      console.warn(`nba daily-edge: /opportunities fetch failed: ${(e as Error).message}`);
    }
  }

  // Earliest-recorded price per (game, market, side) → "line open" lookup.
  // Mirrors the MLB extractor in /api/lab/daily-edge so the Reader's line
  // move row renders for NBA the same way.
  const openByGameMarketSide = new Map<string, number | null>();
  if ((gameRows ?? []).length > 0) {
    const dbIds = (gameRows ?? []).map((g) => g.id);
    const { data: histRows } = await supabase
      .from("line_history")
      .select("game_id, market_type, side, odds_american, recorded_at")
      .in("game_id", dbIds)
      .in("market_type", ["moneyline", "spread", "total"])
      .order("recorded_at", { ascending: true });
    for (const r of (histRows ?? []) as Array<{
      game_id: number;
      market_type: string;
      side: string | null;
      odds_american: number | null;
      recorded_at: string | null;
    }>) {
      const ext = dbIdToExt.get(r.game_id);
      if (ext === undefined) continue;
      const key = `${ext}::${r.market_type}::${r.side ?? "null"}`;
      if (!openByGameMarketSide.has(key)) {
        openByGameMarketSide.set(key, r.odds_american);
      }
    }
  }

  const games: NbaDailyEdgeGameDto[] = snapshots.flatMap((s) => {
    const prov = provenanceByGame.get(s.game_external_id);
    if (prov === undefined) return [];
    const lines = linesByExtId.get(s.game_external_id) ?? [];
    // v0 active. v1 stays parked as research.
    const pred = runNbaAutoModelV1(s, "t60_locked");
    const splitsRow = matchSplitsRow(
      splits,
      s.home_team.abbreviation,
      s.away_team.abbreviation,
    );
    // 2026-06-10 UI honesty fix: demote tier when public splits absent.
    // The model's deriveTier (nbaAutoModelV1.ts:77-86) computes tier from
    // ratings + market + injuries — splits are NOT in the calc. Without
    // this override, a card with `has_splits=false` still gets tier="high"
    // which (a) lets gradeNbaMarket return raw confidence + best_angle
    // eligibility, and (b) makes the persisted snapshot claim "high data
    // quality" while a key data source is missing.
    //
    // When splits are missing, downgrade tier from "high" → "medium" so:
    //   • gradeNbaMarket applies confidence cap (52)
    //   • best_angle eligibility blocked (requires tier="high")
    //   • snapshot.data_integrity.data_quality_tier reads "medium" honestly
    //
    // Pick direction is unchanged — only confidence/grade label downgrade.
    // "low"/"fallback"/"medium" tiers stay as-is (downgrade-only, never
    // promote).
    if (splitsRow === null && pred.audit.data_quality_tier === "high") {
      pred.audit.data_quality_tier = "medium";
      pred.audit.model_integrity_notes = [
        ...pred.audit.model_integrity_notes,
        "data_quality_tier downgraded high → medium: public splits unavailable for this matchup.",
      ];
    }
    const gameOpps = matchOpportunitiesForGame(
      opportunities,
      s.home_team.abbreviation,
      s.away_team.abbreviation,
    );
    const dto = buildNbaDailyEdgeGameDto({
      snapshot: s,
      prediction: pred,
      provenance: prov,
      lines,
      splitsRow,
      opportunities: gameOpps,
    });
    // NBA-P0 — overlay V2 + multi-book consensus + grounding onto the DTO
    // (projection + ML/total intel) and attach the audit substrate. This is
    // what makes the card grounded-but-autonomous instead of single-book V1.
    const groundingAudit = applyNbaGroundingOverlay(dto, s, lines, "t60_locked");
    dto.grounding_audit = groundingAudit as unknown as Record<string, unknown>;
    return [dto];
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
    // Note: this `notice` field is on the internal NbaDailyEdgeDto only.
    // The MLB-shaped DailyEdgeResponse the adapter returns does NOT
    // carry it — member UI never sees this text.
    notice: "Internal NBA preview data. Member UI ignores this field.",
    injury_ingest_enabled: true,
    market_signals_capability: marketSignalsCapability,
    games,
  };

  // Build per-game open-price map keyed on each market's *picked* side.
  // Adapter then surfaces these as `lineOpenAmerican` so the line move
  // renderer can compare them to `priceAmerican`.
  const openPricesByGame = new Map<number, NbaPickSideOpenPrices>();
  for (const g of games) {
    const ext = g.game_external_id;
    const intel = g.intelligence;
    const lookup = (market: "moneyline" | "spread" | "total", pickSide: string | null): number | null => {
      if (pickSide === null) return null;
      return openByGameMarketSide.get(`${ext}::${market}::${pickSide}`) ?? null;
    };
    openPricesByGame.set(ext, {
      ml: lookup("moneyline", intel.ml.pick_side),
      total: lookup("total", intel.total.pick_side),
      spread: lookup("spread", intel.spread.pick_side),
    });
  }

  const externalToDbId = new Map<number, number>();
  for (const [dbId, ext] of dbIdToExt.entries()) externalToDbId.set(ext, dbId);

  return { nbaDto, openPricesByGame, dbIdByExternalId: externalToDbId };
}

/**
 * Adapter wrapper — runs the pipeline and adapts the result to the
 * MLB-shaped DailyEdgeResponse the shared shell consumes. This is the
 * canonical entry point for `/api/lab/daily-edge?sport=nba`.
 */
export async function buildNbaDailyEdgeAdapted(date: string): Promise<DailyEdgeResponse> {
  const { nbaDto, openPricesByGame } = await buildNbaDailyEdgePipeline(date);
  return adaptNbaToDailyEdgeResponse(nbaDto, { openPricesByGame });
}
