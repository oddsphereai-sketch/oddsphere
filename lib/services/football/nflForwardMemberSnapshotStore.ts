import type { SupabaseClient } from "@supabase/supabase-js";
import { NFL_FORWARD_EVIDENCE_SCHEMA_RELEASE } from "./nflForwardEvidence";
import {
  NFL_WEEK_ONE_HELD_MEMBER_FIXTURE_RELEASE,
  type NflWeekOneHeldMemberFixture,
} from "./nflWeekOneHeldMemberFixture";
import {
  NFL_V1_ACTIONABLE_GRADE_DECISION_RELEASE,
  NFL_V1_ACTIONABLE_GRADE_MEMBER_RELEASE,
} from "./nflV1ActionableGradeCandidate";

export const NFL_FORWARD_MEMBER_SNAPSHOT_RELEASE =
  "nfl_forward_member_snapshot_2026_09_22_r19_nonpush_side_alignment" as const;
const NFL_NONPUSH_PREVIOUS_SNAPSHOT_RELEASE =
  "nfl_forward_member_snapshot_2026_09_21_r18_locked_transition_continuity" as const;
const NFL_OPENING_DIRECTION_PREVIOUS_SNAPSHOT_RELEASE =
  "nfl_forward_member_snapshot_2026_09_21_r17_opening_market_direction" as const;
const NFL_LOCKED_TRANSITION_PREVIOUS_SNAPSHOT_RELEASE =
  "nfl_forward_member_snapshot_2026_09_20_r16_locked_transition" as const;
const NFL_ML_TOTAL_PREVIOUS_SNAPSHOT_RELEASE =
  "nfl_forward_member_snapshot_2026_09_20_r15_ml_total_coherence" as const;
const NFL_INJURY_PAGINATION_PREVIOUS_SNAPSHOT_RELEASE =
  "nfl_forward_member_snapshot_2026_09_16_r14_injury_pagination" as const;
const NFL_SHARP_CONTRACT_PREVIOUS_SNAPSHOT_RELEASE =
  "nfl_forward_member_snapshot_2026_09_16_r13_sharp_league_contract" as const;
const NFL_ONE_POINT_PREVIOUS_SNAPSHOT_RELEASE =
  "nfl_forward_member_snapshot_2026_09_15_r12_one_point_pmf_boundary" as const;
const NFL_OPENING_FOLLOW_UP_PREVIOUS_SNAPSHOT_RELEASE =
  "nfl_forward_member_snapshot_2026_09_15_r11_opening_follow_up" as const;
const NFL_PREDICTION_OWNED_PREVIOUS_SNAPSHOT_RELEASE =
  "nfl_forward_member_snapshot_2026_09_14_r10_prediction_owned_side" as const;
const NFL_OPENING_FOLLOW_UP_PREVIOUS_MEMBER_RELEASE =
  "nfl_v1_member_release_2026_09_14_r13_prediction_owned_side" as const;
const NFL_OPENING_FOLLOW_UP_PREVIOUS_DECISION_RELEASE =
  "nfl_v1_daily_edge_decision_2026_09_14_r16_prediction_owned_side" as const;
const NFL_ONE_POINT_PREVIOUS_MEMBER_RELEASE =
  "nfl_v1_member_release_2026_09_15_r14_one_point_pmf_boundary" as const;
const NFL_ONE_POINT_PREVIOUS_DECISION_RELEASE =
  "nfl_v1_daily_edge_decision_2026_09_15_r17_one_point_pmf_boundary" as const;
const NFL_ONE_POINT_PREVIOUS_FIXTURE_RELEASE =
  "nfl_weekly_member_fixture_2026_09_15_r20_one_point_pmf_boundary" as const;
const NFL_INJURY_PAGINATION_PREVIOUS_MEMBER_RELEASE =
  "nfl_v1_member_release_2026_09_16_r16_injury_pagination" as const;
