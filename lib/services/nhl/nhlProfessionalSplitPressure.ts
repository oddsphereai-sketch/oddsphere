import type { NhlIdentifiedProfessionalSplit } from "../../providers/real_api/sharpApiCurrentSplits";
import type { NhlEpisodeMarket, NhlSplitPressureReceipt } from "./nhlMarketEpisodeArbiter";

export const NHL_PROFESSIONAL_SPLIT_MAX_AGE_MS = 3 * 60 * 60_000;

/** Select one fresh identified professional pressure receipt. Multiple fresh
 * books may corroborate but never average. Opposed books produce an explicit
 * conflict receipt that the arbiter treats as a veto; stale/future books do
 * not suppress a fresh fallback. */
export function selectNhlProfessionalSplitPressure(args: {
  splits: readonly NhlIdentifiedProfessionalSplit[];
  market: NhlEpisodeMarket;
  decisionAt: string;
}): NhlSplitPressureReceipt | null {
  const decisionMs = Date.parse(args.decisionAt);
  if (!Number.isFinite(decisionMs)) return null;
  const candidates = args.splits.filter((candidate) => {
    const observedMs = Date.parse(candidate.observedAt);
    const receivedMs = Date.parse(candidate.receivedAt);
    return candidate.market === args.market
      && Number.isFinite(observedMs)
      && Number.isFinite(receivedMs)
      && receivedMs >= observedMs
      && observedMs <= decisionMs
      && receivedMs <= decisionMs
      && decisionMs - observedMs <= NHL_PROFESSIONAL_SPLIT_MAX_AGE_MS
      && decisionMs - receivedMs <= NHL_PROFESSIONAL_SPLIT_MAX_AGE_MS;
  }).flatMap((candidate) => {
    const primarySide = args.market === "total" ? "over" as const : "away" as const;
    const opposingSide = args.market === "total" ? "under" as const : "home" as const;
    const differential = candidate.awayOrOverMoneyPct - candidate.awayOrOverBetsPct;
    const consensus = candidate.awayOrOverMoneyPct >= 55 && candidate.awayOrOverBetsPct >= 55
      ? primarySide
      : candidate.awayOrOverMoneyPct <= 45 && candidate.awayOrOverBetsPct <= 45
        ? opposingSide
        : null;
    const side = Math.abs(differential) >= 10
      ? differential > 0 ? primarySide : opposingSide
      : consensus;
    return side === null ? [] : [{ candidate, side }];
  });
  if (candidates.length === 0) return null;
  const selected = candidates[0]!;
  const selectedPrimary = selected.side === (args.market === "total" ? "over" : "away");
  const conflict = new Set(candidates.map((candidate) => candidate.side)).size !== 1;
  return {
    market: args.market,
    source: conflict ? "identified_professional_conflict" : "identified_professional_split",
    sourceClass: "sharp",
    sourceBook: selected.candidate.sourceBook,
    pressureSide: selected.side,
    ticketsPct: selectedPrimary ? selected.candidate.awayOrOverBetsPct : selected.candidate.homeOrUnderBetsPct,
    moneyPct: selectedPrimary ? selected.candidate.awayOrOverMoneyPct : selected.candidate.homeOrUnderMoneyPct,
    confidence: conflict ? "low" : "high",
    completePair: true,
    observedAt: selected.candidate.observedAt,
    receivedAt: selected.candidate.receivedAt,
  };
}
