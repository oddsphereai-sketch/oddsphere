import type { MlbPropMarketKey } from "./config";

type PropSide = "over" | "under";

// Reliability caps derived from locked, settled predictions. These caps do
// not choose a side or manufacture an edge; they limit how far a less reliable
// model may pull the calibrated probability away from the no-vig market.
// Unlisted market/direction pairs retain their confidence-based model weight.
const MODEL_WEIGHT_CAPS: Partial<Record<MlbPropMarketKey, Partial<Record<PropSide, number>>>> = {
  pitcher_strikeouts: { over: 0.4, under: 0 },
  pitcher_walks: { over: 0 },
  batter_hits: { over: 0.3, under: 0.3 },
  batter_hits_runs_rbis: { over: 0.1, under: 0.1 },
  batter_total_bases: { over: 0, under: 0.3 },
  batter_home_runs: { over: 0.1 },
  batter_rbis: { over: 0 },
  batter_runs_scored: { over: 0, under: 0.3 },
  batter_singles: { over: 0.5, under: 0.5 },
  batter_doubles: { over: 0.1, under: 0.1 },
};

export function calibratedPropModelWeight(args: {
  marketKey: MlbPropMarketKey;
  side: PropSide;
  baseWeight: number;
}): number {
  const boundedBase = Math.max(0, Math.min(1, args.baseWeight));
  const cap = MODEL_WEIGHT_CAPS[args.marketKey]?.[args.side];
  return cap === undefined ? boundedBase : Math.min(boundedBase, cap);
}