const NFL_INJURY_PAGINATION_PREVIOUS_DECISION_RELEASE =
  "nfl_v1_daily_edge_decision_2026_09_16_r19_injury_pagination" as const;
const NFL_INJURY_PAGINATION_PREVIOUS_FIXTURE_RELEASE =
  "nfl_weekly_member_fixture_2026_09_16_r22_injury_pagination" as const;
const NFL_ML_TOTAL_PREVIOUS_MEMBER_RELEASE =
  "nfl_v1_member_release_2026_09_20_r17_ml_total_coherence" as const;
const NFL_ML_TOTAL_PREVIOUS_DECISION_RELEASE =
  "nfl_v1_daily_edge_decision_2026_09_20_r20_ml_total_coherence" as const;
const NFL_ML_TOTAL_PREVIOUS_FIXTURE_RELEASE =
  "nfl_weekly_member_fixture_2026_09_20_r23_ml_total_coherence" as const;
const NFL_LOCKED_TRANSITION_PREVIOUS_MEMBER_RELEASE =
  "nfl_v1_member_release_2026_09_20_r17_ml_total_coherence" as const;
const NFL_LOCKED_TRANSITION_PREVIOUS_DECISION_RELEASE =
  "nfl_v1_daily_edge_decision_2026_09_20_r20_ml_total_coherence" as const;
const NFL_LOCKED_TRANSITION_PREVIOUS_FIXTURE_RELEASE =
  "nfl_weekly_member_fixture_2026_09_20_r24_locked_transition" as const;
const NFL_OPENING_DIRECTION_PREVIOUS_MEMBER_RELEASE =
  "nfl_v1_member_release_2026_09_21_r18_opening_market_direction" as const;
const NFL_OPENING_DIRECTION_PREVIOUS_DECISION_RELEASE =
  "nfl_v1_daily_edge_decision_2026_09_21_r21_opening_market_direction" as const;
const NFL_OPENING_DIRECTION_PREVIOUS_FIXTURE_RELEASE =
  "nfl_weekly_member_fixture_2026_09_21_r25_opening_market_direction" as const;
const NFL_NONPUSH_PREVIOUS_FIXTURE_RELEASE =
  "nfl_weekly_member_fixture_2026_09_21_r26_locked_transition_continuity" as const;
const NFL_FORWARD_PREVIOUS_MEMBER_SNAPSHOT_RELEASES = [
  NFL_NONPUSH_PREVIOUS_SNAPSHOT_RELEASE,
  NFL_OPENING_DIRECTION_PREVIOUS_SNAPSHOT_RELEASE,
  NFL_LOCKED_TRANSITION_PREVIOUS_SNAPSHOT_RELEASE,
  NFL_ML_TOTAL_PREVIOUS_SNAPSHOT_RELEASE,
  NFL_INJURY_PAGINATION_PREVIOUS_SNAPSHOT_RELEASE,
  NFL_SHARP_CONTRACT_PREVIOUS_SNAPSHOT_RELEASE,
  NFL_ONE_POINT_PREVIOUS_SNAPSHOT_RELEASE,
  NFL_OPENING_FOLLOW_UP_PREVIOUS_SNAPSHOT_RELEASE,
  NFL_PREDICTION_OWNED_PREVIOUS_SNAPSHOT_RELEASE,
  "nfl_forward_member_snapshot_2026_09_13_r9_bounded_continuity_read",
  "nfl_forward_member_snapshot_2026_09_13_r8_game_scoped_odds_gaps",
  "nfl_forward_member_snapshot_2026_09_03_r7_target_excluded_forecast",
] as const;
const NFL_PREVIOUS_MEMBER_RELEASE = "nfl_v1_member_release_2026_09_03_r12_target_excluded_forecast" as const;
const NFL_PREVIOUS_DECISION_RELEASE = "nfl_v1_daily_edge_decision_2026_09_03_r15_target_excluded_forecast" as const;
const NFL_PREDICTION_OWNED_PREVIOUS_FIXTURE_RELEASE =
  "nfl_weekly_member_fixture_2026_09_14_r18_prediction_owned_side" as const;
