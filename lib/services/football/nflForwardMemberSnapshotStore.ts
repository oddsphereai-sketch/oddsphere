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
  "nfl_forward_member_snapshot_2026_09_03_r7_target_excluded_forecast" as const;

const SNAPSHOT_TTL_MS = 30 * 60 * 1000;
const SNAPSHOT_STALE_MS = 8 * 60 * 60 * 1000;
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

type SnapshotRow = {
  payload: unknown;
  generated_at: string;
  expires_at: string;
  stale_until: string;
};

export function nflForwardMemberSnapshotKey(input: { season: number; week: number }): string {
  return [
    "nfl",
    "daily-edge",
    input.season,
    input.week,
    NFL_FORWARD_MEMBER_SNAPSHOT_RELEASE,
    NFL_WEEK_ONE_HELD_MEMBER_FIXTURE_RELEASE,
    NFL_V1_ACTIONABLE_GRADE_MEMBER_RELEASE,
    NFL_V1_ACTIONABLE_GRADE_DECISION_RELEASE,
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
  const snapshotKey = nflForwardMemberSnapshotKey(input);
  const now = input.now ? new Date(input.now).toISOString() : new Date().toISOString();
  const { data, error } = await input.client
    .from("lab_response_snapshots")
    .select("payload,generated_at,expires_at,stale_until")
    .eq("snapshot_key", snapshotKey)
    .gt("stale_until", now)
    .maybeSingle();

  if (error) {
    if (TABLE_MISSING_RE.test(error.message)) return null;
    throw new Error(`NFL compact member snapshot read failed: ${error.message}`);
  }
  if (!data) return null;
  return validateNflForwardMemberSnapshot((data as SnapshotRow).payload, input);
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
  const soonestStart = Math.min(...games.map((game) => Date.parse(game.gameStartAt ?? game.scheduledLockAt)));
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
    && market.oddsTrail.some((point) => point.label === "current"))).length;
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
  const warnings = (grades.Lean ?? 0) + (grades["Best Angle"] ?? 0) === 0
    ? ["the current weekly slate contains no actionable play grades"]
    : [];
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
  if (
    snapshot.snapshotRelease !== NFL_FORWARD_MEMBER_SNAPSHOT_RELEASE ||
    snapshot.evidenceRelease !== NFL_FORWARD_EVIDENCE_SCHEMA_RELEASE ||
    snapshot.memberRelease !== NFL_V1_ACTIONABLE_GRADE_MEMBER_RELEASE ||
    snapshot.decisionRelease !== NFL_V1_ACTIONABLE_GRADE_DECISION_RELEASE ||
    snapshot.fixtureRelease !== NFL_WEEK_ONE_HELD_MEMBER_FIXTURE_RELEASE ||
    snapshot.season !== expected.season ||
    snapshot.week !== expected.week ||
    snapshot.fixture?.heldMemberFixtureRelease !== NFL_WEEK_ONE_HELD_MEMBER_FIXTURE_RELEASE ||
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
