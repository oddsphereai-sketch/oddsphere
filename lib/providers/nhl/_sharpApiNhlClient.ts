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

/**
 * Limit-paginated /odds fetch. Mirrors the NBA implementation: stop at
 * first non-200 OR when a page returns < limit rows. Returns whatever
 * rows were successfully fetched.
 */
export async function fetchSharpNhlOdds(
  date: string,
  apiKey: string,
  logger?: (msg: string) => void,
): Promise<SharpNhlOddsRow[]> {
  const log = logger ?? (() => {});
  const all: SharpNhlOddsRow[] = [];
  for (let offset = 0; offset < 1000; offset += 100) {
    const url = `${SHARP_API_BASE}/odds?league=nhl&date=${date}&limit=100&offset=${offset}`;
    const res = await fetch(url, { headers: { Authorization: `Bearer ${apiKey}` } });
    if (!res.ok) {
      log(`  ✗ /odds page offset=${offset} HTTP ${res.status}`);
      break;
    }
    const j = (await res.json()) as { data?: SharpNhlOddsRow[] };
    const items = j.data ?? [];
    all.push(...items);
    if (items.length < 100) break;
  }
  return all;
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
