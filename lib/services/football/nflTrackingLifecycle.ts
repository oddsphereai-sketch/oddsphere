import type { DailyEdgeResponse, MarketEdgeDto } from "@/app/lab/lib/labTypes";
import { footballTrackingEligibility } from "./footballTrackingPolicy";
import {
  assertNflT60CaptureTiming,
  NFL_T60_MAX_CAPTURE_LAG_MINUTES,
  type NflRegularEvaluatedBetDecision,
} from "./nflRegularDecisionEvidence";
import { assertMarketScopedFootballDecisions } from "./footballMarketScopedTracking";
import {
  NFL_V1_ACTIONABLE_GRADE_CALIBRATION_RELEASE,
  NFL_V1_ACTIONABLE_GRADE_DECISION_RELEASE,
  NFL_V1_ACTIONABLE_GRADE_MODEL_RELEASE,
  NFL_V1_EVENT_CONTAINED_SPREAD_MODEL_RELEASE,
  NFL_V1_MARKET_EVIDENCE_TOTAL_MODEL_RELEASE,
} from "./nflV1ActionableGradeCandidate";
export const NFL_TRACKING_LIFECYCLE_RELEASE =
  "nfl_tracking_lifecycle_2026_09_01_r8_forecast_value_separation" as const;

export const NFL_TRACKING_COMPOSITE_RELEASE_BUNDLE =
  "nfl_tracking_composite_release_bundle_2026_09_01_r4_forecast_value_separation" as const;

const NFL_TRACKING_MARKET_RELEASES = {
  moneyline: {
    modelRelease: NFL_V1_ACTIONABLE_GRADE_MODEL_RELEASE,
    calibrationRelease: NFL_V1_ACTIONABLE_GRADE_CALIBRATION_RELEASE,
  },
  spread: {
    modelRelease: NFL_V1_EVENT_CONTAINED_SPREAD_MODEL_RELEASE,
    calibrationRelease: NFL_V1_ACTIONABLE_GRADE_CALIBRATION_RELEASE,
  },
  total: {
    modelRelease: NFL_V1_MARKET_EVIDENCE_TOTAL_MODEL_RELEASE,
    calibrationRelease: NFL_V1_ACTIONABLE_GRADE_CALIBRATION_RELEASE,
  },
} as const;

export type NflTrackedMarket = "moneyline" | "spread" | "total";

export type NflForwardTrackingEligibility = {
  eligible: boolean;
  reason:
    | "not_t60_capture"
    | "late_or_invalid_t60_capture"
    | "publication_not_approved"
    | "incomplete_decision_set"
    | "incoherent_decision_tuple"
    | "official_tracking_not_started"
    | "eligible_regular_t60";
};

export type NflTrackingProposal = {
  lifecycleRelease: typeof NFL_TRACKING_LIFECYCLE_RELEASE;
  sport: "nfl";
  season: 2026;
  seasonPhase: "preseason" | "regular" | "postseason";
  week: number;
  gameId: string;
  providerGameId: number;
  awayTeam: string;
  homeTeam: string;
  gameStartAt: string;
  lockedAt: string;
  market: NflTrackedMarket;
  pick: string;
  line: number | null;
  priceAmerican: number;
  modelProbability: number;
  marketProbability: number;
  playGrade: string;
  projectionRelease: string;
  calibrationRelease: string;
  decisionRelease: string;
  trackingEligible: boolean;
  appendToExistingLifetime: boolean;
  trackingReason: string;
};

export const NFL_EVALUATED_TUPLE_TRACKING_BOUNDARY_RELEASE =
  "nfl_evaluated_tuple_tracking_boundary_2026_09_01_r5_forecast_value_separation" as const;

/**
 * Fail-closed production gate used by the single NFL forward writer before it
 * marks a payload tracking-eligible or attempts a prediction-record insert.
 * The grade bundle cannot enable tracking by itself: the writer must also
 * prove a regular-season, on-time, immutable T-60 capture and an officially
 * launched registry boundary.
 */
