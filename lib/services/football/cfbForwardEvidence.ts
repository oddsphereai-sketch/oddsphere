import { createHash } from "node:crypto";
import type { NcaafBookOdds, NcaafGame } from "./balldontlieNcaafSlate";
import type { CFB_SHARP_API_ODDS_RELEASE } from "./cfbSharpApiOdds";
import type { CfbMarketInformedOutcomeForecast } from "./cfbMarketInformedOutcome";
import type { CfbSharpApiSplitRecord } from "./cfbSharpApiSplits";
import type { CfbKickoffWeatherSnapshot } from "./cfbKickoffWeather";
import type { CfbForwardContextCapture } from "./cfbForwardEvidenceCapture";
import {
  cfbV1LineProbabilities,
  type CfbV1DecisionBundle,
  type CfbV1Forecast,
  type CfbV1Market,
} from "./cfbV1Decision";

export const CFB_FORWARD_EVIDENCE_SCHEMA_RELEASE =
  "cfb_forward_evidence_snapshot_2026_09_04_r20_holistic_confidence" as const;
export const CFB_FORWARD_COHERENT_PREVIOUS_EVIDENCE_SCHEMA_RELEASE =
  "cfb_forward_evidence_snapshot_2026_08_31_r18_kickoff_weather" as const;
export const CFB_FORWARD_WEATHER_PREVIOUS_EVIDENCE_SCHEMA_RELEASE =
  "cfb_forward_evidence_snapshot_2026_08_31_r17_playbook_event_identity" as const;
export const CFB_FORWARD_IDENTITY_PREVIOUS_EVIDENCE_SCHEMA_RELEASE =
  "cfb_forward_evidence_snapshot_2026_08_31_r16_authoritative_pmf_calibration" as const;
export const CFB_FORWARD_CALIBRATION_PREVIOUS_EVIDENCE_SCHEMA_RELEASE =
  "cfb_forward_evidence_snapshot_2026_08_31_r15_public_consensus_market_input" as const;
export const CFB_FORWARD_PUBLIC_SPLITS_PREVIOUS_EVIDENCE_SCHEMA_RELEASE =
  "cfb_forward_evidence_snapshot_2026_08_30_r14_market_dominant_fresh_sharp" as const;
export const CFB_FORWARD_TRANSITION_PREVIOUS_EVIDENCE_SCHEMA_RELEASE =
  "cfb_forward_evidence_snapshot_2026_08_29_r13_transition_coherent" as const;
export const CFB_FORWARD_MARKET_SHARP_PREVIOUS_EVIDENCE_SCHEMA_RELEASE =
  "cfb_forward_evidence_snapshot_2026_08_29_r12_market_sharp_authoritative" as const;
export const CFB_FORWARD_MARKET_SHARP_PRIOR_EVIDENCE_SCHEMA_RELEASE =
  "cfb_forward_evidence_snapshot_2026_08_28_r11_prior_event_disambiguation" as const;
export const CFB_FORWARD_AMBIGUOUS_SCOPE_PREVIOUS_EVIDENCE_SCHEMA_RELEASE =
  "cfb_forward_evidence_snapshot_2026_08_28_r10_event_discovery_pagination" as const;
export const CFB_FORWARD_CANONICAL_DISCOVERY_PREVIOUS_EVIDENCE_SCHEMA_RELEASE =
  "cfb_forward_evidence_snapshot_2026_08_28_r9_canonical_price_coverage" as const;
export const CFB_FORWARD_PROVIDER_DISCOVERY_PREVIOUS_EVIDENCE_SCHEMA_RELEASE =
  "cfb_forward_evidence_snapshot_2026_08_28_r8_directional_pmf" as const;
export const CFB_FORWARD_PRE_DIRECTIONAL_EVIDENCE_SCHEMA_RELEASE =
  "cfb_forward_evidence_snapshot_2026_08_28_r7_display_quote_coverage" as const;
export const CFB_FORWARD_DATA_QUALITY_EVIDENCE_SCHEMA_RELEASE =
  "cfb_forward_evidence_snapshot_2026_08_28_r6_market_scoped_data_quality" as const;
