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
 *   3. Run the independent-first NBA model per game
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

import { isBlockedSportsbook } from "../../config/blockedSportsbooks";
import { publicSplitsSupported } from "../../config/publicSplitsCapability";
import { buildNbaFeatureSnapshotsWithProvenance } from "./featureSnapshot";
import { fetchEspnNbaInjuries } from "./espnNbaInjuries";
import { runNbaAutoModelV2 } from "../../automodel/nba/nbaAutoModelV2";
import {
  assertNbaChampionRuntime,
  NBA_MARKET_MARRIAGE_RELEASE,
} from "../../automodel/nba/nbaChampionRuntime";
import {
  buildNbaProfessionalRuntimeFeatures,
  NBA_PROFESSIONAL_MODEL_ARTIFACT,
  selectNbaProfessionalPortableFeatures,
} from "../../automodel/nba/nbaProfessionalRuntimeArtifacts";
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

assertNbaChampionRuntime();
import {
  fetchNbaOpportunities,
  matchOpportunitiesForGame,
  type NbaOpportunity,
} from "./nbaOpportunitiesClient";
import type { NbaLineRow } from "./nbaMarketIntelligence";
import {
  selectNbaComparableOpening,
  type NbaMovementHistoryRow,
  type NbaMovementMarket,
} from "./nbaSameBookMovement";
import {
  adaptNbaToDailyEdgeResponse,
  type NbaPickSideOpenPrices,
} from "./adaptNbaToDailyEdgeResponse";
import { supabase } from "../../db/supabase";
import type { DailyEdgeResponse } from "../../../app/lab/lib/labTypes";
import { currentDailyEdgeBoardDate } from "../../dates/slateDate";
import {
  loadNbaRollingSchedule,
  nbaMemberAnalysisEligible,
} from "./nbaRollingSchedule";
import {
  applyNbaProfessionalCandidate,
  buildNbaProfessionalCandidate,
} from "./nbaProfessionalCandidate";
import { loadNbaProfessionalCurrentState } from "./nbaProfessionalGameInputs";
import {
  applyNbaLockedMemberSnapshotPrecedence,
  type NbaLockedMemberRecord,
} from "./nbaLockedMemberSnapshot";

