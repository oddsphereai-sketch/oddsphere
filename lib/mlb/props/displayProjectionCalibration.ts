import type { MlbPropMarketKey } from "./config";

/**
 * Post-decision expected-count calibration for member-facing MLB prop projections.
 *
 * This transform must remain downstream of probability, side, grade, actionability,
 * and stake selection. It improves the displayed expected count only; it is not a
 * probability calibration and must never be used as a new decision input.
 */
export const MLB_PROPS_DISPLAY_PROJECTION_CALIBRATION_VERSION =
  "mlb_props_display_projection_calibration_2026_08_19_r1";

type DisplayProjectionCalibrationFit = Readonly<{
  intercept: number;
  slope: number;
}>;

const DISPLAY_PROJECTION_CALIBRATION_FITS: Readonly<
  Partial<Record<MlbPropMarketKey, DisplayProjectionCalibrationFit>>
> = {
  batter_hits_runs_rbis: {
    intercept: 0.17051119248583754,
    slope: 0.4358764745873835,
  },
  batter_strikeouts: {
    intercept: 0.10021861685459268,
    slope: 0.42435101444443957,
  },
  batter_total_bases: {
    intercept: 0.2600632976376942,
    slope: 0.4001965357066221,
  },
  pitcher_earned_runs: {
    intercept: 0.04061896620532436,
    slope: 0.19426630446835788,
  },
  pitcher_hits_allowed: {
    intercept: 0.009150245705195103,
    slope: -0.06016586895252813,
  },
  pitcher_strikeouts: {
    intercept: -0.06107331931260067,
    slope: 0.013245397066669887,
  },
};

export type MlbPropsDisplayProjectionInput = Readonly<{
  market: string;
  side: "over" | "under";
  line: number;
  projection: number;
}>;

function projectionSupportsSide(row: MlbPropsDisplayProjectionInput, projection: number): boolean {
  return row.side === "over" ? projection > row.line : projection < row.line;
}

export function calibrateMlbPropsDisplayProjection(
  row: MlbPropsDisplayProjectionInput,
): number {
  const fit = DISPLAY_PROJECTION_CALIBRATION_FITS[row.market as MlbPropMarketKey];
  if (!fit) return row.projection;
  if (![row.line, row.projection].every(Number.isFinite)) return row.projection;

  const calibrated = Math.max(
    0,
    row.line + fit.intercept + fit.slope * (row.projection - row.line),
  );
  // A display-only correction may resolve an existing projection/side mismatch,
  // but it must never create a new one on an already coherent board row.
  if (projectionSupportsSide(row, row.projection) && !projectionSupportsSide(row, calibrated)) {
    return row.projection;
  }
  return calibrated;
}

export function applyMlbPropsDisplayProjectionCalibration<
  Row extends MlbPropsDisplayProjectionInput,
>(rows: readonly Row[]): Row[] {
  return rows.map((row) => {
    const projection = calibrateMlbPropsDisplayProjection(row);
    return Object.is(projection, row.projection) ? row : { ...row, projection };
  });
}
