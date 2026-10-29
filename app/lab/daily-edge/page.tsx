import CandidateDailyEdgePage from "./CandidateDailyEdgePage";
import LegacyDailyEdgePage from "./LegacyDailyEdgePage";
import { isDailyEdgeExperienceCandidateEnabled } from "@/lib/config/dailyEdgeExperience";
import { isNflDailyEdgeEnabled } from "@/lib/config/nflDailyEdge";
import { resolveDailyEdgeSport } from "@/app/lab/lib/dailyEdgeSports";
import { connection } from "next/server";
import { CBB_ACTIVATION } from "@/lib/cbb/releases";

export default async function DailyEdgePage({
  searchParams,
}: {
  searchParams: Promise<{
    sport?: string | string[];
    league?: string | string[];
    game?: string | string[];
    market?: string | string[];
  }>;
}) {
  // This is a live board, not build-time content. It must read both the
  // candidate flag and the latest published snapshot for each request so a
  // client router.refresh() cannot be answered by the deployment-time page.
  await connection();
  const query = await searchParams;
  const requestedSport = Array.isArray(query.sport) ? query.sport[0] : query.sport;
  const initialSport = resolveDailyEdgeSport(requestedSport);
  const nflMemberRead = initialSport === "nfl" && isNflDailyEdgeEnabled();
  const cbbMemberRead = initialSport === "cbb" && CBB_ACTIVATION.memberPublication &&
    process.env.CBB_DAILY_EDGE_ENABLED === "true";

  return isDailyEdgeExperienceCandidateEnabled() || nflMemberRead || cbbMemberRead
    ? <CandidateDailyEdgePage searchParams={Promise.resolve(query)} />
    : <LegacyDailyEdgePage />;
}
