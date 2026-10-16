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
  type NbaRollingSchedule,
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
import {
  buildNbaProfessionalMarketReader,
  type NbaReaderPriceRow,
  type NbaReaderSplitRow,
} from "./nbaProfessionalMarketReader";
import {
  buildNbaMemberGameEvidence,
  type NbaMemberGameEvidence,
} from "./nbaMemberMarketEvidence";
import { buildNbaSpreadReaderStats } from "./nbaSpreadReaderStats";

const NBA_READER_EVIDENCE_PAGE_SIZE = 1000;

function nbaProviderSeasonForSlate(date: string): number {
  const match = /^(\d{4})-(\d{2})-\d{2}$/.exec(date);
  if (!match) throw new Error(`Invalid NBA slate date: ${date}`);
  const year = Number(match[1]);
  const month = Number(match[2]);
  return month >= 7 ? year : year - 1;
}

function bestExecutionSportsbook(args: {
  lines: readonly NbaLineRow[];
  market: "moneyline" | "spread" | "total";
  side: "home" | "away" | "over" | "under";
  line: number | null;
}): string | null {
  return args.lines
    .filter((row) =>
      row.market_type === args.market && row.side === args.side && row.odds_american !== null &&
      (args.market === "moneyline" || (
        row.line_value !== null && args.line !== null && Math.abs(row.line_value - args.line) < 0.01
      )))
    .sort((left, right) => (right.odds_american ?? -Infinity) - (left.odds_american ?? -Infinity))[0]
    ?.sportsbook ?? null;
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
  /** Unlocked-only display evidence. Never overlays an immutable locked DTO. */
  memberEvidenceByGame: Map<number, NbaMemberGameEvidence>;
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

  // Internal decision evidence only. This is deliberately separate from the
  // member-card adapter: the pipeline reads the market; the adapter only
  // renders the forecast that the pipeline has already produced.
  const readerEvidenceErrors: string[] = [];
  const readerSplitRowsByGame = new Map<number, NbaReaderSplitRow[]>();
  if (gameExternalIds.length > 0) {
    type ReaderSplitDbRow = {
      canonical_event_id: string;
      provider: string;
      source_book: string;
      source_type: string;
      market_type: string;
      selection_key: string;
      bets_pct: number | null;
      money_pct: number | null;
      market_line: number | null;
      source_observed_at: string | null;
      fetched_at: string;
    };
    const rows: ReaderSplitDbRow[] = [];
    let expectedSplitRows: number | null = null;
    for (
      let from = 0;
      expectedSplitRows === null || from < expectedSplitRows;
      from += NBA_READER_EVIDENCE_PAGE_SIZE
    ) {
      const page = await supabase
        .from("market_split_observations_v2")
        .select(
          "id, canonical_event_id, provider, source_book, source_type, market_type, selection_key, bets_pct, money_pct, market_line, source_observed_at, fetched_at",
          { count: "exact" },
        )
        .eq("league", "nba")
        .in("canonical_event_id", gameExternalIds.map(String))
        .order("id", { ascending: true })
        .range(from, from + NBA_READER_EVIDENCE_PAGE_SIZE - 1);
      if (page.error) {
        readerEvidenceErrors.push("split_observation_lookup_failed");
        break;
      }
      if (typeof page.count !== "number") {
        readerEvidenceErrors.push("split_observation_count_unavailable");
        break;
      }
      expectedSplitRows ??= page.count;
      if (page.count !== expectedSplitRows) {
        readerEvidenceErrors.push("split_observation_count_changed_during_read");
        break;
      }
      const data = (page.data ?? []) as ReaderSplitDbRow[];
      const expectedPageRows = Math.min(
        NBA_READER_EVIDENCE_PAGE_SIZE,
        expectedSplitRows - from,
      );
      if (data.length !== expectedPageRows) {
        readerEvidenceErrors.push("split_observation_page_truncated");
        break;
      }
      rows.push(...data);
    }
    for (const row of rows) {
      const externalId = Number(row.canonical_event_id);
      if (!Number.isFinite(externalId) || !["moneyline", "spread", "total"].includes(row.market_type)) continue;
      const gameReaderRows = readerSplitRowsByGame.get(externalId) ?? [];
      gameReaderRows.push({
        provider: row.provider,
        sourceBook: row.source_book,
        sourceType: row.source_type,
        market: row.market_type as NbaMovementMarket,
        selectionKey: row.selection_key,
        betsPct: row.bets_pct,
        moneyPct: row.money_pct,
        marketLine: row.market_line,
        sourceObservedAt: row.source_observed_at,
        fetchedAt: row.fetched_at,
      });
      readerSplitRowsByGame.set(externalId, gameReaderRows);
    }
  }

  const readerPriceRowsByGame = new Map<number, NbaReaderPriceRow[]>();
  if (gameExternalIds.length > 0) {
    type ReaderPriceDbRow = {
      canonical_event_id: string;
      sportsbook: string;
      sharp_book: boolean;
      market_type: string;
      selection_key: string;
      american_price: number | null;
      line: number | null;
      provider_timestamp: string | null;
      fetched_at: string;
    };
    const rows: ReaderPriceDbRow[] = [];
    let expectedPriceRows: number | null = null;
    for (
      let from = 0;
      expectedPriceRows === null || from < expectedPriceRows;
      from += NBA_READER_EVIDENCE_PAGE_SIZE
    ) {
      const page = await supabase
        .from("market_price_observations_v2")
        .select(
          "id, canonical_event_id, sportsbook, sharp_book, market_type, selection_key, american_price, line, provider_timestamp, fetched_at",
          { count: "exact" },
        )
        .eq("league", "nba")
        .in("canonical_event_id", gameExternalIds.map(String))
        .order("id", { ascending: true })
        .range(from, from + NBA_READER_EVIDENCE_PAGE_SIZE - 1);
      if (page.error) {
        readerEvidenceErrors.push("price_observation_lookup_failed");
        break;
      }
      if (typeof page.count !== "number") {
        readerEvidenceErrors.push("price_observation_count_unavailable");
        break;
      }
      expectedPriceRows ??= page.count;
      if (page.count !== expectedPriceRows) {
        readerEvidenceErrors.push("price_observation_count_changed_during_read");
        break;
      }
      const data = (page.data ?? []) as ReaderPriceDbRow[];
      const expectedPageRows = Math.min(
        NBA_READER_EVIDENCE_PAGE_SIZE,
        expectedPriceRows - from,
      );
      if (data.length !== expectedPageRows) {
        readerEvidenceErrors.push("price_observation_page_truncated");
        break;
      }
      rows.push(...data);
    }
    for (const row of rows) {
      const externalId = Number(row.canonical_event_id);
      if (!Number.isFinite(externalId) || !["moneyline", "spread", "total"].includes(row.market_type)) continue;
      const gameReaderRows = readerPriceRowsByGame.get(externalId) ?? [];
      gameReaderRows.push({
        sportsbook: row.sportsbook,
        sharpBook: row.sharp_book,
        market: row.market_type as NbaMovementMarket,
        selectionKey: row.selection_key,
        americanPrice: row.american_price,
        line: row.line,
        providerTimestamp: row.provider_timestamp,
        fetchedAt: row.fetched_at,
      });
      readerPriceRowsByGame.set(externalId, gameReaderRows);
    }
  }

  const readerEvaluatedAt = new Date().toISOString();

  const dynamicGames: NbaDailyEdgeGameDto[] = snapshots.flatMap((s) => {
    const prov = provenanceByGame.get(s.game_external_id);
    if (prov === undefined) return [];
    const lines = linesByExtId.get(s.game_external_id) ?? [];
    const baseline = runNbaAutoModelV2(s, "t60_locked", {
      bookCount: new Set(lines.map((line) => line.sportsbook)).size,
    });
    const featureRow = professionalFeatures.get(s.game_external_id);
    if (!featureRow) throw new Error(`Missing NBA professional feature row for ${s.game_external_id}.`);
    const previewCandidate = buildNbaProfessionalCandidate({
      artifact: NBA_PROFESSIONAL_MODEL_ARTIFACT,
      featureRow: selectNbaProfessionalPortableFeatures(featureRow),
      lines,
      history: movementHistory,
      externalGameId: s.game_external_id,
    });
    const independentMlSide = previewCandidate.independent.marginHome >= 0 ? "home" as const : "away" as const;
    const independentSpreadSide = previewCandidate.consensus.spreadHome === null ||
      previewCandidate.independent.marginHome + previewCandidate.consensus.spreadHome >= 0
      ? "home" as const : "away" as const;
    const independentTotalSide = previewCandidate.consensus.totalLine === null ||
      previewCandidate.independent.total - previewCandidate.consensus.totalLine >= 0
      ? "over" as const : "under" as const;
    const spreadExecutionLine = previewCandidate.consensus.spreadHome === null ? null
      : independentSpreadSide === "home" ? previewCandidate.consensus.spreadHome : -previewCandidate.consensus.spreadHome;
    const reader = buildNbaProfessionalMarketReader({
      evaluatedAt: readerEvaluatedAt,
      priceRows: readerPriceRowsByGame.get(s.game_external_id) ?? [],
      splitRows: readerSplitRowsByGame.get(s.game_external_id) ?? [],
      evidenceErrors: readerEvidenceErrors,
      selectedLines: {
        spreadHome: previewCandidate.consensus.spreadHome,
        total: previewCandidate.consensus.totalLine,
      },
      excludedSportsbooksByMarket: {
        moneyline: [bestExecutionSportsbook({
          lines,
          market: "moneyline",
          side: independentMlSide,
          line: null,
        }) ?? ""],
        spread: [bestExecutionSportsbook({
          lines,
          market: "spread",
          side: independentSpreadSide,
          line: spreadExecutionLine,
        }) ?? ""],
        total: [bestExecutionSportsbook({
          lines,
          market: "total",
          side: independentTotalSide,
          line: previewCandidate.consensus.totalLine,
        }) ?? ""],
      },
    });
    const candidate = buildNbaProfessionalCandidate({
      artifact: NBA_PROFESSIONAL_MODEL_ARTIFACT,
      featureRow: selectNbaProfessionalPortableFeatures(featureRow),
      lines,
      history: movementHistory,
      externalGameId: s.game_external_id,
      marketReader: reader,
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
      spreadReaderStats: buildNbaSpreadReaderStats(featureRow),
    });
    dto.grounding_audit = {
      release: NBA_MARKET_MARRIAGE_RELEASE,
      independent_primary: true,
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
        movement_qualified: candidate.final.movementQualified,
        movement_applied: candidate.final.movementApplied,
        opening_spread_home: candidate.openingSpread?.spreadHome ?? null,
        final_projection: {
          home_score: candidate.final.homeScore,
          away_score: candidate.final.awayScore,
          total: candidate.final.total,
          margin_home: candidate.final.marginHome,
        },
      },
      market_reader: reader,
      market_reader_decision: candidate.readerDecisionAudit,
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
  const lockedExternalIds = new Set(lockedRows.flatMap((row) => {
    if (row.locked_at === null) return [];
    const externalId = dbIdToExt.get(row.game_id);
    return externalId === undefined ? [] : [externalId];
  }));

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
  const memberEvidenceByGame = new Map<number, NbaMemberGameEvidence>();
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
    if (!lockedExternalIds.has(ext)) {
      memberEvidenceByGame.set(ext, buildNbaMemberGameEvidence({
        game: g,
        priceRows: readerPriceRowsByGame.get(ext) ?? [],
        splitRows: readerSplitRowsByGame.get(ext) ?? [],
        evaluatedAt: readerEvaluatedAt,
      }));
    }
  }

  return { nbaDto, openPricesByGame, memberEvidenceByGame, dbIdByExternalId: externalToDbId };
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

  // The active NBA product is a rolling seven-day analyzed board. The
  // schedule supplies exact event identity and lifecycle state; the same
  // champion pipeline that owns game-day projections supplies every normal
  // Daily Edge card and reader market. Official tracking still begins only at
  // the existing T-60 lock boundary and is not written by this read path.
  if (date === currentBoardDate && rollingSchedule && rollingSchedule.games.length > 0) {
    return buildNbaRollingMemberBoard(date, rollingSchedule);
  }

  // Historical official slates and explicit dates inside the active rolling
  // window are analyzed. Preseason/offseason and dates outside that bounded
  // window remain schedule-only and never invoke the model.
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

  const { nbaDto, openPricesByGame, memberEvidenceByGame } = await buildNbaDailyEdgePipeline(date);
  const response = adaptNbaToDailyEdgeResponse(nbaDto, { openPricesByGame, memberEvidenceByGame });
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

const NBA_ROLLING_ANALYSIS_CONCURRENCY = 3;

async function buildNbaRollingMemberBoard(
  anchorDate: string,
  schedule: NbaRollingSchedule,
): Promise<DailyEdgeResponse> {
  const eligibleDates = Array.from(new Set(
    schedule.games
      .map((game) => game.slateDate)
      .filter((slateDate) => nbaMemberAnalysisEligible(slateDate, anchorDate)),
  )).sort();

  const responses: DailyEdgeResponse[] = [];
  for (let index = 0; index < eligibleDates.length; index += NBA_ROLLING_ANALYSIS_CONCURRENCY) {
    const batch = eligibleDates.slice(index, index + NBA_ROLLING_ANALYSIS_CONCURRENCY);
    responses.push(...await Promise.all(batch.map(async (slateDate) => {
      const { nbaDto, openPricesByGame, memberEvidenceByGame } = await buildNbaDailyEdgePipeline(slateDate);
      return adaptNbaToDailyEdgeResponse(nbaDto, { openPricesByGame, memberEvidenceByGame });
    })));
  }

  const scheduledIds = new Set(schedule.games.map((game) => game.externalId));
  const games = responses
    .flatMap((response) => response.games)
    .filter((game) => scheduledIds.has(game.external_id))
    .sort((left, right) => {
      const leftStart = left.gameStartAt ? Date.parse(left.gameStartAt) : Number.POSITIVE_INFINITY;
      const rightStart = right.gameStartAt ? Date.parse(right.gameStartAt) : Number.POSITIVE_INFINITY;
      return leftStart - rightStart || left.external_id - right.external_id;
    });
  const analyzedIds = new Set(games.map((game) => game.external_id));
  const missing = schedule.games.filter((game) =>
    nbaMemberAnalysisEligible(game.slateDate, anchorDate) && !analyzedIds.has(game.externalId),
  );
  if (missing.length > 0) {
    throw new Error(
      `NBA rolling member board incomplete: ${missing.map((game) => game.externalId).join(",")}`,
    );
  }

  const asOf = responses
    .map((response) => response.as_of)
    .sort()
    .at(-1) ?? new Date().toISOString();
  return {
    as_of: asOf,
    sport: "nba",
    date: anchorDate,
    requested_date: anchorDate,
    fallback_used: false,
    slateState: games.length > 0 ? "today_published" : "no_data",
    slate_status: games.length > 0 ? "published" : null,
    last_slate_update_at: asOf,
    nbaRollingSchedule: {
      ...schedule,
      games: schedule.games.filter((game) => !analyzedIds.has(game.externalId)),
    },
    games,
  };
}
