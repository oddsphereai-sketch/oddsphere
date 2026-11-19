/** Explicit product meaning, not fitted calibration or a target forecast.
 * Keep the original distribution, actual win mass and executable price. */
export const PROPS_FORECAST_STRENGTH_RELEASE = "player_props_forecast_strength_2026_11_19_r1_top_conviction" as const;
export const PROPS_BEST_MINIMUM_WIN_PROBABILITY = 0.62;
export const PROPS_BEST_MINIMUM_AMERICAN_PRICE = -200;
export function qualifiesPropsBestForecast(probability:number,american:number):boolean {
  return Number.isFinite(probability)&&probability>=PROPS_BEST_MINIMUM_WIN_PROBABILITY
    &&probability<=1&&Number.isSafeInteger(american)&&Math.abs(american)>=100
    &&american>=PROPS_BEST_MINIMUM_AMERICAN_PRICE;
}
/** Push refunds are not wins. Integer comparison preserves the exact boundary. */
export function qualifiesExactPropsBestForecast(win:number,total:number,american:number):boolean {
  return Number.isSafeInteger(win)&&Number.isSafeInteger(total)&&total>0&&win>=0&&win<=total
    &&BigInt(win)*BigInt(50)>=BigInt(total)*BigInt(31)
    &&Number.isSafeInteger(american)&&Math.abs(american)>=100
    &&american>=PROPS_BEST_MINIMUM_AMERICAN_PRICE;
}
