/**
 * Phase 7L Phase 4 — NHL prediction_records writer.
 *
 * Writes one prediction_records row per regular-season game market
 * (moneyline, total, puck line) for the requested slate.
 *
 * Scope:
 *   • Markets: moneyline, total, and spread (NHL puck line).
 *   • No props.
 *   • sport='nhl'; never touches MLB / NBA rows.
 *
 * Idempotency:
 *   • Upsert on (game_id, market, model_version, slate_date) — same
 *     v17 unique key MLB/NBA use.
 *   • Locked-row preservation: once locked_at IS NOT NULL, subsequent
 *     passes SKIP. Lock captures the snapshot at puck drop.
 *
 * Lock semantics:
 *   • Set locked_at = now() when game starts within
 *     LOCK_MINUTES_BEFORE_PUCK_DROP of now, or game has already started.
 *   • Lock freezes the full snapshot: model output, market price/line,
 *     goalie assumption, feature inputs. Only `result` updates after.
 *
 * snapshot_json (stable schema for ops review + future migrations):
 *   {
 *     model_version: "nhl_regular_2026_r2_complete_slate_odds",
 *     model_output: { ...nhlRegularModelV1 result },
 *     feature_inputs: { ...featureSnapshot inputs },
 *     market_at_lock: {
 *       ml_implied_home_prob, ml_book_count,
 *       total_line, total_book_count,
 *       lines_snapshot: [...]
 *     },
 *     goalie_assumption: {
 *       home: { player_external_id, player_name, source },
 *       away: { player_external_id, player_name, source }
 *     },
 *     locked_at_iso, lock_source
 *   }
 */

import { supabase } from "../../db/supabase";
import {
  selectNhlBestPriceQuote,
  type NhlSelectedPriceQuote,
} from "./nhlLineBoard";
import {
  buildNhlFeatureSnapshot,
  nhlGameTypeFromExternalId,
  nhlSeasonStartYearFromExternalId,
} from "./featureSnapshot";
import {
  NHL_REGULAR_CALIBRATION_RELEASE,
  NHL_REGULAR_DECISION_RELEASE,
  NHL_REGULAR_MODEL_RELEASE,
  NHL_REGULAR_TRANSITION_MODEL_RELEASES,
  resolveNhlPriceAwareVerdict,
  type NhlFeatureSnapshot,
  type NhlModelOutput,
} from "../../automodel/nhlRegularModelV1";
import {
  fetchBdlNhlRosters,
  fetchBdlNhlTeamMetricsWithPriorFallback,
} from "../../providers/nhl/_ballDontLieNhlClient";
import {
  aggregateNhlRosterPrior,
  normalizeNhlPlayerName,
  type NhlRosterPrior,
} from "../../automodel/nhlRosterPrior2026";
import { assertOfficialTrackingMarket } from "../../config/officialTrackingMarkets";
import type { PredictionRecordRow } from "../../types/domain/Tracking";
import {
  identifiedNhlProfessionalSplits,
  readStoredSharpApiCurrentSplits,
  type NhlIdentifiedProfessionalSplit,
} from "../../providers/real_api/sharpApiCurrentSplits";
import {
  nhlSplitPressureReceipt,
  resolvedNhlSplitsByGame,
  type ResolvedNhlSplitsEvent,
} from "./nhlResolvedSplits";
import { loadNhlRegularStateForSlate } from "./loadNhlRegularState";
import { loadNhlOpponentAdjustedState } from "./loadNhlOpponentAdjustedState";
import { buildNhlRegularMarketAwareForecast } from "./nhlTargetExcludedTotalMarket";
import { buildNhlTwoSidedPriceTrail, type NhlTwoSidedPriceTrail } from "./nhlPriceTrail";
import {
  NHL_PROFESSIONAL_SPLIT_MAX_AGE_MS,
  selectNhlProfessionalSplitPressure,
} from "./nhlProfessionalSplitPressure";
import {
  buildNhlReaderReceipt,
  NHL_READER_RECEIPT_RELEASE,
  NHL_READER_RECEIPT_SCHEMA_VERSION,
  type NhlReaderDecisionPoint,
  type NhlReaderMarket,
  type NhlReaderMarketReceipt,
  type NhlReaderQuoteStop,
  type NhlReaderReceipt,
  type NhlReaderSide,
  type NhlReaderSplitReceipt,
} from "./nhlReaderReceipt";
import type { NhlMarketEpisodeDecision } from "./nhlMarketEpisodeArbiter";
import { canonicalNhlSportsbookFamily } from "./nhlSportsbookFamily";
import { priceNhlModelWithReaderReceipt, resolveNhlMoneylineBestVerdict } from "./nhlMoneylineBestConfirmation";

const LOCK_MINUTES_BEFORE_PUCK_DROP = 60;

export type WriteNhlRecordsOptions = {
  /** YYYY-MM-DD ET slate. */
  slateDate: string;
  /** MoneyPuck season start-year (2025 for 2025-26). */
  season?: number;
  /** false = dry-run; no DB writes. */
  apply: boolean;
  /** Optional exact NHL API game ids for a targeted pre-lock refresh. */
  externalIdsFilter?: number[];
  /** Let the shared pregame sweep apply the lock only after coherence checks. */
  deferLock?: boolean;
  /** Manual goalie overrides (player_external_id from nhl_goalie_stats). */
  homeGoalieExternalId?: number;
  awayGoalieExternalId?: number;
  /**
   * Goalie source tag persisted in snapshot. The ordinary automated path
   * filters prior goalie stats to the verified current roster; it must never
   * be described as a confirmed starter. Manual overrides remain explicit.
   */
  goalieSource?: "current_roster_prior_gp" | "default_most_playoff_gp" | "manual_override";
  logger?: (msg: string) => void;
};

export type WriteNhlRecordsResult = {
  mode: "dry-run" | "write" | "no-games";
  gamesProcessed: number;
  recordsCreated: number;
  recordsSkippedLocked: number;
  recordsSkippedPass: number;
  errors: string[];
};

type DbGame = {
  id: number;
  external_id: number;
  home_team_id: number | null;
  away_team_id: number | null;
  game_date: string;
  slate_date: string;
};

type TeamRow = { id: number; abbreviation: string };

function shouldLock(gameDateIso: string, now: Date): boolean {
  try {
    const puckDrop = new Date(gameDateIso).getTime();
    const nowMs = now.getTime();
    return puckDrop - nowMs <= LOCK_MINUTES_BEFORE_PUCK_DROP * 60 * 1000;
  } catch {
    return false;
  }
}