export const CFB_FORWARD_PREVIOUS_EVIDENCE_SCHEMA_RELEASE =
  "cfb_forward_evidence_snapshot_2026_08_28_r5_two_axis_outcome_sharp_splits" as const;
export const CFB_FORWARD_PRIOR_EVIDENCE_SCHEMA_RELEASE =
  "cfb_forward_evidence_snapshot_2026_08_28_r4_market_selection_provenance" as const;
export const CFB_FORWARD_TRANSITION_EVIDENCE_SCHEMA_RELEASE =
  "cfb_forward_evidence_snapshot_2026_08_27_r3_pmf_side_guard" as const;
export const CFB_FORWARD_LEGACY_EVIDENCE_SCHEMA_RELEASE =
  "cfb_forward_evidence_snapshot_2026_08_26_r2_price_provenance" as const;
export const CFB_FORWARD_INITIAL_EVIDENCE_SCHEMA_RELEASE =
  "cfb_forward_evidence_snapshot_2026_08_25_r1" as const;
export const CFB_FORWARD_EVIDENCE_COLLECTOR_RELEASE =
  "cfb_forward_evidence_collector_2026_09_04_r27_sharp_fallback_isolation" as const;
export const CFB_FORWARD_MEMBER_RELEASE =
  "cfb_v1_member_release_2026_09_04_r32_holistic_confidence" as const;
export const CFB_FORWARD_PUBLICATION_PREVIOUS_MEMBER_RELEASE =
  "cfb_v1_member_release_2026_09_02_r29_total_publication_coherence" as const;
export const CFB_FORWARD_COHERENT_PREVIOUS_MEMBER_RELEASE =
  "cfb_v1_member_release_2026_08_31_r27_kickoff_weather" as const;
export const CFB_FORWARD_WEATHER_PREVIOUS_MEMBER_RELEASE =
  "cfb_v1_member_release_2026_08_31_r26_playbook_event_identity" as const;
export const CFB_FORWARD_IDENTITY_PREVIOUS_MEMBER_RELEASE =
  "cfb_v1_member_release_2026_08_31_r25_authoritative_pmf_calibration" as const;
export const CFB_FORWARD_CALIBRATION_PREVIOUS_MEMBER_RELEASE =
  "cfb_v1_member_release_2026_08_31_r24_public_consensus_market_input" as const;
export const CFB_FORWARD_PUBLIC_SPLITS_PREVIOUS_MEMBER_RELEASE =
  "cfb_v1_member_release_2026_08_30_r23_market_dominant_fresh_sharp" as const;
export const CFB_FORWARD_TRANSITION_PREVIOUS_MEMBER_RELEASE =
  "cfb_v1_member_release_2026_08_29_r22_transition_coherent" as const;
export const CFB_FORWARD_MARKET_SHARP_PREVIOUS_MEMBER_RELEASE =
  "cfb_v1_member_release_2026_08_29_r21_market_sharp_authoritative" as const;
export const CFB_FORWARD_MARKET_SHARP_PRIOR_MEMBER_RELEASE =
  "cfb_v1_member_release_2026_08_28_r20_prior_event_disambiguation" as const;

export type CfbForwardEvidenceStage = "opening" | "unlocked" | "t60";

export type CfbForwardQuarterback = {
  playerId: string;
  name: string;
  position: "QB";
  jerseyNumber: string | null;
  previousSeasonPassingAttempts: number | null;
  previousSeasonPassingYards: number | null;
};

export type CfbForwardTeamQuarterbacks = {
  provider: "balldontlie";
  teamId: number;
  team: string;
  capturedAt: string;
  starterStatus: "projected" | "unknown";
  projectionMethod: "active_roster_previous_season_attempts" | "no_active_quarterback";
  expectedStartingQuarterback: CfbForwardQuarterback | null;
  activeQuarterbacks: CfbForwardQuarterback[];
};

export type CfbForwardPlaybookLine = {
  provider: "playbook";
  capturedAt: string;
  sourceTier: string | null;
  homeMoneyline: number | null;
  awayMoneyline: number | null;
  homeSpread: number | null;
  awaySpread: number | null;
  total: number | null;
};

