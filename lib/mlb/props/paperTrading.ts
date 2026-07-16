import type { MlbPropMarketKey } from "./config";

export const PAPER_TRADING_MARKETS: readonly MlbPropMarketKey[] = [
  "pitcher_strikeouts",
  "pitcher_outs",
  "pitcher_hits_allowed",
  "pitcher_walks",
  "pitcher_earned_runs",
  "batter_strikeouts",
  "batter_hits",
  "batter_total_bases",
  "batter_home_runs",
  "batter_rbis",
  "batter_runs_scored",
  "batter_hits_runs_rbis",
  "batter_singles",
  "batter_doubles",
  "batter_triples",
  "batter_walks",
  "batter_stolen_bases",
];

export type RealPaperPersistenceGateArgs = {
  providerMode: "mock" | "real";
  persist: boolean;
  dryRun: boolean;
  env?: NodeJS.ProcessEnv;
};

export type RealPaperPersistenceGateResult =
  | { ok: true; recommendationStatus: "paper" }
  | { ok: false; reason: string };

export function isPaperTradingMarketAllowed(marketKey: string): marketKey is (typeof PAPER_TRADING_MARKETS)[number] {
  return (PAPER_TRADING_MARKETS as readonly string[]).includes(marketKey);
}

export function evaluateRealPaperPersistenceGate(args: RealPaperPersistenceGateArgs): RealPaperPersistenceGateResult {
  const env = args.env ?? process.env;
  if (args.providerMode !== "real") return { ok: false, reason: "provider must be real" };
  if (!args.persist) return { ok: false, reason: "--persist is required" };
  if (args.dryRun) return { ok: false, reason: "--dry-run=false is required" };
  if (env.ODDSPHERE_PROPS_PAPER_TRADING_ENABLED !== "true") {
    return { ok: false, reason: "ODDSPHERE_PROPS_PAPER_TRADING_ENABLED=true is required" };
  }
  if (env.ODDSPHERE_PROPS_REAL_PUBLISH_ENABLED === "true") {
    return { ok: false, reason: "ODDSPHERE_PROPS_REAL_PUBLISH_ENABLED must remain false" };
  }
  if (env.ODDSPHERE_PROPS_DISPLAY_ENABLED === "true") {
    return { ok: false, reason: "ODDSPHERE_PROPS_DISPLAY_ENABLED must remain false" };
  }
  return { ok: true, recommendationStatus: "paper" };
}

export function assertRealPaperPersistenceAllowed(args: RealPaperPersistenceGateArgs): asserts args is RealPaperPersistenceGateArgs {
  const result = evaluateRealPaperPersistenceGate(args);
  if (!result.ok) {
    throw new Error(`Real MLB props paper persistence blocked: ${result.reason}.`);
  }
}
