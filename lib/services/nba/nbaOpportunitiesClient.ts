/**
 * Phase 7B v0c-DE — NBA EV opportunities client.
 *
 * Fetches `/opportunities/ev?league=nba` from SharpAPI and exposes
 * the rows in a typed shape. The opportunities feed produces sharp-book
 * cross-referenced fair probabilities, EV percentages, market_width,
 * cross-book dispersion, stale-price warnings, and Kelly fractions —
 * all of which feed the NBA market-intelligence overlay.
 *
 * Read-only. No DB writes.
 */

const SHARP_API_BASE = "https://api.sharpapi.io/api/v1";

type OpportunityRowRaw = {
  id?: string;
  event_id?: string;
  event_name?: string;
  external_event_id?: string;
  away_team?: string;
  home_team?: string;
  sportsbook?: string;
  sharp_book?: string;
  market_type?: string;
  selection?: string;
  selection_type?: string;
  team_side?: string;
  display_selection?: string;
  line?: number | null;
  odds_american?: number | null;
  odds_decimal?: number | null;
  odds_probability?: number | null;
  no_vig_odds?: number | null;
  fair_probability?: number | null;
  partner_fair_probability?: number | null;
  ev_percentage?: number | null;
  kelly_percent?: number | null;
  confidence?: number | null;
  market_width?: number | null;
  cross_ref_count?: number | null;
  cross_ref_dispersion?: number | null;
  book_count?: number | null;
  start_time?: string;
  detected_at?: string;
  oldest_odds_age_seconds?: number | null;
  possibly_stale?: boolean;
  is_alternate_line?: boolean;
  is_live?: boolean;
  warnings?: string[] | null;
  devig_method?: string | null;
};

export type NbaOpportunity = {
  id: string;
  event_id: string;
  event_name: string | null;
  home_team: string | null;
  away_team: string | null;
  market_type: "moneyline" | "spread" | "total" | "other";
  side: "home" | "away" | "over" | "under" | "other";
  line: number | null;
  /** The sportsbook quoting the EV-positive price. */
  sportsbook: string | null;
  /** The sharp/reference book used to compute no-vig fair. */
  sharp_book: string | null;
  odds_american: number | null;
  no_vig_odds_american: number | null;
  fair_probability: number | null;
  ev_percentage: number | null;
  kelly_percent: number | null;
  confidence: number | null;
  market_width: number | null;
  cross_ref_count: number | null;
  cross_ref_dispersion: number | null;
  book_count: number | null;
  oldest_odds_age_seconds: number | null;
  possibly_stale: boolean;
  is_alternate_line: boolean;
  is_live: boolean;
  detected_at: string | null;
  warnings: string[];
  devig_method: string | null;
  /** Display selection, e.g. "San Antonio Spurs Under 107.5" (team total quirk). */
  display_selection: string | null;
};

function normalizeMarketType(raw: string | undefined): NbaOpportunity["market_type"] {
  if (!raw) return "other";
  const s = raw.toLowerCase();
  if (s.includes("quarter") || s.includes("half") || s.includes("period") || s.includes("1st_") || s.includes("2nd_")) return "other";
  if (s === "moneyline" || s === "ml" || s === "h2h") return "moneyline";
  if (s === "point_spread" || s === "spread" || s === "handicap" || s === "pointspread") return "spread";
  if (s === "total_points" || s === "total" || s === "ou" || s === "totalpoints") return "total";
  return "other";
}

function normalizeSide(
  raw: string | undefined,
  selection: string | undefined,
  market: NbaOpportunity["market_type"],
  homeTeam: string | null,
  awayTeam: string | null,
): NbaOpportunity["side"] {
  const r = (raw ?? "").toLowerCase();
  if (r === "home" || r === "away" || r === "over" || r === "under") return r;
  // Team-name match for moneyline/spread when selection_type is "other".
  if (selection && (market === "moneyline" || market === "spread")) {
    const sel = selection.toLowerCase();
    if (homeTeam !== null && sel.includes(homeTeam.toLowerCase())) return "home";
    if (awayTeam !== null && sel.includes(awayTeam.toLowerCase())) return "away";
    const homeShort = (homeTeam ?? "").split(/\s+/).pop()?.toLowerCase() ?? "";
    const awayShort = (awayTeam ?? "").split(/\s+/).pop()?.toLowerCase() ?? "";
    if (homeShort.length > 3 && sel.includes(homeShort)) return "home";
    if (awayShort.length > 3 && sel.includes(awayShort)) return "away";
  }
  if (selection && market === "total") {
    const sel = selection.toLowerCase();
    if (sel.includes("over")) return "over";
    if (sel.includes("under")) return "under";
  }
  return "other";
}

function asNumberOrNull(x: number | string | null | undefined): number | null {
  if (x === null || x === undefined || x === "") return null;
  const n = typeof x === "number" ? x : Number.parseFloat(x);
  return Number.isFinite(n) ? n : null;
}

