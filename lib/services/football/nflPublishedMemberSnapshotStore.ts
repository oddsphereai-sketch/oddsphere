import {
  NFL_DAILY_EDGE_PUBLICATION_RELEASE,
} from "@/lib/config/nflDailyEdge";
import {
  NFL_MEMBER_SNAPSHOT_RELEASE,
  type NflMemberSnapshot,
} from "@/lib/services/football/nflMemberSnapshotStore";

export const NFL_PUBLISHED_MEMBER_SNAPSHOT_KEY = "nfl::current-week" as const;
const SNAPSHOT_TTL_MS = 90 * 60 * 1000;
const SNAPSHOT_STALE_MS = 48 * 60 * 60 * 1000;
const PRESEASON_TRACKING_REASON =
  "NFL preseason is excluded from official and lifetime tracking." as const;

export type NflPublishedMemberSnapshot = {
  publicationRelease: typeof NFL_DAILY_EDGE_PUBLICATION_RELEASE;
  sourceSnapshotSha256: string;
  publishedAt: string;
  lockedGameIds: string[];
  fixture: NflMemberSnapshot;
};

export type NflPublicationAudit = {
  healthy: boolean;
  critical: string[];
  warnings: string[];
  metrics: {
    games: number;
    predictions: number;
    availabilityGames: number;
    pricedMarkets: number;
    openingTrailGames: number;
    minimumPriceObservations: number;
    sourceAgeMinutes: number | null;
    storedAgeMinutes: number | null;
    grades: Record<string, number>;
  };
};

function ageMinutes(value: string | null | undefined, nowMs: number): number | null {
  const parsed = typeof value === "string" ? Date.parse(value) : Number.NaN;
  return Number.isFinite(parsed) ? Math.max(0, (nowMs - parsed) / 60_000) : null;
}

export function auditNflMemberSnapshot(input: {
  fixture: NflMemberSnapshot;
  now?: Date;
  maxSourceAgeMinutes?: number;
  maxStoredAgeMinutes?: number;
}): NflPublicationAudit {
  const nowMs = (input.now ?? new Date()).getTime();
  const maxSourceAgeMinutes = input.maxSourceAgeMinutes ?? 90;
  const maxStoredAgeMinutes = input.maxStoredAgeMinutes ?? 30;
  const fixture = input.fixture;
  const critical: string[] = [];
  const warnings: string[] = [];
  const games = Array.isArray(fixture?.snapshot?.games) ? fixture.snapshot.games : [];
  const markets = games.flatMap((game) => [
    game.markets?.moneyline,
    game.markets?.total,
    game.markets?.first_inning,
  ]);
  const sourceAgeMinutes = ageMinutes(fixture?.snapshot?.as_of, nowMs);
  const storedAgeMinutes = ageMinutes(fixture?.storedAt, nowMs);
  const availabilityGames = fixture?.availability
    ? games.filter((game) => Boolean(fixture.availability[game.id])).length
    : 0;
  const pricedMarkets = markets.filter((market) =>
    market && Number.isFinite(market.currentPriceAmerican)
  ).length;
  const openingTrailGames = games.filter((game) =>
    [game.markets?.moneyline, game.markets?.total, game.markets?.first_inning].every((market) =>
      Array.isArray(market?.oddsTrail) &&
      market.oddsTrail.some((point) => point.label === "open" || point.label === "first") &&
      market.oddsTrail.some((point) => point.label === "current")
    )
  ).length;
  const priceObservationCounts = markets.map((market) => market?.oddsTrail?.length ?? 0);
  const minimumPriceObservations = priceObservationCounts.length > 0
    ? Math.min(...priceObservationCounts)
    : 0;
  const grades = markets.reduce<Record<string, number>>((counts, market) => {
    const label = market?.verdict?.label ?? "Missing";
    counts[label] = (counts[label] ?? 0) + 1;
    return counts;
  }, {});

  if (fixture?.memberSnapshotRelease !== NFL_MEMBER_SNAPSHOT_RELEASE) {
    critical.push("member snapshot release mismatch");
  }
  if (fixture?.sport !== "nfl" || fixture?.snapshot?.sport !== "nfl") {
    critical.push("snapshot is not NFL-scoped");
  }
  if (games.length === 0) critical.push("weekly slate is empty");
  if (new Set(games.map((game) => game.id)).size !== games.length) {
    critical.push("weekly slate contains duplicate game ids");
  }
  if (markets.length !== games.length * 3) {
    critical.push(`market contract is ${markets.length}/${games.length * 3}`);
  }
  if (pricedMarkets !== games.length * 3) {
    critical.push(`current-price coverage is ${pricedMarkets}/${games.length * 3}`);
  }
  if (availabilityGames !== games.length) {
    critical.push(`availability coverage is ${availabilityGames}/${games.length}`);
  }
  if (openingTrailGames !== games.length) {
    critical.push(`Opening/current trail coverage is ${openingTrailGames}/${games.length}`);
  }
  if (minimumPriceObservations < 2) {
    critical.push(`minimum same-book price observations is ${minimumPriceObservations}/2`);
  }
  if (sourceAgeMinutes === null || sourceAgeMinutes > maxSourceAgeMinutes) {
    critical.push(`provider snapshot age is ${sourceAgeMinutes === null ? "invalid" : `${sourceAgeMinutes.toFixed(1)}m`}`);
  }
  if (storedAgeMinutes === null || storedAgeMinutes > maxStoredAgeMinutes) {
    critical.push(`member snapshot age is ${storedAgeMinutes === null ? "invalid" : `${storedAgeMinutes.toFixed(1)}m`}`);
  }
  if (!fixture?.provenance?.sourceChecksum || fixture.provenance.sourceChecksum.length !== 64) {
    critical.push("model source checksum is missing or invalid");
  }
  if (fixture?.tracking?.trackingEligible !== false) {
    critical.push("member snapshot is unexpectedly tracking-eligible");
  }
  if (fixture?.tracking?.seasonPhase === "preseason") {
    if (fixture.tracking.reason !== PRESEASON_TRACKING_REASON) {
      critical.push("preseason lifetime-tracking exclusion is missing");
    }
    if (fixture.week.week === 2 && games.length !== 16) {
      critical.push(`Preseason Week 2 coverage is ${games.length}/16 games`);
    }
    if (fixture.provenance.splitCoverageGames === 0) {
      warnings.push("public split coverage is unavailable for this preseason slate");
    }
  }
  if ((grades.Missing ?? 0) > 0) critical.push(`${grades.Missing} markets are missing a play grade`);
  if ((grades.Lean ?? 0) + (grades["Best Angle"] ?? 0) === 0) {
    warnings.push("the current weekly slate contains no actionable play grades");
  }

  return {
    healthy: critical.length === 0,
    critical,
    warnings,
    metrics: {
      games: games.length,
      predictions: markets.length,
      availabilityGames,
      pricedMarkets,
      openingTrailGames,
      minimumPriceObservations,
      sourceAgeMinutes,
      storedAgeMinutes,
      grades,
    },
  };
}

