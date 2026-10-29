/** Public Kalshi CBB receipts. Owl's Kalshi index currently rejects ncaab, so
 * this display-only lane reads the official market API without touching picks. */
const BASE = "https://api.elections.kalshi.com/trade-api/v2/markets";
const SERIES = new Set(["KXNCAAMBGAME", "KXNCAAMBSPREAD", "KXNCAAMBTOTAL"]);
type Market = Record<string, unknown>;
type Page = { markets?: unknown; cursor?: unknown };

export type CbbKalshiEnvelope = {
  success: true;
  meta: { cacheTimestamp: string };
  data: Record<string, Market>;
  requests: number;
};

export async function fetchCbbKalshiMarkets(
  series: string,
  options: { eventTickers?: string[]; now?: number; fetcher?: typeof fetch; maxPages?: number } = {},
): Promise<CbbKalshiEnvelope> {
  if (!SERIES.has(series)) throw new Error(`Unsupported CBB Kalshi series: ${series}`);
  const now = options.now ?? Date.now();
  const fetcher = options.fetcher ?? fetch;
  const events = options.eventTickers ? [...new Set(options.eventTickers)] : [];
  if (options.eventTickers && events.length === 0) return { success: true, meta: { cacheTimestamp: new Date(now).toISOString() }, data: {}, requests: 0 };
  if (events.some(event => !new RegExp(`^${series}-[A-Z0-9]+$`).test(event))) throw new Error("Invalid CBB Kalshi event identity");
  const selectors = events.length ? events.map(event => ({ event_ticker: event })) : [{
    series_ticker: series, status: "open",
    min_close_ts: String(Math.floor((now - 86_400_000) / 1000)),
    max_close_ts: String(Math.floor((now + 9 * 86_400_000) / 1000)),
  }];
  const data: Record<string, Market> = {};
  let requests = 0;
  for (const selector of selectors) {
    let cursor = "";
    let exhausted = false;
    for (let page = 0; page < (options.maxPages ?? 6); page++) {
      const url = new URL(BASE);
      for (const [key, value] of Object.entries(selector)) url.searchParams.set(key, value);
      url.searchParams.set("limit", "1000");
      if (cursor) url.searchParams.set("cursor", cursor);
      const response = await fetcher(url, { cache: "no-store", signal: AbortSignal.timeout(8_000) });
      requests++;
      if (!response.ok) throw new Error(`Kalshi CBB ${series} HTTP ${response.status}`);
      const body = await response.json() as Page;
      if (!Array.isArray(body.markets) || typeof body.cursor !== "string") throw new Error(`Kalshi CBB ${series} malformed page`);
      for (const value of body.markets) {
        if (!value || typeof value !== "object" || Array.isArray(value)) continue;
        const market = value as Market;
        if (typeof market.ticker === "string" && market.event_ticker && market.ticker.startsWith(`${series}-`)) data[market.ticker] = market;
      }
      if (!body.cursor) { exhausted = true; break; }
      if (body.cursor === cursor) throw new Error(`Kalshi CBB ${series} repeated cursor`);
      cursor = body.cursor;
    }
    if (!exhausted) throw new Error(`Kalshi CBB ${series} exceeds bounded pagination; refusing partial receipt`);
  }
  return { success: true, meta: { cacheTimestamp: new Date(now).toISOString() }, data, requests };
}
