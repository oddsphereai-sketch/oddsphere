import { createHash } from "node:crypto";
import type { DailyEdgeGameAvailability } from "@/lib/services/dailyEdge/gameAvailability";
import type { WeatherForecastRecord } from "@/lib/providers/interfaces/IWeatherProvider";
import type {
  NflPreviewBookOdds,
  NflPreviewGame,
} from "./balldontlieNflPreviewSlate";
import type {
  NflRegularEvaluatedBetDecision,
  NflRegularOutcomeConfidence,
} from "./nflRegularDecisionEvidence";
import type { NflR6ShadowMoneylineDecision } from "./nflR6MoneylineShadow";
import type { NflRegularSharpSplitSet } from "./sharpApiNflSplits";

export const NFL_FORWARD_EVIDENCE_SCHEMA_RELEASE =
  "nfl_forward_evidence_snapshot_2026_08_23_r3_member" as const;
export const NFL_FORWARD_EVIDENCE_PREVIOUS_SCHEMA_RELEASE =
  "nfl_forward_evidence_snapshot_2026_08_22_r2_multibook" as const;
export const NFL_FORWARD_EVIDENCE_LEGACY_SCHEMA_RELEASE =
  "nfl_forward_evidence_snapshot_2026_08_21_r1" as const;
export const NFL_FORWARD_EVIDENCE_COLLECTOR_RELEASE =
  "nfl_forward_evidence_collector_2026_08_23_r3_member" as const;

export type NflForwardEvidenceStage = "opening" | "unlocked" | "t60";

export type NflForwardRosterPlayer = {
  playerId: string | null;
  name: string;
  position: string | null;
  depth: string | null;
  depthRank: number | null;
  injuryStatus: string | null;
  explicitStarter: boolean;
};

export type NflForwardTeamDepthSnapshot = {
  provider: "balldontlie";
  team: string;
  capturedAt: string;
  sourceSnapshotId: string | null;
  starterStatus: "confirmed" | "projected" | "unknown";
  expectedStartingQuarterback: NflForwardRosterPlayer | null;
  quarterbackDepth: NflForwardRosterPlayer[];
  roster: NflForwardRosterPlayer[];
};

export type NflForwardPlaybookLine = {
  provider: "playbook";
  capturedAt: string;
  sourceTier: string | null;
  homeMoneyline: number | null;
  awayMoneyline: number | null;
  homeSpread: number | null;
  awaySpread: number | null;
  total: number | null;
};