const NFL_PREVIOUS_FIXTURE_RELEASE = "nfl_weekly_member_fixture_2026_09_04_r17_split_history_window" as const;

const SNAPSHOT_TTL_MS = 30 * 60 * 1000;
const SNAPSHOT_STALE_MS = 8 * 60 * 60 * 1000;
const SNAPSHOT_CONTINUITY_MS = 8 * 24 * 60 * 60 * 1000;
const TABLE_MISSING_RE = /relation .*lab_response_snapshots.* does not exist|schema cache/i;

export type NflForwardMemberSnapshot = {
  snapshotRelease: typeof NFL_FORWARD_MEMBER_SNAPSHOT_RELEASE;
  evidenceRelease: typeof NFL_FORWARD_EVIDENCE_SCHEMA_RELEASE;
  memberRelease: typeof NFL_V1_ACTIONABLE_GRADE_MEMBER_RELEASE;
  decisionRelease: typeof NFL_V1_ACTIONABLE_GRADE_DECISION_RELEASE;
  fixtureRelease: typeof NFL_WEEK_ONE_HELD_MEMBER_FIXTURE_RELEASE;
  season: number;
  week: number;
  sourceCapturedAt: string;
  publishedAt: string;
  sourceChecksum: string;
  fixture: NflWeekOneHeldMemberFixture;
};

export type NflForwardMemberSnapshotAudit = {
  healthy: boolean;
  critical: string[];
  warnings: string[];
  metrics: {
    games: number;
    predictions: number;
    pricedMarkets: number;
    openingTrailGames: number;
    minimumPriceObservations: number;
    sourceAgeMinutes: number | null;
    publishedAgeMinutes: number | null;
    maximumSourceAgeMinutes: number;
    grades: Record<string, number>;
  };
};

export function nflFlatBoardWarning(input: {
  grades: Record<string, number>;
  predictions: number;
}): string | null {
  const actionable = (input.grades.Lean ?? 0) + (input.grades["Best Angle"] ?? 0);
  const noPlays = input.grades["No Play"] ?? 0;
  if (actionable === 0) return "the current weekly slate contains no actionable play grades";
  if (input.predictions > 0 && actionable <= 1 && noPlays / input.predictions >= 0.75) {
    return `the current weekly slate is materially flat: ${actionable}/${input.predictions} actionable and ${noPlays} No Play grades`;
  }
  return null;
}

type SnapshotRow = {
  payload: unknown;
  generated_at: string;
  expires_at: string;
  stale_until: string;
};

export function nflForwardMemberSnapshotKey(input: { season: number; week: number }): string {
  return nflForwardMemberSnapshotKeyForRelease(input, NFL_FORWARD_MEMBER_SNAPSHOT_RELEASE);
}

