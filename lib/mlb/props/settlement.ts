import type { MlbPropMarketKey } from "./config";
import type { PropSettlementResult } from "./providers";

export type PropSettlementInput = {
  marketKey: MlbPropMarketKey;
  playerId: string;
  gameId: string;
  line: number;
  side: "over" | "under";
  finalStats?: Record<string, number | string | boolean | null>;
  playerStarted?: boolean;
  stakeUnits?: number;
  americanOdds?: number;
};

export type PropSettlementDecision =
  | { status: "settled"; result: "win" | "loss" | "push"; resultValue: number; units: number }
  | { status: "unresolved"; reason: "player_did_not_start" | "missing_final_stat" | "unsupported_market" };

export function settlePropPick(input: PropSettlementInput): PropSettlementDecision {
  if (input.playerStarted === false) return { status: "unresolved", reason: "player_did_not_start" };
  const value = statValueForMarket(input.marketKey, input.finalStats);
  if (value === null) return { status: "unresolved", reason: isSupportedSettlementMarket(input.marketKey) ? "missing_final_stat" : "unsupported_market" };
  if (value === input.line) return { status: "settled", result: "push", resultValue: value, units: 0 };
  const sideWon = input.side === "over" ? value > input.line : value < input.line;
  const stake = typeof input.stakeUnits === "number" && Number.isFinite(input.stakeUnits) && input.stakeUnits >= 0
    ? input.stakeUnits
    : 1;
  return {
    status: "settled",
    result: sideWon ? "win" : "loss",
    resultValue: value,
    units: sideWon ? roundUnits(stake * profitPerUnit(input.americanOdds)) : -stake,
  };
}

export function settlementResultFromFinalStats(input: Omit<PropSettlementInput, "side">): PropSettlementResult {
  const value = statValueForMarket(input.marketKey, input.finalStats);
  if (value === null || input.playerStarted === false) {
    return {
      marketKey: input.marketKey,
      playerId: input.playerId,
      gameId: input.gameId,
      resultValue: 0,
      overWon: false,
      underWon: false,
      push: false,
      settlementStatus: "pending",
      provider: "internal_settlement_scaffold",
      rawPayload: { unresolvedReason: input.playerStarted === false ? "player_did_not_start" : "missing_final_stat" },
    };
  }
  return {
    marketKey: input.marketKey,
    playerId: input.playerId,
    gameId: input.gameId,
    resultValue: value,
    overWon: value > input.line,
    underWon: value < input.line,
    push: value === input.line,
    settlementStatus: "settled",
    provider: "internal_settlement_scaffold",
    rawPayload: input.finalStats ?? {},
  };
}

export function outsFromInningsPitched(value: number | string | null | undefined): number | null {
  if (value === null || value === undefined) return null;
  if (typeof value === "number" && Number.isFinite(value)) {
    const whole = Math.floor(value);
    const fraction = value - whole;
    const trueOutFraction = Math.round(fraction * 3);
    if (trueOutFraction <= 2 && Math.abs(fraction - trueOutFraction / 3) < 0.0001) {
      return whole * 3 + trueOutFraction;
    }
    const baseballDecimal = Math.round(fraction * 10);
    if (baseballDecimal <= 2 && Math.abs(fraction - baseballDecimal / 10) < 0.0001) {
      return whole * 3 + baseballDecimal;
    }
    return null;
  }
  const [innings, partial = "0"] = String(value).split(".");
  const whole = Number(innings);
  const extra = Number(partial);
  if (!Number.isFinite(whole) || !Number.isFinite(extra) || extra > 2) return null;
  return whole * 3 + extra;
}

function statValueForMarket(marketKey: MlbPropMarketKey, stats?: Record<string, number | string | boolean | null>): number | null {
  if (!stats) return null;
  if (marketKey === "pitcher_strikeouts") return numeric(stats.strikeouts ?? stats.so ?? stats.k);
  if (marketKey === "pitcher_outs") return numeric(stats.outs) ?? outsFromInningsPitched(stats.innings_pitched as string | number | null | undefined);
  if (marketKey === "pitcher_hits_allowed") return numeric(stats.hits_allowed);
  if (marketKey === "pitcher_walks") return numeric(stats.walks);
  if (marketKey === "pitcher_earned_runs") return numeric(stats.earned_runs);
  if (marketKey === "batter_strikeouts") return numeric(stats.strikeouts ?? stats.so ?? stats.k);
  if (marketKey === "batter_hits") return numeric(stats.hits);
  if (marketKey === "batter_total_bases") return numeric(stats.total_bases);
  if (marketKey === "batter_home_runs") return numeric(stats.home_runs);
  if (marketKey === "batter_rbis") return numeric(stats.rbis);
  if (marketKey === "batter_runs_scored") return numeric(stats.runs);
  if (marketKey === "batter_hits_runs_rbis") return numeric(stats.hits_runs_rbis);
  if (marketKey === "batter_singles") return numeric(stats.singles);
  if (marketKey === "batter_doubles") return numeric(stats.doubles);
  if (marketKey === "batter_triples") return numeric(stats.triples);
  if (marketKey === "batter_walks") return numeric(stats.walks);
  if (marketKey === "batter_stolen_bases") return numeric(stats.stolen_bases);
  return null;
}

function isSupportedSettlementMarket(marketKey: MlbPropMarketKey): boolean {
  return [
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
  ].includes(marketKey);
}

function numeric(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function profitPerUnit(americanOdds?: number): number {
  if (typeof americanOdds !== "number" || !Number.isFinite(americanOdds) || americanOdds === 0) return 1;
  return americanOdds > 0 ? americanOdds / 100 : 100 / Math.abs(americanOdds);
}

function roundUnits(value: number): number {
  return Math.round(value * 1_000_000) / 1_000_000;
}
