import type { SupabaseClient } from "@supabase/supabase-js";
import { addDaysToSlate, currentSlateDate } from "@/lib/dates/slateDate";
import type { Sport } from "@/lib/types/domain/Sport";

export const MARKET_CAPTURE_ACTIVITY_RELEASE =
  "daily_edge_market_capture_2026_11_02_r1_empty_slates" as const;

/** Only idle MLB/WNBA observation capture is gated. Schedule ingestion and
 * settlement remain independent, so a newly ingested game resumes capture on
 * the next tick, including a late postseason game outside a calendar window.
 * A schedule-read failure never establishes that a slate is empty.
 */
export async function readMarketCaptureActivity(input: {
  client: Pick<SupabaseClient, "from">;
  sport: Sport;
  now?: Date;
}) {
  const release = MARKET_CAPTURE_ACTIVITY_RELEASE;
  if (input.sport !== "mlb" && input.sport !== "wnba") {
    return { release, skip: false, reason: "active_sport_capture" as const };
  }
  const slate = currentSlateDate(input.sport, input.now);
  const through = addDaysToSlate(slate, 6);
  try {
    const { data, error } = await input.client.from("games").select("id")
      .eq("sport", input.sport).gte("slate_date", slate).lte("slate_date", through).limit(1)
      .abortSignal(AbortSignal.timeout(3_000));
    if (error || !Array.isArray(data)) {
      return { release, skip: false, reason: "schedule_read_unavailable" as const, slate, through };
    }
    return {
      release, skip: data.length === 0,
      reason: data.length === 0 ? "no_canonical_games_in_capture_window" as const : "scheduled_games" as const,
      slate, through,
    };
  } catch {
    return { release, skip: false, reason: "schedule_read_unavailable" as const, slate, through };
  }
}