/**
 * Preserve every previously published game once its scheduled kickoff has
 * arrived. A later weekly refresh may update future games, but cannot rewrite
 * a displayed prediction after kickoff.
 */
export function buildNflPublishedMemberSnapshot(input: {
  fixture: NflMemberSnapshot;
  sourceSnapshotSha256: string;
  existing?: NflPublishedMemberSnapshot | null;
  now?: Date;
}): NflPublishedMemberSnapshot {
  const now = input.now ?? new Date();
  const existingGames = new Map(
    (input.existing?.fixture.snapshot.games ?? []).map((game) => [game.id, game]),
  );
  const previouslyLocked = new Set(input.existing?.lockedGameIds ?? []);
  const lockedGameIds = new Set<string>(previouslyLocked);
  const games = input.fixture.snapshot.games.map((game) => {
    const scheduledAt = Date.parse(game.gameStartAt ?? game.scheduledLockAt);
    const mustPreserve = previouslyLocked.has(game.id) ||
      (Number.isFinite(scheduledAt) && scheduledAt <= now.getTime());
    const existing = existingGames.get(game.id);
    if (mustPreserve && existing) {
      lockedGameIds.add(game.id);
      return existing;
    }
    return game;
  });
  const availability = { ...input.fixture.availability };
  for (const gameId of lockedGameIds) {
    const existingAvailability = input.existing?.fixture.availability[gameId];
    if (existingAvailability) availability[gameId] = existingAvailability;
  }
  return {
    publicationRelease: NFL_DAILY_EDGE_PUBLICATION_RELEASE,
    sourceSnapshotSha256: input.sourceSnapshotSha256,
    publishedAt: now.toISOString(),
    lockedGameIds: [...lockedGameIds].sort(),
    fixture: {
      ...input.fixture,
      snapshot: { ...input.fixture.snapshot, games },
      availability,
    },
  };
}

function validEnvelope(payload: unknown): payload is NflPublishedMemberSnapshot {
  if (!payload || typeof payload !== "object") return false;
  const candidate = payload as Partial<NflPublishedMemberSnapshot>;
  return candidate.publicationRelease === NFL_DAILY_EDGE_PUBLICATION_RELEASE &&
    typeof candidate.sourceSnapshotSha256 === "string" &&
    candidate.sourceSnapshotSha256.length === 64 &&
    typeof candidate.publishedAt === "string" &&
    Array.isArray(candidate.lockedGameIds) &&
    Boolean(candidate.fixture);
}

export async function readCurrentNflPublishedMemberSnapshot(): Promise<NflPublishedMemberSnapshot | null> {
  const { readLabResponseSnapshot } = await import("@/lib/services/labResponseSnapshots");
  const fresh = await readLabResponseSnapshot<Record<string, unknown>>(
    NFL_PUBLISHED_MEMBER_SNAPSHOT_KEY,
    "fresh",
  );
  const stored = fresh ?? await readLabResponseSnapshot<Record<string, unknown>>(
    NFL_PUBLISHED_MEMBER_SNAPSHOT_KEY,
    "stale",
  );
  return validEnvelope(stored?.payload) ? stored.payload : null;
}

export async function writeCurrentNflPublishedMemberSnapshot(
  published: NflPublishedMemberSnapshot,
) {
  const audit = auditNflMemberSnapshot({ fixture: published.fixture });
  if (!audit.healthy) {
    throw new Error(`Refusing unhealthy NFL publication: ${audit.critical.join("; ")}`);
  }
  const { upsertLabResponseSnapshot } = await import("@/lib/services/labResponseSnapshots");
  return upsertLabResponseSnapshot({
    snapshotKey: NFL_PUBLISHED_MEMBER_SNAPSHOT_KEY,
    kind: "daily_edge",
    sport: "nfl",
    slateDate: published.fixture.snapshot.date,
    payload: published as unknown as Record<string, unknown>,
    ttlMs: SNAPSHOT_TTL_MS,
    staleMs: SNAPSHOT_STALE_MS,
    source: "nfl_manual_preseason_publication",
    payloadVersion: `${published.publicationRelease}::${published.fixture.memberSnapshotRelease}::${published.fixture.tracking.seasonPhase}::week${published.fixture.week.week}`,
  });
}
