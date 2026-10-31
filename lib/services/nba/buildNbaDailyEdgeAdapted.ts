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
 *   4. Pull persisted lines and provider-separated market evidence. The
 *      retired SharpAPI request-time split/opportunity lane is never called.
 *   5. Compose per-game NbaDailyEdgeGameDto
 *   6. Adapt to MLB-shaped DailyEdgeResponse
 *
 * Read-only. No DB writes. No prediction_records. No cron.
 *
 * Member-safe: no admin headers required, no preview-branch bypass.
 * Hosting auth gates (middleware beta cookie etc.) sit in front of
 * the calling routes and are unaffected by this helper.
 */

import { publicSplitsSupported } from "../../config/publicSplitsCapability";
import {
  buildNbaFeatureSnapshotsWithProvenance,
  type InjuryResolver,
  type NbaTeamRatingsRow,
} from "./featureSnapshot";
import { createEspnNbaGameInjuryResolver } from "./espnNbaInjuries";
import { runNbaAutoModelV2 } from "../../automodel/nba/nbaAutoModelV2";
import type { NbaPortableModelArtifact } from "../../automodel/nba/nbaPortableScoreModel";
import { scoreNbaPortableModel } from "../../automodel/nba/nbaPortableScoreModel";
import {
  applyNbaRosterRegime,
  fetchNbaLiveRosterSnapshot,
  type NbaLiveRosterSnapshot,
} from "../../automodel/nba/nbaRosterRegime";
import {
  assertNbaChampionRuntime,
  NBA_MARKET_MARRIAGE_RELEASE,
  NBA_MODEL_RELEASE,
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
  matchSplitsRow,
  type NbaSplitsRow,
} from "./nbaSplitsClient";

