import { createHash } from "node:crypto";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { DailyEdgeGameDto, DailyEdgePredictionDto, MarketEdgeDto, OddsTrailStopDto } from "@/app/lab/lib/labTypes";
import type { PreviewHistoryByTeam } from "@/app/dev/experience-preview/ActualDailyEdgePreview";
import { buildRecommendationDecision } from "@/lib/services/recommendationDecision";
import type { MarketSplitDisplaySection } from "@/lib/types/domain/RecommendationDecision";
import {
  CFB_FORWARD_EVIDENCE_SCHEMA_RELEASE,
  CFB_FORWARD_CALIBRATION_PREVIOUS_EVIDENCE_SCHEMA_RELEASE,
  CFB_FORWARD_CALIBRATION_PREVIOUS_MEMBER_RELEASE,
  CFB_FORWARD_AMBIGUOUS_SCOPE_PREVIOUS_EVIDENCE_SCHEMA_RELEASE,
  CFB_FORWARD_CANONICAL_DISCOVERY_PREVIOUS_EVIDENCE_SCHEMA_RELEASE,
  CFB_FORWARD_DATA_QUALITY_EVIDENCE_SCHEMA_RELEASE,
  CFB_FORWARD_INITIAL_EVIDENCE_SCHEMA_RELEASE,
  CFB_FORWARD_LEGACY_EVIDENCE_SCHEMA_RELEASE,
  CFB_FORWARD_MARKET_SHARP_PREVIOUS_EVIDENCE_SCHEMA_RELEASE,
  CFB_FORWARD_MARKET_SHARP_PREVIOUS_MEMBER_RELEASE,
  CFB_FORWARD_MARKET_SHARP_PRIOR_EVIDENCE_SCHEMA_RELEASE,
  CFB_FORWARD_MARKET_SHARP_PRIOR_MEMBER_RELEASE,
  CFB_FORWARD_PROVIDER_DISCOVERY_PREVIOUS_EVIDENCE_SCHEMA_RELEASE,
  CFB_FORWARD_PUBLIC_SPLITS_PREVIOUS_EVIDENCE_SCHEMA_RELEASE,
  CFB_FORWARD_PUBLIC_SPLITS_PREVIOUS_MEMBER_RELEASE,
  CFB_FORWARD_PRE_DIRECTIONAL_EVIDENCE_SCHEMA_RELEASE,
  CFB_FORWARD_PREVIOUS_EVIDENCE_SCHEMA_RELEASE,
  CFB_FORWARD_PRIOR_EVIDENCE_SCHEMA_RELEASE,
  CFB_FORWARD_TRANSITION_EVIDENCE_SCHEMA_RELEASE,
  CFB_FORWARD_TRANSITION_PREVIOUS_EVIDENCE_SCHEMA_RELEASE,
  CFB_FORWARD_TRANSITION_PREVIOUS_MEMBER_RELEASE,
  CFB_FORWARD_MEMBER_RELEASE,
  type CfbForwardMarketOutlook,
  type CfbForwardEvidencePayload,
  type CfbForwardPlaybookSplit,
  type CfbForwardStoredEvidence,
} from "./cfbForwardEvidence";
import { readCfbForwardEvidence } from "./cfbForwardEvidenceStore";
import {
  CFB_V1_CALIBRATION_RELEASE,
  CFB_V1_BASE_DISTRIBUTION_RELEASE,
  CFB_V1_BASE_MODEL_RELEASE,
  CFB_V1_BASE_PROBABILITY_RELEASE,
  CFB_V1_BASE_SCORE_ARTIFACT_RELEASE,
  CFB_V1_DECISION_RELEASE,
  CFB_V1_DISTRIBUTION_RELEASE,
  CFB_V1_GRADE_POLICY_RELEASE,
  CFB_V1_MODEL_RELEASE,
  CFB_V1_PROBABILITY_RELEASE,
  CFB_V1_SCORE_ARTIFACT_RELEASE,
  CFB_T60_MAX_CAPTURE_LAG_MINUTES,
  type CfbV1ExactPriceDecision,
  type CfbV1Market,
} from "./cfbV1Decision";
import { isGameInCfbWeeklyWindow, resolveCfbForwardWindow } from "./cfbWeeklyWindow";
import { cfbFootballEvidenceStats } from "./footballMemberEvidence";
import { CFB_MARKET_SHARP_AWARE_PRODUCTION_RELEASE } from "./cfbMarketSharpAwareShadow";

export const CFB_MEMBER_FIXTURE_RELEASE =
  "cfb_v1_member_fixture_2026_08_31_r37_authoritative_pmf_calibration" as const;
export const CFB_PUBLIC_OUTCOME_CONTRACT_RELEASE =
  "cfb_market_sharp_public_outcome_contract_2026_08_31_r37_authoritative_pmf_calibration" as const;
export const CFB_CONTEXT_ONLY_QUOTE_CAPTURE_SKEW_MS = 5_000 as const;
const CFB_MARKET_CONTEXT_MAX_CAPTURE_LAG_MINUTES = 10;
const CFB_PUBLIC_SCORE_DIRECTION_TOLERANCE_POINTS = 0.25;
const CFB_PRE_DIRECTIONAL_MEMBER_RELEASE = "cfb_v1_member_release_2026_08_28_r14_expanded_sharp_budget" as const;
const CFB_PRE_DIRECTIONAL_DECISION_RELEASE = "cfb_v1_daily_edge_decision_2026_08_28_r11_market_scoped_data_quality" as const;
const CFB_AMBIGUOUS_SCOPE_PREVIOUS_MEMBER_RELEASE = "cfb_v1_member_release_2026_08_28_r19_ambiguous_event_scope" as const;
const CFB_AMBIGUOUS_SCOPE_PREVIOUS_DECISION_RELEASE = "cfb_v1_daily_edge_decision_2026_08_28_r15_ambiguous_event_scope" as const;
const CFB_MARKET_SHARP_PRIOR_DECISION_RELEASE = "cfb_v1_daily_edge_decision_2026_08_28_r15_ambiguous_event_scope" as const;
const CFB_MARKET_SHARP_PREVIOUS_DECISION_RELEASE = "cfb_v1_daily_edge_decision_2026_08_29_r16_market_sharp_authoritative" as const;
const CFB_TRANSITION_PREVIOUS_DECISION_RELEASE = "cfb_v1_daily_edge_decision_2026_08_29_r17_transition_coherent" as const;
const CFB_PUBLIC_SPLITS_PREVIOUS_DECISION_RELEASE = "cfb_v1_daily_edge_decision_2026_08_30_r21_missing_anchor_game_hold" as const;
const CFB_CALIBRATION_PREVIOUS_DECISION_RELEASE = "cfb_v1_daily_edge_decision_2026_08_31_r22_public_consensus_market_input" as const;
const CFB_PROVIDER_DISCOVERY_PREVIOUS_MEMBER_RELEASE = "cfb_v1_member_release_2026_08_28_r15_directional_pmf" as const;
const CFB_PROVIDER_DISCOVERY_PREVIOUS_DECISION_RELEASE = "cfb_v1_daily_edge_decision_2026_08_28_r12_directional_pmf" as const;
const CFB_CANONICAL_PRICE_PREVIOUS_MEMBER_RELEASE = "cfb_v1_member_release_2026_08_28_r16_canonical_price_coverage" as const;
const CFB_EVENT_PAGINATION_PREVIOUS_MEMBER_RELEASE = "cfb_v1_member_release_2026_08_28_r18_event_discovery_pagination" as const;
const CFB_EVENT_PAGINATION_PREVIOUS_DECISION_RELEASE = "cfb_v1_daily_edge_decision_2026_08_28_r14_event_discovery_pagination" as const;
const CFB_INDEPENDENT_PUBLIC_PREVIOUS_MEMBER_RELEASE = "cfb_v1_member_release_2026_08_28_r17_independent_public_prediction" as const;
const CFB_INDEPENDENT_PUBLIC_PREVIOUS_DECISION_RELEASE = "cfb_v1_daily_edge_decision_2026_08_28_r13_canonical_price_coverage" as const;
const CFB_DATA_QUALITY_MEMBER_RELEASE = "cfb_v1_member_release_2026_08_28_r8_market_scoped_data_quality" as const;
const CFB_DATA_QUALITY_DECISION_RELEASE = "cfb_v1_daily_edge_decision_2026_08_28_r11_market_scoped_data_quality" as const;
const CFB_PREVIOUS_MEMBER_RELEASE = "cfb_v1_member_release_2026_08_28_r7_two_axis_outcome_sharp_splits" as const;
const CFB_PREVIOUS_DECISION_RELEASE = "cfb_v1_daily_edge_decision_2026_08_28_r10_exact_paired_market_evidence" as const;
const CFB_PRIOR_MEMBER_RELEASE = "cfb_v1_member_release_2026_08_28_r6_exact_paired_market_evidence" as const;
const CFB_PRIOR_DECISION_RELEASE = "cfb_v1_daily_edge_decision_2026_08_28_r10_exact_paired_market_evidence" as const;
const CFB_TRANSITION_MEMBER_RELEASE = "cfb_v1_member_release_2026_08_27_r5_pmf_side_guard" as const;
const CFB_TRANSITION_DECISION_RELEASE = "cfb_v1_daily_edge_decision_2026_08_27_r9_pmf_side_guard" as const;
const CFB_LEGACY_MEMBER_RELEASE = "cfb_v1_member_release_2026_08_26_r4_price_provenance" as const;
const CFB_LEGACY_DECISION_RELEASE = "cfb_v1_daily_edge_decision_2026_08_26_r7_sharpapi_price_fallback" as const;
const CFB_INITIAL_MEMBER_RELEASE = "cfb_v1_member_release_2026_08_25_r2_weekly" as const;
const CFB_INITIAL_DECISION_RELEASE = "cfb_v1_daily_edge_decision_2026_08_25_r5_weekly" as const;

export type CfbMemberFixture = {
  fixtureRelease: typeof CFB_MEMBER_FIXTURE_RELEASE;
  capturedAt: string;
  snapshot: { as_of: string; sport: "cfb"; date: string; requested_date: string; fallback_used: false; slateState: "today_draft_only"; slate_status: string; last_slate_update_at: string; games: DailyEdgeGameDto[] };
  history: PreviewHistoryByTeam;
  week: { label: string };
  provenance: { sourceChecksum: string; openingCoverageGames: number; splitCoverageGames: number; sharpSplitCoverageGames: number; quarterbackCoverageGames: number; currentOddsGames: number };
  tracking: { trackingEligible: boolean; reason: string };
};

export async function readCurrentCfbMemberFixture(args: { client: SupabaseClient; season?: number }): Promise<CfbMemberFixture> {
  return buildCfbMemberFixture(await readCfbForwardEvidence({ client: args.client, season: args.season ?? 2026 }));
}