function nflForwardMemberSnapshotKeyForRelease(
  input: { season: number; week: number },
  snapshotRelease: string,
): string {
  const current = snapshotRelease === NFL_FORWARD_MEMBER_SNAPSHOT_RELEASE;
  const nonpushPrevious = snapshotRelease === NFL_NONPUSH_PREVIOUS_SNAPSHOT_RELEASE;
  const openingDirectionPrevious = snapshotRelease === NFL_OPENING_DIRECTION_PREVIOUS_SNAPSHOT_RELEASE;
  const lockedTransitionPrevious = snapshotRelease === NFL_LOCKED_TRANSITION_PREVIOUS_SNAPSHOT_RELEASE;
  const mlTotalPrevious = snapshotRelease === NFL_ML_TOTAL_PREVIOUS_SNAPSHOT_RELEASE;
  const injuryPaginationPrevious = snapshotRelease === NFL_INJURY_PAGINATION_PREVIOUS_SNAPSHOT_RELEASE;
  const onePointPrevious = snapshotRelease === NFL_ONE_POINT_PREVIOUS_SNAPSHOT_RELEASE;
  const openingFollowUpPrevious = snapshotRelease === NFL_OPENING_FOLLOW_UP_PREVIOUS_SNAPSHOT_RELEASE;
  const predictionOwnedPrevious = snapshotRelease === NFL_PREDICTION_OWNED_PREVIOUS_SNAPSHOT_RELEASE;
  return [
    "nfl",
    "daily-edge",
    input.season,
    input.week,
    snapshotRelease,
    current
      ? NFL_WEEK_ONE_HELD_MEMBER_FIXTURE_RELEASE
      : nonpushPrevious
        ? NFL_NONPUSH_PREVIOUS_FIXTURE_RELEASE
      : openingDirectionPrevious
        ? NFL_OPENING_DIRECTION_PREVIOUS_FIXTURE_RELEASE
      : lockedTransitionPrevious
        ? NFL_LOCKED_TRANSITION_PREVIOUS_FIXTURE_RELEASE
      : mlTotalPrevious
        ? NFL_ML_TOTAL_PREVIOUS_FIXTURE_RELEASE
      : injuryPaginationPrevious
        ? NFL_INJURY_PAGINATION_PREVIOUS_FIXTURE_RELEASE
        : onePointPrevious
          ? NFL_ONE_POINT_PREVIOUS_FIXTURE_RELEASE
          : openingFollowUpPrevious
            ? "nfl_weekly_member_fixture_2026_09_15_r19_verified_first_observation"
            : predictionOwnedPrevious
              ? NFL_PREDICTION_OWNED_PREVIOUS_FIXTURE_RELEASE
              : NFL_PREVIOUS_FIXTURE_RELEASE,
    current
      ? NFL_V1_ACTIONABLE_GRADE_MEMBER_RELEASE
      : nonpushPrevious
        ? NFL_V1_ACTIONABLE_GRADE_MEMBER_RELEASE
      : openingDirectionPrevious
        ? NFL_OPENING_DIRECTION_PREVIOUS_MEMBER_RELEASE
      : lockedTransitionPrevious
        ? NFL_LOCKED_TRANSITION_PREVIOUS_MEMBER_RELEASE
      : mlTotalPrevious
        ? NFL_ML_TOTAL_PREVIOUS_MEMBER_RELEASE
      : injuryPaginationPrevious
        ? NFL_INJURY_PAGINATION_PREVIOUS_MEMBER_RELEASE
        : onePointPrevious
          ? NFL_ONE_POINT_PREVIOUS_MEMBER_RELEASE
          : openingFollowUpPrevious || predictionOwnedPrevious
            ? NFL_OPENING_FOLLOW_UP_PREVIOUS_MEMBER_RELEASE
            : NFL_PREVIOUS_MEMBER_RELEASE,
    current
      ? NFL_V1_ACTIONABLE_GRADE_DECISION_RELEASE
      : nonpushPrevious
        ? NFL_V1_ACTIONABLE_GRADE_DECISION_RELEASE
      : openingDirectionPrevious
        ? NFL_OPENING_DIRECTION_PREVIOUS_DECISION_RELEASE
      : lockedTransitionPrevious
        ? NFL_LOCKED_TRANSITION_PREVIOUS_DECISION_RELEASE
      : mlTotalPrevious
        ? NFL_ML_TOTAL_PREVIOUS_DECISION_RELEASE
      : injuryPaginationPrevious
        ? NFL_INJURY_PAGINATION_PREVIOUS_DECISION_RELEASE
        : onePointPrevious
          ? NFL_ONE_POINT_PREVIOUS_DECISION_RELEASE
          : openingFollowUpPrevious || predictionOwnedPrevious
            ? NFL_OPENING_FOLLOW_UP_PREVIOUS_DECISION_RELEASE
            : NFL_PREVIOUS_DECISION_RELEASE,
  ].join("::");
}

