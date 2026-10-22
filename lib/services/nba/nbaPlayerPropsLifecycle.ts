import {
  buildNbaPlayerPropsMemberSnapshot,
  type NbaPlayerPropsMemberDecision,
  type NbaPlayerPropsMemberSnapshot,
} from "./nbaPlayerPropsProductContract";
import { currentSlateDate } from "../../dates/slateDate";
import { nbaPlayerPropsCadenceStage, type NbaPlayerPropsCadenceStage } from "./nbaPlayerPropsSourcePolicy";

export const NBA_PLAYER_PROPS_LIFECYCLE_CANDIDATE_RELEASE =
  "nba_player_props_lifecycle_candidate_2026_10_22_r4_et_day_boundary" as const;
export const NBA_PLAYER_PROPS_WRITER_LEASE_GROUP = "prediction_pipeline:nba" as const;
export const NBA_PLAYER_PROPS_LOCK_LEAD_MINUTES = 60;

const CADENCE_MINUTES: Record<Exclude<NbaPlayerPropsCadenceStage, "locked">, number> = {
  far: 24 * 60,
  game_day: 180,
  t_minus_180: 60,
  t_minus_60: 30,
  t_minus_15: 15,
};

export type NbaPlayerPropsRefreshPlan = Readonly<{
  release: typeof NBA_PLAYER_PROPS_LIFECYCLE_CANDIDATE_RELEASE;
  publicEnabled: false;
  writerLeaseGroup: typeof NBA_PLAYER_PROPS_WRITER_LEASE_GROUP;
  dueGameIds: readonly string[];
  lockSweepGameIds: readonly string[];
  stages: Readonly<Record<string, NbaPlayerPropsCadenceStage>>;
}>;

/**
 * NBA props slates roll at the Eastern calendar-day boundary. Game status is
 * deliberately irrelevant: a final does not remove the slate early, and a
 * late game cannot hold the completed date on the next day's board.
 */
export function nbaPlayerPropsSlateDate(now: Date = new Date()): string {
  return currentSlateDate("nba", now);
}

/**
 * Pure planning only. A future cron may call this behind the shared NBA
 * prediction lease; member requests must never call providers themselves.
 */
export function planNbaPlayerPropsRefresh(args: {
  now: string;
  slateDate: string;
  games: NbaPlayerPropsMemberSnapshot["games"];
  lastCapturedAtByGame?: Readonly<Record<string, string>>;
}): NbaPlayerPropsRefreshPlan {
  const now = timestamp(args.now, "now");
  const stages: Record<string, NbaPlayerPropsCadenceStage> = {};
  const dueGameIds: string[] = [];
  const lockSweepGameIds: string[] = [];
  for (const game of args.games) {
    const start = timestamp(game.scheduledStart, "scheduledStart");
    const stage = nbaPlayerPropsCadenceStage({ now: args.now, scheduledStart: game.scheduledStart, slateDate: args.slateDate });
    stages[game.gameId] = stage;
    const lockAt = start - NBA_PLAYER_PROPS_LOCK_LEAD_MINUTES * 60_000;
    if (now >= lockAt) lockSweepGameIds.push(game.gameId);
    if (stage === "locked") continue;
    const last = args.lastCapturedAtByGame?.[game.gameId];
    const interval = CADENCE_MINUTES[stage] * 60_000;
    if (!last || now - timestamp(last, "lastCapturedAt") >= interval) dueGameIds.push(game.gameId);
  }
  return {
    release: NBA_PLAYER_PROPS_LIFECYCLE_CANDIDATE_RELEASE,
    publicEnabled: false,
    writerLeaseGroup: NBA_PLAYER_PROPS_WRITER_LEASE_GROUP,
    dueGameIds,
    lockSweepGameIds,
    stages,
  };
}

/**
 * Advances an in-memory candidate snapshot while preserving every previously
 * locked payload byte-for-byte. It does not persist or publish anything.
 */
export function advanceNbaPlayerPropsCandidateLifecycle(args: {
  now: string;
  previous: NbaPlayerPropsMemberSnapshot | null;
  candidate: NbaPlayerPropsMemberSnapshot;
}): Readonly<{
  release: typeof NBA_PLAYER_PROPS_LIFECYCLE_CANDIDATE_RELEASE;
  snapshot: NbaPlayerPropsMemberSnapshot;
  recomputedUnlocked: number;
  frozenAtLock: number;
  retainedLocked: number;
}> {
  const now = timestamp(args.now, "now");
  if (
    args.candidate.publicEnabled !== false
    || (args.previous !== null && args.previous.publicEnabled !== false)
  ) {
    throw new Error("NBA props candidate lifecycle cannot operate on a public snapshot.");
  }
  const previousByScope = new Map((args.previous?.decisions ?? []).map((row) => [decisionScope(row), row]));
  const candidateScopes = new Set(args.candidate.decisions.map(decisionScope));
  const output: NbaPlayerPropsMemberDecision[] = [];
  let recomputedUnlocked = 0;
  let frozenAtLock = 0;
  let retainedLocked = 0;

  for (const row of args.candidate.decisions) {
    const prior = previousByScope.get(decisionScope(row));
    if (prior?.lockedAt) {
      output.push(prior);
      retainedLocked += 1;
      continue;
    }
    const lockAt = Date.parse(row.scheduledStart) - NBA_PLAYER_PROPS_LOCK_LEAD_MINUTES * 60_000;
    if (now >= lockAt) {
      if (prior) {
        output.push({ ...prior, lockedAt: new Date(Math.max(lockAt, 0)).toISOString() });
        frozenAtLock += 1;
      }
    } else {
      output.push(row);
      recomputedUnlocked += 1;
    }
  }
  for (const prior of args.previous?.decisions ?? []) {
    if (prior.lockedAt && !candidateScopes.has(decisionScope(prior))) {
      output.push(prior);
      retainedLocked += 1;
    }
  }
  const gameMap = new Map([
    ...(args.previous?.games ?? []).map((game) => [game.gameId, game] as const),
    ...args.candidate.games.map((game) => [game.gameId, game] as const),
  ]);
  return {
    release: NBA_PLAYER_PROPS_LIFECYCLE_CANDIDATE_RELEASE,
    snapshot: buildNbaPlayerPropsMemberSnapshot({
      mode: "private_forward_candidate",
      generatedAt: args.now,
      slateDate: args.candidate.slateDate,
      games: [...gameMap.values()],
      decisions: output,
      inputRows: args.candidate.diagnostics.inputRows,
    }),
    recomputedUnlocked,
    frozenAtLock,
    retainedLocked,
  };
}

function decisionScope(row: NbaPlayerPropsMemberDecision): string {
  return [row.gameId, row.playerId, row.market].join("|");
}

function timestamp(value: string, field: string): number {
  const parsed = Date.parse(value);
  if (!Number.isFinite(parsed)) throw new Error(`NBA props lifecycle ${field} is invalid.`);
  return parsed;
}
