/**
 * Phase 7B v0c-DE — NBA public-splits client.
 *
 * Fetches `/splits?league=nba` from SharpAPI and parses the consensus
 * splits row per event. Returns typed shape with bets_pct/handle_pct
 * for ML, spread, and total. NBA splits are CONSENSUS-only (single row
 * per game; no per-book splits available from SharpAPI).
 *
 * Caveats baked into the type:
 *   • Spread row's away_odds/home_odds are the LINE NUMBERS, not juice.
 *   • Total row has the line + over/under bets/handle.
 *   • Moneyline row has the actual American odds for each side.
 *   • Single "consensus" sportsbook; no per-book breakdown.
 *
 * Read-only. No DB writes. No external state.
 */

const SHARP_API_BASE = "https://api.sharpapi.io/api/v1";

/** Raw shape of the per-market sub-object in /splits row (best-effort). */
type SplitsMarketRaw = {
  bets_pct?: Record<string, number>;
  handle_pct?: Record<string, number>;
  line?: number | null;
  // Moneyline-specific
  home_odds?: number | null;
  away_odds?: number | null;
};

type SplitsRowRaw = {
  event_id?: string;
  sport?: string;
  league?: string;
  sportsbook?: string;
  away_team?: string;
  home_team?: string;
  spread?: SplitsMarketRaw;
  total?: SplitsMarketRaw;
  moneyline?: SplitsMarketRaw;
  fetched_at?: string;
};

export type NbaSplitsMl = {
  /** Consensus American odds for the home side. */
  home_odds_american: number | null;
  away_odds_american: number | null;
  bets_pct: { home: number; away: number } | null;
  handle_pct: { home: number; away: number } | null;
};

export type NbaSplitsSpread = {
  /** Spread number from the home perspective (negative = home favored). */
  home_line: number | null;
  bets_pct: { home: number; away: number } | null;
  handle_pct: { home: number; away: number } | null;
};

export type NbaSplitsTotal = {
  line: number | null;
  bets_pct: { over: number; under: number } | null;
  handle_pct: { over: number; under: number } | null;
};

export type NbaSplitsRow = {
  event_id: string;
  home_team: string;
  away_team: string;
  sportsbook: string;     // typically "consensus"
  fetched_at: string | null;
  ml: NbaSplitsMl | null;
  spread: NbaSplitsSpread | null;
  total: NbaSplitsTotal | null;
};

function asNumberOrNull(x: number | null | undefined): number | null {
  if (x === null || x === undefined) return null;
  const n = typeof x === "number" ? x : Number.parseFloat(String(x));
  return Number.isFinite(n) ? n : null;
}

function parseMl(raw: SplitsMarketRaw | undefined): NbaSplitsMl | null {
  if (raw === undefined) return null;
  const home = asNumberOrNull(raw.home_odds);
  const away = asNumberOrNull(raw.away_odds);
  const bets =
    raw.bets_pct !== undefined && typeof raw.bets_pct.home === "number" && typeof raw.bets_pct.away === "number"
      ? { home: raw.bets_pct.home, away: raw.bets_pct.away }
      : null;
  const handle =
    raw.handle_pct !== undefined && typeof raw.handle_pct.home === "number" && typeof raw.handle_pct.away === "number"
      ? { home: raw.handle_pct.home, away: raw.handle_pct.away }
      : null;
  if (home === null && away === null && bets === null && handle === null) return null;
  return { home_odds_american: home, away_odds_american: away, bets_pct: bets, handle_pct: handle };
}

function parseSpread(raw: SplitsMarketRaw | undefined): NbaSplitsSpread | null {
  if (raw === undefined) return null;
  // SharpAPI puts the SPREAD number in away_odds / home_odds (NOT the juice).
  // home_line is the negative-favored value (e.g. -1.5 = home -1.5).
  const homeLine = asNumberOrNull(raw.home_odds);
  const bets =
    raw.bets_pct !== undefined && typeof raw.bets_pct.home === "number" && typeof raw.bets_pct.away === "number"
      ? { home: raw.bets_pct.home, away: raw.bets_pct.away }
      : null;
  const handle =
    raw.handle_pct !== undefined && typeof raw.handle_pct.home === "number" && typeof raw.handle_pct.away === "number"
      ? { home: raw.handle_pct.home, away: raw.handle_pct.away }
      : null;
  if (homeLine === null && bets === null && handle === null) return null;
  return { home_line: homeLine, bets_pct: bets, handle_pct: handle };
}

