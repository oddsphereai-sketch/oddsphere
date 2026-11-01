import type { NflForwardContextCapture } from "./nflForwardEvidenceCapture";
import type { NflEpisodeHistoryBook } from "./nflMoneylineEpisodeTransport";

/** Decode only original current observations from checksum-verified stored captures.
 * A compact opening does not retain its own provider identity, so it cannot be
 * relabeled with the current provider. Earlier captures supply that chronology.
 */
export function nflStoredMarketEpisodeHistory(args: {
  providerGameId: string;
  evaluatedAt: string;
  captures: Array<NflForwardContextCapture | null | undefined>;
}): NflEpisodeHistoryBook[] {
  const books: NflEpisodeHistoryBook[] = [];
  for (const capture of args.captures) {
    if (!capture || capture.gameId !== args.providerGameId ||
        !Number.isFinite(Date.parse(capture.capturedAt)) ||
        Date.parse(capture.capturedAt) > Date.parse(args.evaluatedAt)) continue;
    for (const market of ["moneyline", "spread", "total"] as const) {
      for (const [sportsbook, source, , , , current] of capture.markets[market].families) {
        if (!["circa", "pinnacle"].includes(sportsbook) || !["s", "o"].includes(source)) continue;
        const [observedAt, , freshness, line, firstPrice, secondPrice] = current;
        if (freshness === "x" || !Number.isFinite(Date.parse(observedAt)) ||
            Date.parse(observedAt) > Date.parse(capture.capturedAt)) continue;
        const provider = source === "o" ? "owls" as const : "sharpapi" as const;
        books.push({ providerGameId: args.providerGameId, sportsbook, provider,
          observedAt, targetEligible: false,
          marketObservedAt: { [market]: observedAt },
          storedCanonicalEvent: { provenance: "stored_context_capture",
            canonicalGameId: args.providerGameId, sourceProvider: provider,
            sourceEventId: null, sourceObservedAt: observedAt },
          moneyline: market === "moneyline" ? { awayPrice: firstPrice, homePrice: secondPrice } : null,
          spread: market === "spread" && line !== null
            ? { homeLine: line, awayLine: -line, awayPrice: firstPrice, homePrice: secondPrice } : null,
          total: market === "total" && line !== null
            ? { line, overPrice: firstPrice, underPrice: secondPrice } : null,
        });
      }
    }
  }
  return books;
}