export function buildCfbMemberFixture(rows: CfbForwardStoredEvidence[], now = new Date().toISOString()): CfbMemberFixture {
  const window = resolveCfbForwardWindow({ now, evidence: rows });
  const windowRows = rows.filter((row) => isGameInCfbWeeklyWindow({ scheduledStart: row.gameStartAt }, window));
  const latest = selectLatestCfbMemberEvidenceRows(windowRows, now);
  const movementRowsByGame = new Map(latest.map((row) => [
    row.providerGameId,
    movementRowsForGame(windowRows, row),
  ]));
  const capturedAt = latest.reduce((value, row) => Date.parse(row.capturedAt) > Date.parse(value) ? row.capturedAt : value, latest[0]!.capturedAt);
  const games = latest
    .map((row) => buildGame(row, movementRowsByGame.get(row.providerGameId)!))
    .sort((a, b) => Date.parse(a.gameStartAt ?? "") - Date.parse(b.gameStartAt ?? ""));
  const date = localDate(games[0]!.gameStartAt!);
  const sourceChecksum = createHash("sha256")
    .update([...movementRowsByGame.values()].flat()
      .map((row) => `${row.providerGameId}:${row.capturedAt}:${row.payloadSha256}`)
      .sort()
      .join("|"))
    .digest("hex");
  const trackingGames = latest.filter((row) => row.payload.decisions.trackingEnabled).length;
  return {
    fixtureRelease: CFB_MEMBER_FIXTURE_RELEASE,
    capturedAt,
    snapshot: { as_of: capturedAt, sport: "cfb", date, requested_date: date, fallback_used: false, slateState: "today_draft_only", slate_status: "cfb_week_one_model_live", last_slate_update_at: capturedAt, games },
    history: {},
    week: { label: window.boardStartDate === "2026-08-27" ? "Opening Week" : `Week of ${shortDate(window.boardStartDate)}` },
    provenance: {
      sourceChecksum,
      openingCoverageGames: latest.filter((row) => row.payload.market.operationalOpening !== null).length,
      splitCoverageGames: latest.filter((row) => row.payload.market.playbookSplits !== null).length,
      sharpSplitCoverageGames: latest.filter((row) => (row.payload.market.sharpApiSplits?.length ?? 0) > 0).length,
      quarterbackCoverageGames: latest.filter((row) => row.payload.coverage.activeQuarterbacks).length,
      currentOddsGames: latest.filter((row) => row.payload.market.current !== null).length,
    },
    tracking: { trackingEligible: trackingGames > 0, reason: trackingGames > 0 ? `${trackingGames} game${trackingGames === 1 ? " has" : "s have"} a valid immutable T-60 exact-price tuple.` : "Official CFB tracking begins game by game only after a valid T-60 lock; unlocked grades are not counted yet." },
  };
}

function movementRowsForGame(
  rows: CfbForwardStoredEvidence[],
  latest: CfbForwardStoredEvidence,
): CfbForwardStoredEvidence[] {
  return rows
    .filter((row) =>
      row.providerGameId === latest.providerGameId &&
      Date.parse(row.capturedAt) <= Date.parse(latest.capturedAt))
    .sort((first, second) => Date.parse(first.capturedAt) - Date.parse(second.capturedAt));
}

function shortDate(value: string): string {
  return new Intl.DateTimeFormat("en-US", { timeZone: "UTC", month: "short", day: "numeric" }).format(new Date(`${value}T12:00:00.000Z`));
}

export function selectLatestCfbMemberEvidenceRows(
  rows: CfbForwardStoredEvidence[],
  now = new Date().toISOString(),
): CfbForwardStoredEvidence[] {
  if (rows.length === 0) throw new Error("CFB forward evidence is empty.");
  const providerDiscoveryPrevious = completeRowsForRelease(
    rows,
    CFB_FORWARD_PROVIDER_DISCOVERY_PREVIOUS_EVIDENCE_SCHEMA_RELEASE,
    CFB_PROVIDER_DISCOVERY_PREVIOUS_MEMBER_RELEASE,
    CFB_PROVIDER_DISCOVERY_PREVIOUS_DECISION_RELEASE,
  );
  const ambiguousScopePrevious = completeRowsForRelease(rows, CFB_FORWARD_AMBIGUOUS_SCOPE_PREVIOUS_EVIDENCE_SCHEMA_RELEASE, CFB_AMBIGUOUS_SCOPE_PREVIOUS_MEMBER_RELEASE, CFB_AMBIGUOUS_SCOPE_PREVIOUS_DECISION_RELEASE);
  const ambiguousScopeBoundaryTransition = providerDiscoveryPrevious
    ? immutableBoundaryTransitionRows(
        rows,
        now,
        CFB_FORWARD_AMBIGUOUS_SCOPE_PREVIOUS_EVIDENCE_SCHEMA_RELEASE,
        CFB_AMBIGUOUS_SCOPE_PREVIOUS_MEMBER_RELEASE,
        CFB_AMBIGUOUS_SCOPE_PREVIOUS_DECISION_RELEASE,
        providerDiscoveryPrevious,
      )
    : null;
  const precedingRelease = ambiguousScopePrevious ?? ambiguousScopeBoundaryTransition;
  const marketSharpPriorTransitionBase = precedingRelease ?? providerDiscoveryPrevious;
  const marketSharpPrior = completeRowsForRelease(
    rows,
    CFB_FORWARD_MARKET_SHARP_PRIOR_EVIDENCE_SCHEMA_RELEASE,
    CFB_FORWARD_MARKET_SHARP_PRIOR_MEMBER_RELEASE,
    CFB_MARKET_SHARP_PRIOR_DECISION_RELEASE,
  );
  const marketSharpPriorBoundary = marketSharpPriorTransitionBase
    ? immutableBoundaryTransitionRows(
        rows,
        now,
        CFB_FORWARD_MARKET_SHARP_PRIOR_EVIDENCE_SCHEMA_RELEASE,
        CFB_FORWARD_MARKET_SHARP_PRIOR_MEMBER_RELEASE,
        CFB_MARKET_SHARP_PRIOR_DECISION_RELEASE,
        marketSharpPriorTransitionBase,
      )
    : null;
  const marketSharpPriorAuthority = marketSharpPrior ?? marketSharpPriorBoundary ?? marketSharpPriorTransitionBase;
  const marketSharpPrevious = completeRowsForRelease(
    rows,
    CFB_FORWARD_MARKET_SHARP_PREVIOUS_EVIDENCE_SCHEMA_RELEASE,
    CFB_FORWARD_MARKET_SHARP_PREVIOUS_MEMBER_RELEASE,
    CFB_MARKET_SHARP_PREVIOUS_DECISION_RELEASE,
  );
  const marketSharpPreviousBoundary = marketSharpPriorAuthority
    ? immutableBoundaryTransitionRows(
        rows,
        now,
        CFB_FORWARD_MARKET_SHARP_PREVIOUS_EVIDENCE_SCHEMA_RELEASE,
        CFB_FORWARD_MARKET_SHARP_PREVIOUS_MEMBER_RELEASE,
        CFB_MARKET_SHARP_PREVIOUS_DECISION_RELEASE,
        marketSharpPriorAuthority,
      )
    : null;
  const marketSharpPreviousAuthority = marketSharpPrevious ?? marketSharpPreviousBoundary ?? marketSharpPriorAuthority;
  const transitionPrevious = completeRowsForRelease(
    rows,
    CFB_FORWARD_TRANSITION_PREVIOUS_EVIDENCE_SCHEMA_RELEASE,
    CFB_FORWARD_TRANSITION_PREVIOUS_MEMBER_RELEASE,
    CFB_TRANSITION_PREVIOUS_DECISION_RELEASE,
  );
  const transitionPreviousBoundary = marketSharpPreviousAuthority
    ? immutableBoundaryTransitionRows(
        rows,
        now,
        CFB_FORWARD_TRANSITION_PREVIOUS_EVIDENCE_SCHEMA_RELEASE,
        CFB_FORWARD_TRANSITION_PREVIOUS_MEMBER_RELEASE,
        CFB_TRANSITION_PREVIOUS_DECISION_RELEASE,
        marketSharpPreviousAuthority,
      )
    : null;
  const transitionPreviousAuthority = transitionPrevious ?? transitionPreviousBoundary ?? marketSharpPreviousAuthority;
  const publicSplitsPrevious = completeRowsForRelease(
    rows,
    CFB_FORWARD_PUBLIC_SPLITS_PREVIOUS_EVIDENCE_SCHEMA_RELEASE,
    CFB_FORWARD_PUBLIC_SPLITS_PREVIOUS_MEMBER_RELEASE,
    CFB_PUBLIC_SPLITS_PREVIOUS_DECISION_RELEASE,
  );
  const publicSplitsPreviousBoundary = transitionPreviousAuthority
    ? immutableBoundaryTransitionRows(
        rows,
        now,
        CFB_FORWARD_PUBLIC_SPLITS_PREVIOUS_EVIDENCE_SCHEMA_RELEASE,
        CFB_FORWARD_PUBLIC_SPLITS_PREVIOUS_MEMBER_RELEASE,
        CFB_PUBLIC_SPLITS_PREVIOUS_DECISION_RELEASE,
        transitionPreviousAuthority,
      )
    : null;
  const publicSplitsPreviousAuthority = publicSplitsPrevious ?? publicSplitsPreviousBoundary ?? transitionPreviousAuthority;
  const calibrationPrevious = completeRowsForRelease(
    rows,
    CFB_FORWARD_CALIBRATION_PREVIOUS_EVIDENCE_SCHEMA_RELEASE,
    CFB_FORWARD_CALIBRATION_PREVIOUS_MEMBER_RELEASE,
    CFB_CALIBRATION_PREVIOUS_DECISION_RELEASE,
  );
  const calibrationPreviousBoundary = publicSplitsPreviousAuthority
    ? immutableBoundaryTransitionRows(
        rows,
        now,
        CFB_FORWARD_CALIBRATION_PREVIOUS_EVIDENCE_SCHEMA_RELEASE,
        CFB_FORWARD_CALIBRATION_PREVIOUS_MEMBER_RELEASE,
        CFB_CALIBRATION_PREVIOUS_DECISION_RELEASE,
        publicSplitsPreviousAuthority,
      )
    : null;
  const calibrationPreviousAuthority = calibrationPrevious ?? calibrationPreviousBoundary ?? publicSplitsPreviousAuthority;
  const current = completeRowsForRelease(rows, CFB_FORWARD_EVIDENCE_SCHEMA_RELEASE, CFB_FORWARD_MEMBER_RELEASE, CFB_V1_DECISION_RELEASE);
  if (current) return current;
  const immutableBoundaryTransition = calibrationPreviousAuthority
    ? immutableBoundaryTransitionRows(
        rows,
        now,
        CFB_FORWARD_EVIDENCE_SCHEMA_RELEASE,
        CFB_FORWARD_MEMBER_RELEASE,
        CFB_V1_DECISION_RELEASE,
        calibrationPreviousAuthority,
      )
    : null;
  if (immutableBoundaryTransition) return immutableBoundaryTransition;
  if (calibrationPrevious) return calibrationPrevious;
  if (calibrationPreviousBoundary) return calibrationPreviousBoundary;
  if (publicSplitsPrevious) return publicSplitsPrevious;
  if (publicSplitsPreviousBoundary) return publicSplitsPreviousBoundary;
  if (transitionPrevious) return transitionPrevious;
  if (transitionPreviousBoundary) return transitionPreviousBoundary;
  if (marketSharpPrevious) return marketSharpPrevious;
  if (marketSharpPreviousBoundary) return marketSharpPreviousBoundary;
  if (marketSharpPrior) return marketSharpPrior;
  if (marketSharpPriorBoundary) return marketSharpPriorBoundary;
  if (ambiguousScopePrevious) return ambiguousScopePrevious;
  if (ambiguousScopeBoundaryTransition) return ambiguousScopeBoundaryTransition;
  const eventPaginationFallback = completeRowsForRelease(rows, CFB_FORWARD_AMBIGUOUS_SCOPE_PREVIOUS_EVIDENCE_SCHEMA_RELEASE, CFB_EVENT_PAGINATION_PREVIOUS_MEMBER_RELEASE, CFB_EVENT_PAGINATION_PREVIOUS_DECISION_RELEASE);
  if (eventPaginationFallback) return eventPaginationFallback;
  const independentPublicFallback = completeRowsForRelease(rows, CFB_FORWARD_CANONICAL_DISCOVERY_PREVIOUS_EVIDENCE_SCHEMA_RELEASE, CFB_INDEPENDENT_PUBLIC_PREVIOUS_MEMBER_RELEASE, CFB_INDEPENDENT_PUBLIC_PREVIOUS_DECISION_RELEASE);
  if (independentPublicFallback) return independentPublicFallback;
  const canonicalPriceFallback = completeRowsForRelease(rows, CFB_FORWARD_CANONICAL_DISCOVERY_PREVIOUS_EVIDENCE_SCHEMA_RELEASE, CFB_CANONICAL_PRICE_PREVIOUS_MEMBER_RELEASE, CFB_INDEPENDENT_PUBLIC_PREVIOUS_DECISION_RELEASE);
  if (canonicalPriceFallback) return canonicalPriceFallback;
  const providerDiscoveryPreviousFallback = completeRowsForRelease(rows, CFB_FORWARD_PROVIDER_DISCOVERY_PREVIOUS_EVIDENCE_SCHEMA_RELEASE, CFB_PROVIDER_DISCOVERY_PREVIOUS_MEMBER_RELEASE, CFB_PROVIDER_DISCOVERY_PREVIOUS_DECISION_RELEASE);
  if (providerDiscoveryPreviousFallback) return providerDiscoveryPreviousFallback;
  const preDirectionalFallback = completeRowsForRelease(rows, CFB_FORWARD_PRE_DIRECTIONAL_EVIDENCE_SCHEMA_RELEASE, CFB_PRE_DIRECTIONAL_MEMBER_RELEASE, CFB_PRE_DIRECTIONAL_DECISION_RELEASE);
  if (preDirectionalFallback) return preDirectionalFallback;
  const dataQualityFallback = completeRowsForRelease(rows, CFB_FORWARD_DATA_QUALITY_EVIDENCE_SCHEMA_RELEASE, CFB_DATA_QUALITY_MEMBER_RELEASE, CFB_DATA_QUALITY_DECISION_RELEASE);
  if (dataQualityFallback) return dataQualityFallback;
  const previousFallback = completeRowsForRelease(rows, CFB_FORWARD_PREVIOUS_EVIDENCE_SCHEMA_RELEASE, CFB_PREVIOUS_MEMBER_RELEASE, CFB_PREVIOUS_DECISION_RELEASE);
  if (previousFallback) return previousFallback;
  const priorFallback = completeRowsForRelease(rows, CFB_FORWARD_PRIOR_EVIDENCE_SCHEMA_RELEASE, CFB_PRIOR_MEMBER_RELEASE, CFB_PRIOR_DECISION_RELEASE);
  if (priorFallback) return priorFallback;
  const transitionFallback = completeRowsForRelease(rows, CFB_FORWARD_TRANSITION_EVIDENCE_SCHEMA_RELEASE, CFB_TRANSITION_MEMBER_RELEASE, CFB_TRANSITION_DECISION_RELEASE);
  if (transitionFallback) return transitionFallback;
  const legacyFallback = completeRowsForRelease(rows, CFB_FORWARD_LEGACY_EVIDENCE_SCHEMA_RELEASE, CFB_LEGACY_MEMBER_RELEASE, CFB_LEGACY_DECISION_RELEASE);
  if (legacyFallback) return legacyFallback;
  const initialFallback = completeRowsForRelease(rows, CFB_FORWARD_INITIAL_EVIDENCE_SCHEMA_RELEASE, CFB_INITIAL_MEMBER_RELEASE, CFB_INITIAL_DECISION_RELEASE);
  if (initialFallback) return initialFallback;
  const observed = [...new Set(rows.map((row) => `${row.payload.schemaRelease}|${row.payload.memberRelease}|${row.payload.decisions.decisionRelease}|${row.payload.slateGameCount}`))].join(",");
  throw new Error(`CFB has no complete current or release-transition member evidence (observed=${observed}).`);
}

