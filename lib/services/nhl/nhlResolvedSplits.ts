import type { SupabaseClient } from "@supabase/supabase-js";
import type { SharpNhlSplitsEvent } from "../../providers/nhl/_sharpApiNhlClient";
import type {
  PublicSplitAgreementState,
  PublicSplitModelConfidence,
  PublicSplitsProvider,
} from "../publicSplitsResolver";
import { resolveSlatePublicSplits } from "../resolveSlatePublicSplits";
import type { NhlEpisodeMarket, NhlSplitPressureReceipt } from "./nhlMarketEpisodeArbiter";

type NhlResolvedSplitEvidence = {
  source: PublicSplitsProvider | null;
  agreement: PublicSplitAgreementState;
  confidence: PublicSplitModelConfidence;
  providerGapPct: number | null;
  observedAt?: string | null;
  receivedAt?: string | null;
  completePair?: boolean;
};

export type ResolvedNhlSplitsEvent = SharpNhlSplitsEvent & {
  internal_resolution?: Partial<Record<"moneyline" | "spread" | "total", NhlResolvedSplitEvidence>>;
};

export function nhlSplitPressureReceipt(
  event: ResolvedNhlSplitsEvent | null,
  market: NhlEpisodeMarket,
): NhlSplitPressureReceipt | null {
  if (!event) return null;
  const evidence = event.internal_resolution?.[market];
  const selectedSide = market === "total" ? "over" as const : "home" as const;
  const opposingSide = market === "total" ? "under" as const : "away" as const;
  const selectedTickets = market === "total"
    ? event.total?.bets_pct?.over
    : (market === "moneyline" ? event.moneyline : event.spread)?.bets_pct?.home;
  const selectedMoney = market === "total"
    ? event.total?.handle_pct?.over
    : (market === "moneyline" ? event.moneyline : event.spread)?.handle_pct?.home;
  if (!evidence?.source || !evidence.observedAt || !evidence.completePair
    || selectedTickets == null || selectedMoney == null) return null;
  const ticketsPct = selectedTickets * 100;
  const moneyPct = selectedMoney * 100;
  const consensusSide = ticketsPct >= 55 && moneyPct >= 55
    ? selectedSide
    : ticketsPct <= 45 && moneyPct <= 45
      ? opposingSide
      : null;
  const differential = moneyPct - ticketsPct;
  const differentialSide = Math.abs(differential) >= 10
    ? differential > 0 ? selectedSide : opposingSide
    : null;
  const pressureSide = differentialSide ?? consensusSide;
  if (pressureSide === null) return null;
  const pressureTickets = pressureSide === selectedSide ? ticketsPct : 100 - ticketsPct;
  const pressureMoney = pressureSide === selectedSide ? moneyPct : 100 - moneyPct;
  return {
    market,
    source: evidence.source,
    sourceClass: "public",
    pressureSide,
    ticketsPct: pressureTickets,
    moneyPct: pressureMoney,
    confidence: evidence.confidence,
    completePair: true,
    observedAt: evidence.observedAt,
    receivedAt: evidence.receivedAt ?? null,
  };
}

/**
 * NHL product contract: the last complete provider observation remains usable
 * until a newer complete observation replaces it. Playbook is the active
 * Public Consensus source. Historical SharpAPI rows may still explain an
 * immutable older payload, but no new SharpAPI request is made. NHL
 * deliberately has no age expiry because removing the section is worse than
 * retaining the latest verified money+ticket observation.
 */
export async function resolvedNhlSplitsByGame(
  supabase: SupabaseClient,
  slateDate: string,
): Promise<Map<number, ResolvedNhlSplitsEvent>> {
  const cells = await resolveSlatePublicSplits({
    supabase,
    sport: "nhl",
    slateDate,
    staleAfterMinutes: Number.POSITIVE_INFINITY,
  });
  const byGame = new Map<number, ResolvedNhlSplitsEvent>();
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
  const cellsByMarket = new Map<string, typeof cells>();
  for (const cell of cells) {
    const key = `${cell.gameId}:${cell.market}`;
    cellsByMarket.set(key, [...(cellsByMarket.get(key) ?? []), cell]);
  }
  for (const [key, marketCells] of cellsByMarket) {
    const [gameIdRaw, market] = key.split(":") as [string, "moneyline" | "spread" | "total"];
    const selectedSide = market === "total" ? "over" : "home";
    const opposingSide = market === "total" ? "under" : "away";
    const selected = marketCells.find((cell) => cell.side === selectedSide) ?? null;
    const opposing = marketCells.find((cell) => cell.side === opposingSide) ?? null;
    const sameReceipt = selected !== null
      && opposing !== null
      && selected.resolved.displaySource !== null
      && selected.resolved.displaySource === opposing.resolved.displaySource
      && selected.resolved.displayObservedAt !== null
      && selected.resolved.displayObservedAt === opposing.resolved.displayObservedAt;
    const percentagesComplete = sameReceipt
      && selected!.resolved.displayBettingPct !== null
      && opposing!.resolved.displayBettingPct !== null
      && selected!.resolved.displayMoneyPct !== null
      && opposing!.resolved.displayMoneyPct !== null
      && Math.abs(selected!.resolved.displayBettingPct + opposing!.resolved.displayBettingPct - 100) <= 1
      && Math.abs(selected!.resolved.displayMoneyPct + opposing!.resolved.displayMoneyPct - 100) <= 1;
    const event = byGame.get(Number(gameIdRaw));
    if (!event || !selected) continue;
    event.internal_resolution ??= {};
    event.internal_resolution[market] = {
      source: selected.resolved.displaySource,
      agreement: selected.resolved.agreementState,
      confidence: selected.resolved.modelConfidence,
      providerGapPct: selected.resolved.providerGapPct.max,
      observedAt: selected.resolved.displayObservedAt,
      receivedAt: selected.resolved.displayReceivedAt,
      completePair: percentagesComplete,
    };
  }
  return byGame;
}
