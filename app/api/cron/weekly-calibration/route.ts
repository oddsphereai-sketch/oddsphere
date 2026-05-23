/**
 * /api/cron/weekly-calibration — runs Sundays 3am ET / 8am UTC.
 *
 * Recompute calibration_buckets across all 4 time windows × sports ×
 * markets × confidence buckets. Drives the "honest tracking" calibration
 * display in Phase 5 UI. is_displayable gates buckets with sample < 30
 * from public display until enough data accumulates.
 */

import { cronHandler } from "@/lib/cron/runCron";
import { resultsService } from "@/lib/services/resultsService";

export const maxDuration = 120;

export async function GET(request: Request) {
  return cronHandler(
    request,
    "weekly_calibration",
    async () => {
      return await resultsService.refreshCalibrationBuckets();
    },
    { sport: null }
  );
}

export const POST = GET;