function gradeFromVerdict(verdict: string): string {
  switch (verdict) {
    case "best_angle": return "best_signal";
    case "lean":       return "model_only";
    case "watchlist":  return "market_watch";
    case "pass":       return "model_only";
    default:           return "model_only";
  }
}

/**
 * Build the snapshot_json payload — a stable, ops-readable record of
 * everything that fed the prediction at lock time. Caller passes the
 * goalie meta directly so we don't re-fetch.
 */
function buildSnapshotJson(opts: {
  model: NhlModelOutput;
  marketLines: Array<{
    market_type: string;
    sportsbook: string;
    side: string;
    line_value: number | null;
    odds_american: number | null;
    observed_at?: string | null;
  }>;
  evaluatedQuotes: Record<"moneyline" | "total" | "spread", NhlSelectedPriceQuote | null>;
  goalieAssumption: {
    home: { player_external_id?: number; player_name?: string; source: string };
    away: { player_external_id?: number; player_name?: string; source: string };
  };
  featureInputs: NhlFeatureSnapshot;
  lockedAtIso: string | null;
  lockSource: "live" | "locked";
  // P1-2 Commit A — needed to build the PL* substrate.
  homeAbbr: string;
  capturedAt: string;
  readerReceipt: NhlReaderReceipt;
}): Record<string, unknown> {
  return {
    model_version: NHL_REGULAR_MODEL_RELEASE,
    calibration_version: NHL_REGULAR_CALIBRATION_RELEASE,
    decision_version: NHL_REGULAR_DECISION_RELEASE,
    model_output: opts.model,
    feature_inputs: opts.featureInputs,
    market_at_lock: {
      ml_implied_home_prob: opts.model.inputs_summary.market_book_count > 0
        ? opts.model.moneyline.model_market_gap_pct !== null
          ? opts.model.moneyline.probability - opts.model.moneyline.model_market_gap_pct
          : null
        : null,
      ml_book_count: opts.model.inputs_summary.moneyline_book_count,
      moneyline_book_count: opts.model.inputs_summary.moneyline_book_count,
      spread_book_count: opts.model.inputs_summary.spread_book_count,
      total_book_count: opts.model.inputs_summary.total_book_count,
      total_line: opts.model.total.model_market_gap_pct !== null
        ? opts.model.expected_total_goals - opts.model.total.model_market_gap_pct
        : null,
      target_excluded_total_read: opts.featureInputs.market.target_excluded_total_read ?? null,
      target_exclusion_status: opts.featureInputs.market.target_exclusion_status ?? "unavailable",
      lines_snapshot: opts.marketLines,
    },
    evaluated_quotes: opts.evaluatedQuotes,
    nhl_reader_receipt_v2: opts.readerReceipt,
    captured_at: opts.capturedAt,
    goalie_assumption: opts.goalieAssumption,
    locked_at_iso: opts.lockedAtIso,
    lock_source: opts.lockSource,
  };
}

type ReaderLineRow = {
  market_type: string;
  sportsbook: string;
  side: string;
  line_value: number | null;
  odds_american: number | null;
  observed_at?: string | null;
  source_timestamp?: string | null;
};