function immutableBoundaryTransitionRows(
  rows: CfbForwardStoredEvidence[],
  now: string,
  schemaRelease: string,
  memberRelease: string,
  decisionRelease: string,
  previous: CfbForwardStoredEvidence[],
): CfbForwardStoredEvidence[] | null {
  const current = latestValidRowsForRelease(
    rows,
    schemaRelease,
    memberRelease,
    decisionRelease,
  );
  if (!current || current.values.length >= current.expected) return null;

  if (previous.length !== current.expected) return null;

  const previousByGame = new Map(previous.map((row) => [row.providerGameId, row]));
  if (current.values.some((row) => !previousByGame.has(row.providerGameId))) return null;
  const currentByGame = new Map(current.values.map((row) => [row.providerGameId, row]));
  const missing = previous.filter((row) => !currentByGame.has(row.providerGameId));
  if (missing.length !== current.expected - current.values.length) return null;

  const responseTime = Date.parse(now);
  if (!Number.isFinite(responseTime) || missing.some((row) =>
    Date.parse(row.gameStartAt) > responseTime && !isValidImmutableBoundaryT60(row)
  )) return null;
  return previous.map((row) => currentByGame.get(row.providerGameId) ?? row);
}

function isValidImmutableBoundaryT60(row: CfbForwardStoredEvidence): boolean {
  const lag = row.payload.t60LagMinutes;
  return row.stage === "t60" &&
    row.payload.stage === "t60" &&
    row.payload.captureTiming === "on_time" &&
    lag !== null &&
    Number.isFinite(lag) &&
    lag >= 0 &&
    lag <= CFB_T60_MAX_CAPTURE_LAG_MINUTES &&
    row.payload.coverage.healthHolds.length === 0 &&
    row.payload.decisions.trackingEnabled &&
    row.payload.decisions.evaluatedBets.length > 0 &&
    row.payload.decisions.evaluatedBets.every((decision) =>
      decision.stage === "t60_locked" &&
      decision.lockedAt === row.payload.capturedAt &&
      decision.evaluatedAt === row.payload.capturedAt
    );
}

function latestValidRowsForRelease(
  rows: CfbForwardStoredEvidence[],
  schemaRelease: string,
  memberRelease: string,
  decisionRelease: string,
): { values: CfbForwardStoredEvidence[]; expected: number } | null {
  const latest = new Map<string, CfbForwardStoredEvidence>();
  for (const row of rows) {
    if (row.payload.schemaRelease !== schemaRelease || row.payload.memberRelease !== memberRelease) continue;
    const current = latest.get(row.providerGameId);
    if (!current || Date.parse(row.capturedAt) > Date.parse(current.capturedAt)) latest.set(row.providerGameId, row);
  }
  const values = [...latest.values()];
  if (values.length === 0) return null;
  const expected = Math.max(...values.map((row) => row.payload.slateGameCount));
  if (values.some((row) =>
    row.payload.slateGameCount !== expected ||
    !row.payload.decisions.publicationEnabled ||
    row.payload.decisions.decisionRelease !== decisionRelease ||
    row.payload.decisions.evaluatedBets.some((decision) => decision.decisionRelease !== decisionRelease) ||
    (schemaRelease === CFB_FORWARD_EVIDENCE_SCHEMA_RELEASE && (
      row.payload.authoritativeForecast?.release !== CFB_MARKET_SHARP_AWARE_PRODUCTION_RELEASE ||
      !row.payload.independentForecast ||
      row.payload.decisions.modelRelease !== CFB_V1_MODEL_RELEASE ||
      row.payload.decisions.policyRelease !== CFB_V1_GRADE_POLICY_RELEASE ||
      row.payload.decisions.evaluatedBets.some((decision) =>
        decision.modelRelease !== CFB_V1_MODEL_RELEASE ||
        decision.distributionRelease !== CFB_V1_DISTRIBUTION_RELEASE ||
        decision.probabilityRelease !== CFB_V1_PROBABILITY_RELEASE ||
        decision.calibrationRelease !== CFB_V1_CALIBRATION_RELEASE ||
        decision.policyRelease !== CFB_V1_GRADE_POLICY_RELEASE ||
        decision.gradeAdjustment?.release !== CFB_MARKET_SHARP_AWARE_PRODUCTION_RELEASE
      )
    ))
  )) return null;
  return { values, expected };
}

function completeRowsForRelease(
  rows: CfbForwardStoredEvidence[],
  schemaRelease: string,
  memberRelease: string,
  decisionRelease: string,
): CfbForwardStoredEvidence[] | null {
  const release = latestValidRowsForRelease(rows, schemaRelease, memberRelease, decisionRelease);
  if (!release) return null;
  const { values, expected } = release;
  if (values.length !== expected) return null;
  return values;
}