export type CfbForwardPlaybookSplit = {
  provider: "playbook";
  capturedAt: string;
  booksUsed: number | null;
  homeMoneyPct: number | null;
  awayMoneyPct: number | null;
  homeBetsPct: number | null;
  awayBetsPct: number | null;
  overMoneyPct: number | null;
  underMoneyPct: number | null;
  overBetsPct: number | null;
  underBetsPct: number | null;
};

export type CfbForwardPlaybookSplitSet = Record<"moneyline" | "spread" | "total", CfbForwardPlaybookSplit>;

export type CfbForwardOperationalOpening = {
  provenance: "provider_opening" | "first_observed";
  capturedAt: string;
  quote: NcaafBookOdds;
};

export type CfbForwardPublishedForecast = Omit<CfbV1Forecast, "pmf">;
export type CfbForwardPublishedOutcomeForecast = Omit<CfbMarketInformedOutcomeForecast, "pmf">;

export type CfbForwardMarketOutlook = {
  market: CfbV1Market;
  side: "home" | "away" | "over" | "under";
  line: number | null;
  independentProbability: number;
  source: "authoritative_pmf" | "authoritative_pmf_at_playbook_line" | "independent_pmf" | "independent_pmf_at_playbook_line";
  contextObservedAt: string | null;
};

export type CfbForwardPublishedDecisionBundle = Omit<CfbV1DecisionBundle, "forecast"> & {
  forecast: CfbForwardPublishedForecast;
  /** Added by member release r3; optional only while the prior r2 wave is the release-transition fallback. */
  marketOutlooks?: Record<CfbV1Market, CfbForwardMarketOutlook | null>;
};

export type CfbForwardEvidencePayload = {
  schemaRelease: typeof CFB_FORWARD_EVIDENCE_SCHEMA_RELEASE;
  collectorRelease: typeof CFB_FORWARD_EVIDENCE_COLLECTOR_RELEASE;
  memberRelease: typeof CFB_FORWARD_MEMBER_RELEASE;
  runId: string;
  season: number;
  week: number;
  slateGameCount: number;
  stage: CfbForwardEvidenceStage;
  captureTiming: "on_time" | "late_first_observation";
  capturedAt: string;
  cutoffAt: string | null;
  t60LagMinutes: number | null;
  game: NcaafGame;
  market: {
    current: NcaafBookOdds | null;
    currentBooks: NcaafBookOdds[];
    /** All verified named-book display observations, including one-sided offers excluded from grading. */
    displayBooks?: NcaafBookOdds[];
    providerOpening: NcaafBookOdds | null;
    operationalOpening: CfbForwardOperationalOpening | null;
    playbookLine: CfbForwardPlaybookLine | null;
    playbookSplits: CfbForwardPlaybookSplitSet | null;
    sharpApiOddsRelease: typeof CFB_SHARP_API_ODDS_RELEASE | null;
    sharpApiSplits: CfbSharpApiSplitRecord[] | null;
    sharpApiSplitsStatus?: "matched" | "event_not_published" | "request_failed";
    sharpApiSplitsError?: string | null;
  };
  quarterbacks: {
    away: CfbForwardTeamQuarterbacks;
    home: CfbForwardTeamQuarterbacks;
  };
  availability: {
    injuryStatus: "provider_unavailable";
    weatherStatus: CfbKickoffWeatherSnapshot["status"] | "venue_weather_unavailable";
    /** Required on the current weather-aware schema; absent only on immutable prior releases. */
    weather?: CfbKickoffWeatherSnapshot;
    note: string;
  };
  decisions: CfbForwardPublishedDecisionBundle;
  contextualEvidenceCapture?: CfbForwardContextCapture;
  /** Immutable football-only baseline retained for release-separated diagnostics.
   * It never overrides the authoritative `decisions.forecast`. */
  independentForecast?: CfbForwardPublishedForecast | null;
  authoritativeForecast?: {
    status: "market_sharp_applied" | "market_anchor_unavailable_hold";
    release: string;
    candidateRelease: string;
    marketWeight: number;
    weatherIndependentTotalAdjustmentPoints?: number;
    weatherAuthoritativeTotalAdjustmentPoints?: number;
  };
  /** Legacy shadow market-context score distribution retained only on old rows. */
  outcomeForecast?: CfbForwardPublishedOutcomeForecast | null;
  /** Legacy shadow market-context directions retained only on old rows. */
  outcomeMarketOutlooks?: Record<CfbV1Market, CfbForwardMarketOutlook | null>;
  coverage: {
    currentOdds: boolean;
    comparableCurrentBookCount: number;
    currentOddsProviders: Array<"balldontlie" | "sharpapi">;
    sharpApiOddsFallback: boolean;
    targetExcludedConsensusReady: boolean;
    operationalOpening: boolean;
    playbookLine: boolean;
    playbookSplits: boolean;
    sharpApiSplits: boolean;
    activeQuarterbacks: boolean;
    injuries: false;
    weather: boolean;
    healthHolds: string[];
    availabilityWarnings: string[];
  };
  requestBudget: {
    balldontlieSlate: number;
    balldontlieQuarterbacks: number;
    playbook: number;
    sharpApiOdds: number;
    sharpApiSplits?: number;
    weather?: number;
    totalMaximum: number;
  };
};