export function buildReaderReceiptForWrite(args: {
  gameId: number;
  externalId: number;
  slateDate: string;
  gameStartAt: string;
  snapshot: NhlFeatureSnapshot;
  seedModel: NhlModelOutput;
  finalModel: NhlModelOutput;
  currentRows: readonly ReaderLineRow[];
  historyRows: readonly ReaderLineRow[];
  evaluatedQuotes: Record<NhlReaderMarket, NhlSelectedPriceQuote | null>;
  split: ResolvedNhlSplitsEvent | null;
  professionalSplits: readonly NhlIdentifiedProfessionalSplit[];
  capturedAt: string;
  homeAbbr: string;
  awayAbbr: string;
}): NhlReaderReceipt {
  const clock = (sourceObservedAt: string | null, receivedAt = args.capturedAt) => ({
    sourceObservedAt,
    receivedAt,
    capturedAt: args.capturedAt,
  });
  const quoteStop = (
    quote: NhlSelectedPriceQuote | null,
    side: NhlReaderSide,
  ): NhlReaderQuoteStop | null => quote && quote.sportsbook
    ? {
      sportsbook: quote.sportsbook,
      side,
      line: quote.line_value,
      american: quote.odds_american,
      clock: clock(quote.observed_at),
    }
    : null;
  const decisionPoint = (model: NhlModelOutput, market: NhlReaderMarket): NhlReaderDecisionPoint => {
    const output = market === "moneyline" ? model.moneyline : market === "total" ? model.total : model.puck_line;
    return {
      awayScore: model.projected_away_goals,
      homeScore: model.projected_home_goals,
      pick: output.pick,
      probability: output.probability,
      verdict: output.verdict,
    };
  };
  const episodeFor = (market: NhlReaderMarket): NhlMarketEpisodeDecision | null => market === "moneyline"
    ? args.snapshot.market.moneyline_market_episode ?? null
    : market === "spread"
      ? args.snapshot.market.spread_market_episode ?? null
      : args.snapshot.market.total_market_episode ?? null;
  const sideFor = (market: NhlReaderMarket): NhlReaderSide => {
    if (market === "total") return args.finalModel.total.pick.startsWith("OVER") ? "over" : "under";
    const pick = market === "moneyline" ? args.finalModel.moneyline.pick : args.finalModel.puck_line.pick;
    return pick.startsWith(args.homeAbbr) ? "home" : "away";
  };
  const lineFor = (market: NhlReaderMarket, side: NhlReaderSide): number | null => {
    if (market === "moneyline") return null;
    if (market === "total") return args.snapshot.market.market_total_line;
    return side === "home"
      ? args.snapshot.market.market_home_puck_line
      : args.snapshot.market.market_away_puck_line;
  };
  const splitReceipt = (market: NhlReaderMarket, selectedSide: NhlReaderSide): NhlReaderSplitReceipt | null => {
    const evidence = args.split?.internal_resolution?.[market];
    if (!evidence?.source || !evidence.observedAt || !evidence.completePair) return null;
    const homeOrOver = market === "total" ? "over" : "home";
    const selectedIsPrimary = selectedSide === homeOrOver;
    const primaryBets = market === "total"
      ? args.split?.total?.bets_pct?.over
      : market === "moneyline"
        ? args.split?.moneyline?.bets_pct?.home
        : args.split?.spread?.bets_pct?.home;
    const primaryMoney = market === "total"
      ? args.split?.total?.handle_pct?.over
      : market === "moneyline"
        ? args.split?.moneyline?.handle_pct?.home
        : args.split?.spread?.handle_pct?.home;
    if (primaryBets == null || primaryMoney == null) return null;
    const selectedBetsPct = (selectedIsPrimary ? primaryBets : 1 - primaryBets) * 100;
    const selectedMoneyPct = (selectedIsPrimary ? primaryMoney : 1 - primaryMoney) * 100;
    return {
      family: "public_consensus",
      provider: evidence.source,
      sourceBook: null,
      selectedSide,
      selectedMoneyPct,
      selectedBetsPct,
      opposingMoneyPct: 100 - selectedMoneyPct,
      opposingBetsPct: 100 - selectedBetsPct,
      marketLine: lineFor(market, selectedSide),
      confidence: evidence.confidence,
      selectedForPressure: episodeFor(market)?.pressure?.sourceClass === "public",
      rejectionReason: episodeFor(market)?.pressure?.sourceClass === "public" ? null : "not_selected_for_pressure",
      clock: clock(evidence.observedAt, evidence.receivedAt ?? evidence.observedAt),
    };
  };
  const professionalSplitReceipts = (
    market: NhlReaderMarket,
    selectedSide: NhlReaderSide,
  ): NhlReaderSplitReceipt[] => args.professionalSplits
    .filter((split) => split.market === market)
    .map((split) => {
      const episodePressure = episodeFor(market)?.pressure ?? null;
      const selectedForPressure = episodePressure?.source === "identified_professional_split"
        && episodePressure.sourceBook === split.sourceBook;
      const observedMs = Date.parse(split.observedAt);
      const receivedMs = Date.parse(split.receivedAt);
      const capturedMs = Date.parse(args.capturedAt);
      const rejectionReason = selectedForPressure
        ? null
        : !Number.isFinite(observedMs) || !Number.isFinite(receivedMs) || receivedMs < observedMs
          ? "invalid_clock"
          : observedMs > capturedMs || receivedMs > capturedMs
            ? "future_observation"
            : capturedMs - observedMs > NHL_PROFESSIONAL_SPLIT_MAX_AGE_MS
              || capturedMs - receivedMs > NHL_PROFESSIONAL_SPLIT_MAX_AGE_MS
              ? "stale_observation"
              : episodePressure?.source === "identified_professional_conflict"
                ? "professional_conflict"
                : "not_selected_for_pressure";
      const primarySide: NhlReaderSide = market === "total" ? "over" : "away";
      const selectedIsPrimary = selectedSide === primarySide;
      const selectedMoneyPct = selectedIsPrimary ? split.awayOrOverMoneyPct : split.homeOrUnderMoneyPct;
      const selectedBetsPct = selectedIsPrimary ? split.awayOrOverBetsPct : split.homeOrUnderBetsPct;
      return {
        family: "professional_book" as const,
        provider: "owls_current_splits",
        sourceBook: split.sourceBook,
        selectedSide,
        selectedMoneyPct,
        selectedBetsPct,
        opposingMoneyPct: selectedIsPrimary ? split.homeOrUnderMoneyPct : split.awayOrOverMoneyPct,
        opposingBetsPct: selectedIsPrimary ? split.homeOrUnderBetsPct : split.awayOrOverBetsPct,
        marketLine: lineFor(market, selectedSide),
        confidence: "high" as const,
        selectedForPressure,
        rejectionReason,
        clock: {
          sourceObservedAt: split.observedAt,
          receivedAt: split.receivedAt,
          capturedAt: args.capturedAt,
        },
      };
    });
  const trailStop = (side: NhlReaderSide, stop: NhlTwoSidedPriceTrail["selected"][number]): NhlReaderQuoteStop | null => (
    stop.sportsbook === null ? null : {
      sportsbook: stop.sportsbook,
      side,
      line: stop.line,
      american: stop.american,
      clock: clock(stop.observedAt),
    }
  );
  const buildMarket = (market: NhlReaderMarket): NhlReaderMarketReceipt => {
    const selectedSide = sideFor(market);
    const opposingSide: NhlReaderSide = market === "total"
      ? selectedSide === "over" ? "under" : "over"
      : selectedSide === "home" ? "away" : "home";
    const selectedLine = lineFor(market, selectedSide);
    const opposingLine = lineFor(market, opposingSide);
    const evaluatedQuote = args.evaluatedQuotes[market];
    const opposingQuote = selectNhlBestPriceQuote({
      rows: args.currentRows,
      market,
      side: opposingSide,
      line: opposingLine,
    });
    const trail = buildNhlTwoSidedPriceTrail({
      live: args.currentRows.map((row) => ({ ...row, observed_at: row.observed_at ?? row.source_timestamp ?? null })),
      history: args.historyRows.map((row) => ({ ...row, observed_at: row.observed_at ?? row.source_timestamp ?? null })),
      market,
      selectedSide,
      opposingSide,
      selectedLine,
      opposingLine,
      preferredBook: evaluatedQuote?.sportsbook ?? null,
      preservePreferredBook: true,
    });
    const episode = episodeFor(market);
    // The current author pair is frozen separately from the execution trail.
    // An economic coordinate alone cannot prove the exact professional payout.
    let confirmationQuotePair: NhlReaderMarketReceipt["confirmationQuotePair"] = null;
    if (market === "moneyline" && episode?.author) {
      const author = episode.author;
      const rows = args.currentRows.filter(row => row.market_type === "moneyline" && row.line_value === null
        && canonicalNhlSportsbookFamily(row.sportsbook) === canonicalNhlSportsbookFamily(author.sportsbook)
        && (row.observed_at ?? row.source_timestamp) === author.currentObservedAt);
      const side = (name: "home" | "away") => rows.filter(row => row.side === name);
      const home = side("home"), away = side("away");
      if (rows.length === 2 && home.length === 1 && away.length === 1
        && home[0].odds_american !== null && away[0].odds_american !== null) {
        const stop = (row: ReaderLineRow, side: "home" | "away"): NhlReaderQuoteStop => ({
          sportsbook: row.sportsbook, side, line: null, american: row.odds_american!, clock: clock(author.currentObservedAt),
        });
        confirmationQuotePair = { home: stop(home[0], "home"), away: stop(away[0], "away") };
      }
    }
    const rejectedByFamily = new Map((episode?.rejectedPaths ?? []).map((path) => [path.sportsbookFamily, path.reason]));
    const selectedFamily = episode?.author?.sportsbookFamily ?? null;
    const consideredPaths = (args.snapshot.market.market_episode_paths ?? [])
      .filter((path) => path.market === market)
      .map((path) => {
        const netMove = Number.isFinite(path.currentValue - path.openingValue)
          ? path.currentValue - path.openingValue
          : null;
        return {
          sportsbook: path.sportsbook,
          sourceClass: path.sourceClass,
          state: path.state === "incomplete" ? "unavailable" as const : path.state,
          direction: netMove === null || Math.abs(netMove) < 1e-12
            ? null
            : market === "total"
              ? netMove > 0 ? "over" as const : "under" as const
              : netMove > 0 ? "home" as const : "away" as const,
          selected: path.sportsbookFamily === selectedFamily,
          rejectionReason: rejectedByFamily.get(path.sportsbookFamily) ?? null,
          openingCoordinate: path.openingValue,
          currentCoordinate: path.currentValue,
          netMove,
          latestLeg: null,
          clock: clock(path.currentObservedAt),
        };
      });
    const finalLayer = market === "moneyline"
      ? {
        state: args.finalModel.layers.moneyline_market_read,
        side: args.finalModel.layers.moneyline_market_side,
        basis: args.finalModel.layers.moneyline_market_pressure_basis,
      }
      : market === "spread"
        ? {
          state: args.finalModel.layers.puck_line_market_read,
          side: args.finalModel.layers.puck_line_market_side,
          basis: args.finalModel.layers.puck_line_market_pressure_basis,
        }
        : {
          state: args.finalModel.layers.total_market_read,
          side: args.finalModel.layers.total_market_side,
          basis: args.finalModel.layers.total_market_pressure_basis,
        };
    const selectedAxisAuthor = market === "moneyline"
      ? args.finalModel.layers.side_market_authority === "moneyline"
      : market === "spread"
        ? args.finalModel.layers.side_market_authority === "spread"
        : args.finalModel.layers.total_market_authority_source === "market_episode";
    const applied = args.finalModel.layers.joint_market_projection_status === "projected"
      && episode?.author != null
      && selectedAxisAuthor;
    const homeProbability = (model: NhlModelOutput) => model.moneyline.pick.startsWith(args.homeAbbr)
      ? model.moneyline.probability
      : 1 - model.moneyline.probability;
    const homeCoverProbability = (model: NhlModelOutput) => model.puck_line.pick.startsWith(args.homeAbbr)
      ? model.puck_line.probability
      : 1 - model.puck_line.probability;
    const appliedInnovation = !applied ? 0 : market === "moneyline"
      ? homeProbability(args.finalModel) - homeProbability(args.seedModel)
      : market === "spread"
        ? homeCoverProbability(args.finalModel) - homeCoverProbability(args.seedModel)
        : args.finalModel.expected_total_goals - args.seedModel.expected_total_goals;
    return {
      ...(market === "moneyline" ? { confirmationQuotePair, confirmationSourcePaths: structuredClone((args.snapshot.market.market_episode_paths ?? []).filter(path => path.market === "moneyline" && path.sourceClass === "named")) } : {}),
      evaluatedQuote: quoteStop(evaluatedQuote, selectedSide),
      opposingQuote: quoteStop(opposingQuote, opposingSide),
      selectedTrail: trail.selected.flatMap((stop) => trailStop(selectedSide, stop) ?? []),
      opposingTrail: trail.opposing.flatMap((stop) => trailStop(opposingSide, stop) ?? []),
      lineTrail: trail.line.flatMap((stop) => trailStop(selectedSide, stop) ?? []),
      splits: {
        publicConsensus: splitReceipt(market, selectedSide),
        professionalBooks: professionalSplitReceipts(market, selectedSide),
      },
      consideredPaths,
      interpretation: {
        state: episode?.state ?? "unavailable",
        side: finalLayer.side,
        pressureBasis: finalLayer.basis,
        authoritySource: applied ? "market_episode" : "independent",
        observedInnovation: episode?.author ? episode.innovation : null,
        appliedInnovation,
        selectedMoveAt: episode?.selectedMoveAt ?? null,
        reasonCodes: [
          episode?.reason ?? "no_episode",
          ...(episode?.rejectedPressure ? [`pressure_${episode.rejectedPressure.reason}`] : []),
          ...(args.finalModel.layers.joint_market_projection_reason ? [args.finalModel.layers.joint_market_projection_reason] : []),
        ],
      },
      before: decisionPoint(args.seedModel, market),
      after: decisionPoint(args.finalModel, market),
    };
  };
  return buildNhlReaderReceipt({
    schemaVersion: NHL_READER_RECEIPT_SCHEMA_VERSION,
    release: NHL_READER_RECEIPT_RELEASE,
    capturedAt: args.capturedAt,
    cutoffAt: args.snapshot.market.market_decision_at ?? args.capturedAt,
    identity: {
      gameId: args.gameId,
      externalId: args.externalId,
      slateDate: args.slateDate,
      gameStartAt: args.gameStartAt,
      awayAbbr: args.awayAbbr,
      homeAbbr: args.homeAbbr,
      lockBoundaryAt: args.gameStartAt,
    },
    modelRelease: {
      modelVersion: args.finalModel.model_version,
      calibrationVersion: args.finalModel.calibration_version,
      decisionVersion: args.finalModel.decision_version,
    },
    markets: {
      moneyline: buildMarket("moneyline"),
      total: buildMarket("total"),
      spread: buildMarket("spread"),
    },
    finalDecision: {
      independentAwayGoals: args.seedModel.projected_away_goals,
      independentHomeGoals: args.seedModel.projected_home_goals,
      finalAwayGoals: args.finalModel.projected_away_goals,
      finalHomeGoals: args.finalModel.projected_home_goals,
    },
  });
}