export function buildNflForwardMemberSnapshot(input: {
  fixture: NflWeekOneHeldMemberFixture;
  season: number;
  week: number;
  publishedAt: string;
}): NflForwardMemberSnapshot {
  const sourceChecksum = input.fixture.provenance.sourceChecksum;
  if (input.fixture.heldMemberFixtureRelease !== NFL_WEEK_ONE_HELD_MEMBER_FIXTURE_RELEASE) {
    throw new Error("NFL compact member snapshot fixture release mismatch.");
  }
  if (input.fixture.sport !== "nfl" || input.fixture.snapshot.sport !== "nfl") {
    throw new Error("NFL compact member snapshot must be NFL-scoped.");
  }
  if (input.fixture.week.week !== input.week || input.fixture.snapshot.games.length === 0) {
    throw new Error("NFL compact member snapshot week or slate is invalid.");
  }
  if (input.fixture.snapshot.games.some((game) => Object.values(game.markets).length !== 3)) {
    throw new Error("NFL compact member snapshot contains an incomplete market contract.");
  }
  if (!/^[a-f0-9]{64}$/.test(sourceChecksum)) {
    throw new Error("NFL compact member snapshot source checksum is invalid.");
  }

  return {
    snapshotRelease: NFL_FORWARD_MEMBER_SNAPSHOT_RELEASE,
    evidenceRelease: NFL_FORWARD_EVIDENCE_SCHEMA_RELEASE,
    memberRelease: NFL_V1_ACTIONABLE_GRADE_MEMBER_RELEASE,
    decisionRelease: NFL_V1_ACTIONABLE_GRADE_DECISION_RELEASE,
    fixtureRelease: NFL_WEEK_ONE_HELD_MEMBER_FIXTURE_RELEASE,
    season: input.season,
    week: input.week,
    sourceCapturedAt: input.fixture.capturedAt,
    publishedAt: new Date(input.publishedAt).toISOString(),
    sourceChecksum,
    fixture: input.fixture,
  };
}

export async function writeNflForwardMemberSnapshot(input: {
  client: SupabaseClient;
  snapshot: NflForwardMemberSnapshot;
}): Promise<{ ok: true; snapshotKey: string } | { ok: false; snapshotKey: string; error: string }> {
  const snapshotKey = nflForwardMemberSnapshotKey(input.snapshot);
  const now = Date.parse(input.snapshot.publishedAt);
  const { error } = await input.client
    .from("lab_response_snapshots")
    .upsert({
      snapshot_key: snapshotKey,
      kind: "daily_edge",
      sport: "nfl",
      slate_date: input.snapshot.fixture.snapshot.date,
      payload: input.snapshot,
      payload_version: NFL_FORWARD_MEMBER_SNAPSHOT_RELEASE,
      source: "nfl_forward_evidence_writer",
      generated_at: input.snapshot.publishedAt,
      expires_at: new Date(now + SNAPSHOT_TTL_MS).toISOString(),
      stale_until: new Date(now + SNAPSHOT_STALE_MS).toISOString(),
      updated_at: input.snapshot.publishedAt,
    }, { onConflict: "snapshot_key" });

  if (error) {
    return { ok: false, snapshotKey, error: error.message };
  }
  return { ok: true, snapshotKey };
}

export async function readNflForwardMemberSnapshot(input: {
  client: SupabaseClient;
  season: number;
  week: number;
  now?: string;
}): Promise<NflForwardMemberSnapshot | null> {
  const now = input.now ? new Date(input.now).toISOString() : new Date().toISOString();
  const releases = [NFL_FORWARD_MEMBER_SNAPSHOT_RELEASE, ...NFL_FORWARD_PREVIOUS_MEMBER_SNAPSHOT_RELEASES];
  for (const release of releases) {
    const { data, error } = await input.client
      .from("lab_response_snapshots")
      .select("payload,generated_at,expires_at,stale_until")
      .eq("snapshot_key", nflForwardMemberSnapshotKeyForRelease(input, release))
      .maybeSingle();
    if (error) {
      if (TABLE_MISSING_RE.test(error.message)) return null;
      throw new Error(`NFL compact member snapshot read failed: ${error.message}`);
    }
    if (!data) continue;
    const snapshot = validateNflForwardMemberSnapshot((data as SnapshotRow).payload, input);
    if (!snapshot || Date.parse(now) - Date.parse(snapshot.publishedAt) > SNAPSHOT_CONTINUITY_MS) continue;
    return { ...snapshot, snapshotRelease: NFL_FORWARD_MEMBER_SNAPSHOT_RELEASE };
  }
  return null;
}