export function nflForwardT60TrackingEligibility(args: {
  stage: "opening" | "unlocked" | "t60";
  captureTiming: "on_time" | "late_first_observation";
  t60LagMinutes: number | null;
  capturedAt: string;
  providerGameId: string;
  gameStartsAt: string;
  decisions: NflRegularEvaluatedBetDecision[];
  publicationApproved: boolean;
  officialRegistryLaunched: boolean;
}): NflForwardTrackingEligibility {
  if (args.stage !== "t60") return { eligible: false, reason: "not_t60_capture" };
  if (
    args.captureTiming !== "on_time" ||
    args.t60LagMinutes === null ||
    args.t60LagMinutes < 0 ||
    args.t60LagMinutes > NFL_T60_MAX_CAPTURE_LAG_MINUTES
  ) {
    return { eligible: false, reason: "late_or_invalid_t60_capture" };
  }
  if (!args.publicationApproved) return { eligible: false, reason: "publication_not_approved" };
  if (args.decisions.length === 0) {
    return { eligible: false, reason: "incomplete_decision_set" };
  }
  try {
    assertMarketScopedFootballDecisions(args.decisions, "NFL T-60 tracking boundary");
  } catch {
    return { eligible: false, reason: "incoherent_decision_tuple" };
  }
  const capturedAt = Date.parse(args.capturedAt);
  const gameStartsAt = Date.parse(args.gameStartsAt);
  const releasesAreCoherent = args.decisions.every((decision) => {
    const expected = NFL_TRACKING_MARKET_RELEASES[decision.market];
    return decision.modelRelease === expected.modelRelease &&
      decision.calibrationRelease === expected.calibrationRelease &&
      decision.decisionRelease === NFL_V1_ACTIONABLE_GRADE_DECISION_RELEASE;
  });
  const tuplesAreCoherent = Number.isFinite(capturedAt) && Number.isFinite(gameStartsAt) &&
    releasesAreCoherent && args.decisions.every((decision) =>
      decision.providerGameId === args.providerGameId &&
      decision.stage === "t60_locked" &&
      decision.lockedAt !== null &&
      Date.parse(decision.lockedAt) === capturedAt &&
      Date.parse(decision.evaluatedAt) === capturedAt &&
      Date.parse(decision.gameStartsAt) === gameStartsAt &&
      Date.parse(decision.evaluatedQuote.observedAt) <= capturedAt);
  if (!tuplesAreCoherent) return { eligible: false, reason: "incoherent_decision_tuple" };
  try {
    assertNflT60CaptureTiming({ lockedAt: args.capturedAt, gameStartsAt: args.gameStartsAt });
  } catch {
    return { eligible: false, reason: "late_or_invalid_t60_capture" };
  }
  const policy = footballTrackingEligibility({
    seasonPhase: "regular",
    modelApproved: true,
    officialRegistryLaunched: args.officialRegistryLaunched,
    predictionLocked: true,
  });
  if (!policy.eligible) return { eligible: false, reason: "official_tracking_not_started" };
  return { eligible: true, reason: "eligible_regular_t60" };
}

export type NflEvaluatedTupleTrackingProposal = NflTrackingProposal & {
  tupleBoundaryRelease: typeof NFL_EVALUATED_TUPLE_TRACKING_BOUNDARY_RELEASE;
  decisionSchemaRelease: string;
  evaluatedAt: string;
  evaluatedSportsbook: string;
  evaluatedQuoteObservedAt: string;
};

export type NflTrackingSettlement = {
  gameId: string;
  market: NflTrackedMarket;
  outcome: "win" | "loss" | "push" | "void";
  finalAwayScore: number;
  finalHomeScore: number;
};

