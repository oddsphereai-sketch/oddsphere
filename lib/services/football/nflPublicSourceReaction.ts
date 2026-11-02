import type { NflForwardPlaybookLine, NflForwardPlaybookSplitSet } from "./nflForwardEvidence";
import type { NflEpisodeHistoryBook } from "./nflMoneylineEpisodeTransport";
import type { NflInnovationReactionContext } from "./nflMarketInnovationRuntime";
import { nflPairedReferenceBooksAt, nflMarketSourceAt } from "./nflMarketQualification";

/** Public pressure is read at its own recorded contract. It cannot supply a
 * probability for a different member bet or identify the bettor as sharp. */
export function qualifyNflPublicSourceReaction(args: {
  providerGameId: string; evaluatedAt: string; gameStartsAt: string;
  line: NflForwardPlaybookLine | null; splits: NflForwardPlaybookSplitSet | null;
  history: NflEpisodeHistoryBook[]; excludedFamiliesByMarket: Record<"moneyline" | "spread" | "total", string[]>;
}): NflInnovationReactionContext {
  const result: NflInnovationReactionContext = {};
  const evaluated = Date.parse(args.evaluatedAt), start = Date.parse(args.gameStartsAt);
  if (!args.line || !args.splits || !Number.isFinite(evaluated) || !(evaluated < start)) return result;
  for (const market of ["moneyline", "spread", "total"] as const) {
    const row = args.splits[market], at = Date.parse(row.capturedAt), lineAt = Date.parse(args.line.capturedAt);
    if (![at, lineAt].every(Number.isFinite) || at > evaluated || evaluated - at > 120 * 60_000 ||
        lineAt > at || at - lineAt > 120 * 60_000) continue;
    const sourceLine = market === "spread" ? args.line.homeSpread : market === "total" ? args.line.total : null;
    if (market !== "moneyline" && (sourceLine === null || !Number.isFinite(sourceLine) ||
      (market === "spread" ? args.line.awaySpread !== -sourceLine : sourceLine <= 0))) continue;
    const values = market === "total" ? [row.overMoneyPct, row.underMoneyPct, row.overBetsPct, row.underBetsPct]
      : [row.homeMoneyPct, row.awayMoneyPct, row.homeBetsPct, row.awayBetsPct];
    if (!values.every(x => typeof x === "number" && Number.isFinite(x) && x >= 0 && x <= 100) ||
      Math.abs(values[0]! + values[1]! - 100) > 1e-4 || Math.abs(values[2]! + values[3]! - 100) > 1e-4) continue;
    const priorPairs = nflPairedReferenceBooksAt({ books: args.history, market,
      providerGameId: args.providerGameId, evaluatedAt: row.capturedAt, gameStartsAt: args.gameStartsAt });
    const contractPairs = priorPairs.filter(book => !args.excludedFamiliesByMarket[market].some(f =>
      f.toLowerCase().replace(/[^a-z0-9]/g, "") === book.sportsbook.toLowerCase().replace(/[^a-z0-9]/g, "")) &&
      (market === "moneyline" || (market === "spread" ? book.spread?.homeLine === sourceLine : book.total?.line === sourceLine)));
    if (!contractPairs.length) continue;
    const gap = values[0]! - values[2]!;
    const direction = Math.sign(Math.abs(gap) > 1e-9 ? gap : values[0]! - 50);
    if (!direction) continue;
    result[market] = { books: [], flows: [{ observedAt: row.capturedAt, direction: direction > 0 ? 1 : -1,
      sourceLine, moneyPct: values[0]!, ticketPct: values[2]!, authority: "public_source_contract_reaction_context_only",
      contractAttestations: contractPairs.map(book => ({ book: book.sportsbook, observedAt: nflMarketSourceAt(book, market) })) }] };
  }
  return result;
}
