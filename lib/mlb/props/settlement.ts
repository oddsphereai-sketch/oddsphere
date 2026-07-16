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
  return null;
}

function isSupportedSettlementMarket(marketKey: MlbPropMarketKey): boolean {
  return marketKey === "pitcher_strikeouts" || marketKey === "pitcher_outs";
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
