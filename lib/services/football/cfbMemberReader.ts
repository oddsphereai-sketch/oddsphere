import "server-only";

import { unstable_cache } from "next/cache";
import { CFB_MEMBER_FIXTURE_RELEASE } from "./cfbMemberFixture";
import {
  CFB_FORWARD_MEMBER_SNAPSHOT_RELEASE,
  CFB_MEMBER_SNAPSHOT_READER_RELEASE,
} from "./cfbForwardMemberSnapshotStore";

async function readUncachedCfbMemberFixture(season: number) {
  const [{ supabase }, { readCfbForwardMemberSnapshot }] = await Promise.all([
    import("@/lib/db/supabase"),
    import("./cfbForwardMemberSnapshotStore"),
  ]);
  const published = await readCfbForwardMemberSnapshot({ client: supabase, season });
  return published?.fixture ?? null;
}

export const readCachedCfbMemberFixture = unstable_cache(
  readUncachedCfbMemberFixture,
  [
    "cfb-current-member-fixture",
    CFB_MEMBER_FIXTURE_RELEASE,
    CFB_FORWARD_MEMBER_SNAPSHOT_RELEASE,
    CFB_MEMBER_SNAPSHOT_READER_RELEASE,
  ],
  { revalidate: 60, tags: [CFB_MEMBER_FIXTURE_RELEASE] },
);

export async function readResilientCfbMemberFixture(season: number) {
  const cached = await readCachedCfbMemberFixture(season).catch(() => null);
  // A cached miss must not extend an outage after the sole writer recovers.
  // Retry the compact snapshot directly; never rebuild the evidence season.
  return cached ?? readUncachedCfbMemberFixture(season);
}
