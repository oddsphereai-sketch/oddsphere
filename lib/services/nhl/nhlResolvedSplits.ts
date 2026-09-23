import type { SupabaseClient } from "@supabase/supabase-js";
import type { SharpNhlSplitsEvent } from "../../providers/nhl/_sharpApiNhlClient";
import { resolveSlatePublicSplits } from "../resolveSlatePublicSplits";

/**
 * NHL product contract: the last complete provider observation remains usable
 * until a newer complete observation replaces it. The resolver still prefers
 * Playbook and silently falls back to SharpAPI, but NHL deliberately has no
 * age expiry because removing the section is worse than retaining the latest
 * verified money+ticket observation. No freshness copy is exposed to members.
 */
export async function resolvedNhlSplitsByGame(
  supabase: SupabaseClient,
  slateDate: string,
): Promise<Map<number, SharpNhlSplitsEvent>> {
  const cells = await resolveSlatePublicSplits({
    supabase,
    sport: "nhl",
    slateDate,
    staleAfterMinutes: Number.POSITIVE_INFINITY,
  });
  const byGame = new Map<number, SharpNhlSplitsEvent>();
  for (const cell of cells) {
    const bet = cell.resolved.displayBettingPct;
    const money = cell.resolved.displayMoneyPct;
    if (bet === null || money === null) continue;
    const event = byGame.get(cell.gameId) ?? {};
    const betFraction = bet / 100;
    const moneyFraction = money / 100;
    if (cell.market === "moneyline" && (cell.side === "home" || cell.side === "away")) {
      event.moneyline ??= { bets_pct: {}, handle_pct: {} };
      event.moneyline.bets_pct ??= {};
      event.moneyline.handle_pct ??= {};
      event.moneyline.bets_pct[cell.side] = betFraction;
      event.moneyline.handle_pct[cell.side] = moneyFraction;
    } else if (cell.market === "spread" && (cell.side === "home" || cell.side === "away")) {
      event.spread ??= { bets_pct: {}, handle_pct: {} };
      event.spread.bets_pct ??= {};
      event.spread.handle_pct ??= {};
      event.spread.bets_pct[cell.side] = betFraction;
      event.spread.handle_pct[cell.side] = moneyFraction;
    } else if (cell.market === "total" && (cell.side === "over" || cell.side === "under")) {
      event.total ??= { bets_pct: {}, handle_pct: {} };
      event.total.bets_pct ??= {};
      event.total.handle_pct ??= {};
      event.total.bets_pct[cell.side] = betFraction;
      event.total.handle_pct[cell.side] = moneyFraction;
    }
    byGame.set(cell.gameId, event);
  }
  return byGame;
}
