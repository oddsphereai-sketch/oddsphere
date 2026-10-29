import "server-only";

import { unstable_cache } from "next/cache";
import { NFL_FORWARD_MEMBER_SNAPSHOT_RELEASE } from "./nflForwardMemberSnapshotStore";

export const NFL_MEMBER_READER_CACHE_RELEASE =
  "nfl-member-reader-cache-v2-enriched-fixture" as const;

async function readUncachedNflMemberFixture(season: number, week: number) {
  const [{ supabase }, { readNflForwardMemberSnapshot }] = await Promise.all([
    import("@/lib/db/supabase"),
    import("./nflForwardMemberSnapshotStore"),
  ]);
  const published = await readNflForwardMemberSnapshot({ client: supabase, season, week });
  const fixture = published?.fixture ?? null;
  if (!fixture || nflFixtureAlreadyHasModelEvidence(fixture)) return fixture;
  const { enrichCachedNflFootballEvidence } = await import("./footballMemberEvidence");
  return enrichCachedNflFootballEvidence(fixture);
}

export const readCachedNflMemberFixture = unstable_cache(
  readUncachedNflMemberFixture,
  [
    NFL_MEMBER_READER_CACHE_RELEASE,
    NFL_FORWARD_MEMBER_SNAPSHOT_RELEASE,
  ],
  { revalidate: 15, tags: [NFL_MEMBER_READER_CACHE_RELEASE] },
);

function nflFixtureAlreadyHasModelEvidence(fixture: {
  snapshot: {
    games: Array<{
      markets: Record<string, { keyStats: Array<{ label: string }> }>;
    }>;
  };
}): boolean {
  return fixture.snapshot.games.every((game) =>
    Object.values(game.markets).every((market) =>
      market.keyStats.some((stat) => stat.label.startsWith("Decision-model input ·"))),
  );
}