function buildGame(row: CfbForwardStoredEvidence, movementRows: CfbForwardStoredEvidence[]): DailyEdgeGameDto {
  const payload = row.payload;
  const decisions = payload.decisions.evaluatedBets;
  const moneylineDecision = decisionFor(decisions, "moneyline");
  const totalDecision = decisionFor(decisions, "total");
  const spreadDecision = decisionFor(decisions, "spread");
  const moneyline = buildMarket(payload, "moneyline", moneylineDecision, movementRows);
  const total = buildMarket(payload, "total", totalDecision, movementRows);
  const spread = buildMarket(payload, "spread", spreadDecision, movementRows);
  const startsAt = payload.game.scheduledStart;
  const started = Date.parse(row.capturedAt) >= Date.parse(startsAt);
  const t60 = payload.stage === "t60";
  const allHeld = payload.decisions.heldMarkets.length === 3;
  const headline = [moneyline, total, spread].sort((a, b) => verdictRank(b.verdict.key) - verdictRank(a.verdict.key))[0]!;
  const primaryForecast = payload.decisions.forecast;
  const independentForecast = payload.schemaRelease === CFB_FORWARD_EVIDENCE_SCHEMA_RELEASE &&
    payload.authoritativeForecast?.status === "market_sharp_applied"
    ? payload.independentForecast ?? null
    : null;
  const projected = primaryForecast.representativeScore;
  const recommendationDecision = buildCfbRecommendationDecision({
    payload,
    projected,
    moneyline: { market: moneyline, decision: moneylineDecision },
    total: { market: total, decision: totalDecision },
    spread: { market: spread, decision: spreadDecision },
  });
  moneyline.recommendationDecision = recommendationDecision.markets.moneyline;
  total.recommendationDecision = recommendationDecision.markets.total;
  spread.recommendationDecision = recommendationDecision.markets.firstInning;
  moneyline.sportsbookSplits = buildSportsbookSplitSection(payload, "moneyline");
  total.sportsbookSplits = buildSportsbookSplitSection(payload, "total");
  spread.sportsbookSplits = buildSportsbookSplitSection(payload, "spread");
  if (moneyline.sportsbookSplits) moneyline.sharpBookAvailability = null;
  if (total.sportsbookSplits) total.sharpBookAvailability = null;
  if (spread.sportsbookSplits) spread.sharpBookAvailability = null;
  const game: DailyEdgeGameDto = {
    id: `cfb-${payload.game.providerGameId}`,
    sport: "cfb",
    collegeFootballScope: payload.game.away.fbs || payload.game.home.fbs
      ? "fbs_involved"
      : "fcs_only",
    external_id: Number(payload.game.providerGameId),
    awayTeam: payload.game.away.abbreviation,
    awayTeamLogo: null,
    homeTeam: payload.game.home.abbreviation,
    homeTeamLogo: null,
    gameTime: timeEt(startsAt),
    gameStartAt: startsAt,
    gameStartMinutes: minutesEt(startsAt),
    scheduledLockAt: new Date(Date.parse(startsAt) - 60 * 60_000).toISOString(),
    lockState: started || t60 ? "locked" : Date.parse(row.capturedAt) >= Date.parse(startsAt) - 60 * 60_000 ? "locking" : "open",
    lockedAt: t60 ? row.capturedAt : null,
    updatedAt: row.capturedAt,
    generatedAt: row.capturedAt,
    holdReason: allHeld ? "cfb_exact_price_tuple_incomplete" : null,
    homeStarter: null,
    awayStarter: null,
    predictions: { ml: legacyPrediction(moneyline), total: { ...legacyPrediction(total), line: total.line }, nrfi: legacyPrediction(spread) },
    markets: { moneyline, total, first_inning: spread },
    decisionLine: headline.verdict.key === "best_angle" ? `Best angle: ${headline.pick}` : headline.verdict.key === "lean" ? `Lean: ${headline.pick}` : headline.verdict.key === "watchlist" ? `Watchlist: ${headline.pick}` : allHeld ? "Predictions are live · exact-price Bet grades are No Play until sportsbook evidence is complete" : "No exact-price play clears the current policy",
    projected,
    footballProjection: {
      awayWinProbability: 1 - primaryForecast.homeWinProbability,
      homeWinProbability: primaryForecast.homeWinProbability,
      expectedAwayPoints: primaryForecast.expectedAwayPoints,
      expectedHomePoints: primaryForecast.expectedHomePoints,
      representativeScore: primaryForecast.representativeScore,
      interval80: primaryForecast.interval80,
      modelRelease: CFB_V1_MODEL_RELEASE,
      distributionRelease: CFB_V1_DISTRIBUTION_RELEASE,
      probabilityRelease: CFB_V1_PROBABILITY_RELEASE,
      artifactRelease: CFB_V1_SCORE_ARTIFACT_RELEASE,
    },
    footballOnlyProjection: independentForecast ? {
      awayWinProbability: 1 - independentForecast.homeWinProbability,
      homeWinProbability: independentForecast.homeWinProbability,
      expectedAwayPoints: independentForecast.expectedAwayPoints,
      expectedHomePoints: independentForecast.expectedHomePoints,
      representativeScore: independentForecast.representativeScore,
      interval80: independentForecast.interval80,
      modelRelease: CFB_V1_BASE_MODEL_RELEASE,
      distributionRelease: CFB_V1_BASE_DISTRIBUTION_RELEASE,
      probabilityRelease: CFB_V1_BASE_PROBABILITY_RELEASE,
      artifactRelease: CFB_V1_BASE_SCORE_ARTIFACT_RELEASE,
    } : null,
    sharpSignals: buildSignals(payload),
    status: { lineupConfirmed: null, linesLocked: payload.market.current !== null || payload.market.playbookLine !== null, sharpSignalPending: !payload.market.sharpApiSplits?.some((record) => record.sourceSemantics === "sharp_adjacent"), marketDataLimited: payload.market.current === null && payload.market.playbookLine === null },
    result: null,
    breakdown: { verdict: headline.verdict, sharpRead: { key: "mixed", sentence: "The authoritative CFB forecast coherently combines football, bounded market state, and strictly matched sharp evidence before exact-price grading." }, modelBreakdown: `OddSphere's authoritative joint PMF projects ${payload.game.away.abbreviation} ${primaryForecast.expectedAwayPoints.toFixed(1)}–${primaryForecast.expectedHomePoints.toFixed(1)} ${payload.game.home.abbreviation}; the reachable representative score is ${primaryForecast.representativeScore.away}–${primaryForecast.representativeScore.home}.` },
    recommendationDecision,
  };
  assertCfbPublicPredictionCoherence({ payload, game });
  return game;
}

function assertCfbPublicPredictionCoherence(args: {
  payload: CfbForwardEvidencePayload;
  game: DailyEdgeGameDto;
}): void {
  const forecast = args.payload.decisions.forecast;
  const football = args.game.footballProjection;
  if (!football) {
    throw new Error(`${CFB_PUBLIC_OUTCOME_CONTRACT_RELEASE}: CFB must publish exactly one authoritative prediction.`);
  }
  if (
    args.payload.schemaRelease === CFB_FORWARD_EVIDENCE_SCHEMA_RELEASE &&
    args.payload.authoritativeForecast?.status === "market_sharp_applied" &&
    !args.game.footballOnlyProjection
  ) {
    throw new Error(`${CFB_PUBLIC_OUTCOME_CONTRACT_RELEASE}: the market/sharp release must retain its immutable football-only baseline.`);
  }
  if (
    Math.abs(football.expectedAwayPoints - forecast.expectedAwayPoints) > 1e-9 ||
    Math.abs(football.expectedHomePoints - forecast.expectedHomePoints) > 1e-9 ||
    Math.abs(football.homeWinProbability - forecast.homeWinProbability) > 1e-9 ||
    args.game.projected.away !== forecast.representativeScore.away ||
    args.game.projected.home !== forecast.representativeScore.home
  ) {
    throw new Error(`${CFB_PUBLIC_OUTCOME_CONTRACT_RELEASE}: public score/winner fields do not match the authoritative PMF.`);
  }
  const expectedMarginHome = forecast.expectedHomePoints - forecast.expectedAwayPoints;
  const expectedTotal = forecast.expectedHomePoints + forecast.expectedAwayPoints;
  const markets: Array<{
    market: CfbV1Market;
    dto: MarketEdgeDto;
    decision: CfbV1ExactPriceDecision | null;
  }> = [
    { market: "moneyline", dto: args.game.markets.moneyline, decision: decisionFor(args.payload.decisions.evaluatedBets, "moneyline") },
    { market: "spread", dto: args.game.markets.first_inning, decision: decisionFor(args.payload.decisions.evaluatedBets, "spread") },
    { market: "total", dto: args.game.markets.total, decision: decisionFor(args.payload.decisions.evaluatedBets, "total") },
  ];
  for (const { market, dto, decision } of markets) {
    const prediction = dto.marketPrediction;
    if (!decision) continue;
    if (
      !prediction || prediction.status !== "available" ||
      prediction.label !== decision.side ||
      prediction.line !== decision.evaluatedQuote.line ||
      Math.abs((prediction.probability ?? -1) - decisionForecastProbability(decision)) > 1e-9
    ) {
      throw new Error(`${CFB_PUBLIC_OUTCOME_CONTRACT_RELEASE}: ${market} prediction does not match the authoritative PMF at the evaluated line.`);
    }
    const selected = canonicalSide(args.payload, decision);
    let scoreSide: "home" | "away" | "over" | "under" | null = null;
    if (market === "moneyline" && Math.abs(expectedMarginHome) > CFB_PUBLIC_SCORE_DIRECTION_TOLERANCE_POINTS) {
      scoreSide = expectedMarginHome > 0 ? "home" : "away";
    } else if (market === "spread" && decision.evaluatedQuote.line !== null) {
      const homeSpread = selected === "home" ? decision.evaluatedQuote.line : -decision.evaluatedQuote.line;
      const scoreCoverMargin = expectedMarginHome + homeSpread;
      if (Math.abs(scoreCoverMargin) > CFB_PUBLIC_SCORE_DIRECTION_TOLERANCE_POINTS) scoreSide = scoreCoverMargin > 0 ? "home" : "away";
    } else if (market === "total" && decision.evaluatedQuote.line !== null) {
      const scoreTotalMargin = expectedTotal - decision.evaluatedQuote.line;
      if (Math.abs(scoreTotalMargin) > CFB_PUBLIC_SCORE_DIRECTION_TOLERANCE_POINTS) scoreSide = scoreTotalMargin > 0 ? "over" : "under";
    }
    if (scoreSide && scoreSide !== selected) {
      throw new Error(
        `${CFB_PUBLIC_OUTCOME_CONTRACT_RELEASE}: ${args.payload.game.away.abbreviation}@${args.payload.game.home.abbreviation} ` +
        `${market} score direction ${scoreSide} conflicts with ${selected} at line ${decision.evaluatedQuote.line}; ` +
        `expected margin ${expectedMarginHome.toFixed(4)}, expected total ${expectedTotal.toFixed(4)}.`,
      );
    }
  }
}