function parseTotal(raw: SplitsMarketRaw | undefined): NbaSplitsTotal | null {
  if (raw === undefined) return null;
  const line = asNumberOrNull(raw.line);
  const bets =
    raw.bets_pct !== undefined && typeof raw.bets_pct.over === "number" && typeof raw.bets_pct.under === "number"
      ? { over: raw.bets_pct.over, under: raw.bets_pct.under }
      : null;
  const handle =
    raw.handle_pct !== undefined && typeof raw.handle_pct.over === "number" && typeof raw.handle_pct.under === "number"
      ? { over: raw.handle_pct.over, under: raw.handle_pct.under }
      : null;
  if (line === null && bets === null && handle === null) return null;
  return { line, bets_pct: bets, handle_pct: handle };
}

/**
 * Fetch all NBA /splits rows. Single page is usually enough — NBA has a
 * small slate per night. We page up to 100 rows defensively.
 */
export async function fetchNbaSplits(apiKey: string): Promise<NbaSplitsRow[]> {
  const url = `${SHARP_API_BASE}/splits?league=nba&per_page=100`;
  const res = await fetch(url, { headers: { Authorization: `Bearer ${apiKey}` } });
  if (!res.ok) {
    throw new Error(`SharpAPI /splits?league=nba HTTP ${res.status}`);
  }
  const body = (await res.json().catch(() => null)) as { data?: SplitsRowRaw[] } | null;
  const rows = body?.data ?? [];
  const out: NbaSplitsRow[] = [];
  for (const r of rows) {
    if (!r.event_id || !r.home_team || !r.away_team) continue;
    out.push({
      event_id: r.event_id,
      home_team: r.home_team,
      away_team: r.away_team,
      sportsbook: r.sportsbook ?? "consensus",
      fetched_at: r.fetched_at ?? null,
      ml: parseMl(r.moneyline),
      spread: parseSpread(r.spread),
      total: parseTotal(r.total),
    });
  }
  return out;
}

/**
 * Map abbreviation → team nickname (the last word of the city+team name).
 * Used so we can match a snapshot's abbreviation against SharpAPI's full
 * "City Team" naming (where simple substring on the abbrev fails because
 * the abbrev doesn't appear as a substring of the city — e.g. "NY" is
 * not in "new york knicks", but the nickname "knicks" IS).
 */
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
  // Prefer nickname lookup; fall back to lowercased raw token.
  const upper = input.toUpperCase().trim();
  const nick = NBA_ABBR_TO_NICKNAME[upper];
  if (nick !== undefined) return nick;
  return input.toLowerCase().trim();
}

function teamRowKeys(name: string): string[] {
  // Reduce a SharpAPI full team name like "New York Knicks" to a set of
  // candidate match keys: full lower string, last token, last 2 tokens.
  const lower = name.toLowerCase().trim();
  if (lower === "") return [];
  const tokens = lower.split(/\s+/);
  const last = tokens.at(-1) ?? lower;
  const lastTwo = tokens.length >= 2 ? `${tokens.at(-2)} ${last}` : last;
  return [lower, last, lastTwo];
}

/**
 * Match a splits row to a game by team-nickname overlap, robust to the
 * fact that the snapshot's `home_team.abbreviation` (e.g. "NY") does NOT
 * appear as a substring of the SharpAPI full team name "New York Knicks".
 */
export function matchSplitsRow(
  splits: NbaSplitsRow[],
  homeName: string,
  awayName: string,
): NbaSplitsRow | null {
  const homeKey = teamMatchKey(homeName);
  const awayKey = teamMatchKey(awayName);
  for (const s of splits) {
    const sh = teamRowKeys(s.home_team);
    const sa = teamRowKeys(s.away_team);
    const homeHit = sh.includes(homeKey) || sh.some((x) => x.endsWith(` ${homeKey}`));
    const awayHit = sa.includes(awayKey) || sa.some((x) => x.endsWith(` ${awayKey}`));
    if (homeHit && awayHit) return s;
    const homeHitS = sa.includes(homeKey) || sa.some((x) => x.endsWith(` ${homeKey}`));
    const awayHitS = sh.includes(awayKey) || sh.some((x) => x.endsWith(` ${awayKey}`));
    if (homeHitS && awayHitS) return s;
  }
  return null;
}