export type CfbForwardStoredEvidence = {
  id: string;
  providerGameId: string;
  stage: CfbForwardEvidenceStage;
  capturedAt: string;
  gameStartAt: string;
  payloadSha256: string;
  payload: CfbForwardEvidencePayload;
};

export type CfbForwardCapturePlan = {
  game: NcaafGame;
  stage: CfbForwardEvidenceStage;
  captureTiming: "on_time" | "late_first_observation";
  cutoffAt: string | null;
  t60LagMinutes: number | null;
};

const T60_MS = 60 * 60_000;
const HOURLY_CADENCE_HORIZON_MS = 48 * 60 * 60_000;

function unlockedCadenceMinutes(startsAt: number, now: number): 60 | 360 {
  return startsAt - now <= HOURLY_CADENCE_HORIZON_MS ? 60 : 360;
}

export function planCfbForwardEvidenceCaptures(args: {
  games: NcaafGame[];
  existing: CfbForwardStoredEvidence[];
  capturedAt: string;
  unlockedCadenceMinutesOverride?: number;
}): CfbForwardCapturePlan[] {
  const now = timestamp(args.capturedAt, "capturedAt");
  const byGame = groupByGame(args.existing);
  const plans: CfbForwardCapturePlan[] = [];
  for (const game of args.games) {
    const startsAt = timestamp(game.scheduledStart, `game ${game.providerGameId} start`);
    if (now >= startsAt) continue;
    const cutoff = startsAt - T60_MS;
    const existing = byGame.get(game.providerGameId) ?? [];
    const hasOpening = existing.some((row) => row.stage === "opening");
    const hasT60 = existing.some((row) => row.stage === "t60");
    if (!hasOpening) plans.push({ game, stage: "opening", captureTiming: now >= cutoff ? "late_first_observation" : "on_time", cutoffAt: null, t60LagMinutes: null });
    if (now >= cutoff && !hasT60) {
      plans.push({ game, stage: "t60", captureTiming: "on_time", cutoffAt: new Date(cutoff).toISOString(), t60LagMinutes: Math.max(0, (now - cutoff) / 60_000) });
      continue;
    }
    if (!hasOpening || now >= cutoff) continue;
    const latest = Math.max(...existing.map((row) => timestamp(row.capturedAt, "stored capturedAt")));
    const cadenceMinutes = args.unlockedCadenceMinutesOverride ?? unlockedCadenceMinutes(startsAt, now);
    if (now - latest >= cadenceMinutes * 60_000) {
      plans.push({ game, stage: "unlocked", captureTiming: "on_time", cutoffAt: new Date(cutoff).toISOString(), t60LagMinutes: null });
    }
  }
  return plans;
}