function buildCfbRecommendationDecision(args: {
  payload: CfbForwardEvidencePayload;
  projected: { away: number; home: number };
  moneyline: { market: MarketEdgeDto; decision: CfbV1ExactPriceDecision | null };
  total: { market: MarketEdgeDto; decision: CfbV1ExactPriceDecision | null };
  spread: { market: MarketEdgeDto; decision: CfbV1ExactPriceDecision | null };
}) {
  const marketInput = (
    key: "moneyline" | "total" | "firstInning",
    marketName: CfbV1Market,
    value: { market: MarketEdgeDto; decision: CfbV1ExactPriceDecision | null },
  ) => ({
    key,
    pick: value.market.pick,
    selectedSide: selectedMarketSide(args.payload, marketName, value.decision),
    modelProbability: value.market.modelProb,
    marketImplied: value.market.marketFairProb,
    edgePp: value.decision ? value.decision.edgePercentagePoints * 100 : null,
    price: value.market.priceAmerican,
    playGrade: value.decision?.grade ?? "No Play",
    quickRead: value.market.displayReason ?? "The outcome forecast and exact-price Bet grade remain separate.",
    riskNote: "Outcome forecast, public consensus, sharp-book context and exact-price Bet grade are separate evidence layers.",
    publicSplits: value.market.publicSplits,
    marketReadV2: null,
    marketReadV2Enabled: false,
    sharpBookSplitsOverride: buildSharpBookSplitSection(args.payload, marketName),
    lineMovementOverride: value.decision?.gradeAdjustment?.movementDirection === "unknown"
      ? null
      : value.decision?.gradeAdjustment?.movementDirection ?? null,
    allowBestAngleMarketConflict: value.decision !== null,
  });
  return buildRecommendationDecision({
    sport: "cfb",
    slateDate: localDate(args.payload.game.scheduledStart),
    gameId: `cfb-${args.payload.game.providerGameId}`,
    homeTeam: args.payload.game.home.abbreviation,
    awayTeam: args.payload.game.away.abbreviation,
    projectedScore: args.projected,
    markets: [
      marketInput("moneyline", "moneyline", args.moneyline),
      marketInput("total", "total", args.total),
      marketInput("firstInning", "spread", args.spread),
    ],
  });
}

function selectedMarketSide(
  payload: CfbForwardEvidencePayload,
  market: CfbV1Market,
  decision: CfbV1ExactPriceDecision | null,
): "home" | "away" | "over" | "under" | null {
  if (decision) return canonicalSide(payload, decision);
  return payload.decisions.marketOutlooks?.[market]?.side ?? null;
}

function buildSharpBookSplitSection(
  payload: CfbForwardEvidencePayload,
  market: CfbV1Market,
): MarketSplitDisplaySection | null {
  const record = [...(payload.market.sharpApiSplits ?? [])]
    .filter((candidate) => candidate.sourceSemantics === "sharp_adjacent" && sharpMarketAvailable(candidate, market))
    .sort((first, second) => Date.parse(second.capturedAt) - Date.parse(first.capturedAt))[0];
  if (!record) return null;
  return cfbSplitSection(payload, market, record, "Sharp Book Splits");
}

function buildSportsbookSplitSection(
  payload: CfbForwardEvidencePayload,
  market: CfbV1Market,
): MarketSplitDisplaySection | null {
  if (buildSharpBookSplitSection(payload, market)) return null;
  const record = [...(payload.market.sharpApiSplits ?? [])]
    .filter((candidate) => candidate.sourceSemantics === "public_recreational" && sharpMarketAvailable(candidate, market))
    .sort((first, second) => Date.parse(second.capturedAt) - Date.parse(first.capturedAt))[0];
  if (!record) return null;
  return cfbSplitSection(payload, market, record, record.sportsbook === "draftkings" ? "DraftKings Splits" : "BetMGM Splits");
}

function cfbSplitSection(
  payload: CfbForwardEvidencePayload,
  market: CfbV1Market,
  record: NonNullable<CfbForwardEvidencePayload["market"]["sharpApiSplits"]>[number],
  label: MarketSplitDisplaySection["label"],
): MarketSplitDisplaySection | null {
  const staleAfterMinutes = cfbSplitStaleAfterMinutes(payload.game.scheduledStart, record.capturedAt);
  const isStale = Date.parse(payload.capturedAt) - Date.parse(record.capturedAt) > staleAfterMinutes * 60_000;
  const stamp = { observedAt: record.capturedAt, freshnessCheckedAt: record.capturedAt, staleAfterMinutes, isStale };
  const rows = market === "total" && record.total
    ? [
        { side: "over" as const, label: "Over", moneyPct: record.total.over.moneyPct, betsPct: record.total.over.ticketsPct, ...stamp },
        { side: "under" as const, label: "Under", moneyPct: record.total.under.moneyPct, betsPct: record.total.under.ticketsPct, ...stamp },
      ]
    : market === "spread" && record.spread
      ? [
          { side: "home" as const, label: payload.game.home.abbreviation, moneyPct: record.spread.home.moneyPct, betsPct: record.spread.home.ticketsPct, ...stamp },
          { side: "away" as const, label: payload.game.away.abbreviation, moneyPct: record.spread.away.moneyPct, betsPct: record.spread.away.ticketsPct, ...stamp },
        ]
      : record.moneyline
        ? [
            { side: "home" as const, label: payload.game.home.abbreviation, moneyPct: record.moneyline.home.moneyPct, betsPct: record.moneyline.home.ticketsPct, ...stamp },
            { side: "away" as const, label: payload.game.away.abbreviation, moneyPct: record.moneyline.away.moneyPct, betsPct: record.moneyline.away.ticketsPct, ...stamp },
          ]
        : [];
  if (rows.length === 0) return null;
  return { label, rows, signal: null, lastUpdated: record.capturedAt };
}

function sharpMarketAvailable(
  record: NonNullable<CfbForwardEvidencePayload["market"]["sharpApiSplits"]>[number],
  market: CfbV1Market,
): boolean {
  return (market === "moneyline" ? record.moneyline : market === "spread" ? record.spread : record.total) !== null;
}

function sharpBookAvailability(
  payload: CfbForwardEvidencePayload,
  market: CfbV1Market,
): NonNullable<MarketEdgeDto["sharpBookAvailability"]> {
  const sharp = buildSharpBookSplitSection(payload, market);
  if (sharp) return { status: sharp.rows.some((row) => row.isStale) ? "stale" : "complete", message: "Verified sharp splits are available for this game and market.", lastUpdated: sharp.lastUpdated };
  const records = payload.market.sharpApiSplits ?? [];
  const latest = records.reduce<string | null>((value, record) => value === null || record.capturedAt > value ? record.capturedAt : value, null);
  if (payload.market.sharpApiSplitsStatus === "request_failed") {
    return { status: "unavailable", message: "Verified sharp splits are unavailable for this capture. Public consensus remains separate.", lastUpdated: null };
  }
  if (records.some((record) => record.sourceSemantics === "public_recreational" && sharpMarketAvailable(record, market))) {
    return { status: "provider_limited", message: "A public split is available, but no verified sharp split is available for this market yet.", lastUpdated: latest };
  }
  return { status: "pending", message: "No verified sharp split is available for this market yet.", lastUpdated: latest };
}