export function auditNflForwardMemberSnapshot(input: {
  snapshot: NflForwardMemberSnapshot;
  now?: Date;
}): NflForwardMemberSnapshotAudit {
  const now = input.now ?? new Date();
  const nowMs = now.getTime();
  const games = input.snapshot.fixture.snapshot.games;
  const markets = games.flatMap((game) => [
    game.markets.moneyline,
    game.markets.total,
    game.markets.first_inning,
  ]);
  const upcomingStarts = games
    .map((game) => Date.parse(game.gameStartAt ?? game.scheduledLockAt))
    .filter((startsAt) => Number.isFinite(startsAt) && startsAt > nowMs);
  const soonestStart = upcomingStarts.length ? Math.min(...upcomingStarts) : Number.POSITIVE_INFINITY;
  const maximumSourceAgeMinutes = Number.isFinite(soonestStart) && soonestStart - nowMs <= 48 * 60 * 60 * 1000
    ? 90
    : 390;
  const ageMinutes = (value: string): number | null => {
    const parsed = Date.parse(value);
    return Number.isFinite(parsed) ? Math.max(0, (nowMs - parsed) / 60_000) : null;
  };
  const sourceAgeMinutes = ageMinutes(input.snapshot.sourceCapturedAt);
  const publishedAgeMinutes = ageMinutes(input.snapshot.publishedAt);
  const pricedMarkets = markets.filter((market) => Number.isFinite(market.currentPriceAmerican)).length;
  const openingTrailGames = games.filter((game) => [
    game.markets.moneyline,
    game.markets.total,
    game.markets.first_inning,
  ].every((market) => Array.isArray(market.oddsTrail)
    && market.oddsTrail.some((point) => point.label === "open" || point.label === "first")
    && market.oddsTrail.some((point) => point.label === "current" || point.label === "locked"))).length;
  const minimumPriceObservations = markets.length
    ? Math.min(...markets.map((market) => market.oddsTrail?.length ?? 0))
    : 0;
  const grades = markets.reduce<Record<string, number>>((counts, market) => {
    const grade = market.verdict?.label ?? "Missing";
    counts[grade] = (counts[grade] ?? 0) + 1;
    return counts;
  }, {});
  const critical = [
    games.length === 0 ? "weekly slate is empty" : null,
    markets.length !== games.length * 3 ? `market contract is ${markets.length}/${games.length * 3}` : null,
    pricedMarkets !== markets.length ? `current-price coverage is ${pricedMarkets}/${markets.length}` : null,
    openingTrailGames !== games.length ? `Opening/current trail coverage is ${openingTrailGames}/${games.length}` : null,
    minimumPriceObservations < 2 ? `minimum same-book price observations is ${minimumPriceObservations}/2` : null,
    sourceAgeMinutes === null || sourceAgeMinutes > maximumSourceAgeMinutes
      ? `provider snapshot age is ${sourceAgeMinutes === null ? "invalid" : `${sourceAgeMinutes.toFixed(1)}m`}`
      : null,
    publishedAgeMinutes === null || publishedAgeMinutes > 60
      ? `compact member snapshot age is ${publishedAgeMinutes === null ? "invalid" : `${publishedAgeMinutes.toFixed(1)}m`}`
      : null,
    (grades.Missing ?? 0) > 0 ? `${grades.Missing} markets are missing a play grade` : null,
  ].filter((value): value is string => value !== null);
  const flatBoardWarning = nflFlatBoardWarning({ grades, predictions: markets.length });
  const warnings = flatBoardWarning ? [flatBoardWarning] : [];
  return {
    healthy: critical.length === 0,
    critical,
    warnings,
    metrics: {
      games: games.length,
      predictions: markets.length,
      pricedMarkets,
      openingTrailGames,
      minimumPriceObservations,
      sourceAgeMinutes,
      publishedAgeMinutes,
      maximumSourceAgeMinutes,
      grades,
    },
  };
}

