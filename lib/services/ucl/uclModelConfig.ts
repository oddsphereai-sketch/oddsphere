/** Shared released likelihood parameters; retained evidence uses the same
 * relevance horizon as observed goals. No independent aging configuration. */
export const UCL_MODEL_CONFIG = {
  halfLifeDays: 365,
  shrinkageMatches: 4,
  xgWeight: 0.35,
  dixonColesTau: -0.1,
} as const;
