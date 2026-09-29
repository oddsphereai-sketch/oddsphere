/**
 * SharpAPI NHL client — odds + splits wrappers.
 *
 * Mirrors the NBA SharpAPI usage pattern (the existing
 * refresh-nba-lines service inlines its own SharpAPI client; we
 * extract that pattern here for NHL so the lines + splits paths
 * share one client). NHL-filtered (`league=nhl`).
 *
 * Phase 7L probe confirmed:
 *   • /odds            — ML / total_goals / puck_line + many props.
 *                        ~600 rows/day during Finals across 8
 *                        sportsbooks. HTTP 400 at offset=600 is a
 *                        pre-existing pagination quirk; the loop
 *                        breaks on non-200 and returns what it has.
 *   • /splits          — per-event nested {moneyline, spread, total}
 *                        with bets_pct populated, handle_pct often
 *                        null (matches MLB/NBA pattern).
 *   • /opportunities/ev — devig + ev_percentage + book_count for
 *                        sharp-action proxy (since /signals/sharp-
 *                        action returns 404 for NHL).
 *
 * NEVER logs the API key.
 */

const SHARP_API_BASE = "https://api.sharpapi.io/api/v1";

export type SharpNhlOddsRow = {
  id?: string;
  event_id?: string;
  external_event_id?: string;
  event_start_time?: string;
  sportsbook?: string;
  market_type?: string;
  selection_type?: string;
  selection?: string;
  line?: number | string | null;
  odds_american?: number | string | null;
  odds_decimal?: number | string | null;
  odds_probability?: number | string | null;
  home_team?: string;
  away_team?: string;
  league?: string;
  sport?: string;
  is_main_line?: boolean;
  is_alternate_line?: boolean;
  is_active?: boolean;
  is_live?: boolean;
  is_stale_pregame_price?: boolean;
  timestamp?: string;
};

export type SharpNhlEvent = {
  id?: string;
  league?: string;
  home_team?: string;
  away_team?: string;
  start_time?: string;
  market_count?: number;
};

type SharpPagination = {
  has_more?: boolean;
  next_cursor?: string | null;
};

export type SharpNhlSplitsEvent = {
  event_id?: string;
  sportsbook?: string;
  home_team?: string;
  away_team?: string;
  fetched_at?: string;
  moneyline?: {
    home_odds?: number | null;
    away_odds?: number | null;
    bets_pct?: { home?: number | null; away?: number | null };
    handle_pct?: { home?: number | null; away?: number | null };
  };
  spread?: {
    home_odds?: number | null;
    away_odds?: number | null;
    bets_pct?: { home?: number | null; away?: number | null };
    handle_pct?: { home?: number | null; away?: number | null };
  };
  total?: {
    line?: number | null;
    bets_pct?: { over?: number | null; under?: number | null };
    handle_pct?: { over?: number | null; under?: number | null };
  };
};

export type SharpNhlOpportunity = {
  id?: string;
  event_id?: string;
  external_event_id?: string;
  event_name?: string;
  home_team?: string;
  away_team?: string;
  sportsbook?: string;
  market_type?: string;
  display_selection?: string;
  odds_american?: number;
  odds_decimal?: number;
  ev_percentage?: number;
  fair_probability?: number;
  devig_method?: string;
  book_count?: number;
  cross_ref_count?: number;
  cross_ref_dispersion?: number;
  confidence?: number;
  arb_available?: boolean;
  arb_profit?: number | null;
  is_alternate_line?: boolean;
  is_live?: boolean;
};

async function fetchSharpPage<T>(
  path: string,
  query: Record<string, string>,
  apiKey: string,
): Promise<{ data: T[]; pagination: SharpPagination | null }> {
  const url = new URL(`${SHARP_API_BASE}/${path}`);
  for (const [key, value] of Object.entries(query)) url.searchParams.set(key, value);
  const res = await fetch(url, { headers: { Authorization: `Bearer ${apiKey}` } });
  if (!res.ok) throw new Error(`SharpAPI /${path} NHL fetch failed: HTTP ${res.status}`);
  const body = (await res.json()) as { data?: T[]; pagination?: SharpPagination | null };
  return { data: body.data ?? [], pagination: body.pagination ?? null };
}

