import { createHash } from "node:crypto";
import type { NcaafBookOdds, NcaafGame } from "./balldontlieNcaafSlate";
import type { CfbV1DecisionBundle, CfbV1Forecast } from "./cfbV1Decision";

export const CFB_FORWARD_EVIDENCE_SCHEMA_RELEASE =
  "cfb_forward_evidence_snapshot_2026_08_25_r1" as const;
export const CFB_FORWARD_EVIDENCE_COLLECTOR_RELEASE =
  "cfb_forward_evidence_collector_2026_08_25_r2_team_scoped_qb" as const;
export const CFB_FORWARD_MEMBER_RELEASE =
  "cfb_v1_member_release_2026_08_25_r1" as const;

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

export type CfbForwardPublishedDecisionBundle = Omit<CfbV1DecisionBundle, "forecast"> & {
  forecast: CfbForwardPublishedForecast;
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
    providerOpening: NcaafBookOdds | null;
    operationalOpening: CfbForwardOperationalOpening | null;
    playbookLine: CfbForwardPlaybookLine | null;
    playbookSplits: CfbForwardPlaybookSplitSet | null;
    sharpApiSplits: null;
  };
  quarterbacks: {
    away: CfbForwardTeamQuarterbacks;
    home: CfbForwardTeamQuarterbacks;
  };
  availability: {
    injuryStatus: "provider_unavailable";
    weatherStatus: "venue_weather_unavailable";
    note: string;
  };
  decisions: CfbForwardPublishedDecisionBundle;
  coverage: {
    currentOdds: boolean;
    comparableCurrentBookCount: number;
    targetExcludedConsensusReady: boolean;
    operationalOpening: boolean;
    playbookLine: boolean;
    playbookSplits: boolean;
    sharpApiSplits: false;
    activeQuarterbacks: boolean;
    injuries: false;
    weather: false;
    healthHolds: string[];
    availabilityWarnings: string[];
  };
  requestBudget: {
    balldontlieSlate: number;
    balldontlieQuarterbacks: number;
    playbook: number;
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

export function planCfbForwardEvidenceCaptures(args: {
  games: NcaafGame[];
  existing: CfbForwardStoredEvidence[];
  capturedAt: string;
  unlockedCadenceMinutes: number;
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
    if (now - latest >= args.unlockedCadenceMinutes * 60_000) {
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
  const upcoming: number[] = [];
  for (const rows of byGame.values()) {
    const latest = [...rows].sort((a, b) => Date.parse(b.capturedAt) - Date.parse(a.capturedAt))[0]!;
    const startsAt = timestamp(latest.gameStartAt, "stored gameStartAt");
    if (startsAt <= now) continue;
    const cutoff = startsAt - T60_MS;
    if (now >= cutoff && !rows.some((row) => row.stage === "t60")) return { collect: true, reason: "t60_due", cadenceMinutes: 15 };
    if (now < cutoff) upcoming.push(startsAt);
  }
  if (upcoming.length === 0) return { collect: false, reason: "no_unlocked_games_due", cadenceMinutes: null };
  const nextStart = Math.min(...upcoming);
  const cadenceMinutes = nextStart - now <= 48 * 60 * 60_000 ? 60 : 360;
  const latest = Math.max(...args.existing.map((row) => timestamp(row.capturedAt, "stored capturedAt")));
  return now - latest >= cadenceMinutes * 60_000
    ? { collect: true, reason: "unlocked_refresh_due", cadenceMinutes }
    : { collect: false, reason: "cadence_not_due", cadenceMinutes };
}

export function hashCfbForwardEvidencePayload(payload: CfbForwardEvidencePayload): string {
  return createHash("sha256").update(stableJson(payload)).digest("hex");
}

function groupByGame(rows: CfbForwardStoredEvidence[]): Map<string, CfbForwardStoredEvidence[]> {
  const result = new Map<string, CfbForwardStoredEvidence[]>();
  for (const row of rows) result.set(row.providerGameId, [...(result.get(row.providerGameId) ?? []), row]);
  return result;
}

function stableJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableJson).join(",")}]`;
  if (value !== null && typeof value === "object") return `{${Object.entries(value as Record<string, unknown>).sort(([a], [b]) => a.localeCompare(b)).map(([key, item]) => `${JSON.stringify(key)}:${stableJson(item)}`).join(",")}}`;
  return JSON.stringify(value) ?? "null";
}

function timestamp(value: string, label: string): number {
  const parsed = Date.parse(value);
  if (!Number.isFinite(parsed)) throw new Error(`${label} must be a valid timestamp.`);
  return parsed;
}