export function determineCfbForwardCollectionNeed(args: {
  existing: CfbForwardStoredEvidence[];
  now: string;
}): { collect: boolean; reason: string; cadenceMinutes: number | null } {
  const now = timestamp(args.now, "now");
  if (args.existing.length === 0) return { collect: true, reason: "opening_seed", cadenceMinutes: null };
  const byGame = groupByGame(args.existing);
  const expected = Math.max(...args.existing.map((row) => row.payload.slateGameCount));
  if (new Set(args.existing.filter((row) => row.stage === "opening").map((row) => row.providerGameId)).size < expected) {
    return { collect: true, reason: "opening_incomplete", cadenceMinutes: null };
  }
  const upcoming: Array<{ startsAt: number; latest: number; cadenceMinutes: 60 | 360 }> = [];
  for (const rows of byGame.values()) {
    const latest = [...rows].sort((a, b) => Date.parse(b.capturedAt) - Date.parse(a.capturedAt))[0]!;
    const startsAt = timestamp(latest.gameStartAt, "stored gameStartAt");
    if (startsAt <= now) continue;
    const cutoff = startsAt - T60_MS;
    if (now >= cutoff && !rows.some((row) => row.stage === "t60")) return { collect: true, reason: "t60_due", cadenceMinutes: null };
    if (now < cutoff) upcoming.push({
      startsAt,
      latest: timestamp(latest.capturedAt, "stored capturedAt"),
      cadenceMinutes: unlockedCadenceMinutes(startsAt, now),
    });
  }
  if (upcoming.length === 0) return { collect: false, reason: "no_unlocked_games_due", cadenceMinutes: null };
  const due = upcoming.filter((row) => now - row.latest >= row.cadenceMinutes * 60_000);
  if (due.length > 0) return { collect: true, reason: "unlocked_refresh_due", cadenceMinutes: Math.min(...due.map((row) => row.cadenceMinutes)) };
  const next = [...upcoming].sort((first, second) => first.startsAt - second.startsAt)[0]!;
  return { collect: false, reason: "cadence_not_due", cadenceMinutes: next.cadenceMinutes };
}

export function hashCfbForwardEvidencePayload(payload: CfbForwardEvidencePayload): string {
  return createHash("sha256").update(stableJson(payload)).digest("hex");
}

/**
 * The r7 writer hashed optional object properties with an `undefined` value as
 * JSON `null`, while Postgres JSONB correctly omitted those properties. Keep a
 * narrowly release-scoped verifier so the immutable r7 transition wave remains
 * readable; r8 hashes the exact JSON-serializable shape.
 */
export function matchesCfbForwardEvidencePayloadHash(
  payload: CfbForwardEvidencePayload,
  expected: string,
): boolean {
  if (hashCfbForwardEvidencePayload(payload) === expected) return true;
  if (String(payload.schemaRelease) !== CFB_FORWARD_PRE_DIRECTIONAL_EVIDENCE_SCHEMA_RELEASE) return false;
  const legacyPayload = Object.hasOwn(payload, "outcomeMarketOutlooks")
    ? payload
    : { ...payload, outcomeMarketOutlooks: undefined };
  return createHash("sha256").update(legacyStableJson(legacyPayload)).digest("hex") === expected;
}

