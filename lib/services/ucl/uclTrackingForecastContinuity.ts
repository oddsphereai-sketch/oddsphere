import type { MarketEdgeDto } from "@/app/lab/lib/labTypes";
import type { PredictionRecordRow, TrackedMarketV17 } from "@/lib/types/domain/Tracking";

export const UCL_TRACKING_FORECAST_CONTINUITY_RELEASE =
  "ucl_tracking_forecast_continuity_2026_10_15_r1_frozen_member_pick" as const;

type UclTrackedMarket = Extract<TrackedMarketV17, "match_result" | "double_chance" | "total" | "btts">;

type UclTrackingRecordProjection = PredictionRecordRow & {
  member_market_at_capture?: unknown;
};

const VALID_SIDES: Readonly<Record<UclTrackedMarket, ReadonlySet<string>>> = {
  match_result: new Set(["home", "draw", "away"]),
  double_chance: new Set(["home_or_draw", "away_or_draw", "home_or_away"]),
  total: new Set(["over", "under"]),
  btts: new Set(["yes", "no"]),
};

function trackedMarket(value: string): UclTrackedMarket | null {
  return value === "match_result" || value === "double_chance" || value === "total" || value === "btts"
    ? value
    : null;
}

function canonical(value: unknown, market: UclTrackedMarket): string | null {
  if (typeof value !== "string") return null;
  const normalized = value.trim().toLowerCase();
  return VALID_SIDES[market].has(normalized) ? normalized : null;
}

/** Price selection is preferred; the frozen displayed forecast is authoritative when price is absent. */
export function uclForecastSideFromMemberMarket(
  market: Pick<MarketEdgeDto, "soccerPriceBoard" | "soccerMatchResultContext" | "soccerDoubleChanceContext" | "soccerTotalContext" | "soccerBttsContext">,
  marketName: UclTrackedMarket,
): string | null {
  const priced = market.soccerPriceBoard?.rows.find((row) => row.selected)?.side ?? null;
  const pricedSide = canonical(priced, marketName);
  if (pricedSide !== null) return pricedSide;

  const displayed = marketName === "match_result"
    ? market.soccerMatchResultContext?.displayed_side
    : marketName === "double_chance"
      ? market.soccerDoubleChanceContext?.displayed_side
      : marketName === "total"
        ? market.soccerTotalContext?.displayed_side
        : market.soccerBttsContext?.displayed_side;
  return canonical(displayed, marketName);
}

function isUclRecord(record: PredictionRecordRow): boolean {
  return record.sport === "soccer"
    && (record.competition ?? record.snapshot_json?.competition) === "uefa_champions_league";
}

/**
 * Returns only a side already frozen at lock. No score, result, fresh model
 * output, or post-lock market data participates in legacy recovery.
 */
export function uclFrozenTrackingForecastSide(record: PredictionRecordRow): string | null {
  if (!isUclRecord(record)) return null;
  const marketName = trackedMarket(record.market);
  if (marketName === null) return null;

  const direct = canonical(record.pick, marketName) ?? canonical(record.side, marketName);
  if (direct !== null) return direct;
  if (
    record.locked_at === null
    || record.held !== true
    || record.hold_reason !== "missing_coherent_current_price"
    || record.pick !== null
    || record.side !== null
    || record.odds_american !== null
    || record.market_probability !== null
  ) return null;

  // The member aggregate intentionally projects only the JSON fields it needs
  // instead of downloading every historical snapshot_json blob. Accept that
  // bounded PostgREST projection as well as the full record used by graders.
  const projected = (record as UclTrackingRecordProjection).member_market_at_capture;
  const captured = projected ?? record.snapshot_json?.member_market_at_capture;
  if (captured === null || typeof captured !== "object") return null;
  const member = captured as MarketEdgeDto;
  if (member.held !== true || member.currentPriceAmerican !== null || member.marketFairProb !== null) return null;
  return uclForecastSideFromMemberMarket(member, marketName);
}

/** Read-only tracking/grading view; the immutable database row is unchanged. */
export function withUclFrozenTrackingForecast(record: PredictionRecordRow): PredictionRecordRow {
  const side = uclFrozenTrackingForecastSide(record);
  if (side === null || (record.pick === side && record.side === side && record.held !== true)) return record;
  return {
    ...record,
    pick: side,
    side,
    // Null odds continue to exclude this forecast from ROI. For prediction
    // tracking it is not absent merely because exact-price economics were.
    held: false,
  };
}
