/**
 * Phase 7B.0 — Basketball Reference (BBR) HTML team-ratings scraper.
 *
 * Source: https://www.basketball-reference.com/leagues/NBA_<YYYY>.html
 *         https://www.basketball-reference.com/playoffs/NBA_<YYYY>.html
 *
 * What we extract: team-level advanced ratings — ORtg, DRtg, NetRtg,
 * Pace — from BBR's per-possession team tables. These are the canonical
 * "industry standard" advanced metrics; BBR computes them from per-game
 * box scores and is the most reliable public source we have access to.
 *
 * Compliance:
 *   • robots.txt allows `/leagues/NBA_*.html` and `/playoffs/NBA_*.html`
 *     for User-agent: * (audited 2026-06-08; BBR's Disallow list does
 *     NOT include these paths).
 *   • robots.txt requires `Crawl-delay: 3` — this client enforces a
 *     minimum 3000ms delay between any two HTTP requests via the shared
 *     `lastFetchAt` module-level state.
 *   • User-Agent is `OddsphereAI/1.0 (admin-internal NBA Finals v0)` —
 *     identifies us; not impersonating a search-engine bot.
 *   • Single fetch per page per scrape; caller-side caching encouraged.
 *
 * Defensive parsing:
 *   • BBR table structure is stable but not contractual. We locate the
 *     `per_poss-team` table by its `<table id="per_poss-team">` marker,
 *     then read columns by their `data-stat` attribute (which has been
 *     stable for ~15 years on BBR).
 *   • Missing columns / malformed rows → null. Caller decides whether
 *     absence is fatal (we treat "no ratings" as a fallback-tier signal
 *     in the model, not an error).
 *   • Anti-scrape canary: if BBR ever 4xx/5xx, returns empty array and
 *     logs to console; caller continues with empty ratings.
 *
 * Scope: this scraper extracts TEAM-level ratings only. Per-player or
 * per-game data is explicitly Disallow'd by BBR for User-agent: * and
 * we do not request it.
 */

const BBR_BASE = "https://www.basketball-reference.com";

const HEADERS = {
  "User-Agent":
    "OddsphereAI/1.0 (admin-internal NBA Finals v0; +ops@oddsphereai.com)",
  Accept: "text/html",
  "Accept-Language": "en-US,en;q=0.9",
} as const;

const BBR_CRAWL_DELAY_MS = 3000;

let lastFetchAt = 0;

async function respectCrawlDelay(): Promise<void> {
  const since = Date.now() - lastFetchAt;
  if (since < BBR_CRAWL_DELAY_MS) {
    await new Promise<void>((r) => setTimeout(r, BBR_CRAWL_DELAY_MS - since));
  }
  lastFetchAt = Date.now();
}

/**
 * Canonical per-team advanced ratings, sourced 1:1 from BBR's `per_poss`
 * team table. All fields nullable — a malformed row returns nulls but
 * still emits the team identifier so callers can correlate with our
 * `teams.abbreviation` field.
 */
export type BbrTeamRatings = {
  /** BBR-canonical team name, e.g. "New York Knicks". */
  team_name: string;
  /** Three-letter BBR abbreviation, e.g. "NYK", "SAS". Used to match teams.abbreviation. */
  abbreviation: string;
  /** Offensive rating: points produced per 100 possessions. League avg ~115. */
  off_rating: number | null;
  /** Defensive rating: points allowed per 100 possessions. */
  def_rating: number | null;
  /** Net rating = ORtg - DRtg. Convenience field; derived if not present in row. */
  net_rating: number | null;
  /** Pace: possessions per 48 minutes. League avg ~99. */
  pace: number | null;
  /** Source URL the row was scraped from (for provenance). */
  source_url: string;
  /** ISO timestamp of when the scrape ran. */
  fetched_at: string;
};

export type BbrFetchResult = {
  status: "ok" | "http_error" | "parse_error" | "no_data";
  http_status?: number;
  rows: BbrTeamRatings[];
  notes?: string;
};

/**
 * Map BBR's three-letter abbreviations to ESPN's where they differ.
 * BBR uses some abbreviations that don't match ESPN; e.g. BBR uses
 * "BRK" for Brooklyn while ESPN uses "BKN". Caller can map either way
 * via this table when joining BBR data to our `teams` rows (which were
 * seeded from ESPN/BDL).
 */
export const BBR_TO_ESPN_ABBR: Record<string, string> = {
  BRK: "BKN", // Brooklyn Nets
  CHO: "CHA", // Charlotte Hornets
  PHO: "PHX", // Phoenix Suns
  // BBR uses standard abbreviations for all other 27 teams.
};