function buildMarket(
  payload: CfbForwardEvidencePayload,
  market: CfbV1Market,
  decision: CfbV1ExactPriceDecision | null,
  movementRows: CfbForwardStoredEvidence[],
): MarketEdgeDto {
  const held = decision === null;
  const outlook = payload.decisions.marketOutlooks?.[market] ?? null;
  const displayedProbability = decision?.modelProbability ?? outlook?.independentProbability ?? null;
  const slot = market === "spread" ? payload.market.current?.spread : market === "total" ? payload.market.current?.total : payload.market.current?.moneyline;
  const split = payload.market.playbookSplits?.[market] ?? null;
  const selectedSide = decision ? canonicalSide(payload, decision) : outlook?.side ?? (market === "total" ? "over" : "home");
  const selectedSplit = splitValue(split, market, selectedSide);
  const currentQuote = decision === null
    ? currentDisplayQuote(payload, market, selectedSide)
    : null;
  const contextOnlyQuote = decision === null && currentQuote === null
    ? currentDisplayQuote(payload, market, opposingCanonicalSide(selectedSide))
    : null;
  const trails = decision
    ? decisionTrails(payload, decision, movementRows)
    : currentQuote
      ? contextQuoteTrails(payload, market, selectedSide, currentQuote, movementRows)
      : contextOnlyQuote
        ? {
            selected: [] as OddsTrailStopDto[],
            opposing: buildSameBookTrail({
              rows: movementRows,
              sportsbook: contextOnlyQuote.book.sportsbook,
              market,
              side: opposingCanonicalSide(selectedSide),
              terminal: { ...contextOnlyQuote.quote, american: contextOnlyQuote.quote.price, observedAt: contextOnlyQuote.observedAt, locked: false },
            }),
          }
        : { selected: [] as OddsTrailStopDto[], opposing: [] as OddsTrailStopDto[] };
  const isBest = decision?.grade === "Best Angle";
  const isLean = decision?.grade === "Lean";
  const isWatch = decision?.grade === "Watchlist";
  const actionability = isBest ? 82 : isLean ? 62 : isWatch ? 45 : decision ? 30 : null;
  const label = market === "moneyline" ? "moneyline" : market;
  const unavailable = payload.decisions.heldMarkets.find((value) => value.market === market);
  const unavailableReason = unavailable
    ? unavailableReasonSentence(unavailable.reasonCodes ?? unavailable.reason.split(";"))
    : null;
  const oneSidedContext = contextOnlyQuote
    ? ` A verified one-sided ${opposingLabel(payload, market, selectedSide, contextOnlyQuote.quote.line)} quote is ${formatAmerican(contextOnlyQuote.quote.price)} at ${contextOnlyQuote.book.sportsbook}; it is shown as sportsbook context and is not treated as a two-sided fair-price or grading input.`
    : "";
  const reason = held
    ? outlook
      ? `The ${label} prediction is ${outlookLabel(payload, outlook)} at ${(100 * outlook.independentProbability).toFixed(1)}% from the primary outcome PMF. The exact-price Bet grade is No Play because ${unavailableReason ?? "the exact-price evidence is incomplete"}.${oneSidedContext}`
      : `The ${label} Bet grade is No Play because ${unavailableReason ?? "the exact-price evidence is incomplete"}. The game-level prediction remains live.${oneSidedContext}`
    : `${decision.side} is evaluated at ${formatAmerican(decision.evaluatedQuote.price)} from ${decision.evaluatedQuote.sportsbook}; the ${decision.grade} grade uses that exact ${decision.evaluatedQuote.marketSelection === "coherent_paired_alternate" ? "paired alternate offer" : "main-line quote"}, the authoritative PMF and calibrated probability, public money-versus-ticket divergence, stronger strictly matched sharp-book evidence when available, same-book movement, and other-book fair consensus.${crossMarketExplanation(payload, market, decision)}`;
  const publicSplits = buildPublicSplits(payload, market);
  const marketPrediction = buildMarketPrediction(payload, market, decision, outlook);
  return {
    pick: decision?.side ?? null,
    confidence: displayedProbability,
    grade: isBest ? "best_signal" : isLean ? "model_only" : isWatch ? "market_watch" : null,
    signalType: isBest ? "balanced" : isLean ? "model_only" : null,
    marketSignal: "market_neutral",
    sharpStatus: "mixed",
    held,
    marketPrediction,
    verdict: held ? { key: "no_play", label: "No Play" } : isBest ? { key: "best_angle", label: "Best Angle" } : isLean ? { key: "lean", label: "Lean" } : isWatch ? { key: "watchlist", label: "Watchlist" } : { key: "no_play", label: "No Play" },
    rawGrade: isBest ? "best_signal" : isLean ? "model_only" : isWatch ? "market_watch" : null,
    rawRecScore: actionability,
    capReasons: held ? ["cfb_exact_price_tuple_incomplete"] : [`cfb_${decision.grade.toLowerCase().replace(/\s+/g, "_")}`, ...payload.coverage.availabilityWarnings],
    finalGrade: isBest ? "best_signal" : isLean ? "model_only" : isWatch ? "market_watch" : null,
    finalRecScore: actionability,
    actionabilityLabel: held ? "No Play" : decision!.grade,
    displayReason: reason,
    guidedGuide: reason,
    guidedWatchOut: "Prices and projected quarterback context refresh until T-60. Injury and venue-weather context are not available for this slate.",
    whyLine: reason,
    riskLine: decision?.evaluatedQuote.marketSelection === "coherent_paired_alternate"
      ? "The sportsbook labels this as an alternate offer. It is evaluated only because at least two other trusted named books carry the identical line; no line interpolation or consensus price is used."
      : "The authoritative forecast and exact-price Bet grade share one coherent PMF. Playbook public money-versus-ticket divergence is a bounded lower-strength model input; it remains separately labeled and is never relabeled as strictly matched Circa sharp evidence.",
    modelProb: displayedProbability,
    marketFairProb: decision?.marketFairProbability ?? null,
    pinnacleEvPct: decision ? decision.expectedValue * 100 : null,
    moneyPct: selectedSplit.money,
    betsPct: selectedSplit.bets,
    publicSplits,
    sharpBookAvailability: sharpBookAvailability(payload, market),
    priceAmerican: decision?.evaluatedQuote.price ?? null,
    currentPriceAmerican: decision?.evaluatedQuote.price ?? currentQuote?.quote.price ?? null,
    currentPriceSportsbook: decision?.evaluatedQuote.sportsbook ?? currentQuote?.book.sportsbook ?? null,
    currentPriceObservedAt: decision?.evaluatedQuote.observedAt ?? currentQuote?.observedAt ?? null,
    bestAvailablePriceAmerican: null,
    bestAvailableSportsbook: null,
    bestAvailableObservedAt: null,
    gradePriceAmerican: decision?.evaluatedQuote.price ?? null,
    fiMarketBoard: null,
    lineOpenAmerican: trails.selected[0]?.american ?? null,
    priceUnavailableAtLock: false,
    priceObservedAt: decision?.evaluatedQuote.observedAt ?? null,
    priceIsStale: false,
    lineOpenObservedAt: trails.selected[0]?.observedAt ?? null,
    lineOpenIsStale: false,
    moneyPctObservedAt: split?.capturedAt ?? null,
    moneyPctIsStale: false,
    betsPctObservedAt: split?.capturedAt ?? null,
    betsPctIsStale: false,
    oddspherePostedAmerican: decision?.evaluatedQuote.price ?? null,
    oddspherePostedAt: decision?.evaluatedAt ?? null,
    oddspherePostedMatchesPick: decision !== null,
    lockedLineAmerican: decision?.stage === "t60_locked" ? decision.evaluatedQuote.price : null,
    lockedLineAt: decision?.lockedAt ?? null,
    oddsTrail: trails.selected,
    lineTrail: market === "moneyline" ? [] : trails.selected,
    opposingOddsTrail: { side: opposingCanonicalSide(selectedSide), label: opposingLabel(payload, market, selectedSide, decision?.evaluatedQuote.line ?? currentQuote?.quote.line ?? contextOnlyQuote?.quote.line ?? outlook?.line ?? lineFromSlot(slot)), stops: trails.opposing },
    marketInterpretation: null,
    marketReadV2: null,
    marketReadV2Enabled: false,
    writerMovementDirection: decision?.gradeAdjustment?.movementDirection === "unknown"
      ? null
      : decision?.gradeAdjustment?.movementDirection ?? null,
    lastMovePrevAmerican: trails.selected.length > 1 ? trails.selected.at(-2)!.american : null,
    lastMoveNextAmerican: trails.selected.at(-1)?.american ?? null,
    lastMoveAtIso: trails.selected.at(-1)?.observedAt ?? null,
    lastMoveLinePrev: trails.selected.length > 1 ? trails.selected.at(-2)!.line : null,
    lastMoveLineNext: trails.selected.at(-1)?.line ?? null,
    modelTotal: market === "total" ? payload.decisions.forecast.expectedTotal : null,
    marketTotal: market === "total" ? decision?.evaluatedQuote.line ?? outlook?.line ?? lineFromSlot(slot) : null,
    line: decision?.evaluatedQuote.line ?? currentQuote?.quote.line ?? outlook?.line ?? lineFromSlot(slot),
    keyStats: keyStats(payload, market),
    modelTrustPct: displayedProbability === null ? null : displayedProbability * 100,
    marketImpliedPct: decision ? decision.marketFairProbability * 100 : null,
    modelMarketGapPct: decision ? decision.edgePercentagePoints : null,
    recommendationConfidence: actionability,
    marketSource: decision?.evaluatedQuote.sportsbook ?? currentQuote?.book.sportsbook ?? contextOnlyQuote?.book.sportsbook ?? null,
    marketDataQuality: decision ? "two_sided_consensus" : currentQuote || contextOnlyQuote ? "single_book" : payload.market.playbookLine ? "single_book" : "unavailable",
    reviewFlags: [...new Set([
      ...(decision?.gradeAdjustment?.reasonCodes ?? []),
      ...payload.coverage.availabilityWarnings,
    ])],
    reviewActionSummary: held ? "repair_price_coverage" : "keep",
  };
}

function unavailableReasonSentence(codes: string[]): string {
  const descriptions: Record<string, string> = {
    named_target_quote_unavailable: "no complete target-book quote pair is currently available",
    market_context_line_unavailable: "the line needed to evaluate this market is unavailable",
    target_excluded_same_line_consensus_insufficient: "fewer than two other named books corroborate the identical line",
    quote_timestamp_invalid: "the provider quote timestamp is invalid",
    quote_observed_after_evaluation: "the provider quote is timestamped after this evaluation",
    evaluation_not_pregame: "the evaluation timestamp is not pregame",
    global_health_hold: "a game-level health requirement is incomplete",
    mean_pmf_near_tossup_conflict: "the PMF is effectively tied at this Total while its mean falls narrowly on the other side",
  };
  const values = [...new Set(codes.map((code) => descriptions[code] ?? code.replaceAll("_", " ")))].filter(Boolean);
  return values.length > 1
    ? `${values.slice(0, -1).join(", ")}, and ${values.at(-1)}`
    : values[0] ?? "the exact-price evidence is incomplete";
}

type CfbCurrentDisplayQuote = {
  book: NonNullable<CfbForwardEvidencePayload["market"]["current"]>;
  quote: { price: number; line: number | null };
  observedAt: string;
  paired: boolean;
};

function currentDisplayQuote(
  payload: CfbForwardEvidencePayload,
  market: CfbV1Market,
  side: "home" | "away" | "over" | "under",
): CfbCurrentDisplayQuote | null {
  const capturedAt = Date.parse(payload.capturedAt);
  const startsAt = Date.parse(payload.game.scheduledStart);
  if (!Number.isFinite(capturedAt) || !Number.isFinite(startsAt)) return null;
  const candidates = (payload.market.displayBooks ?? payload.market.currentBooks)
    .flatMap((book): CfbCurrentDisplayQuote[] => {
      const displayQuote = marketQuoteFor(book, market, side);
      const quote = displayQuote ? { price: displayQuote.price, line: displayQuote.line } : null;
      const observedAt = displayQuote?.observedAt ?? book.marketObservedAt?.[market] ?? book.observedAt;
      const observed = Date.parse(observedAt);
      if (
        !quote ||
        !Number.isFinite(observed) ||
        observed > capturedAt + CFB_CONTEXT_ONLY_QUOTE_CAPTURE_SKEW_MS ||
        observed >= startsAt
      ) return [];
      return [{ book, quote, observedAt, paired: displayQuote?.paired ?? false }];
    });
  return representativeDisplayQuotes(payload, market, side, candidates)
    .sort((first, second) => Number(second.paired) - Number(first.paired) ||
      Number(second.book.targetEligible !== false) - Number(first.book.targetEligible !== false) ||
      Date.parse(second.observedAt) - Date.parse(first.observedAt) ||
      first.book.sportsbook.localeCompare(second.book.sportsbook))[0] ?? null;
}

function marketQuoteFor(
  book: NonNullable<CfbForwardEvidencePayload["market"]["current"]>,
  market: CfbV1Market,
  side: string,
): { price: number; line: number | null; observedAt: string; paired: boolean } | null {
  const paired = quoteFor(book, market, side);
  if (paired) return { ...paired, observedAt: book.marketObservedAt?.[market] ?? book.observedAt, paired: true };
  const quote = [...(book.marketQuotes ?? [])]
    .filter((value) => value.market === market && value.side === side && value.marketSelection === "main_line")
    .sort((first, second) => Date.parse(second.observedAt) - Date.parse(first.observedAt))[0];
  return quote ? { price: quote.price, line: quote.line, observedAt: quote.observedAt, paired: false } : null;
}

function representativeDisplayQuotes(
  payload: CfbForwardEvidencePayload,
  market: CfbV1Market,
  side: "home" | "away" | "over" | "under",
  candidates: CfbCurrentDisplayQuote[],
): CfbCurrentDisplayQuote[] {
  if (candidates.length === 0) return [];
  if (market === "moneyline") {
    const playbookPrice = side === "home"
      ? payload.market.playbookLine?.homeMoneyline
      : side === "away"
        ? payload.market.playbookLine?.awayMoneyline
        : null;
    const decimalPrices = [
      ...candidates.map((candidate) => decimalOdds(candidate.quote.price)),
      ...(playbookPrice === null || playbookPrice === undefined ? [] : [decimalOdds(playbookPrice)]),
    ].filter((value) => Number.isFinite(value));
    if (decimalPrices.length < 2) return candidates;
    const center = playbookPrice === null || playbookPrice === undefined
      ? median(decimalPrices)
      : decimalOdds(playbookPrice);
    return candidates.filter((candidate) => {
      const ratio = decimalOdds(candidate.quote.price) / center;
      return ratio >= 0.6 && ratio <= 1.8;
    });
  }
  const playbookLine = market === "spread"
    ? side === "home"
      ? payload.market.playbookLine?.homeSpread
      : payload.market.playbookLine?.awaySpread
    : payload.market.playbookLine?.total;
  const lines = [
    ...candidates.map((candidate) => candidate.quote.line).filter((value): value is number => value !== null),
    ...(playbookLine === null || playbookLine === undefined ? [] : [playbookLine]),
  ];
  if (lines.length < 2) return candidates;
  const center = playbookLine === null || playbookLine === undefined ? median(lines) : playbookLine;
  const tolerance = market === "spread" ? 1 : 2;
  return candidates.filter((candidate) => candidate.quote.line !== null && Math.abs(candidate.quote.line - center) <= tolerance);
}