export async function fetchNbaOpportunities(apiKey: string): Promise<NbaOpportunity[]> {
  const url = `${SHARP_API_BASE}/opportunities/ev?league=nba&per_page=100`;
  const res = await fetch(url, { headers: { Authorization: `Bearer ${apiKey}` } });
  if (!res.ok) {
    throw new Error(`SharpAPI /opportunities/ev?league=nba HTTP ${res.status}`);
  }
  const body = (await res.json().catch(() => null)) as { data?: OpportunityRowRaw[] } | null;
  const rows = body?.data ?? [];
  const out: NbaOpportunity[] = [];
  for (const r of rows) {
    const id = r.id ?? "";
    const eventId = r.event_id ?? "";
    if (id === "" || eventId === "") continue;
    const market = normalizeMarketType(r.market_type);
    const side = normalizeSide(r.team_side ?? r.selection_type, r.selection ?? r.display_selection, market, r.home_team ?? null, r.away_team ?? null);
    out.push({
      id,
      event_id: eventId,
      event_name: r.event_name ?? null,
      home_team: r.home_team ?? null,
      away_team: r.away_team ?? null,
      market_type: market,
      side,
      line: asNumberOrNull(r.line),
      sportsbook: r.sportsbook ?? null,
      sharp_book: r.sharp_book ?? null,
      odds_american: asNumberOrNull(r.odds_american),
      no_vig_odds_american: asNumberOrNull(r.no_vig_odds),
      fair_probability: asNumberOrNull(r.fair_probability) ?? asNumberOrNull(r.partner_fair_probability),
      ev_percentage: asNumberOrNull(r.ev_percentage),
      kelly_percent: asNumberOrNull(r.kelly_percent),
      confidence: asNumberOrNull(r.confidence),
      market_width: asNumberOrNull(r.market_width),
      cross_ref_count: asNumberOrNull(r.cross_ref_count),
      cross_ref_dispersion: asNumberOrNull(r.cross_ref_dispersion),
      book_count: asNumberOrNull(r.book_count),
      oldest_odds_age_seconds: asNumberOrNull(r.oldest_odds_age_seconds),
      possibly_stale: r.possibly_stale === true,
      is_alternate_line: r.is_alternate_line === true,
      is_live: r.is_live === true,
      detected_at: r.detected_at ?? null,
      warnings: Array.isArray(r.warnings) ? r.warnings : [],
      devig_method: r.devig_method ?? null,
      display_selection: r.display_selection ?? null,
    });
  }
  return out;
}

const NBA_ABBR_TO_NICKNAME: Record<string, string> = {
  ATL: "hawks", BOS: "celtics", BKN: "nets", CHA: "hornets",
  CHI: "bulls", CLE: "cavaliers", DAL: "mavericks", DEN: "nuggets",
  DET: "pistons", GSW: "warriors", HOU: "rockets", IND: "pacers",
  LAC: "clippers", LAL: "lakers", MEM: "grizzlies", MIA: "heat",
  MIL: "bucks", MIN: "timberwolves", NOP: "pelicans", NYK: "knicks",
  NY: "knicks", OKC: "thunder", ORL: "magic", PHI: "76ers",
  PHX: "suns", POR: "trail blazers", SAC: "kings", SAS: "spurs",
  SA: "spurs", TOR: "raptors", UTA: "jazz", WAS: "wizards",
};

function teamMatchKey(input: string): string {
  const upper = input.toUpperCase().trim();
  const nick = NBA_ABBR_TO_NICKNAME[upper];
  if (nick !== undefined) return nick;
  return input.toLowerCase().trim();
}

function teamRowKeys(name: string): string[] {
  const lower = name.toLowerCase().trim();
  if (lower === "") return [];
  const tokens = lower.split(/\s+/);
  const last = tokens.at(-1) ?? lower;
  return [lower, last];
}

/**
 * Filter opportunities to a given matchup. Robust to short abbreviations
 * (e.g. snapshot "NY" matches SharpAPI "New York Knicks" via nickname).
 */
export function matchOpportunitiesForGame(
  opps: NbaOpportunity[],
  homeName: string,
  awayName: string,
): NbaOpportunity[] {
  const homeKey = teamMatchKey(homeName);
  const awayKey = teamMatchKey(awayName);
  return opps.filter((o) => {
    if (o.is_alternate_line || o.is_live) return false;
    if (o.market_type === "other") return false;
    const sh = teamRowKeys(o.home_team ?? "");
    const sa = teamRowKeys(o.away_team ?? "");
    const homeHit = sh.includes(homeKey) || sh.some((x) => x.endsWith(` ${homeKey}`));
    const awayHit = sa.includes(awayKey) || sa.some((x) => x.endsWith(` ${awayKey}`));
    const homeHitS = sa.includes(homeKey) || sa.some((x) => x.endsWith(` ${homeKey}`));
    const awayHitS = sh.includes(awayKey) || sh.some((x) => x.endsWith(` ${awayKey}`));
    return (homeHit && awayHit) || (homeHitS && awayHitS);
  });
}
