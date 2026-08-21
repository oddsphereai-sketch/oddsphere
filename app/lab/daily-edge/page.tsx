import CandidateDailyEdgePage from "./CandidateDailyEdgePage";
import LegacyDailyEdgePage from "./LegacyDailyEdgePage";
import { isDailyEdgeExperienceCandidateEnabled } from "@/lib/config/dailyEdgeExperience";
import { isNflDailyEdgeEnabled } from "@/lib/config/nflDailyEdge";
import { connection } from "next/server";

export default async function DailyEdgePage({
  searchParams,
}: {
  searchParams: Promise<{ sport?: string | string[]; league?: string | string[] }>;
}) {
  // This is a live board, not build-time content. It must read both the
  // candidate flag and the latest published snapshot for each request so a
  // client router.refresh() cannot be answered by the deployment-time page.
  await connection();
  const query = await searchParams;
  const requestedSport = Array.isArray(query.sport) ? query.sport[0] : query.sport;
  const nflMemberRead = requestedSport === "nfl" && isNflDailyEdgeEnabled();

  return isDailyEdgeExperienceCandidateEnabled() || nflMemberRead
    ? <CandidateDailyEdgePage searchParams={Promise.resolve(query)} />
    : <LegacyDailyEdgePage />;
}