export async function writeNhlPredictionRecords(
  opts: WriteNhlRecordsOptions,
): Promise<WriteNhlRecordsResult> {
  const log = opts.logger ?? (() => {});
  const errors: string[] = [];
  const now = new Date();

  // 1. Load NHL games for the slate.
  const { data: gamesData, error: gamesErr } = await supabase
    .from("games")
    .select("id, external_id, home_team_id, away_team_id, game_date, slate_date")
    .eq("sport", "nhl")
    .eq("slate_date", opts.slateDate);
  if (gamesErr) throw new Error(`load NHL games: ${gamesErr.message}`);
  const requestedExternalIds = opts.externalIdsFilter === undefined
    ? null
    : new Set(opts.externalIdsFilter);
  const games = ((gamesData as DbGame[] | null) ?? []).filter((game) => (
    nhlGameTypeFromExternalId(game.external_id) === 2
    && (requestedExternalIds === null || requestedExternalIds.has(game.external_id))
  ));
  if (games.length === 0) {
    log(`(no NHL regular-season games on slate ${opts.slateDate})`);
    return {
      mode: "no-games", gamesProcessed: 0,
      recordsCreated: 0, recordsSkippedLocked: 0, recordsSkippedPass: 0,
      errors,
    };
  }

  // 2. Load teams for matchup label.
  const teamIds = new Set<number>();
  for (const g of games) {
    if (g.home_team_id !== null) teamIds.add(g.home_team_id);
    if (g.away_team_id !== null) teamIds.add(g.away_team_id);
  }
  const { data: teamsData } = await supabase
    .from("teams")
    .select("id, abbreviation")
    .in("id", [...teamIds]);
  const teamById = new Map<number, TeamRow>(
    (teamsData as TeamRow[] | null ?? []).map((t) => [t.id, t]),
  );

  const featureSeason = opts.season ?? nhlSeasonStartYearFromExternalId(games[0]!.external_id);
  const calibratedStateByTeam = await loadNhlRegularStateForSlate(
    supabase,
    featureSeason,
    games.reduce((earliest, game) => game.game_date < earliest ? game.game_date : earliest, games[0]!.game_date),
  );
  const opponentAdjusted = await loadNhlOpponentAdjustedState(featureSeason, opts.slateDate);
  const priorGameCountResult = await supabase.from("games")
    .select("external_id")
    .eq("sport", "nhl")
    .gte("external_id", featureSeason * 1_000_000 + 20_000)
    .lte("external_id", featureSeason * 1_000_000 + 29_999)
    .lt("slate_date", opts.slateDate)
    .not("home_score", "is", null)
    .not("away_score", "is", null);
  if (priorGameCountResult.error) {
    throw new Error(`NHL fast-state coverage count: ${priorGameCountResult.error.message}`);
  }
  const expectedPriorGameIds = new Set((priorGameCountResult.data ?? []).map((game) => Number(game.external_id)));
  const expectedPriorGames = expectedPriorGameIds.size;
  const replayComplete = opponentAdjusted.complete
    && [...expectedPriorGameIds].every((gameId) => opponentAdjusted.gameIdsApplied.has(gameId));
  log(`NHL replay state: ${opponentAdjusted.source}; games=${opponentAdjusted.gamesApplied}/${expectedPriorGames}; requests=${opponentAdjusted.requestCount}${opponentAdjusted.error ? `; fallback=${opponentAdjusted.error}` : ""}`);
  let providerMetricsByTeam: Awaited<ReturnType<typeof fetchBdlNhlTeamMetricsWithPriorFallback>>["metrics"] = new Map();
  let providerFeatureSeason: number | null = null;
  const rosterPriorByTeam = new Map<string, NhlRosterPrior>();
  const currentRosterGoaliesByTeam = new Map<string, ReadonlySet<string>>(
    [...teamById.values()].map((team) => [team.abbreviation, new Set<string>()]),
  );
  if (process.env.BALLDONTLIE_API_KEY) {
    try {
      const provider = await fetchBdlNhlTeamMetricsWithPriorFallback(
        featureSeason,
        process.env.BALLDONTLIE_API_KEY,
      );
      providerMetricsByTeam = provider.metrics;
      providerFeatureSeason = provider.sourceSeason;
    } catch (error) {
      errors.push(`BALLDONTLIE team metrics: ${(error as Error).message}`);
    }
    try {
      const rosters = await fetchBdlNhlRosters(
        featureSeason,
        [...teamById.values()].map((team) => team.abbreviation),
        process.env.BALLDONTLIE_API_KEY,
      );
      for (const [team, players] of rosters) {
        const prior = aggregateNhlRosterPrior(players);
        if (prior) rosterPriorByTeam.set(team, prior);
        currentRosterGoaliesByTeam.set(team, new Set(
          players
            .filter((player) => player.positionCode === "G")
            .map((player) => normalizeNhlPlayerName(player.fullName)),
        ));
      }
    } catch (error) {
      errors.push(`BALLDONTLIE current rosters: ${(error as Error).message}`);
    }
  }
  let splitsByGame = new Map<number, ResolvedNhlSplitsEvent>();
  try {
    splitsByGame = await resolvedNhlSplitsByGame(supabase, opts.slateDate);
  } catch (error) {
    errors.push(`resolved NHL splits: ${(error as Error).message}`);
  }
  const professionalSplitFeed = await readStoredSharpApiCurrentSplits("nhl").catch((error) => {
    errors.push(`identified NHL professional splits: ${(error as Error).message}`);
    return null;
  });

  // 3. For each game: snapshot → model → write record(s).
  let recordsCreated = 0;
  let recordsSkippedLocked = 0;
  let recordsSkippedPass = 0;

  for (const g of games) {
    try {
      const gameErrorCountBefore = errors.length;
      const homeAbbr = g.home_team_id !== null ? teamById.get(g.home_team_id)?.abbreviation ?? "?" : "?";
      const awayAbbr = g.away_team_id !== null ? teamById.get(g.away_team_id)?.abbreviation ?? "?" : "?";
      const split = splitsByGame.get(g.id) ?? null;
      const professionalSplits = identifiedNhlProfessionalSplits({
        feed: professionalSplitFeed,
        slateDate: opts.slateDate,
        gameStartAt: g.game_date,
        awayAbbr,
        homeAbbr,
        cutoffAt: now.toISOString(),
      });
      const professionalPressure = (market: "moneyline" | "spread" | "total") => selectNhlProfessionalSplitPressure({
        splits: professionalSplits,
        market,
        decisionAt: now.toISOString(),
      });
      const built = await buildNhlFeatureSnapshot({
        gameId: g.id,
        season: featureSeason,
        homeGoalieExternalId: opts.homeGoalieExternalId,
        awayGoalieExternalId: opts.awayGoalieExternalId,
        providerMetricsByTeam,
        providerFeatureSeason,
        calibratedStateByTeam,
        opponentAdjustedStateByTeam: replayComplete ? opponentAdjusted.states : undefined,
        fastStateByTeam: replayComplete ? opponentAdjusted.fastStates : undefined,
        rosterPriorByTeam,
        currentRosterGoaliesByTeam,
        marketEvidence: {
          mlHomeBetsPct: split?.moneyline?.bets_pct?.home == null ? null : split.moneyline.bets_pct.home * 100,
          mlHomeMoneyPct: split?.moneyline?.handle_pct?.home == null ? null : split.moneyline.handle_pct.home * 100,
          spreadHomeBetsPct: split?.spread?.bets_pct?.home == null ? null : split.spread.bets_pct.home * 100,
          spreadHomeMoneyPct: split?.spread?.handle_pct?.home == null ? null : split.spread.handle_pct.home * 100,
          totalOverBetsPct: split?.total?.bets_pct?.over == null ? null : split.total.bets_pct.over * 100,
          totalOverMoneyPct: split?.total?.handle_pct?.over == null ? null : split.total.handle_pct.over * 100,
          mlSplitSource: split?.internal_resolution?.moneyline?.source ?? null,
          mlSplitConfidence: split?.internal_resolution?.moneyline?.confidence ?? "none",
          spreadSplitSource: split?.internal_resolution?.spread?.source ?? null,
          spreadSplitConfidence: split?.internal_resolution?.spread?.confidence ?? "none",
          totalSplitSource: split?.internal_resolution?.total?.source ?? null,
          totalSplitConfidence: split?.internal_resolution?.total?.confidence ?? "none",
          moneylinePressureReceipt: professionalPressure("moneyline") ?? nhlSplitPressureReceipt(split, "moneyline"),
          spreadPressureReceipt: professionalPressure("spread") ?? nhlSplitPressureReceipt(split, "spread"),
          totalPressureReceipt: professionalPressure("total") ?? nhlSplitPressureReceipt(split, "total"),
        },
      });
      const marketAware = buildNhlRegularMarketAwareForecast({
        snapshot: built.snapshot,
        currentRows: built.meta.market_lines,
        historyRows: built.meta.market_history_lines,
      });
      const snapshot = marketAware.snapshot;
      const model = marketAware.model;
      const meta = built.meta;
      if (!opts.apply) {
        const episodeDiagnostic = (decision: NhlFeatureSnapshot["market"]["moneyline_market_episode"]) => ({
          state: decision?.state ?? "missing",
          reason: decision?.reason ?? "missing",
          counts: decision?.counts ?? null,
          rejected: decision?.rejectedPaths.reduce<Record<string, number>>((counts, rejection) => {
            counts[rejection.reason] = (counts[rejection.reason] ?? 0) + 1;
            return counts;
          }, {}) ?? {},
          pressureRejected: decision?.rejectedPressure?.reason ?? null,
        });
        log(`  [episode-audit] ${awayAbbr} @ ${homeAbbr} ${JSON.stringify({
          paths: snapshot.market.market_episode_paths?.length ?? 0,
          moneyline: episodeDiagnostic(snapshot.market.moneyline_market_episode),
          spread: episodeDiagnostic(snapshot.market.spread_market_episode),
          total: episodeDiagnostic(snapshot.market.total_market_episode),
        })}`);
      }
      const openingWindow = snapshot.game_type === 2
        && Math.max(snapshot.home.current_season_games ?? 0, snapshot.away.current_season_games ?? 0) < 10;
      if (openingWindow
        && !model.layers.fast_state_direct_active
        && !model.layers.specialized_margin_total_handoff_active) {
        throw new Error(`NHL fast-state evidence incomplete (${opponentAdjusted.gamesApplied}/${expectedPriorGames} prior games); prediction write failed closed`);
      }

      // The feature builder and model consume the same canonical quote board.
      // Reusing it here prevents a mid-run refresh from changing the price
      // target after the target-excluded Total read has already been solved.
      const lines = meta.market_lines;

      const matchup = `${awayAbbr} @ ${homeAbbr}`;

      const goalieSource = opts.goalieSource ??
        (opts.homeGoalieExternalId !== undefined || opts.awayGoalieExternalId !== undefined
          ? "manual_override"
          : "current_roster_prior_gp");

      const goalieAssumption = {
        home: {
          player_external_id: opts.homeGoalieExternalId,
          player_name: meta.home_goalie,
          source: goalieSource,
        },
        away: {
          player_external_id: opts.awayGoalieExternalId,
          player_name: meta.away_goalie,
          source: goalieSource,
        },
      };

      const isLockingNow = opts.deferLock !== true && shouldLock(g.game_date, now);
      const lockedAtIso = isLockingNow ? now.toISOString() : null;
      const lockSource = isLockingNow ? "locked" : "live";

      // Build one row per official regular-season market.
      const marketsToWrite: Array<{
        market: "moneyline" | "total" | "spread";
        modelMarket: NhlModelOutput["moneyline"];
        side: "home" | "away" | "over" | "under";
        priceAmerican: number | null;
        lineValue: number | null;
        quote: NhlSelectedPriceQuote | null;
      }> = [];

      // Phase 7L Step 7 — persist every market including Pass/No-Play
      // so backend calibration can later answer "would the Pass picks
      // have hit?" Without this, NHL Pass markets are invisible to
      // post-hoc calibration analysis. Pass rows still set no_bet=true
      // + no_bet_reason="below_edge_threshold" so they're auditable
      // distinct from active picks.
      {
        // Moneyline — always write a row. For Pass, pick side defaults
        // to the model's nominal lean (home if expected_goal_diff >= 0)
        // even though no_bet=true, so the row still has a directional
        // record for retrospective analysis.
        const mlIsPass = model.moneyline.verdict === "pass";
        const pickIsHome = mlIsPass
          ? model.expected_goal_diff >= 0
          : model.moneyline.pick.startsWith(homeAbbr);
        const pickSide = pickIsHome ? "home" : "away";
        const quote = selectNhlBestPriceQuote({
          rows: lines,
          market: "moneyline",
          side: pickSide,
          line: null,
        });
        marketsToWrite.push({
          market: "moneyline",
          modelMarket: model.moneyline,
          side: pickSide,
          priceAmerican: quote?.odds_american ?? null,
          lineValue: null,
          quote,
        });
        if (mlIsPass) recordsSkippedPass += 1; // counter still tracks pass frequency
      }
      {
        // Total — same persist-on-pass policy. For Pass, default the
        // side to over if model_total > market_line, else under.
        const totalIsPass = model.total.verdict === "pass";
        const marketLine = snapshot.market.market_total_line;
        const pickIsOver = totalIsPass
          ? marketLine === null || model.expected_total_goals > marketLine
          : model.total.pick.startsWith("OVER");
        const totalSide = pickIsOver ? "over" : "under";
        const quote = marketLine === null ? null : selectNhlBestPriceQuote({
          rows: lines,
          market: "total",
          side: totalSide,
          line: marketLine,
        });
        marketsToWrite.push({
          market: "total",
          modelMarket: model.total,
          side: totalSide,
          priceAmerican: quote?.odds_american ?? null,
          lineValue: quote?.line_value ?? marketLine,
          quote,
        });
        if (totalIsPass) recordsSkippedPass += 1;
      }
      {
        const spreadIsPass = model.puck_line.verdict === "pass";
        const pickIsHome = model.puck_line.pick.startsWith(homeAbbr);
        const side = pickIsHome ? "home" : "away";
        const lineValue = model.puck_line.puck_line_value;
        const quote = selectNhlBestPriceQuote({
          rows: lines,
          market: "spread",
          side,
          line: lineValue,
        });
        marketsToWrite.push({
          market: "spread",
          modelMarket: model.puck_line,
          side,
          priceAmerican: quote?.odds_american ?? null,
          lineValue,
          quote,
        });
        if (spreadIsPass) recordsSkippedPass += 1;
      }

      const evaluatedQuotes = {
        moneyline: marketsToWrite.find((entry) => entry.market === "moneyline")?.quote ?? null,
        total: marketsToWrite.find((entry) => entry.market === "total")?.quote ?? null,
        spread: marketsToWrite.find((entry) => entry.market === "spread")?.quote ?? null,
      } satisfies Record<NhlReaderMarket, NhlSelectedPriceQuote | null>;
      const capturedAt = now.toISOString();
      const expectedReceiptIdentity = { gameId: g.id, externalId: g.external_id, slateDate: opts.slateDate,
        gameStartAt: g.game_date, awayAbbr, homeAbbr, lockBoundaryAt: g.game_date,
        modelVersion: NHL_REGULAR_MODEL_RELEASE, calibrationVersion: NHL_REGULAR_CALIBRATION_RELEASE, decisionVersion: NHL_REGULAR_DECISION_RELEASE };
      const unpricedReceipt = buildReaderReceiptForWrite({
        gameId: g.id,
        externalId: g.external_id,
        slateDate: opts.slateDate,
        gameStartAt: g.game_date,
        snapshot,
        seedModel: marketAware.seedModel,
        finalModel: model,
        currentRows: lines,
        historyRows: meta.market_history_lines,
        evaluatedQuotes,
        split,
        professionalSplits,
        capturedAt,
        homeAbbr,
        awayAbbr,
      });
      const { model: pricedModel, receipt: readerReceipt } = priceNhlModelWithReaderReceipt({
        model, receipt: unpricedReceipt, expected: expectedReceiptIdentity, quotes: evaluatedQuotes,
      });
      const snapshotJson = buildSnapshotJson({
        model: pricedModel,
        marketLines: lines,
        evaluatedQuotes,
        goalieAssumption,
        featureInputs: snapshot,
        lockedAtIso,
        lockSource,
        homeAbbr,
        capturedAt,
        readerReceipt,
      });

      for (const m of marketsToWrite) {
        assertOfficialTrackingMarket("nhl", m.market);
        const pickSide = m.side;

        // Check if a locked row already exists — skip if so.
        const { data: existingRows, error: existingRowsError } = await supabase
          .from("prediction_records")
          .select("id, locked_at, model_version")
          .eq("game_id", g.id)
          .eq("market", m.market)
          .in("model_version", [...NHL_REGULAR_TRANSITION_MODEL_RELEASES])
          .eq("slate_date", g.slate_date);
        if (existingRowsError) {
          throw new Error(`failed to inspect NHL transition locks: ${existingRowsError.message}`);
        }
        const existingLocked = ((existingRows ?? []) as Array<{
          locked_at: string | null;
        }>).some((row) => row.locked_at !== null);
        if (existingLocked) {
          recordsSkippedLocked += 1;
          log(`  ⏭ ${matchup} ${m.market}: locked row preserved`);
          continue;
        }

        const oddsDecimal = m.priceAmerican !== null
          ? (m.priceAmerican > 0 ? 1 + m.priceAmerican / 100 : 1 + 100 / Math.abs(m.priceAmerican))
          : null;
        const marketProbability = m.priceAmerican === null
          ? null
          : m.priceAmerican > 0
            ? 100 / (m.priceAmerican + 100)
            : -m.priceAmerican / (-m.priceAmerican + 100);
        const priceComplete = m.priceAmerican !== null
          && (m.market === "moneyline" || m.lineValue !== null);
        const effectiveVerdict = priceComplete
          ? m.market === "moneyline"
            ? resolveNhlMoneylineBestVerdict({ verdict: m.modelMarket.verdict, probability: m.modelMarket.probability,
              quote: m.quote, receipt: readerReceipt, expected: expectedReceiptIdentity })
            : resolveNhlPriceAwareVerdict(m.market, m.modelMarket.verdict, m.priceAmerican, m.modelMarket.probability)
          : "pass";
        const row: Omit<PredictionRecordRow, "id" | "created_at"> = {
          game_prediction_id: null, // v18: nullable for non-MLB
          game_id: g.id,
          external_id: g.external_id,
          sport: "nhl",
          slate_date: g.slate_date,
          game_date: g.game_date,
          matchup,
          market: m.market,
          pick: m.modelMarket.pick,
          side: pickSide,
          line_value: m.lineValue,
          odds_american: m.priceAmerican,
          odds_decimal: oddsDecimal,
          model_used: "nhlRegularModelV1",
          model_version: NHL_REGULAR_MODEL_RELEASE,
          calibration_version: NHL_REGULAR_CALIBRATION_RELEASE,
          prediction_source: "daily_edge_pipeline",
          confidence: m.modelMarket.confidence,
          model_probability: m.modelMarket.probability,
          market_probability: marketProbability,
          edge: marketProbability === null ? null : m.modelMarket.probability - marketProbability,
          expected_value: oddsDecimal === null ? null : m.modelMarket.probability * oddsDecimal - 1,
          play_grade: gradeFromVerdict(effectiveVerdict),
          prediction_type: m.market === "moneyline" ? "game_ml" : m.market === "total" ? "game_total" : "game_spread",
          best_angle: effectiveVerdict === "best_angle",
          no_bet: effectiveVerdict === "pass",
          no_bet_reason: !priceComplete
            ? "missing_current_price"
            : effectiveVerdict === "pass"
              ? "below_edge_threshold"
              : null,
          market_aligned: m.modelMarket.model_market_gap_pct !== null
            ? Math.abs(m.modelMarket.model_market_gap_pct) <= 0.05
            : false,
          data_quality_tier: (
            m.market === "moneyline" ? model.inputs_summary.moneyline_book_count
              : m.market === "spread" ? model.inputs_summary.spread_book_count
                : model.inputs_summary.total_book_count
          ) >= 3 ? "two_sided_consensus" : "single_book",
          source_quality: "release_pure_holdout",
          provisional: false,
          held: false,
          hold_reason: null,
          launch_day: false,
          manual_outcome_expected: false,
          locked_at: lockedAtIso,
          published_at: now.toISOString(),
          snapshot_json: snapshotJson,
        };

        if (!opts.apply) {
          log(`  [dry-run] ${matchup} ${m.market}/${pickSide}  pick=${m.modelMarket.pick}  prob=${m.modelMarket.probability.toFixed(3)}  verdict=${effectiveVerdict}  score=${model.projected_away_goals.toFixed(2)}-${model.projected_home_goals.toFixed(2)}  price=${m.priceAmerican}  ml_read=${model.layers.moneyline_market_read}:${model.layers.moneyline_market_side ?? "none"}:${model.layers.moneyline_market_pressure_basis ?? "none"}  ml_source=${model.layers.moneyline_market_source_class ?? "none"}:${model.layers.moneyline_market_sportsbook ?? "none"}:${model.layers.moneyline_market_path_state}  puck_read=${model.layers.puck_line_market_read}:${model.layers.puck_line_market_side ?? "none"}:${model.layers.puck_line_market_pressure_basis ?? "none"}  puck_source=${model.layers.puck_line_market_source_class ?? "none"}:${model.layers.puck_line_market_sportsbook ?? "none"}:${model.layers.puck_line_market_path_state}  total_read=${model.layers.total_market_read}:${model.layers.total_market_side ?? "none"}:${model.layers.total_market_pressure_basis ?? "none"}  total_source=${model.layers.total_market_source_class ?? "none"}:${model.layers.total_market_sportsbook ?? "none"}:${model.layers.total_market_path_state}:${model.layers.total_market_authority_source}  reasons=${model.layers.moneyline_market_reason ?? "none"}:${model.layers.puck_line_market_reason ?? "none"}:${model.layers.total_market_reason ?? "none"}  locked_at=${lockedAtIso ?? "null"}`);
          recordsCreated += 1;
          continue;
        }

        const { error: upErr } = await supabase
          .from("prediction_records")
          .upsert(row, { onConflict: "game_id,market,model_version,slate_date" });
        if (upErr) {
          const msg = `  ✗ upsert ${matchup} ${m.market}: ${upErr.message}`;
          log(msg);
          errors.push(msg);
        } else {
          log(`  ✓ ${matchup} ${m.market}/${pickSide}  pick=${m.modelMarket.pick}  locked_at=${lockedAtIso ?? "null"}`);
          recordsCreated += 1;
        }
      }

      // Once the complete current-release tuple exists, retire only older
      // unlocked transition rows for this game. Locked historical tuples are
      // immutable. This prevents the shared lock propagation from freezing
      // both the superseded and current release and double-counting tracking.
      if (opts.apply && errors.length === gameErrorCountBefore) {
        const supersededReleases = NHL_REGULAR_TRANSITION_MODEL_RELEASES.filter(
          (release) => release !== NHL_REGULAR_MODEL_RELEASE,
        );
        if (supersededReleases.length > 0) {
          const { data: supersededRows, error: supersededRowsError } = await supabase
            .from("prediction_records")
            .select("id, locked_at")
            .eq("game_id", g.id)
            .eq("sport", "nhl")
            .eq("slate_date", g.slate_date)
            .is("locked_at", null)
            .in("model_version", [...supersededReleases]);
          if (supersededRowsError) {
            errors.push(`  ✗ inspect superseded ${matchup}: ${supersededRowsError.message}`);
            continue;
          }

          const supersededIds = (supersededRows ?? []).map((row) => Number(row.id));
          if (supersededIds.length === 0) continue;

          // The grader creates pending child rows before puck drop. The FK is
          // intentionally restrictive, so verify those children are still
          // wholly pending before removing them. A settled child or a row
          // that has locked since the query fails closed and remains intact.
          const { data: gradeRows, error: gradeRowsError } = await supabase
            .from("prediction_grades")
            .select("prediction_record_id, result, win, loss, push")
            .in("prediction_record_id", supersededIds);
          if (gradeRowsError) {
            errors.push(`  ✗ inspect superseded grades ${matchup}: ${gradeRowsError.message}`);
            continue;
          }
          const unsafeGrade = (gradeRows ?? []).find((grade) => (
            grade.result !== "pending"
            || grade.win === true
            || grade.loss === true
            || grade.push === true
          ));
          if (unsafeGrade) {
            errors.push(`  ✗ retire superseded ${matchup}: grade is no longer pending`);
            continue;
          }

          if ((gradeRows ?? []).length > 0) {
            const { error: retireGradesError } = await supabase
              .from("prediction_grades")
              .delete()
              .in("prediction_record_id", supersededIds)
              .eq("result", "pending")
              .eq("win", false)
              .eq("loss", false)
              .eq("push", false);
            if (retireGradesError) {
              errors.push(`  ✗ retire superseded grades ${matchup}: ${retireGradesError.message}`);
              continue;
            }
          }

          const { error: retireError } = await supabase
            .from("prediction_records")
            .delete()
            .in("id", supersededIds)
            .eq("game_id", g.id)
            .eq("sport", "nhl")
            .eq("slate_date", g.slate_date)
            .is("locked_at", null)
            .in("model_version", [...supersededReleases]);
          if (retireError) {
            errors.push(`  ✗ retire superseded ${matchup}: ${retireError.message}`);
          } else {
            log(`  ✓ retired ${supersededIds.length} superseded unlocked rows for ${matchup}`);
          }
        }
      }
    } catch (e) {
      const msg = `  ✗ game ${g.id}: ${(e as Error).message}`;
      log(msg);
      errors.push(msg);
    }
  }

  return {
    mode: opts.apply ? "write" : "dry-run",
    gamesProcessed: games.length,
    recordsCreated,
    recordsSkippedLocked,
    recordsSkippedPass,
    errors,
  };
}