export type NflForwardPlaybookSplit = {
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

export type NflForwardPlaybookSplitSet = Record<
  "moneyline" | "spread" | "total",
  NflForwardPlaybookSplit
>;

export type NflForwardWeatherSnapshot = {
  venueTeam: string;
  venueName: string;
  roofType: "outdoor" | "retractable" | "fixed";
  status:
    | "forecast_available"
    | "controlled_indoor"
    | "outside_forecast_window"
    | "not_captured_for_unlocked"
    | "provider_unavailable";
  capturedAt: string;
  forecast: WeatherForecastRecord | null;
};

export type NflForwardOperationalOpening = {
  provenance: "provider_opening" | "first_observed";
  capturedAt: string;
  quote: NflPreviewBookOdds;
};

export type NflForwardEvidencePayload = {
  schemaRelease: typeof NFL_FORWARD_EVIDENCE_SCHEMA_RELEASE;
  collectorRelease: typeof NFL_FORWARD_EVIDENCE_COLLECTOR_RELEASE;
  runId: string;
  season: number;
  week: number;
  slateGameCount: number;
  stage: NflForwardEvidenceStage;
  captureTiming: "on_time" | "late_first_observation";
  capturedAt: string;
  cutoffAt: string | null;
  t60LagMinutes: number | null;
  game: NflPreviewGame;
  market: {
    current: NflPreviewBookOdds;
    currentBooks: NflPreviewBookOdds[];
    comparableCurrentBooks: NflPreviewBookOdds[];
    providerOpening: NflPreviewBookOdds | null;
    providerOpeningBooks: NflPreviewBookOdds[];
    comparableProviderOpeningBooks: NflPreviewBookOdds[];
    operationalOpening: NflForwardOperationalOpening;
    playbookLine: NflForwardPlaybookLine | null;
    playbookSplits: NflForwardPlaybookSplitSet | null;
    sharpApiSplits: NflRegularSharpSplitSet | null;
  };
  startersAndDepth: {
    away: NflForwardTeamDepthSnapshot;
    home: NflForwardTeamDepthSnapshot;
  };
  injuries: DailyEdgeGameAvailability | null;
  weather: NflForwardWeatherSnapshot;
  decisions: {
    evaluatedBets: NflRegularEvaluatedBetDecision[];
    outcomeConfidence: NflRegularOutcomeConfidence[];
    shadowEvaluatedBets?: NflR6ShadowMoneylineDecision[];
    modelPromotionStatus: "nfl_v1_member_release_2026_08_23_r2";
    publicationEnabled: true;
    trackingEnabled: false;
  };
  coverage: {
    currentOdds: boolean;
    currentBookCount: number;
    comparableCurrentBookCount: number;
    multibookConsensusReady: boolean;
    operationalOpening: boolean;
    rosterAndDepth: boolean;
    expectedQuarterbacks: boolean;
    injuries: boolean;
    playbookSplits: boolean;
    sharpApiSplits: boolean;
    weather: boolean;
    healthHolds: string[];
  };
  requestBudget: {
    balldontlieSlate: number;
    balldontlieRoster: number;
    balldontlieInjuriesMaximum: number;
    playbook: number;
    sharpApi: number;
    weather: number;
    totalMaximum: number;
  };
};

export type NflForwardPreviousEvidencePayload = Omit<
  NflForwardEvidencePayload,
  "schemaRelease" | "collectorRelease" | "decisions"
> & {
  schemaRelease: typeof NFL_FORWARD_EVIDENCE_PREVIOUS_SCHEMA_RELEASE;
  collectorRelease: "nfl_forward_evidence_collector_2026_08_22_r2_multibook";
  decisions: {
    evaluatedBets: NflRegularEvaluatedBetDecision[];
    outcomeConfidence: NflRegularOutcomeConfidence[];
    shadowEvaluatedBets?: NflR6ShadowMoneylineDecision[];
    modelPromotionStatus: "blocked_pending_independent_validation";
    publicationEnabled: false;
    trackingEnabled: false;
  };
};

export type NflForwardLegacyEvidencePayload = Omit<
  NflForwardEvidencePayload,
  "schemaRelease" | "collectorRelease" | "market" | "coverage" | "decisions"
> & {
  schemaRelease: typeof NFL_FORWARD_EVIDENCE_LEGACY_SCHEMA_RELEASE;
  collectorRelease: "nfl_forward_evidence_collector_2026_08_21_r1";
  market: Omit<
    NflForwardEvidencePayload["market"],
    "currentBooks" | "comparableCurrentBooks" | "providerOpeningBooks" | "comparableProviderOpeningBooks"
  >;
  coverage: Omit<
    NflForwardEvidencePayload["coverage"],
    "currentBookCount" | "comparableCurrentBookCount" | "multibookConsensusReady"
  >;
  decisions: {
    evaluatedBets: NflRegularEvaluatedBetDecision[];
    outcomeConfidence: NflRegularOutcomeConfidence[];
    modelPromotionStatus: "blocked_pending_independent_validation";
    publicationEnabled: false;
    trackingEnabled: false;
  };
};

export type NflForwardAnyEvidencePayload =
  | NflForwardEvidencePayload
  | NflForwardPreviousEvidencePayload
  | NflForwardLegacyEvidencePayload;

export type NflForwardStoredEvidence = {
  id: string;
  providerGameId: string;
  stage: NflForwardEvidenceStage;
  capturedAt: string;
  gameStartAt: string;
  payloadSha256: string;
  payload: NflForwardAnyEvidencePayload;
};

export type NflForwardCapturePlan = {
  game: NflPreviewGame;
  stage: NflForwardEvidenceStage;
  captureTiming: "on_time" | "late_first_observation";
  cutoffAt: string | null;
  t60LagMinutes: number | null;
};

const T60_MS = 60 * 60_000;

export function planNflForwardEvidenceCaptures(args: {
  games: NflPreviewGame[];
  existing: NflForwardStoredEvidence[];
  capturedAt: string;
  unlockedCadenceMinutes: number;
}): NflForwardCapturePlan[] {
  const now = validTimestamp(args.capturedAt, "capturedAt");
  const byGame = groupByGame(args.existing);
  const plans: NflForwardCapturePlan[] = [];
  for (const game of args.games) {
    const startsAt = validTimestamp(game.scheduledStart, `game ${game.providerGameId} start`);
    if (now >= startsAt) continue;
    const cutoff = startsAt - T60_MS;
    const existing = byGame.get(game.providerGameId) ?? [];
    const hasOpening = existing.some((row) => row.stage === "opening");
    const hasT60 = existing.some((row) => row.stage === "t60");
    if (!hasOpening) {
      plans.push({
        game,
        stage: "opening",
        captureTiming: now >= cutoff ? "late_first_observation" : "on_time",
        cutoffAt: null,
        t60LagMinutes: null,
      });
    }
    if (now >= cutoff && !hasT60) {
      plans.push({
        game,
        stage: "t60",
        captureTiming: "on_time",
        cutoffAt: new Date(cutoff).toISOString(),
        t60LagMinutes: Math.max(0, (now - cutoff) / 60_000),
      });
      continue;
    }
    if (!hasOpening || now >= cutoff) continue;
    const latest = Math.max(...existing.map((row) => validTimestamp(row.capturedAt, "stored capturedAt")));
    if (now - latest >= args.unlockedCadenceMinutes * 60_000) {
      plans.push({
        game,
        stage: "unlocked",
        captureTiming: "on_time",
        cutoffAt: new Date(cutoff).toISOString(),
        t60LagMinutes: null,
      });
    }
  }
  return plans;
}

export function determineNflForwardCollectionNeed(args: {
  existing: NflForwardStoredEvidence[];
  now: string;
}): { collect: boolean; reason: string; cadenceMinutes: number | null } {
  const now = validTimestamp(args.now, "now");
  if (args.existing.length === 0) return { collect: true, reason: "opening_seed", cadenceMinutes: null };
  const byGame = groupByGame(args.existing);
  const expected = Math.max(...args.existing.map((row) => row.payload.slateGameCount));
  const openings = args.existing.filter((row) => row.stage === "opening").length;
  if (openings < expected) return { collect: true, reason: "opening_incomplete", cadenceMinutes: null };
  const upcomingOutsideT60: number[] = [];
  for (const rows of byGame.values()) {
    const latestRow = [...rows].sort((first, second) => Date.parse(second.capturedAt) - Date.parse(first.capturedAt))[0]!;
    const startsAt = validTimestamp(latestRow.gameStartAt, "stored gameStartAt");
    if (startsAt <= now) continue;
    const cutoff = startsAt - T60_MS;
    if (now >= cutoff && !rows.some((row) => row.stage === "t60")) {
      return { collect: true, reason: "t60_due", cadenceMinutes: 15 };
    }
    if (now < cutoff) upcomingOutsideT60.push(startsAt);
  }
  if (upcomingOutsideT60.length === 0) return { collect: false, reason: "no_unlocked_games_due", cadenceMinutes: null };
  const nextStart = Math.min(...upcomingOutsideT60);
  const cadenceMinutes = nextStart - now <= 48 * 60 * 60_000 ? 60 : 360;
  const latest = Math.max(...args.existing.map((row) => validTimestamp(row.capturedAt, "stored capturedAt")));
  return now - latest >= cadenceMinutes * 60_000
    ? { collect: true, reason: "unlocked_refresh_due", cadenceMinutes }
    : { collect: false, reason: "cadence_not_due", cadenceMinutes };
}

export function hashNflForwardEvidencePayload(payload: NflForwardAnyEvidencePayload): string {
  return createHash("sha256").update(stableJson(payload)).digest("hex");
}

function groupByGame(rows: NflForwardStoredEvidence[]): Map<string, NflForwardStoredEvidence[]> {
  const byGame = new Map<string, NflForwardStoredEvidence[]>();
  for (const row of rows) byGame.set(row.providerGameId, [...(byGame.get(row.providerGameId) ?? []), row]);
  return byGame;
}

function stableJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableJson).join(",")}]`;
  if (value !== null && typeof value === "object") {
    return `{${Object.entries(value as Record<string, unknown>)
      .sort(([first], [second]) => first.localeCompare(second))
      .map(([key, item]) => `${JSON.stringify(key)}:${stableJson(item)}`)
      .join(",")}}`;
  }
  return JSON.stringify(value) ?? "null";
}

function validTimestamp(value: string, label: string): number {
  const timestamp = Date.parse(value);
  if (!Number.isFinite(timestamp)) throw new Error(`${label} must be a valid timestamp.`);
  return timestamp;
}
