import CandidateDailyEdgePage from "./CandidateDailyEdgePage";
import LegacyDailyEdgePage from "./LegacyDailyEdgePage";
import { isDailyEdgeExperienceCandidateEnabled } from "@/lib/config/dailyEdgeExperience";
import { connection } from "next/server";

export default async function DailyEdgePage({
  searchParams,
}: {
  searchParams: Promise<{ sport?: string | string[] }>;
}) {
  // This is a live board, not build-time content. It must read both the
  // candidate flag and the latest published snapshot for each request so a
  // client router.refresh() cannot be answered by the deployment-time page.
  await connection();

  return isDailyEdgeExperienceCandidateEnabled()
    ? <CandidateDailyEdgePage searchParams={searchParams} />
    : <LegacyDailyEdgePage />;
}