function nbaProviderSeasonForSlate(date: string): number {
  const match = /^(\d{4})-(\d{2})-\d{2}$/.exec(date);
  if (!match) throw new Error(`Invalid NBA slate date: ${date}`);
  const year = Number(match[1]);
  const month = Number(match[2]);
  return month >= 7 ? year : year - 1;
}

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
  const providerSeason = nbaProviderSeasonForSlate(date);
  const currentState = snapshots.length === 0
    ? { games: [], boxes: [] }
    : await loadNbaProfessionalCurrentState({ supabase, season: providerSeason });
  const professionalFeatures = buildNbaProfessionalRuntimeFeatures({
    upcomingGames: snapshots.map((snapshot) => {
      if (snapshot.game_time_iso === null) {
        throw new Error(`NBA professional runtime game ${snapshot.game_external_id} has no tip time.`);
      }
      return {
        gameId: snapshot.game_external_id,
        season: providerSeason,
        startTime: snapshot.game_time_iso,
        homeTeam: snapshot.home_team.abbreviation,
        awayTeam: snapshot.away_team.abbreviation,
      };
    }),
    currentGames: currentState.games,
    currentBoxes: currentState.boxes,
  });

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
      if (isBlockedSportsbook(l.sportsbook)) continue; // never use blocked books (e.g. fliff)
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

  // Preserve the complete history rows so opening comparison can require the
  // same sportsbook and exact Spread/Total line as the evaluated current quote.
  const movementHistory: NbaMovementHistoryRow[] = [];
  if ((gameRows ?? []).length > 0) {
    const dbIds = (gameRows ?? []).map((g) => g.id);
    const { data: histRows } = await supabase
      .from("line_history")
      .select("game_id, market_type, side, line_value, odds_american, recorded_at, sportsbook")
      .in("game_id", dbIds)
      .in("market_type", ["moneyline", "spread", "total"])
      .order("recorded_at", { ascending: true });
    const rows = ((histRows ?? []) as Array<{
      game_id: number;
      market_type: string;
      side: string | null;
      line_value: number | null;
      odds_american: number | null;
      recorded_at: string | null;
      sportsbook: string | null;
    }>).filter((r) => !isBlockedSportsbook(r.sportsbook));
    for (const r of rows) {
      const ext = dbIdToExt.get(r.game_id);
      if (
        ext === undefined || r.side === null || r.sportsbook === null ||
        !["moneyline", "spread", "total"].includes(r.market_type)
      ) continue;
      movementHistory.push({
        externalGameId: ext,
        market: r.market_type as NbaMovementMarket,
        side: r.side,
        sportsbook: r.sportsbook,
        line: r.line_value,
        americanPrice: r.odds_american,
        observedAt: r.recorded_at,
      });
    }
  }

  const dynamicGames: NbaDailyEdgeGameDto[] = snapshots.flatMap((s) => {
    const prov = provenanceByGame.get(s.game_external_id);
    if (prov === undefined) return [];
    const lines = linesByExtId.get(s.game_external_id) ?? [];
    const baseline = runNbaAutoModelV2(s, "t60_locked", {
      bookCount: new Set(lines.map((line) => line.sportsbook)).size,
    });
    const featureRow = professionalFeatures.get(s.game_external_id);
    if (!featureRow) throw new Error(`Missing NBA professional feature row for ${s.game_external_id}.`);
    const candidate = buildNbaProfessionalCandidate({
      artifact: NBA_PROFESSIONAL_MODEL_ARTIFACT,
      featureRow: selectNbaProfessionalPortableFeatures(featureRow),
      lines,
      history: movementHistory,
      externalGameId: s.game_external_id,
    });
    const pred = applyNbaProfessionalCandidate({ baseline, candidate });
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
    const dto = buildNbaDailyEdgeGameDto({
      snapshot: s,
      prediction: pred,
      provenance: prov,
      lines,
      splitsRow,
      opportunities: gameOpps,
    });
    dto.grounding_audit = {
      release: NBA_MARKET_MARRIAGE_RELEASE,
      independent_primary: false,
      independent_projection: {
        home_score: candidate.independent.homeScore,
        away_score: candidate.independent.awayScore,
        total: candidate.independent.total,
        margin_home: candidate.independent.marginHome,
      },
      market_consensus: {
        home_moneyline_probability: candidate.consensus.mlHomeNoVig,
        spread_home: candidate.consensus.spreadHome,
        total: candidate.consensus.totalLine,
        strength: candidate.consensus.consensusStrength,
        accepted_books: {
          moneyline: candidate.consensus.mlAcceptedBooks,
          spread: candidate.consensus.spreadAcceptedBooks,
          total: candidate.consensus.totalAcceptedBooks,
        },
      },
      forecast_correction: {
        applied: candidate.final.marketApplied.margin || candidate.final.marketApplied.total,
        release: candidate.final.release,
        movement_applied: candidate.final.movementApplied,
        opening_spread_home: candidate.openingSpread?.spreadHome ?? null,
        final_projection: {
          home_score: candidate.final.homeScore,
          away_score: candidate.final.awayScore,
          total: candidate.final.total,
          margin_home: candidate.final.marginHome,
        },
      },
    };
    return [dto];
  });

  const externalToDbId = new Map<number, number>();
  for (const [dbId, ext] of dbIdToExt.entries()) externalToDbId.set(ext, dbId);
  let lockedRows: NbaLockedMemberRecord[] = [];
  if ((gameRows ?? []).length > 0) {
    const { data, error } = await supabase
      .from("prediction_records")
      .select("game_id,market,locked_at,snapshot_json")
      .eq("sport", "nba")
      .eq("slate_date", date)
      .in("game_id", (gameRows ?? []).map((game) => game.id))
      .not("locked_at", "is", null);
    if (error) throw new Error(`NBA locked member snapshot lookup failed: ${error.message}`);
    lockedRows = (data ?? []) as NbaLockedMemberRecord[];
  }
  const games = applyNbaLockedMemberSnapshotPrecedence({
    games: dynamicGames,
    dbIdByExternalId: externalToDbId,
    rows: lockedRows,
  });

  const marketSignalsCapability =
    sharpKey === undefined || sharpKey === ""
      ? ("unavailable_no_api_key" as const)
      : publicSplitsSupported("nba")
      ? ("available" as const)
      : ("unavailable_unvalidated_source" as const);

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

  // Surface only a comparable same-book, same-line opening price. Missing
  // identity is unavailable—not permission to compare unrelated quotes.
  const openPricesByGame = new Map<number, NbaPickSideOpenPrices>();
  for (const g of games) {
    const ext = g.game_external_id;
    const intel = g.intelligence;
    const lookup = (
      market: NbaMovementMarket,
      value: typeof intel.ml,
    ): number | null => {
      return selectNbaComparableOpening({
        rows: movementHistory,
        externalGameId: ext,
        market,
        side: value.pick_side,
        sportsbook: value.current_price.sportsbook,
        line: value.consensus_line,
        currentObservedAt: value.current_price.fetched_at,
      })?.americanPrice ?? null;
    };
    openPricesByGame.set(ext, {
      ml: lookup("moneyline", intel.ml),
      total: lookup("total", intel.total),
      spread: lookup("spread", intel.spread),
    });
  }

  return { nbaDto, openPricesByGame, dbIdByExternalId: externalToDbId };
}

/**
 * Adapter wrapper — runs the pipeline and adapts the result to the
 * MLB-shaped DailyEdgeResponse the shared shell consumes. This is the
 * canonical entry point for `/api/lab/daily-edge?sport=nba`.
 */
export async function buildNbaDailyEdgeAdapted(date: string): Promise<DailyEdgeResponse> {
  const currentBoardDate = currentDailyEdgeBoardDate("nba");
  const includeRollingSchedule = date >= currentBoardDate;
  const rollingSchedule = includeRollingSchedule
    ? await loadNbaRollingSchedule(currentBoardDate)
    : undefined;

  // Schedule visibility is deliberately independent of prediction
  // visibility. Preseason/offseason dates and manually selected future dates
  // never run or expose the member model; they return only the official
  // rolling schedule contract.
  if (!nbaMemberAnalysisEligible(date, currentBoardDate)) {
    return {
      as_of: new Date().toISOString(),
      sport: "nba",
      date,
      requested_date: date,
      fallback_used: false,
      slateState: "no_data",
      slate_status: null,
      last_slate_update_at: null,
      nbaRollingSchedule: rollingSchedule,
      games: [],
    };
  }

  const { nbaDto, openPricesByGame } = await buildNbaDailyEdgePipeline(date);
  const response = adaptNbaToDailyEdgeResponse(nbaDto, { openPricesByGame });
  if (rollingSchedule) {
    // Preserve the analyzed current-day lifecycle, including completed cards
    // through the normal ET rollover. The schedule layer independently drops
    // finals, and this identity filter prevents a pregame/live duplicate.
    const analyzedGameIds = new Set(response.games.map((game) => game.external_id));
    response.nbaRollingSchedule = {
      ...rollingSchedule,
      games: rollingSchedule.games.filter((game) => !analyzedGameIds.has(game.externalId)),
    };
  }
  return response;
}
