import {
  normalizeOwlsNamedBookOdds, normalizeOwlsSharpBookOdds,
  type RawOwlsOddsResponse, type NormalizedOwlsNamedPrice,
} from "../providers/owls/owlsSharpBookOdds";

export const CBB_RETAIL_PRICE_JOURNAL_RELEASE = "cbb_retail_price_journal_2026_11_03_r1_existing_response";
// Executable CBB books already supported by owlsMarketEvidence. Exchanges and
// synthetic consensus are deliberately absent. Professional capture is unchanged.
export const CBB_RETAIL_JOURNAL_BOOKS = ["draftkings", "fanduel", "betmgm", "caesars", "bet365", "bovada",
  "betrivers", "betr", "stations", "south_point", "westgate", "wynn", "hardrock", "betonline"] as const;

/** Journal received current quotes, never manufacture an opener or receipt.
 * Uses the collector's single existing response and canonical upsert. Retail
 * rows have no professional-reader authority; that allowlist remains unchanged.
 */
export function normalizeCbbRetailPriceJournal(response: RawOwlsOddsResponse, receivedAt: Date) {
  const sharp = normalizeOwlsSharpBookOdds(response, "ncaab");
  const events = Array.isArray(response.data) ? response.data : Object.values(response.data ?? {}).flatMap(rows => rows ?? []);
  // CBB current odds permit a more specific market clock. Preserve it rather
  // than assigning the enclosing book's clock to every contract.
  const retailResponse: RawOwlsOddsResponse = { ...response, data: events.map(event => ({ ...event,
    bookmakers: (event.bookmakers ?? []).flatMap(book => (book.markets ?? []).map(market => ({ ...book,
      last_update: (market as typeof market & { last_update?: string }).last_update ?? book.last_update,
      markets: [market],
    }))),
  })) };
  const retail = normalizeOwlsNamedBookOdds(retailResponse, "ncaab", CBB_RETAIL_JOURNAL_BOOKS);
  const groups = new Map<string, NormalizedOwlsNamedPrice[]>();
  for (const row of retail.prices) {
    const key = JSON.stringify([row.providerEventId, row.sportsbook, row.market]);
    groups.set(key, [...(groups.get(key) ?? []), row]);
  }
  const prices: NormalizedOwlsNamedPrice[] = [...sharp.prices];
  const rejected = [...sharp.rejected, ...retail.rejected];
  for (const rows of groups.values()) {
    const unique = [...new Map(rows.map(row => [JSON.stringify(row), row])).values()];
    const first = unique[0]!;
    const at = Date.parse(first.observedAt), start = Date.parse(first.scheduledStart ?? "");
    const hold = unique.reduce((sum, row) => sum + 1 / row.decimalPrice, 0);
    const valid = response.success !== false && unique.length === 2 &&
      unique[0].side !== unique[1].side && unique.every(row => row.observedAt === first.observedAt &&
        Math.abs(row.americanPrice) >= 100 && (row.market === "moneyline" ||
          (row.line !== null && Number.isInteger(row.line * 2) && (row.market !== "total" || row.line > 0)))) &&
      Number.isFinite(at) && Number.isFinite(start) && at <= receivedAt.getTime() &&
      receivedAt.getTime() < start && at < start && hold >= 0.98 && hold <= 1.3;
    if (valid) prices.push(...unique);
    else rejected.push({ providerEventId: first.providerEventId, sportsbook: first.sportsbook,
      reason: `invalid, conflicting or nonpregame retail ${first.market} pair` });
  }
  return { eventsReturned: sharp.eventsReturned,
    matchedBookEvents: sharp.matchedBookEvents + new Set(retail.prices.map(row => `${row.providerEventId}|${row.sportsbook}`)).size,
    prices, rejected };
}
