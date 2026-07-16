import { cronHandler } from "@/lib/cron/runCron";
import { settleInternalMlbProps } from "@/lib/mlb/props/internalTracking";

export const runtime = "nodejs";
export const maxDuration = 300;

export async function GET(request: Request) {
  return cronHandler(request, "mlb_player_props_settlement", async () => {
    if (process.env.MLB_PLAYER_PROPS_SETTLEMENT_CRON_ENABLED !== "true") {
      return {
        partial: true,
        error_message: "MLB player props settlement is disabled.",
        details: { skipped: true, reason: "settlement_cron_disabled" },
      };
    }
    const url = new URL(request.url);
    const requestedDate = url.searchParams.get("date");
    const dates = requestedDate && /^\d{4}-\d{2}-\d{2}$/.test(requestedDate) ? [requestedDate] : undefined;
    const result = await settleInternalMlbProps({ dates });
    return {
      records_updated: result.propsSettled + result.voided,
      partial: result.unresolved > 0,
      error_message: result.unresolved > 0 ? `${result.unresolved} final-game props remain unresolved` : null,
      details: result,
    };
  }, { sport: "mlb", lockMinutes: 8 });
}
