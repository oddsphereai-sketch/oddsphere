import CandidateDailyEdgePage from "./CandidateDailyEdgePage";
import LegacyDailyEdgePage from "./LegacyDailyEdgePage";
import { isDailyEdgeExperienceCandidateEnabled } from "@/lib/config/dailyEdgeExperience";

export default function DailyEdgePage({
  searchParams,
}: {
  searchParams: Promise<{ sport?: string | string[] }>;
}) {
  return isDailyEdgeExperienceCandidateEnabled()
    ? <CandidateDailyEdgePage searchParams={searchParams} />
    : <LegacyDailyEdgePage />;
}