function decimalOdds(american: number): number {
  return american > 0 ? 1 + american / 100 : 1 + 100 / Math.abs(american);
}

function median(values: number[]): number {
  const ordered = [...values].sort((first, second) => first - second);
  const middle = Math.floor(ordered.length / 2);
  return ordered.length % 2 === 0
    ? (ordered[middle - 1]! + ordered[middle]!) / 2
    : ordered[middle]!;
}

function contextQuoteTrails(
  payload: CfbForwardEvidencePayload,
  market: CfbV1Market,
  side: "home" | "away" | "over" | "under",
  current: CfbCurrentDisplayQuote,
  movementRows: CfbForwardStoredEvidence[],
): { selected: OddsTrailStopDto[]; opposing: OddsTrailStopDto[] } {
  const selected = buildSameBookTrail({
    rows: movementRows,
    sportsbook: current.book.sportsbook,
    market,
    side,
    terminal: { ...current.quote, american: current.quote.price, observedAt: current.observedAt, locked: false },
  });
  const opposingSide = opposingCanonicalSide(side);
  const opposing = quoteFor(current.book, market, opposingSide);
  return {
    selected,
    opposing: opposing ? buildSameBookTrail({
      rows: movementRows,
      sportsbook: current.book.sportsbook,
      market,
      side: opposingSide,
      terminal: {
        american: opposing.price,
        line: opposing.line,
        observedAt: current.observedAt,
        locked: false,
      },
    }) : [],
  };
}

function crossMarketExplanation(
  payload: CfbForwardEvidencePayload,
  market: CfbV1Market,
  decision: CfbV1ExactPriceDecision,
): string {
  const notes: string[] = [];
  const primary = payload.decisions.forecast;
  if (market === "moneyline") {
    const selected = canonicalSide(payload, decision);
    const predictedWinner = primary.homeWinProbability >= 0.5 ? "home" : "away";
    if ((selected === "home" || selected === "away") && selected !== predictedWinner) {
      const winner = predictedWinner === "home" ? payload.game.home.abbreviation : payload.game.away.abbreviation;
      notes.push(
        ` ${decision.side} has ${(decision.modelProbability * 100).toFixed(1)}% win probability and is a price-value evaluation, not the predicted winner; the primary forecast still favors ${winner} at ${(Math.max(primary.homeWinProbability, 1 - primary.homeWinProbability) * 100).toFixed(1)}%.`,
      );
    }
  }
  if (market === "moneyline" || market === "spread") {
    const moneyline = payload.decisions.evaluatedBets.find((value) => value.market === "moneyline");
    const spread = payload.decisions.evaluatedBets.find((value) => value.market === "spread");
    if (moneyline && spread && moneyline.grade !== spread.grade) {
      notes.push(
        ` Moneyline and Spread grade differently because they are separate exact-price contracts: ${moneyline.side} ${formatAmerican(moneyline.evaluatedQuote.price)} is ${moneyline.grade} at ${(moneyline.expectedValue * 100).toFixed(1)}% EV, while ${spread.side} ${formatAmerican(spread.evaluatedQuote.price)} is ${spread.grade} at ${(spread.expectedValue * 100).toFixed(1)}% EV.`,
      );
    }
  }
  return notes.join("");
}

function buildMarketPrediction(
  payload: CfbForwardEvidencePayload,
  market: CfbV1Market,
  decision: CfbV1ExactPriceDecision | null,
  outlook: CfbForwardMarketOutlook | null,
): NonNullable<MarketEdgeDto["marketPrediction"]> {
  if (decision) {
    return {
      status: "available",
      label: decision.side,
      line: decision.evaluatedQuote.line,
      probability: decisionForecastProbability(decision),
      source: market === "moneyline" ? "model_outcome" : "model_at_context_line",
      sportsbook: decision.evaluatedQuote.sportsbook,
      observedAt: decision.evaluatedQuote.observedAt,
      freshnessCheckedAt: payload.capturedAt,
      reason: market === "moneyline"
        ? "The authoritative market/sharp-aware joint PMF supplies the winner prediction and the exact-price decision is derived from that same forecast."
        : "The authoritative market/sharp-aware joint PMF is evaluated at the identical sportsbook line used by the exact-price decision.",
    };
  }
  if (outlook && market === "moneyline") {
    return {
      status: "available",
      label: outlookLabel(payload, outlook),
      line: null,
      probability: outlook.independentProbability,
      source: "model_outcome",
      sportsbook: null,
      observedAt: null,
      freshnessCheckedAt: payload.capturedAt,
      reason: "The authoritative game forecast remains available without an offered Moneyline price; no price or grade is fabricated.",
    };
  }
  if (outlook && currentMarketContextIsFresh(payload, outlook)) {
    return {
      status: "available",
      label: outlookLabel(payload, outlook),
      line: outlook.line,
      probability: outlook.independentProbability,
      source: "model_at_context_line",
      sportsbook: null,
      observedAt: outlook.contextObservedAt,
      freshnessCheckedAt: payload.capturedAt,
      reason: "The authoritative joint-score PMF is evaluated at the current context line without turning that context into a sportsbook offer.",
    };
  }
  return {
    status: "market_data_unavailable",
    label: null,
    line: null,
    probability: null,
    source: null,
    sportsbook: null,
    observedAt: outlook?.contextObservedAt ?? null,
    freshnessCheckedAt: payload.capturedAt,
    reason: `A fresh coherent current ${market} line is unavailable; projected score context is not substituted for a bettable market prediction.`,
  };
}

function currentMarketContextIsFresh(
  payload: CfbForwardEvidencePayload,
  outlook: CfbForwardMarketOutlook,
): boolean {
  if (outlook.line === null || outlook.contextObservedAt === null) return false;
  const captured = Date.parse(payload.capturedAt);
  const observed = Date.parse(outlook.contextObservedAt);
  if (!Number.isFinite(captured) || !Number.isFinite(observed) || observed > captured) return false;
  return captured - observed <= CFB_MARKET_CONTEXT_MAX_CAPTURE_LAG_MINUTES * 60_000;
}

function outlookLabel(payload: CfbForwardEvidencePayload, outlook: CfbForwardMarketOutlook): string {
  if (outlook.market === "moneyline") return outlook.side === "home" ? payload.game.home.abbreviation : payload.game.away.abbreviation;
  if (outlook.market === "spread") {
    const team = outlook.side === "home" ? payload.game.home.abbreviation : payload.game.away.abbreviation;
    return `${team} ${signed(outlook.line ?? 0)}`;
  }
  return `${outlook.side === "over" ? "Over" : "Under"} ${marketNumber(outlook.line ?? 0)}`;
}

function decisionTrails(
  payload: CfbForwardEvidencePayload,
  decision: CfbV1ExactPriceDecision,
  movementRows: CfbForwardStoredEvidence[],
): { selected: OddsTrailStopDto[]; opposing: OddsTrailStopDto[] } {
  const selectedSide = canonicalSide(payload, decision);
  const exactBook = payload.market.currentBooks.find((book) => normalizeBook(book.sportsbook) === normalizeBook(decision.evaluatedQuote.sportsbook));
  const opposingQuote = exactBook ? quoteFor(exactBook, decision.market, opposingCanonicalSide(selectedSide)) : null;
  const selected = buildSameBookTrail({
    rows: movementRows,
    sportsbook: decision.evaluatedQuote.sportsbook,
    market: decision.market,
    side: selectedSide,
    terminal: {
      american: decision.evaluatedQuote.price,
      line: decision.evaluatedQuote.line,
      observedAt: decision.evaluatedQuote.observedAt,
      locked: decision.stage === "t60_locked",
    },
  });
  const opposing = opposingQuote ? buildSameBookTrail({
    rows: movementRows,
    sportsbook: decision.evaluatedQuote.sportsbook,
    market: decision.market,
    side: opposingCanonicalSide(selectedSide),
    terminal: {
      american: opposingQuote.price,
      line: opposingQuote.line,
      observedAt: exactBook!.marketObservedAt?.[decision.market] ?? exactBook!.observedAt,
      locked: decision.stage === "t60_locked",
    },
  }) : [];
  return { selected, opposing };
}