export function buildNflTrackingProposals(args: {
  snapshot: DailyEdgeResponse;
  seasonPhase: "preseason" | "regular" | "postseason";
  week: number;
  lockedAt: string | Readonly<Record<string, string>>;
  modelApproved: boolean;
  officialRegistryLaunched: boolean;
  projectionRelease: string;
  calibrationRelease: string;
  decisionRelease: string;
}): NflTrackingProposal[] {
  if (args.snapshot.sport !== "nfl") throw new Error("NFL tracking lifecycle received a non-NFL snapshot.");
  if (args.snapshot.games.length === 0) throw new Error("NFL tracking lock received an empty weekly card.");
  const rows = args.snapshot.games.flatMap((game) => {
    const start = game.gameStartAt ?? null;
    if (!start || !Number.isFinite(Date.parse(start))) throw new Error(`NFL game ${game.id} is missing a valid start time.`);
    const lockedAt = typeof args.lockedAt === "string" ? args.lockedAt : args.lockedAt[game.id];
    const lockedAtMs = Date.parse(lockedAt ?? "");
    if (!lockedAt || !Number.isFinite(lockedAtMs)) {
      throw new Error(`NFL game ${game.id} is missing an actual ISO lock timestamp.`);
    }
    const lockedBeforeKickoff = lockedAtMs < Date.parse(start);
    return [
      proposal(game.id, game.external_id, game.awayTeam, game.homeTeam, start, "moneyline", game.markets.moneyline),
      proposal(game.id, game.external_id, game.awayTeam, game.homeTeam, start, "total", game.markets.total),
      proposal(game.id, game.external_id, game.awayTeam, game.homeTeam, start, "spread", game.markets.first_inning),
    ].map((row) => {
      const eligibility = footballTrackingEligibility({
        seasonPhase: args.seasonPhase,
        modelApproved: args.modelApproved,
        officialRegistryLaunched: args.officialRegistryLaunched,
        predictionLocked: lockedBeforeKickoff,
      });
      return {
        ...row,
        lifecycleRelease: NFL_TRACKING_LIFECYCLE_RELEASE,
        sport: "nfl" as const,
        season: 2026 as const,
        seasonPhase: args.seasonPhase,
        week: args.week,
        lockedAt,
        projectionRelease: args.projectionRelease,
        calibrationRelease: args.calibrationRelease,
        decisionRelease: args.decisionRelease,
        trackingEligible: eligibility.eligible,
        appendToExistingLifetime: eligibility.appendToExistingLifetime,
        trackingReason: eligibility.reason,
      };
    });
  });
  const expectedRows = args.snapshot.games.length * 3;
  if (rows.length !== expectedRows || new Set(rows.map((row) => `${row.gameId}:${row.market}`)).size !== expectedRows) {
    throw new Error(`NFL tracking lifecycle must produce exactly three unique markets per game; expected ${expectedRows}.`);
  }
  return rows;
}

/**
 * Production boundary: tracking rows must be written from the exact T-60
 * decision tuples, never reconstructed from a later reader quote. The single
 * leased NFL writer owns the call site once the Week 1 registry is launched.
 */
export function buildNflTrackingProposalsFromEvaluatedDecisions(args: {
  snapshot: DailyEdgeResponse;
  decisions: NflRegularEvaluatedBetDecision[];
  seasonPhase: "regular" | "postseason";
  week: number;
  modelApproved: boolean;
  officialRegistryLaunched: boolean;
}): NflEvaluatedTupleTrackingProposal[] {
  if (args.snapshot.sport !== "nfl") throw new Error("NFL evaluated tracking received a non-NFL snapshot.");
  if (args.snapshot.games.length === 0) throw new Error("NFL evaluated tracking received an empty weekly card.");
  const publishedProviderIds = new Set(args.snapshot.games.map((game) => String(game.external_id)));
  const decisionsByGame = new Map<string, NflRegularEvaluatedBetDecision[]>();
  for (const decision of args.decisions) {
    if (!publishedProviderIds.has(decision.providerGameId)) {
      throw new Error(`NFL evaluated tuple references an unpublished game ${decision.providerGameId}.`);
    }
    if (decision.stage !== "t60_locked" || !decision.lockedAt) {
      throw new Error(`NFL tracking requires a frozen T-60 tuple for ${decision.providerGameId}/${decision.market}.`);
    }
    assertNflT60CaptureTiming({ lockedAt: decision.lockedAt, gameStartsAt: decision.gameStartsAt });
    decisionsByGame.set(decision.providerGameId, [...(decisionsByGame.get(decision.providerGameId) ?? []), decision]);
  }
  const rows = args.snapshot.games.flatMap((game) => {
    const providerGameId = String(game.external_id);
    const decisions = decisionsByGame.get(providerGameId) ?? [];
    if (decisions.length === 0) return [];
    assertMarketScopedFootballDecisions(decisions, `NFL evaluated tracking for ${providerGameId}`);
    if (
      new Set(decisions.map((decision) => decision.lockedAt)).size !== 1 ||
      new Set(decisions.map((decision) => decision.modelRelease)).size !== 1 ||
      new Set(decisions.map((decision) => decision.calibrationRelease)).size !== 1 ||
      new Set(decisions.map((decision) => decision.decisionRelease)).size !== 1
    ) {
      throw new Error(`NFL evaluated tracking tuples are release- or lock-incoherent for ${providerGameId}.`);
    }
    return decisions.map((decision): NflEvaluatedTupleTrackingProposal => {
      if (Date.parse(decision.gameStartsAt) !== Date.parse(game.gameStartAt ?? "")) {
        throw new Error(`NFL evaluated tuple start time does not match the published game for ${providerGameId}.`);
      }
      const eligibility = footballTrackingEligibility({
        seasonPhase: args.seasonPhase,
        modelApproved: args.modelApproved,
        officialRegistryLaunched: args.officialRegistryLaunched,
        predictionLocked: Date.parse(decision.lockedAt!) < Date.parse(decision.gameStartsAt),
      });
      return {
        lifecycleRelease: NFL_TRACKING_LIFECYCLE_RELEASE,
        tupleBoundaryRelease: NFL_EVALUATED_TUPLE_TRACKING_BOUNDARY_RELEASE,
        decisionSchemaRelease: decision.schemaRelease,
        sport: "nfl",
        season: 2026,
        seasonPhase: args.seasonPhase,
        week: args.week,
        gameId: game.id,
        providerGameId: game.external_id,
        awayTeam: game.awayTeam,
        homeTeam: game.homeTeam,
        gameStartAt: decision.gameStartsAt,
        lockedAt: decision.lockedAt!,
        market: decision.market,
        pick: decision.side,
        line: decision.evaluatedQuote.line,
        priceAmerican: decision.evaluatedQuote.price,
        modelProbability: decision.modelProbability,
        marketProbability: decision.marketFairProbability,
        playGrade: decision.grade,
        projectionRelease: decision.modelRelease,
        calibrationRelease: decision.calibrationRelease,
        decisionRelease: decision.decisionRelease,
        trackingEligible: eligibility.eligible,
        appendToExistingLifetime: eligibility.appendToExistingLifetime,
        trackingReason: eligibility.reason,
        evaluatedAt: decision.evaluatedAt,
        evaluatedSportsbook: decision.evaluatedQuote.sportsbook,
        evaluatedQuoteObservedAt: decision.evaluatedQuote.observedAt,
      };
    });
  });
  const expected = args.decisions.length;
  if (rows.length !== expected || new Set(rows.map((row) => `${row.gameId}:${row.market}`)).size !== expected) {
    throw new Error(`NFL evaluated tracking tuple count mismatch; expected ${expected}.`);
  }
  return rows;
}