function validateNflForwardMemberSnapshot(
  value: unknown,
  expected: { season: number; week: number },
): NflForwardMemberSnapshot | null {
  if (!value || typeof value !== "object") return null;
  const snapshot = value as Partial<NflForwardMemberSnapshot>;
  const memberRelease = snapshot.memberRelease as string | undefined;
  const decisionRelease = snapshot.decisionRelease as string | undefined;
  const fixtureRelease = snapshot.fixtureRelease as string | undefined;
  const heldMemberFixtureRelease = snapshot.fixture?.heldMemberFixtureRelease as string | undefined;
  const currentContract =
    memberRelease === NFL_V1_ACTIONABLE_GRADE_MEMBER_RELEASE &&
    decisionRelease === NFL_V1_ACTIONABLE_GRADE_DECISION_RELEASE &&
    fixtureRelease === NFL_WEEK_ONE_HELD_MEMBER_FIXTURE_RELEASE &&
    heldMemberFixtureRelease === NFL_WEEK_ONE_HELD_MEMBER_FIXTURE_RELEASE;
  const nonpushPreviousContract =
    memberRelease === NFL_V1_ACTIONABLE_GRADE_MEMBER_RELEASE &&
    decisionRelease === NFL_V1_ACTIONABLE_GRADE_DECISION_RELEASE &&
    fixtureRelease === NFL_NONPUSH_PREVIOUS_FIXTURE_RELEASE &&
    heldMemberFixtureRelease === NFL_NONPUSH_PREVIOUS_FIXTURE_RELEASE;
  const openingDirectionPreviousContract =
    memberRelease === NFL_OPENING_DIRECTION_PREVIOUS_MEMBER_RELEASE &&
    decisionRelease === NFL_OPENING_DIRECTION_PREVIOUS_DECISION_RELEASE &&
    fixtureRelease === NFL_OPENING_DIRECTION_PREVIOUS_FIXTURE_RELEASE &&
    heldMemberFixtureRelease === NFL_OPENING_DIRECTION_PREVIOUS_FIXTURE_RELEASE;
  const lockedTransitionPreviousContract =
    memberRelease === NFL_LOCKED_TRANSITION_PREVIOUS_MEMBER_RELEASE &&
    decisionRelease === NFL_LOCKED_TRANSITION_PREVIOUS_DECISION_RELEASE &&
    fixtureRelease === NFL_LOCKED_TRANSITION_PREVIOUS_FIXTURE_RELEASE &&
    heldMemberFixtureRelease === NFL_LOCKED_TRANSITION_PREVIOUS_FIXTURE_RELEASE;
  const mlTotalPreviousContract =
    memberRelease === NFL_ML_TOTAL_PREVIOUS_MEMBER_RELEASE &&
    decisionRelease === NFL_ML_TOTAL_PREVIOUS_DECISION_RELEASE &&
    fixtureRelease === NFL_ML_TOTAL_PREVIOUS_FIXTURE_RELEASE &&
    heldMemberFixtureRelease === NFL_ML_TOTAL_PREVIOUS_FIXTURE_RELEASE;
  const injuryPaginationPreviousContract =
    memberRelease === NFL_INJURY_PAGINATION_PREVIOUS_MEMBER_RELEASE &&
    decisionRelease === NFL_INJURY_PAGINATION_PREVIOUS_DECISION_RELEASE &&
    fixtureRelease === NFL_INJURY_PAGINATION_PREVIOUS_FIXTURE_RELEASE &&
    heldMemberFixtureRelease === NFL_INJURY_PAGINATION_PREVIOUS_FIXTURE_RELEASE;
  const onePointPreviousContract =
    memberRelease === NFL_ONE_POINT_PREVIOUS_MEMBER_RELEASE &&
    decisionRelease === NFL_ONE_POINT_PREVIOUS_DECISION_RELEASE &&
    fixtureRelease === NFL_ONE_POINT_PREVIOUS_FIXTURE_RELEASE &&
    heldMemberFixtureRelease === NFL_ONE_POINT_PREVIOUS_FIXTURE_RELEASE;
  const openingFollowUpPreviousContract =
    memberRelease === NFL_OPENING_FOLLOW_UP_PREVIOUS_MEMBER_RELEASE &&
    decisionRelease === NFL_OPENING_FOLLOW_UP_PREVIOUS_DECISION_RELEASE &&
    fixtureRelease === "nfl_weekly_member_fixture_2026_09_15_r19_verified_first_observation" &&
    heldMemberFixtureRelease === "nfl_weekly_member_fixture_2026_09_15_r19_verified_first_observation";
  const predictionOwnedPreviousContract =
    memberRelease === NFL_OPENING_FOLLOW_UP_PREVIOUS_MEMBER_RELEASE &&
    decisionRelease === NFL_OPENING_FOLLOW_UP_PREVIOUS_DECISION_RELEASE &&
    fixtureRelease === NFL_PREDICTION_OWNED_PREVIOUS_FIXTURE_RELEASE &&
    heldMemberFixtureRelease === NFL_PREDICTION_OWNED_PREVIOUS_FIXTURE_RELEASE;
  const previousContract =
    memberRelease === NFL_PREVIOUS_MEMBER_RELEASE &&
    decisionRelease === NFL_PREVIOUS_DECISION_RELEASE &&
    fixtureRelease === NFL_PREVIOUS_FIXTURE_RELEASE &&
    heldMemberFixtureRelease === NFL_PREVIOUS_FIXTURE_RELEASE;
  if (
    ![NFL_FORWARD_MEMBER_SNAPSHOT_RELEASE, ...NFL_FORWARD_PREVIOUS_MEMBER_SNAPSHOT_RELEASES].includes(snapshot.snapshotRelease as typeof NFL_FORWARD_MEMBER_SNAPSHOT_RELEASE) ||
    snapshot.evidenceRelease !== NFL_FORWARD_EVIDENCE_SCHEMA_RELEASE ||
    (!currentContract && !nonpushPreviousContract && !openingDirectionPreviousContract && !lockedTransitionPreviousContract && !mlTotalPreviousContract && !injuryPaginationPreviousContract && !onePointPreviousContract && !openingFollowUpPreviousContract && !predictionOwnedPreviousContract && !previousContract) ||
    snapshot.season !== expected.season ||
    snapshot.week !== expected.week ||
    snapshot.fixture?.week?.week !== expected.week ||
    snapshot.fixture?.sport !== "nfl" ||
    snapshot.fixture?.snapshot?.sport !== "nfl" ||
    snapshot.fixture?.snapshot?.games?.length === 0 ||
    snapshot.fixture?.capturedAt !== snapshot.sourceCapturedAt ||
    snapshot.fixture?.provenance?.sourceChecksum !== snapshot.sourceChecksum ||
    !Number.isFinite(Date.parse(snapshot.sourceCapturedAt ?? "")) ||
    !Number.isFinite(Date.parse(snapshot.publishedAt ?? "")) ||
    !/^[a-f0-9]{64}$/.test(snapshot.sourceChecksum ?? "")
  ) {
    return null;
  }
  return snapshot as NflForwardMemberSnapshot;
}