assertNbaChampionRuntime();
import {
  matchOpportunitiesForGame,
  type NbaOpportunity,
} from "./nbaOpportunitiesClient";
import { selectBestNbaExecutableOffer, type NbaLineRow } from "./nbaMarketIntelligence";
import {
  buildNbaMovementHistoryFromCanonicalPrices,
  selectNbaComparableOpening,
  type NbaMovementMarket,
} from "./nbaSameBookMovement";
import {
  adaptNbaToDailyEdgeResponse,
  type NbaPickSideOpenPrices,
} from "./adaptNbaToDailyEdgeResponse";
import { supabase } from "../../db/supabase";
import { loadCompleteCurrentGameLines } from "../currentGameLineReader";
import {
  selectNbaConsumerExecutionBoard,
  selectNbaCurrentLineBoard,
} from "./nbaCurrentLineBoard";
import type { DailyEdgeGameDto, DailyEdgeResponse } from "../../../app/lab/lib/labTypes";
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
  resolveApprovedNbaLegacyLockedEvidenceRecovery,
  type NbaLockedMemberRecord,
} from "./nbaLockedMemberSnapshot";
import {
  buildNbaProfessionalMarketReader,
  type NbaReaderPriceRow,
  type NbaReaderSplitRow,
} from "./nbaProfessionalMarketReader";
import {
  buildApprovedNbaLegacyLockedMemberGameEvidence,
  buildNbaMemberGameEvidence,
  type NbaMemberGameEvidence,
} from "./nbaMemberMarketEvidence";
import { buildNbaSpreadReaderStats } from "./nbaSpreadReaderStats";
import { isNbaAuthoritativeSportsbook } from "./nbaMarketSourceEligibility";
import { loadNbaConsumerMemberLineHistory } from "./nbaConsumerMemberLineHistory";
import { nbaIndependentInputFingerprint } from "./nbaIndependentKnowledge";
import { loadNbaMarketKnowledgeStates } from "./nbaMarketKnowledgeStore";
import { resolveNbaExecutionFixedPoint, type NbaExecutionExclusions } from "./nbaMarketExecution";

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
  /** Exact fully adapted member cards captured by future immutable locks. */
  lockedMemberGamesByExternalId: Map<number, DailyEdgeGameDto>;
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
export async function buildNbaDailyEdgePipeline(
  date: string,
  options: {
    injuryResolver?: InjuryResolver;
    /** Read-only same-input audit hook; production callers omit this. */
    professionalArtifact?: NbaPortableModelArtifact;
    /** Read-only same-input audit hook for the superseded injury-count cap. */
    retainLegacyInjuryCap?: boolean;
    /** Read-only same-input ratings audit hook; production callers omit this. */
    teamRatingsOverride?: readonly NbaTeamRatingsRow[];
    /** Read-only same-input audit hook for the superseded price-incoherent grade path. */
    retainLegacyGradeEconomics?: boolean;
    /** Read-only same-input audit hook for the superseded Moneyline Best Angle path. */
    retainLegacyMoneylineEvidenceGrade?: boolean;
    /** Deterministic audit/test hook. Production resolves the active provider roster once per build. */
    rosterRegimeRosterOverride?: NbaLiveRosterSnapshot;
    /** Read-only same-input audit hook for the superseded score path without roster-regime correction. */
    retainLegacyRosterRegime?: boolean;
    /** Read-only same-input audit hook for a proposed complete current-line board. */
    currentLinesOverrideByExternalId?: ReadonlyMap<number, readonly NbaLineRow[]>;
  } = {},
): Promise<NbaDailyEdgePipelineResult> {
  const etWindow = etSlateDateToUtcWindow(date);
  const startUtcDate = etWindow.startISO.slice(0, 10);
  const endUtcDate = etWindow.endISO.slice(0, 10);
  const utcDatesToQuery =
    startUtcDate === endUtcDate ? [startUtcDate] : [startUtcDate, endUtcDate];

  const injuryResolver = options.injuryResolver ?? createEspnNbaGameInjuryResolver();
  const professionalArtifact = options.professionalArtifact ?? NBA_PROFESSIONAL_MODEL_ARTIFACT;

  type SnapshotBuildResult = Awaited<
    ReturnType<typeof buildNbaFeatureSnapshotsWithProvenance>
  >;
  const buildResults: SnapshotBuildResult[] = [];
  for (const d of utcDatesToQuery) {
    buildResults.push(
      await buildNbaFeatureSnapshotsWithProvenance(d, {
        injuryResolver,
        teamRatingsOverride: options.teamRatingsOverride,
      }),
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
  const liveRoster = options.rosterRegimeRosterOverride ?? (
    snapshots.length === 0
      ? await fetchNbaLiveRosterSnapshot({ apiKey: "" })
      : await fetchNbaLiveRosterSnapshot()
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
  const dbIdToExt = new Map<number, number>(
    (gameRows ?? []).map((g: { id: number; external_id: number }) => [g.id, g.external_id]),
  );
  // One bounded read of the sole writer's current unlocked state. It is not
  // a second writer or a reconstruction of old/locked inputs. On failure do
  // not reset epochs and publish a newly seeded board over coherent state.
  const priorKnowledgeByExternalId = await loadNbaMarketKnowledgeStates({ client: supabase, slateDate: date,
    modelRelease: NBA_MODEL_RELEASE, externalIdByDbId: dbIdToExt });
  const consumerMemberHistory = await loadNbaConsumerMemberLineHistory({
    client: supabase,
    externalIdByDbId: dbIdToExt,
  });

  // Bulk-pull lines for all games on the slate.
  const linesByExtId = new Map<number, NbaLineRow[]>();
  if (options.currentLinesOverrideByExternalId) {
    for (const externalId of gameExternalIds) {
      const rows = options.currentLinesOverrideByExternalId.get(externalId) ?? [];
      linesByExtId.set(
        externalId,
        selectNbaConsumerExecutionBoard(selectNbaCurrentLineBoard(rows)),
      );
    }
  } else if ((gameRows ?? []).length > 0) {
    const dbIds = (gameRows ?? []).map((g) => g.id);
    const lineRows = await loadCompleteCurrentGameLines({
      client: supabase,
      gameIds: dbIds,
      marketTypes: ["moneyline", "spread", "total"],
      context: "buildNbaDailyEdgePipeline",
    });
    for (const l of lineRows) {
      const ext = dbIdToExt.get(l.game_id);
      if (ext === undefined) continue;
      if (!isNbaAuthoritativeSportsbook(l.sportsbook)) continue;
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
    for (const [externalId, rows] of linesByExtId) {
      linesByExtId.set(
        externalId,
        selectNbaConsumerExecutionBoard(selectNbaCurrentLineBoard(rows)),
      );
    }
  }

  // SharpAPI is retired. These legacy adapter slots remain empty; current
  // public consensus and named-book evidence arrive through the persisted,
  // provider-separated Playbook/Owls lanes below.
  const splits: NbaSplitsRow[] = [];
  const opportunities: NbaOpportunity[] = [];

  // Internal decision evidence only. This is deliberately separate from the
  // member-card adapter: the pipeline reads the market; the adapter only
  // renders the forecast that the pipeline has already produced.
  const readerEvidenceErrors: string[] = [];
  const readerSplitRowsByGame = new Map<number, NbaReaderSplitRow[]>();
  if (gameExternalIds.length > 0) {
    type ReaderSplitDbRow = {
      id: number;
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
    let lastSplitId = 0;
    const splitHighWaterRead = await supabase
      .from("market_split_observations_v2")
      .select("id")
      .eq("league", "nba")
      .in("canonical_event_id", gameExternalIds.map(String))
      .order("id", { ascending: false })
      .limit(1)
      .maybeSingle();
    if (splitHighWaterRead.error) readerEvidenceErrors.push("split_observation_high_water_failed");
    const splitHighWaterId = Number(splitHighWaterRead.data?.id ?? 0);
    while (lastSplitId < splitHighWaterId) {
      const page = await supabase
        .from("market_split_observations_v2")
        .select("id, canonical_event_id, provider, source_book, source_type, market_type, selection_key, bets_pct, money_pct, market_line, source_observed_at, fetched_at")
        .eq("league", "nba")
        .in("canonical_event_id", gameExternalIds.map(String))
        .gt("id", lastSplitId)
        .lte("id", splitHighWaterId)
        .order("id", { ascending: true })
        .limit(NBA_READER_EVIDENCE_PAGE_SIZE);
      if (page.error) {
        readerEvidenceErrors.push("split_observation_lookup_failed");
        break;
      }
      const data = (page.data ?? []) as ReaderSplitDbRow[];
      if (data.some((row, index) => !Number.isInteger(row.id) || row.id <= (index === 0 ? lastSplitId : data[index - 1]!.id))) {
        readerEvidenceErrors.push("split_observation_id_order_invalid");
        break;
      }
      rows.push(...data);
      if (data.length < NBA_READER_EVIDENCE_PAGE_SIZE) break;
      lastSplitId = data.at(-1)!.id;
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
      id: number;
      provider: string;
      provider_event_id: string | null;
      ingestion_run_id: string | null;
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
    let lastPriceId = 0;
    const priceHighWaterRead = await supabase
      .from("market_price_observations_v2")
      .select("id")
      .eq("league", "nba")
      .in("canonical_event_id", gameExternalIds.map(String))
      .order("id", { ascending: false })
      .limit(1)
      .maybeSingle();
    if (priceHighWaterRead.error) readerEvidenceErrors.push("price_observation_high_water_failed");
    const priceHighWaterId = Number(priceHighWaterRead.data?.id ?? 0);
    while (lastPriceId < priceHighWaterId) {
      const page = await supabase
        .from("market_price_observations_v2")
        .select("id, provider, provider_event_id, ingestion_run_id, canonical_event_id, sportsbook, sharp_book, market_type, selection_key, american_price, line, provider_timestamp, fetched_at")
        .eq("league", "nba")
        .in("canonical_event_id", gameExternalIds.map(String))
        .gt("id", lastPriceId)
        .lte("id", priceHighWaterId)
        .order("id", { ascending: true })
        .limit(NBA_READER_EVIDENCE_PAGE_SIZE);
      if (page.error) {
        readerEvidenceErrors.push("price_observation_lookup_failed");
        break;
      }
      const data = (page.data ?? []) as ReaderPriceDbRow[];
      if (data.some((row, index) => !Number.isInteger(row.id) || row.id <= (index === 0 ? lastPriceId : data[index - 1]!.id))) {
        readerEvidenceErrors.push("price_observation_id_order_invalid");
        break;
      }
      rows.push(...data);
      if (data.length < NBA_READER_EVIDENCE_PAGE_SIZE) break;
      lastPriceId = data.at(-1)!.id;
    }
    for (const row of rows) {
      const externalId = Number(row.canonical_event_id);
      if (
        !Number.isFinite(externalId) ||
        !["moneyline", "spread", "total"].includes(row.market_type) ||
        !isNbaAuthoritativeSportsbook(row.sportsbook)
      ) continue;
      const gameReaderRows = readerPriceRowsByGame.get(externalId) ?? [];
      gameReaderRows.push({
        provider: row.provider,
        providerEventId: row.provider_event_id,
        ingestionRunId: row.ingestion_run_id,
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

  // Use the same fully paginated canonical chronology as the professional
  // reader. A direct line_history query silently stopped at 1,000 rows and
  // made later games lose their opening-price and opening-spread evidence.
  const movementHistory = buildNbaMovementHistoryFromCanonicalPrices({
    rowsByExternalGameId: readerPriceRowsByGame,
  });

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
    const portableFeatureRow = selectNbaProfessionalPortableFeatures(featureRow);
    const rawIndependent = scoreNbaPortableModel(professionalArtifact, portableFeatureRow);
    const rosterRegime = applyNbaRosterRegime({
      independent: rawIndependent,
      providerSeason,
      homeTeam: s.home_team.abbreviation,
      awayTeam: s.away_team.abbreviation,
      homeCurrentGames: Number(featureRow.home_current_games ?? 0),
      awayCurrentGames: Number(featureRow.away_current_games ?? 0),
      homeInjuries: s.home_injuries,
      awayInjuries: s.away_injuries,
      liveRoster,
    });
    const selectedIndependent = options.retainLegacyRosterRegime
      ? rawIndependent
      : rosterRegime.score;
    const previewCandidate = buildNbaProfessionalCandidate({
      artifact: professionalArtifact,
      featureRow: portableFeatureRow,
      lines,
      history: movementHistory,
      externalGameId: s.game_external_id,
      independentOverride: selectedIndependent,
    });
    const executionBooks = (c: typeof previewCandidate): NbaExecutionExclusions => {
      const book = (market: "moneyline" | "spread" | "total", side: "home" | "away" | "over" | "under" | null, line: number | null) => {
        if (market !== "moneyline" && side !== null) {
          const pFirst = market === "spread" ? c.probabilities.spread_home_cover_prob : c.probabilities.total_over_prob;
          const probability = pFirst === null ? null : side === "home" || side === "over" ? pFirst : 1 - pFirst;
          const offer = selectBestNbaExecutableOffer({ lines, market, pickSide: side,
            acceptedBooks: market === "spread" ? c.consensus.spreadAcceptedBooks : c.consensus.totalAcceptedBooks,
            consensusPickLine: line, modelProbabilityAtPickLine: () => probability });
          if (offer) return [offer.pick.sportsbook];
        }
        const selected = side === null ? null : bestExecutionSportsbook({ lines, market, side, line });
        return selected ? [selected] : [];
      };
      return { moneyline: book("moneyline", c.picks.moneyline, null),
        spread: book("spread", c.picks.spread, c.consensus.spreadHome === null ? null : c.picks.spread === "home" ? c.consensus.spreadHome : -c.consensus.spreadHome),
        total: book("total", c.picks.total, c.consensus.totalLine) };
    };
    const resolvedExecution = resolveNbaExecutionFixedPoint({ initial: previewCandidate, executionBooks,
      evaluate: (executionExclusions, disabledMarkets) => {
      const reader = buildNbaProfessionalMarketReader({
      evaluatedAt: readerEvaluatedAt,
      priceRows: readerPriceRowsByGame.get(s.game_external_id) ?? [],
      splitRows: readerSplitRowsByGame.get(s.game_external_id) ?? [],
      evidenceErrors: readerEvidenceErrors,
      selectedLines: {
        spreadHome: previewCandidate.consensus.spreadHome,
        total: previewCandidate.consensus.totalLine,
      },
      excludedSportsbooksByMarket: executionExclusions,
    });
      return buildNbaProfessionalCandidate({
      artifact: professionalArtifact,
      featureRow: portableFeatureRow,
      lines,
      history: movementHistory,
      externalGameId: s.game_external_id,
      marketReader: reader,
      independentOverride: selectedIndependent,
      marketContext: {
        eventId: String(s.game_external_id), evaluatedAt: readerEvaluatedAt,
        inputFingerprint: nbaIndependentInputFingerprint({ modelRelease: NBA_MODEL_RELEASE,
          artifactRelease: professionalArtifact.release, featureRelease: professionalArtifact.featureRelease, rosterRelease: rosterRegime.audit.release,
          features: portableFeatureRow, independentMargin: selectedIndependent.marginHome, independentTotal: selectedIndependent.total,
          residualLaw: previewCandidate.priceLaw,
          injuriesKnown: [s.data_quality.home_injuries_known, s.data_quality.away_injuries_known],
          homeInjuries: s.home_injuries, awayInjuries: s.away_injuries, rosterStatus: rosterRegime.audit.status,
          homeRetained: rosterRegime.audit.homeRetainedMinutesShare, awayRetained: rosterRegime.audit.awayRetainedMinutesShare }),
        previousState: priorKnowledgeByExternalId.get(s.game_external_id),
        priceRows: readerPriceRowsByGame.get(s.game_external_id) ?? [], splitRows: readerSplitRowsByGame.get(s.game_external_id) ?? [],
        pricesTrusted: reader.evidenceFamilies?.prices !== "failed", splitsTrusted: reader.evidenceFamilies?.splits !== "failed",
        excludedSportsbooksByMarket: executionExclusions,
        disabledMarkets,
      },
      });
    } });
    const candidate = resolvedExecution.candidate;
    const reader = candidate.marketReader!;
    const pred = applyNbaProfessionalCandidate({
      baseline,
      candidate,
      retainLegacyInjuryCap: options.retainLegacyInjuryCap,
    });
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
      retainLegacyGradeEconomics: options.retainLegacyGradeEconomics,
      retainLegacyMoneylineEvidenceGrade: options.retainLegacyMoneylineEvidenceGrade,
    });
    dto.grounding_audit = {
      release: NBA_MARKET_MARRIAGE_RELEASE,
      independent_primary: false,
      independent_role: "pristine_forecast_input_to_joint_market_decision",
      independent_projection: {
        home_score: candidate.independent.homeScore,
        away_score: candidate.independent.awayScore,
        total: candidate.independent.total,
        margin_home: candidate.independent.marginHome,
      },
      market_reader_knowledge_state: candidate.marketConsequence?.state ?? null,
      market_reader_execution_resolution: { excluded: resolvedExecution.exclusions, iterations: resolvedExecution.iterations, cycleMarkets: resolvedExecution.cycleMarkets },
      market_reader_consequence: candidate.marketConsequence === null ? null : {
        ...candidate.marketConsequence, state: undefined,
        books: candidate.marketConsequence.books.map(book => ({ ...book, proposals: book.proposals.map(p => ({
          market: p.market, provider: p.provider, anchorCaptureAt: p.anchor.captureAt, currentCaptureAt: p.current.captureAt,
          innovationLogOdds: p.innovationLogOdds, probability: p.probability, location: p.location, delta: p.delta, path: p.path,
        })) })),
      },
      roster_regime: {
        ...rosterRegime.audit,
        selected: !options.retainLegacyRosterRegime,
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
        margin_probability_calibration: candidate.probabilityCalibration,
        final_margin_probabilities: {
          home_win: candidate.probabilities.ml_home_win_prob,
          home_cover: candidate.probabilities.spread_home_cover_prob,
        },
      },
      market_reader: { ...reader, activeDecisionHead: candidate.marketConsequence?.release ?? null, legacyQualificationsAreDiagnostics: true },
      market_reader_price_postures: pred.audit.professional_grade_context?.namedBookPostures,
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
  const lockedMemberSnapshots = applyNbaLockedMemberSnapshotPrecedence({
    games: dynamicGames,
    dbIdByExternalId: externalToDbId,
    rows: lockedRows,
  });
  const games = lockedMemberSnapshots.games;
  const lockedExternalIds = new Set(lockedRows.flatMap((row) => {
    if (row.locked_at === null) return [];
    const externalId = dbIdToExt.get(row.game_id);
    return externalId === undefined ? [] : [externalId];
  }));
  const approvedLegacyRecoveryByExternalId = new Map(
    games.flatMap((game) => {
      const gameId = externalToDbId.get(game.game_external_id);
      if (gameId === undefined) return [];
      const recovery = resolveApprovedNbaLegacyLockedEvidenceRecovery({
        game,
        gameId,
        rows: lockedRows,
      });
      return recovery === null ? [] : [[game.game_external_id, recovery] as const];
    }),
  );

  const marketSignalsCapability = publicSplitsSupported("nba")
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
    const approvedLegacyRecovery = approvedLegacyRecoveryByExternalId.get(ext);
    if (approvedLegacyRecovery !== undefined) {
      memberEvidenceByGame.set(ext, buildApprovedNbaLegacyLockedMemberGameEvidence({
        game: g,
        priceRows: readerPriceRowsByGame.get(ext) ?? [],
        recovery: approvedLegacyRecovery,
      }));
    } else if (!lockedExternalIds.has(ext)) {
      memberEvidenceByGame.set(ext, buildNbaMemberGameEvidence({
        game: g,
        // Display-only consumer chronology is deliberately merged here, after
        // the model and professional reader have finished. It cannot alter a
        // forecast, pick, grade, stake, or immutable locked payload.
        priceRows: [
          ...(readerPriceRowsByGame.get(ext) ?? []),
          ...(consumerMemberHistory.rowsByExternalGameId.get(ext) ?? []),
        ],
        splitRows: readerSplitRowsByGame.get(ext) ?? [],
        evaluatedAt: readerEvaluatedAt,
      }));
    }
  }

  return {
    nbaDto,
    openPricesByGame,
    memberEvidenceByGame,
    lockedMemberGamesByExternalId: lockedMemberSnapshots.memberGamesByExternalId,
    dbIdByExternalId: externalToDbId,
  };
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

  const {
    nbaDto,
    openPricesByGame,
    memberEvidenceByGame,
    lockedMemberGamesByExternalId,
  } = await buildNbaDailyEdgePipeline(date);
  const response = adaptNbaToDailyEdgeResponse(nbaDto, {
    openPricesByGame,
    memberEvidenceByGame,
    lockedMemberGamesByExternalId,
  });
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
      const {
        nbaDto,
        openPricesByGame,
        memberEvidenceByGame,
        lockedMemberGamesByExternalId,
      } = await buildNbaDailyEdgePipeline(slateDate);
      return adaptNbaToDailyEdgeResponse(nbaDto, {
        openPricesByGame,
        memberEvidenceByGame,
        lockedMemberGamesByExternalId,
      });
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