function buildSameBookTrail(args: {
  rows: CfbForwardStoredEvidence[];
  sportsbook: string;
  market: CfbV1Market;
  side: "home" | "away" | "over" | "under";
  terminal: { american: number; line: number | null; observedAt: string; locked: boolean };
}): OddsTrailStopDto[] {
  const sportsbook = normalizeBook(args.sportsbook);
  const candidates: OddsTrailStopDto[] = [];
  const append = (stop: OddsTrailStopDto, replaceDuplicate = false) => {
    const key = `${normalizeBook(stop.sportsbook ?? "")}:${stop.observedAt}:${stop.american}:${stop.line ?? "null"}`;
    const duplicateIndex = candidates.findIndex((candidate) =>
      `${normalizeBook(candidate.sportsbook ?? "")}:${candidate.observedAt}:${candidate.american}:${candidate.line ?? "null"}` === key);
    if (duplicateIndex >= 0) {
      if (replaceDuplicate) candidates.splice(duplicateIndex, 1);
      else return;
    }
    candidates.push(stop);
  };

  for (const row of args.rows) {
    const opening = row.payload.market.providerOpening;
    if (!opening || normalizeBook(opening.sportsbook) !== sportsbook) continue;
    const value = quoteFor(opening, args.market, args.side);
    if (!value) continue;
    append({
      american: value.price,
      line: value.line,
      observedAt: opening.marketObservedAt?.[args.market] ?? opening.observedAt,
      sportsbook: opening.sportsbook,
      source: "provider_opening",
      label: "open",
    });
  }

  const operationalOpening = args.rows[0]?.payload.market.operationalOpening ?? null;
  if (operationalOpening && normalizeBook(operationalOpening.quote.sportsbook) === sportsbook) {
    const value = quoteFor(operationalOpening.quote, args.market, args.side);
    if (value) append({
      american: value.price,
      line: value.line,
      observedAt: operationalOpening.capturedAt,
      sportsbook: operationalOpening.quote.sportsbook,
      source: operationalOpening.provenance === "provider_opening" ? "provider_opening" : "line_history",
      label: operationalOpening.provenance === "provider_opening" ? "open" : "first",
    });
  }

  for (const row of args.rows.slice(0, -1)) {
    const current = row.payload.market.currentBooks.find((candidate) =>
      normalizeBook(candidate.sportsbook) === sportsbook) ??
      (row.payload.market.current && normalizeBook(row.payload.market.current.sportsbook) === sportsbook
        ? row.payload.market.current
        : null);
    if (!current) continue;
    const value = quoteFor(current, args.market, args.side);
    if (!value) continue;
    append({
      american: value.price,
      line: value.line,
      observedAt: current.marketObservedAt?.[args.market] ?? current.observedAt,
      sportsbook: current.sportsbook,
      source: "line_history",
      label: "move",
    });
  }

  append({
    american: args.terminal.american,
    line: args.terminal.line,
    observedAt: args.terminal.observedAt,
    sportsbook: args.sportsbook,
    source: args.terminal.locked ? "locked_snapshot" : "current_line",
    label: args.terminal.locked ? "locked" : "current",
  }, true);

  candidates.sort((first, second) => Date.parse(first.observedAt ?? "") - Date.parse(second.observedAt ?? ""));
  const materialStops = candidates.reduce<OddsTrailStopDto[]>((stops, stop, index) => {
    if (index === 0) return [stop];
    const previous = stops[stops.length - 1]!;
    const changed = previous.american !== stop.american || previous.line !== stop.line;
    const terminal = index === candidates.length - 1;
    if (changed || terminal) stops.push(stop);
    return stops;
  }, []);

  return materialStops.map((stop, index, stops) => ({
    ...stop,
    source: index === stops.length - 1
      ? args.terminal.locked ? "locked_snapshot" : "current_line"
      : stop.source === "provider_opening" ? "provider_opening" : "line_history",
    label: index === stops.length - 1
      ? args.terminal.locked ? "locked" : "current"
      : index === 0
        ? stop.source === "provider_opening" ? "open" : "first"
        : "move",
  }));
}

function keyStats(payload: CfbForwardEvidencePayload, market: CfbV1Market): MarketEdgeDto["keyStats"] {
  const forecast = payload.decisions.forecast;
  const footballEvidence = cfbFootballEvidenceStats({
    awayTeamName: payload.game.away.name,
    homeTeamName: payload.game.home.name,
    market,
    awayQuarterback: { name: payload.quarterbacks.away.expectedStartingQuarterback?.name ?? null, status: payload.quarterbacks.away.starterStatus },
    homeQuarterback: { name: payload.quarterbacks.home.expectedStartingQuarterback?.name ?? null, status: payload.quarterbacks.home.starterStatus },
  });
  if (market === "moneyline") return [
    { label: "Projected winner probability", awayValue: `${((1 - forecast.homeWinProbability) * 100).toFixed(1)}%`, homeValue: `${(forecast.homeWinProbability * 100).toFixed(1)}%`, source: "computed" },
    { label: "Expected points", awayValue: forecast.expectedAwayPoints.toFixed(1), homeValue: forecast.expectedHomePoints.toFixed(1), source: "computed" },
    ...footballEvidence,
  ];
  if (market === "spread") return [
    { label: "Model scoring margin", awayValue: forecast.expectedMarginHome < 0 ? `${payload.game.away.abbreviation} by ${Math.abs(forecast.expectedMarginHome).toFixed(1)}` : null, homeValue: forecast.expectedMarginHome >= 0 ? `${payload.game.home.abbreviation} by ${forecast.expectedMarginHome.toFixed(1)}` : null, source: "computed" },
    { label: "80% margin range", awayValue: null, homeValue: `${forecast.interval80.marginHome[0].toFixed(0)} to ${forecast.interval80.marginHome[1].toFixed(0)}`, source: "computed" },
    ...footballEvidence,
  ];
  return [
    { label: "Model expected total", awayValue: null, homeValue: forecast.expectedTotal.toFixed(1), source: "computed" },
    { label: "Expected points", awayValue: forecast.expectedAwayPoints.toFixed(1), homeValue: forecast.expectedHomePoints.toFixed(1), source: "computed" },
    { label: "80% total range", awayValue: null, homeValue: `${forecast.interval80.total[0].toFixed(0)} to ${forecast.interval80.total[1].toFixed(0)}`, source: "computed" },
    ...footballEvidence,
  ];
}

function buildPublicSplits(payload: CfbForwardEvidencePayload, market: CfbV1Market): MarketEdgeDto["publicSplits"] {
  const split = payload.market.playbookSplits?.[market];
  if (!split) return [];
  const stamp = {
    observedAt: split.capturedAt,
    freshnessCheckedAt: split.capturedAt,
    staleAfterMinutes: cfbSplitStaleAfterMinutes(payload.game.scheduledStart, split.capturedAt),
    isStale: false,
  };
  if (market === "total") return [
    { side: "over", label: "Over", moneyPct: split.overMoneyPct, betsPct: split.overBetsPct, ...stamp },
    { side: "under", label: "Under", moneyPct: split.underMoneyPct, betsPct: split.underBetsPct, ...stamp },
  ];
  return [
    { side: "home", label: payload.game.home.abbreviation, moneyPct: split.homeMoneyPct, betsPct: split.homeBetsPct, ...stamp },
    { side: "away", label: payload.game.away.abbreviation, moneyPct: split.awayMoneyPct, betsPct: split.awayBetsPct, ...stamp },
  ];
}

function cfbSplitStaleAfterMinutes(gameStartsAt: string, observedAt: string): number {
  const untilKickoff = Date.parse(gameStartsAt) - Date.parse(observedAt);
  return untilKickoff <= 48 * 60 * 60_000 ? 90 : 390;
}

function splitValue(split: CfbForwardPlaybookSplit | null, market: CfbV1Market, side: string): { money: number | null; bets: number | null } {
  if (!split) return { money: null, bets: null };
  if (market === "total") return side === "over" ? { money: split.overMoneyPct, bets: split.overBetsPct } : { money: split.underMoneyPct, bets: split.underBetsPct };
  return side === "home" ? { money: split.homeMoneyPct, bets: split.homeBetsPct } : { money: split.awayMoneyPct, bets: split.awayBetsPct };
}

function buildSignals(payload: CfbForwardEvidencePayload): DailyEdgeGameDto["sharpSignals"] {
  if (!payload.market.playbookSplits) return [];
  return [
    { market: "ML", category: "handle_gap", description: "Playbook public money-versus-ticket divergence is available as a bounded market input for both teams.", source: "Playbook public consensus", direction: "neutral" },
    { market: "OU", category: "handle_gap", description: "Playbook public money-versus-ticket divergence is available as a bounded market input for Over and Under.", source: "Playbook public consensus", direction: "neutral" },
    { market: "NRFI", category: "handle_gap", description: "Playbook public money-versus-ticket divergence is available as a bounded market input for both spread sides.", source: "Playbook public consensus", direction: "neutral" },
  ];
}

function legacyPrediction(market: MarketEdgeDto): DailyEdgePredictionDto { return { pick: market.pick, confidence: market.confidence, grade: market.grade, signalType: market.signalType, marketSignal: market.marketSignal, sharpStatus: market.sharpStatus }; }
function decisionFor(decisions: CfbV1ExactPriceDecision[], market: CfbV1Market): CfbV1ExactPriceDecision | null { const matches = decisions.filter((row) => row.market === market); if (matches.length > 1) throw new Error(`CFB member fixture has duplicate ${market} decisions.`); return matches[0] ?? null; }
function decisionForecastProbability(decision: CfbV1ExactPriceDecision): number {
  return decision.forecastProbability ?? decision.independentProbability;
}
function canonicalSide(payload: CfbForwardEvidencePayload, decision: CfbV1ExactPriceDecision): "home" | "away" | "over" | "under" { if (decision.market === "total") return /^over\b/i.test(decision.side) ? "over" : "under"; return decision.side.startsWith(payload.game.home.abbreviation) ? "home" : "away"; }
function opposingCanonicalSide(side: string): "home" | "away" | "over" | "under" { return side === "home" ? "away" : side === "away" ? "home" : side === "over" ? "under" : "over"; }
function opposingLabel(payload: CfbForwardEvidencePayload, market: CfbV1Market, side: string, line: number | null): string { if (market === "moneyline") return side === "home" ? payload.game.away.abbreviation : payload.game.home.abbreviation; if (market === "spread") return `${side === "home" ? payload.game.away.abbreviation : payload.game.home.abbreviation} ${signed(line === null ? 0 : -line)}`; return `${side === "over" ? "Under" : "Over"} ${marketNumber(line ?? 0)}`; }
function quoteFor(book: NonNullable<CfbForwardEvidencePayload["market"]["current"]>, market: CfbV1Market, side: string): { price: number; line: number | null } | null { if (market === "moneyline" && book.moneyline) return { price: side === "home" ? book.moneyline.homePrice : book.moneyline.awayPrice, line: null }; if (market === "spread" && book.spread) return { price: side === "home" ? book.spread.homePrice : book.spread.awayPrice, line: side === "home" ? book.spread.homeLine : book.spread.awayLine }; if (market === "total" && book.total) return { price: side === "over" ? book.total.overPrice : book.total.underPrice, line: book.total.line }; return null; }
function lineFromSlot(slot: CfbForwardEvidencePayload["market"]["current"] extends never ? never : unknown): number | null { if (!slot || typeof slot !== "object") return null; const record = slot as Record<string, unknown>; return typeof record.line === "number" ? record.line : typeof record.homeLine === "number" ? record.homeLine : null; }
function normalizeBook(value: string): string { return value.toLowerCase().replace(/[^a-z0-9]+/g, ""); }
function formatAmerican(value: number): string { return value > 0 ? `+${value}` : String(value); }
function marketNumber(value: number): string { return Number.isInteger(value) ? value.toFixed(0) : value.toFixed(1); }
function signed(value: number): string { return value > 0 ? `+${marketNumber(value)}` : marketNumber(value); }
function verdictRank(value: string): number { return value === "best_angle" ? 3 : value === "lean" ? 2 : value === "watchlist" ? 1 : 0; }
function localDate(value: string): string { return new Intl.DateTimeFormat("en-CA", { timeZone: "America/New_York", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date(value)); }
function timeEt(value: string): string { return new Intl.DateTimeFormat("en-US", { timeZone: "America/New_York", hour: "numeric", minute: "2-digit" }).format(new Date(value)); }
function minutesEt(value: string): number { const parts = new Intl.DateTimeFormat("en-US", { timeZone: "America/New_York", hour: "2-digit", minute: "2-digit", hour12: false }).formatToParts(new Date(value)); return Number(parts.find((part) => part.type === "hour")?.value ?? 0) * 60 + Number(parts.find((part) => part.type === "minute")?.value ?? 0); }