/**
 * Normalize a BBR abbreviation to the ESPN form we use in `teams.abbreviation`.
 * Pass-through for any abbreviation not in the override table.
 */
export function normalizeBbrAbbr(bbrAbbr: string): string {
  return BBR_TO_ESPN_ABBR[bbrAbbr] ?? bbrAbbr;
}

/** Strip HTML comments (BBR wraps some tables in <!-- ... --> for caching). */
function stripComments(html: string): string {
  return html.replace(/<!--/g, "").replace(/-->/g, "");
}

/**
 * Locate a table by its `id` attribute and return its inner HTML.
 * Returns null if the table isn't found.
 */
function extractTableById(html: string, tableId: string): string | null {
  // Match: <table ... id="tableId" ...>...</table>
  const escaped = tableId.replace(/[-/\\^$*+?.()|[\]{}]/g, "\\$&");
  const re = new RegExp(
    `<table[^>]*\\bid=["']${escaped}["'][\\s\\S]*?</table>`,
    "i",
  );
  const match = html.match(re);
  return match ? match[0] : null;
}

/**
 * Parse a BBR table's `<tbody>` rows by data-stat attributes.
 * Returns an array of {dataStat: value} maps, one per row.
 */
function parseTableRows(tableHtml: string): Array<Record<string, string>> {
  // Extract <tbody>...</tbody>
  const tbodyMatch = tableHtml.match(/<tbody[\s\S]*?<\/tbody>/i);
  if (!tbodyMatch) return [];
  const tbody = tbodyMatch[0];
  // Each row: <tr>...</tr>
  const rows: Array<Record<string, string>> = [];
  const rowRe = /<tr[\s\S]*?<\/tr>/gi;
  const trMatches = tbody.match(rowRe) ?? [];
  for (const tr of trMatches) {
    // Skip header / class="thead" separator rows.
    if (/class=["'][^"']*thead/i.test(tr)) continue;
    const row: Record<string, string> = {};
    const cellRe = /<(th|td)[^>]*\bdata-stat=["']([^"']+)["'][^>]*>([\s\S]*?)<\/\1>/gi;
    let m: RegExpExecArray | null;
    while ((m = cellRe.exec(tr)) !== null) {
      const stat = m[2];
      // Strip nested HTML tags to get the text content.
      const raw = m[3].replace(/<[^>]*>/g, "").replace(/&nbsp;/g, " ").trim();
      row[stat] = raw;
    }
    if (Object.keys(row).length > 0) rows.push(row);
  }
  return rows;
}

function toNumberOrNull(s: string | undefined): number | null {
  if (s === undefined || s === "") return null;
  const n = Number.parseFloat(s);
  return Number.isFinite(n) ? n : null;
}

/**
 * Fetch + parse the season-wide advanced team table for the given season
 * (e.g. season=2026 → /leagues/NBA_2026.html). Returns one BbrTeamRatings
 * per team. Honors BBR Crawl-delay.
 */
export async function fetchBbrSeasonTeamRatings(
  season: number,
): Promise<BbrFetchResult> {
  await respectCrawlDelay();
  const url = `${BBR_BASE}/leagues/NBA_${season}.html`;
  let res: Response;
  try {
    res = await fetch(url, { headers: HEADERS });
  } catch (e) {
    return {
      status: "http_error",
      rows: [],
      notes: `network error: ${(e as Error).message}`,
    };
  }
  if (!res.ok) {
    return { status: "http_error", http_status: res.status, rows: [] };
  }
  const html = await res.text();
  const fetchedAt = new Date().toISOString();
  return parseAdvancedTable(html, url, fetchedAt);
}

/**
 * Fetch + parse the postseason team-ratings table for the given playoffs
 * year (e.g. /playoffs/NBA_2026.html). Smaller sample; intended as a
 * playoff-specific overlay when available.
 */
export async function fetchBbrPlayoffTeamRatings(
  year: number,
): Promise<BbrFetchResult> {
  await respectCrawlDelay();
  const url = `${BBR_BASE}/playoffs/NBA_${year}.html`;
  let res: Response;
  try {
    res = await fetch(url, { headers: HEADERS });
  } catch (e) {
    return {
      status: "http_error",
      rows: [],
      notes: `network error: ${(e as Error).message}`,
    };
  }
  if (!res.ok) {
    return { status: "http_error", http_status: res.status, rows: [] };
  }
  const html = await res.text();
  const fetchedAt = new Date().toISOString();
  return parseAdvancedTable(html, url, fetchedAt);
}

/**
 * Pure parser. Exported so tests can feed in fixture HTML without
 * hitting the network.
 *
 * Strategy: BBR's `per_poss-team` table exposes ORtg/DRtg/Pace via
 * data-stat attributes `off_rtg`, `def_rtg`, `pace`. Some season pages
 * also have a `net_rtg` column; when absent we derive ORtg - DRtg.
 * Team name comes from data-stat="team" cell content.
 */
export function parseAdvancedTable(
  html: string,
  sourceUrl: string,
  fetchedAt: string,
): BbrFetchResult {
  // BBR caches some tables inside HTML comments. Strip them so our regex
  // finds the actual table markup.
  const cleaned = stripComments(html);
  // The per-possession team table — primary source for ORtg/DRtg/Pace.
  // Falls back to a couple of candidate IDs since BBR has historically
  // varied between `per_poss-team`, `team-stats-per_poss`, and similar.
  // Order matters: `advanced-team` is the canonical source for
  // ORtg/DRtg/Net/Pace (verified live 2026-06-08). The per-possession
  // table doesn't expose ratings — it exposes scoring/rebounding/etc.
  const candidateIds = [
    "advanced-team",
    "team_misc",
    "per_poss-team",
    "team-stats-per_poss",
  ];
  let tableHtml: string | null = null;
  let usedId: string | null = null;
  for (const id of candidateIds) {
    const t = extractTableById(cleaned, id);
    if (t !== null) {
      tableHtml = t;
      usedId = id;
      break;
    }
  }
  if (tableHtml === null) {
    return {
      status: "no_data",
      rows: [],
      notes: `no candidate table found (tried ${candidateIds.join(", ")})`,
    };
  }
  const rawRows = parseTableRows(tableHtml);
  const out: BbrTeamRatings[] = [];
  for (const r of rawRows) {
    const teamRaw = r["team"] ?? r["team_name"] ?? "";
    if (teamRaw === "" || teamRaw === "League Average") continue;
    // BBR sometimes appends "*" to playoff teams; strip it.
    const teamName = teamRaw.replace(/\*+$/, "").trim();
    const abbr = inferAbbreviationFromTeamName(teamName);
    const off = toNumberOrNull(r["off_rtg"] ?? r["o_rtg"] ?? r["off_rating"]);
    const def = toNumberOrNull(r["def_rtg"] ?? r["d_rtg"] ?? r["def_rating"]);
    const net =
      toNumberOrNull(r["net_rtg"] ?? r["n_rtg"]) ??
      (off !== null && def !== null ? Math.round((off - def) * 10) / 10 : null);
    const pace = toNumberOrNull(r["pace"]);
    out.push({
      team_name: teamName,
      abbreviation: abbr,
      off_rating: off,
      def_rating: def,
      net_rating: net,
      pace,
      source_url: sourceUrl,
      fetched_at: fetchedAt,
    });
  }
  if (out.length === 0) {
    return {
      status: "no_data",
      rows: [],
      notes: `table id="${usedId}" found but no parseable rows`,
    };
  }
  return { status: "ok", rows: out };
}

/**
 * Best-effort abbreviation inference from BBR's team-name strings.
 * Covers the 30 current NBA teams. Falls back to the first three
 * letters if a name isn't matched.
 */
const TEAM_NAME_TO_ABBR: Record<string, string> = {
  "Atlanta Hawks": "ATL",
  "Boston Celtics": "BOS",
  "Brooklyn Nets": "BKN",
  "Charlotte Hornets": "CHA",
  "Chicago Bulls": "CHI",
  "Cleveland Cavaliers": "CLE",
  "Dallas Mavericks": "DAL",
  "Denver Nuggets": "DEN",
  "Detroit Pistons": "DET",
  "Golden State Warriors": "GSW",
  "Houston Rockets": "HOU",
  "Indiana Pacers": "IND",
  "Los Angeles Clippers": "LAC",
  "Los Angeles Lakers": "LAL",
  "Memphis Grizzlies": "MEM",
  "Miami Heat": "MIA",
  "Milwaukee Bucks": "MIL",
  "Minnesota Timberwolves": "MIN",
  "New Orleans Pelicans": "NOP",
  "New York Knicks": "NY",
  "Oklahoma City Thunder": "OKC",
  "Orlando Magic": "ORL",
  "Philadelphia 76ers": "PHI",
  "Phoenix Suns": "PHX",
  "Portland Trail Blazers": "POR",
  "Sacramento Kings": "SAC",
  "San Antonio Spurs": "SA",
  "Toronto Raptors": "TOR",
  "Utah Jazz": "UTA",
  "Washington Wizards": "WAS",
};

function inferAbbreviationFromTeamName(name: string): string {
  return TEAM_NAME_TO_ABBR[name] ?? name.slice(0, 3).toUpperCase();
}