export function settleNflTrackingProposal(
  row: NflTrackingProposal,
  final: { awayScore: number; homeScore: number; status: "final" | "canceled" | "postponed" },
): NflTrackingSettlement {
  if (final.status !== "final") {
    return settlement(row, "void", final.awayScore, final.homeScore);
  }
  const away = Number(final.awayScore);
  const home = Number(final.homeScore);
  if (!Number.isFinite(away) || !Number.isFinite(home)) return settlement(row, "void", away, home);
  if (row.market === "moneyline") {
    if (away === home) return settlement(row, "push", away, home);
    const winner = home > away ? row.homeTeam : row.awayTeam;
    return settlement(row, normalizeTeam(row.pick) === normalizeTeam(winner) ? "win" : "loss", away, home);
  }
  if (row.market === "total") {
    if (row.line === null) return settlement(row, "void", away, home);
    const difference = away + home - row.line;
    if (difference === 0) return settlement(row, "push", away, home);
    const over = /^over\b/i.test(row.pick);
    return settlement(row, (over ? difference > 0 : difference < 0) ? "win" : "loss", away, home);
  }
  if (row.line === null) return settlement(row, "void", away, home);
  const selectedHome = normalizeTeam(row.pick) === normalizeTeam(row.homeTeam);
  const selectedScore = selectedHome ? home : away;
  const opponentScore = selectedHome ? away : home;
  const difference = selectedScore + row.line - opponentScore;
  return settlement(row, difference === 0 ? "push" : difference > 0 ? "win" : "loss", away, home);
}

function proposal(
  gameId: string,
  providerGameId: number,
  awayTeam: string,
  homeTeam: string,
  gameStartAt: string,
  market: NflTrackedMarket,
  value: MarketEdgeDto,
) {
  if (
    !value.pick ||
    value.priceAmerican === null ||
    value.modelProb === null ||
    value.marketFairProb === null
  ) {
    throw new Error(`NFL tracking proposal is incomplete for ${gameId}/${market}.`);
  }
  return {
    gameId,
    providerGameId,
    awayTeam,
    homeTeam,
    gameStartAt,
    market,
    pick: value.pick,
    line: value.line,
    priceAmerican: value.priceAmerican,
    modelProbability: value.modelProb,
    marketProbability: value.marketFairProb,
    playGrade: value.verdict.label,
  };
}

function settlement(row: NflTrackingProposal, outcome: NflTrackingSettlement["outcome"], away: number, home: number): NflTrackingSettlement {
  return { gameId: row.gameId, market: row.market, outcome, finalAwayScore: away, finalHomeScore: home };
}

function normalizeTeam(value: string): string {
  return value.trim().split(/\s+/)[0]!.toUpperCase();
}