/** Fetch the bounded event catalog for a single UTC date. The provider's
 * league/date odds query can exceed 1,000 rows because futures and player
 * props sort ahead of later games; resolving the exact event first keeps the
 * game-line workload complete and materially cheaper. */
export async function fetchSharpNhlEvents(
  date: string,
  apiKey: string,
  logger?: (msg: string) => void,
): Promise<SharpNhlEvent[]> {
  const log = logger ?? (() => {});
  const all: SharpNhlEvent[] = [];
  let cursor: string | null = null;
  for (let page = 0; page < 4; page++) {
    const response: { data: SharpNhlEvent[]; pagination: SharpPagination | null } = await fetchSharpPage<SharpNhlEvent>("events", {
      league: "nhl",
      date,
      limit: "200",
      ...(cursor ? { cursor } : {}),
    }, apiKey);
    all.push(...response.data);
    if (!response.pagination?.has_more || !response.pagination.next_cursor) break;
    cursor = response.pagination.next_cursor;
  }
  log(`SharpAPI NHL event catalog ${date}: ${all.length} rows`);
  return all;
}

const NHL_GAME_MARKETS = ["moneyline", "puck_line", "total_goals"] as const;

function presentGameMarkets(rows: SharpNhlOddsRow[]): Set<string> {
  return new Set(rows
    .filter((row) => row.home_team?.trim() && row.away_team?.trim())
    .filter((row) => !/\bperiod\b/i.test(`${row.home_team} ${row.away_team}`))
    .map((row) => row.market_type ?? ""));
}

/** Fetch one exact event. A single 200-row event page normally contains all
 * three full-game markets. Any absent game market is retried directly, so
 * props cannot crowd a required line off the response. */
export async function fetchSharpNhlEventOdds(
  eventId: string,
  apiKey: string,
  logger?: (msg: string) => void,
): Promise<SharpNhlOddsRow[]> {
  const log = logger ?? (() => {});
  const first = await fetchSharpPage<SharpNhlOddsRow>("odds", {
    event_id: eventId,
    limit: "200",
  }, apiKey);
  const rows = [...first.data];
  const present = presentGameMarkets(rows);
  for (const market of NHL_GAME_MARKETS) {
    if (present.has(market)) continue;
    const fallback = await fetchSharpPage<SharpNhlOddsRow>("odds", {
      event_id: eventId,
      market_type: market,
      limit: "200",
    }, apiKey);
    rows.push(...fallback.data);
    log(`SharpAPI NHL event ${eventId}: recovered ${market} with ${fallback.data.length} rows`);
  }
  const unique = new Map<string, SharpNhlOddsRow>();
  for (const row of rows) {
    const key = row.id ?? [
      row.event_id,
      row.sportsbook,
      row.market_type,
      row.selection_type,
      row.selection,
      row.line,
      row.odds_american,
    ].join("|");
    unique.set(key, row);
  }
  return [...unique.values()];
}

/**
 * Fetch NHL splits for a date. Returns per-event nested moneyline /
 * spread / total objects. handle_pct often null on the books we see.
 */
export async function fetchSharpNhlSplits(
  date: string,
  apiKey: string,
): Promise<SharpNhlSplitsEvent[]> {
  const url = `${SHARP_API_BASE}/splits?league=nhl&date=${date}&limit=200`;
  const res = await fetch(url, { headers: { Authorization: `Bearer ${apiKey}` } });
  if (!res.ok) {
    throw new Error(`SharpAPI /splits NHL fetch failed: HTTP ${res.status}`);
  }
  const j = (await res.json()) as { data?: SharpNhlSplitsEvent[] };
  return j.data ?? [];
}

/**
 * Fetch NHL EV opportunities for a date. Used as the sharp-action
 * proxy since the dedicated /signals/sharp-action endpoint returns
 * 404 for NHL.
 */
export async function fetchSharpNhlOpportunities(
  date: string,
  apiKey: string,
): Promise<SharpNhlOpportunity[]> {
  const url = `${SHARP_API_BASE}/opportunities/ev?league=nhl&date=${date}&limit=200`;
  const res = await fetch(url, { headers: { Authorization: `Bearer ${apiKey}` } });
  if (!res.ok) {
    throw new Error(`SharpAPI /opportunities NHL fetch failed: HTTP ${res.status}`);
  }
  const j = (await res.json()) as { data?: SharpNhlOpportunity[] };
  return j.data ?? [];
}
