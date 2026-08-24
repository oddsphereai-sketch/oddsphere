import type { DailyEdgeResponse } from "@/app/lab/lib/labTypes";
import { weeklyReaderGameIsVisible } from "@/lib/services/dailyEdge/weeklyReaderLifecycle";

const EPL_EMERGENCY_SNAPSHOT_MAX_AGE_MS = 8 * 24 * 60 * 60 * 1000;

export function eplEmergencySnapshotIsUsable(
  snapshot: DailyEdgeResponse,
  generatedAt: string,
  now: Date = new Date(),
): boolean {
  const generatedAtMs = Date.parse(generatedAt);
  const ageMs = now.getTime() - generatedAtMs;
  if (!Number.isFinite(generatedAtMs) || ageMs < 0 || ageMs > EPL_EMERGENCY_SNAPSHOT_MAX_AGE_MS) return false;
  return snapshot.games.some((game) => weeklyReaderGameIsVisible(game, "soccer", now));
}