export function buildCfbForwardMarketOutlooks(args: {
  forecast: CfbV1Forecast;
  playbookLine: CfbForwardPlaybookLine | null;
}): Record<CfbV1Market, CfbForwardMarketOutlook | null> {
  const homeWin = args.forecast.homeWinProbability;
  const moneyline = homeWin >= 0.5
    ? outlook("moneyline", "home", null, homeWin, "authoritative_pmf", null)
    : outlook("moneyline", "away", null, 1 - homeWin, "authoritative_pmf", null);
  const playbookLine = args.playbookLine;
  if (!playbookLine) return { moneyline, spread: null, total: null };
  const homeSpread = playbookLine.homeSpread;
  const totalLine = playbookLine.total;
  if (homeSpread === null || homeSpread === undefined || totalLine === null || totalLine === undefined) {
    return {
      moneyline,
      spread: homeSpread === null || homeSpread === undefined
        ? null
        : spreadOutlook(args.forecast, homeSpread, playbookLine.capturedAt),
      total: totalLine === null || totalLine === undefined
        ? null
        : totalOutlook(args.forecast, totalLine, playbookLine.capturedAt),
    };
  }
  const probabilities = cfbV1LineProbabilities({ forecast: args.forecast, homeSpread, totalLine });
  return {
    moneyline,
    spread: probabilities.spread.home >= probabilities.spread.away
      ? outlook("spread", "home", homeSpread, probabilities.spread.home, "authoritative_pmf_at_playbook_line", playbookLine.capturedAt)
      : outlook("spread", "away", -homeSpread, probabilities.spread.away, "authoritative_pmf_at_playbook_line", playbookLine.capturedAt),
    total: probabilities.total.over >= probabilities.total.under
      ? outlook("total", "over", totalLine, probabilities.total.over, "authoritative_pmf_at_playbook_line", playbookLine.capturedAt)
      : outlook("total", "under", totalLine, probabilities.total.under, "authoritative_pmf_at_playbook_line", playbookLine.capturedAt),
  };
}

function spreadOutlook(forecast: CfbV1Forecast, homeSpread: number, observedAt: string): CfbForwardMarketOutlook {
  const probabilities = cfbV1LineProbabilities({ forecast, homeSpread, totalLine: forecast.expectedTotal });
  return probabilities.spread.home >= probabilities.spread.away
    ? outlook("spread", "home", homeSpread, probabilities.spread.home, "authoritative_pmf_at_playbook_line", observedAt)
    : outlook("spread", "away", -homeSpread, probabilities.spread.away, "authoritative_pmf_at_playbook_line", observedAt);
}

function totalOutlook(forecast: CfbV1Forecast, totalLine: number, observedAt: string): CfbForwardMarketOutlook {
  const probabilities = cfbV1LineProbabilities({ forecast, homeSpread: 0, totalLine });
  return probabilities.total.over >= probabilities.total.under
    ? outlook("total", "over", totalLine, probabilities.total.over, "authoritative_pmf_at_playbook_line", observedAt)
    : outlook("total", "under", totalLine, probabilities.total.under, "authoritative_pmf_at_playbook_line", observedAt);
}

function outlook(
  market: CfbV1Market,
  side: CfbForwardMarketOutlook["side"],
  line: number | null,
  independentProbability: number,
  source: CfbForwardMarketOutlook["source"],
  contextObservedAt: string | null,
): CfbForwardMarketOutlook {
  if (!Number.isFinite(independentProbability) || independentProbability < 0.5 || independentProbability > 1) {
    throw new Error(`CFB ${market} independent outlook probability is invalid.`);
  }
  return { market, side, line, independentProbability, source, contextObservedAt };
}

function groupByGame(rows: CfbForwardStoredEvidence[]): Map<string, CfbForwardStoredEvidence[]> {
  const result = new Map<string, CfbForwardStoredEvidence[]>();
  for (const row of rows) result.set(row.providerGameId, [...(result.get(row.providerGameId) ?? []), row]);
  return result;
}

function stableJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableJson).join(",")}]`;
  if (value !== null && typeof value === "object") return `{${Object.entries(value as Record<string, unknown>).filter(([, item]) => item !== undefined).sort(([a], [b]) => a.localeCompare(b)).map(([key, item]) => `${JSON.stringify(key)}:${stableJson(item)}`).join(",")}}`;
  return JSON.stringify(value) ?? "null";
}

function legacyStableJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(legacyStableJson).join(",")}]`;
  if (value !== null && typeof value === "object") return `{${Object.entries(value as Record<string, unknown>).sort(([a], [b]) => a.localeCompare(b)).map(([key, item]) => `${JSON.stringify(key)}:${legacyStableJson(item)}`).join(",")}}`;
  return JSON.stringify(value) ?? "null";
}

function timestamp(value: string, label: string): number {
  const parsed = Date.parse(value);
  if (!Number.isFinite(parsed)) throw new Error(`${label} must be a valid timestamp.`);
  return parsed;
}
