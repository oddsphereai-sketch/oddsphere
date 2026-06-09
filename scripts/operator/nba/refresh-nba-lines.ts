/**
 * Phase 7B.1 — NBA odds/lines refresh from SharpAPI.
 *
 * Real, automated, idempotent. Fetches NBA market data from
 * SharpAPI `/odds?league=nba&date=YYYY-MM-DD` (limit-paginated),
 * matches each odds row to a `games` row (sport='nba') by team
 * abbreviation, and upserts into `lines`.
 *
 * Why inline (vs extending SharpAPIOddsProvider): the MLB provider
 * filters hard on `league === 'mlb'` and adding NBA support requires
 * a moderate refactor we don't need tonight. This operator uses a
 * minimal NBA-only fetch that respects the same MLB code path
 * (no shared state).
 *
 * Two-key write gate:
 *   • CLI flag: --apply
 *   • Env var:  NBA_LINES_DB_WRITES_ENABLED=true
 * Default: DRY-RUN.
 *
 * Scope:
 *   • Reads:  SharpAPI `/odds?league=nba`, our `games` + `teams` tables
 *             (lookup only, sport='nba').
 *   • Writes: `lines` (only rows where game_id is an NBA game).
 *             NEVER writes any other table; NEVER touches MLB rows.
 *
 * Examples:
 *   Dry-run for today:
 *     npx tsx --env-file=.env.local \
 *       scripts/operator/nba/refresh-nba-lines.ts --date 2026-06-08
 *
 *   Apply:
 *     NBA_LINES_DB_WRITES_ENABLED=true \
 *     npx tsx --env-file=.env.local \
 *       scripts/operator/nba/refresh-nba-lines.ts --date 2026-06-08 --apply
 */

import { supabase } from "../../../lib/db/supabase";
import { readBoolFlag, readStringFlag } from "../_cliCommon";

const NBA_LINES_WRITES_ENV = "NBA_LINES_DB_WRITES_ENABLED";
const SHARP_API_BASE = "https://api.sharpapi.io/api/v1";

type GameRow = {
  id: number;
  external_id: number;
  home_team_id: number | null;
  away_team_id: number | null;
  game_date: string;
};

type TeamRow = {
  id: number;
  display_name: string;
  abbreviation: string;
};

type SharpOddsRow = {
  event_id?: string;
  game_id?: number | string;
  sportsbook?: string;
  market?: string;
  market_type?: string;
  side?: string;
  selection_type?: string;
  selection?: string;
  outcome?: string;
  line?: number | string | null;
  line_value?: number | string | null;
  point?: number | string | null;
  price?: number | string | null;
  odds_american?: number | string | null;
  odds_decimal?: number | string | null;
  ev_percent?: number | string | null;
  fair_odds?: number | string | null;
  home_team?: string;
  away_team?: string;
  league?: string;
  sport?: string;
  is_main_line?: boolean;
  is_alternate_line?: boolean;
  last_seen_at?: string;
  wire_received_at?: string;
};

function asNumberOrNull(x: number | string | null | undefined): number | null {
  if (x === null || x === undefined || x === "") return null;
  const n = typeof x === "number" ? x : Number.parseFloat(x);
  return Number.isFinite(n) ? n : null;
}

function normalizeMarket(raw: string | undefined): "moneyline" | "spread" | "total" | null {
  if (!raw) return null;
  const s = raw.toLowerCase();
  // Exclude period/quarter sub-markets explicitly — they all contain
  // "quarter" or "half" or "period" or numeric prefixes like "1st_".
  if (/\b(quarter|half|period|1st_|2nd_|3rd_|4th_)/.test(s)) return null;
  // SharpAPI NBA uses "total_points" not "total"; "point_spread" not "spread".
  if (s === "moneyline" || s === "ml" || s === "h2h") return "moneyline";
  if (s === "point_spread" || s === "pointspread" || s === "spread" || s === "handicap") return "spread";
  if (s === "total_points" || s === "totalpoints" || s === "total" || s === "ou" || s === "overunder") return "total";
  return null;
}

function normalizeSide(
  rawSide: string | undefined,
  selection: string | undefined,
  homeTeam: string,
  awayTeam: string,
): "home" | "away" | "over" | "under" | null {
  // First try the explicit selection_type when SharpAPI gives us one.
  const s = (rawSide ?? "").toLowerCase();
  if (s === "home" || s === "away" || s === "over" || s === "under") return s;
  // Some SharpAPI NBA moneyline rows use selection_type="other" and put
  // the team name in the `selection` string. Match the selection text
  // against home/away team names.
  if (selection !== undefined && selection !== null) {
    const sel = selection.toLowerCase();
    const home = homeTeam.toLowerCase();
    const away = awayTeam.toLowerCase();
    // Look for team-name overlap. Use the most-specific match available
    // (e.g. "Knicks" within "New York Knicks").
    const homeShort = home.split(/\s+/).pop() ?? home;
    const awayShort = away.split(/\s+/).pop() ?? away;
    if (sel.includes(home) || (homeShort.length > 3 && sel.includes(homeShort))) return "home";
    if (sel.includes(away) || (awayShort.length > 3 && sel.includes(awayShort))) return "away";
  }
  return null;
}

function americanFromDecimal(decimal: number | null): number | null {
  if (decimal === null || decimal <= 1) return null;
  if (decimal >= 2) return Math.round((decimal - 1) * 100);
  return Math.round(-100 / (decimal - 1));
}

function decimalFromAmerican(american: number | null): number | null {
  if (american === null || american === 0) return null;
  if (american > 0) return 1 + american / 100;
  return 1 + 100 / Math.abs(american);
}

function impliedProbability(american: number | null): number | null {
  if (american === null || american === 0) return null;
  if (american > 0) return 100 / (american + 100);
  return Math.abs(american) / (Math.abs(american) + 100);
}

async function fetchNbaOddsPaginated(
  date: string,
  apiKey: string,
): Promise<SharpOddsRow[]> {
  const all: SharpOddsRow[] = [];
  for (let offset = 0; offset < 1000; offset += 100) {
    const url = `${SHARP_API_BASE}/odds?league=nba&date=${date}&limit=100&offset=${offset}`;
    const res = await fetch(url, { headers: { Authorization: `Bearer ${apiKey}` } });
    if (!res.ok) {
      console.log(`  ✗ /odds page offset=${offset} HTTP ${res.status}`);
      break;
    }
    const j = (await res.json()) as { data?: SharpOddsRow[] };
    const items = j.data ?? [];
    all.push(...items);
    if (items.length < 100) break;
  }
  return all;
}

async function loadNbaGamesForDate(date: string): Promise<GameRow[]> {
  const start = `${date}T00:00:00Z`;
  const end = `${date}T23:59:59Z`;
  const { data, error } = await supabase
    .from("games")
    .select("id, external_id, home_team_id, away_team_id, game_date")
    .eq("sport", "nba")
    .gte("game_date", start)
    .lte("game_date", end);
  if (error !== null) throw new Error(`load NBA games failed: ${error.message}`);
  return ((data as unknown) ?? []) as GameRow[];
}

async function loadNbaTeams(): Promise<TeamRow[]> {
  const { data, error } = await supabase
    .from("teams")
    .select("id, display_name, abbreviation")
    .eq("sport", "nba");
  if (error !== null) throw new Error(`load NBA teams failed: ${error.message}`);
  return ((data as unknown) ?? []) as TeamRow[];
}

function matchGame(
  homeTeamName: string,
  awayTeamName: string,
  games: GameRow[],
  teamById: Map<number, TeamRow>,
): GameRow | null {
  const homeLower = homeTeamName.toLowerCase();
  const awayLower = awayTeamName.toLowerCase();
  for (const g of games) {
    const home = g.home_team_id !== null ? teamById.get(g.home_team_id) : undefined;
    const away = g.away_team_id !== null ? teamById.get(g.away_team_id) : undefined;
    if (!home || !away) continue;
    const homeMatches =
      home.display_name.toLowerCase().includes(homeLower) ||
      homeLower.includes(home.display_name.toLowerCase());
    const awayMatches =
      away.display_name.toLowerCase().includes(awayLower) ||
      awayLower.includes(away.display_name.toLowerCase());
    if (homeMatches && awayMatches) return g;
  }
  return null;
}

type LineUpsertPayload = {
  game_id: number;
  market_type: string;
  player_id: null;
  sportsbook: string;
  side: string;
  line_value: number | null;
  odds_american: number | null;
  odds_decimal: number | null;
  implied_probability: number | null;
  ev_percent: number | null;
  fair_odds: number | null;
};

type LineHistoryPayload = {
  game_id: number;
  market_type: string;
  player_id: null;
  sportsbook: string;
  side: string;
  line_value: number | null;
  odds_american: number | null;
  is_opener: false;
  recorded_at: string;
};

function buildLinePayload(
  row: SharpOddsRow,
  gameId: number,
  market: "moneyline" | "spread" | "total",
  side: "home" | "away" | "over" | "under",
): LineUpsertPayload | null {
  const sportsbook = (row.sportsbook ?? "").toLowerCase();
  if (sportsbook === "") return null;
  const american =
    asNumberOrNull(row.odds_american) ??
    americanFromDecimal(asNumberOrNull(row.odds_decimal) ?? asNumberOrNull(row.price));
  const decimal =
    asNumberOrNull(row.odds_decimal) ??
    asNumberOrNull(row.price) ??
    decimalFromAmerican(american);
  const lineValue =
    asNumberOrNull(row.line_value) ??
    asNumberOrNull(row.line) ??
    asNumberOrNull(row.point);
  const implied = impliedProbability(american);
  return {
    game_id: gameId,
    market_type: market,
    player_id: null,
    sportsbook,
    side,
    line_value: lineValue,
    odds_american: american,
    odds_decimal: decimal,
    implied_probability: implied,
    ev_percent: asNumberOrNull(row.ev_percent),
    fair_odds: asNumberOrNull(row.fair_odds),
  };
}

async function main(): Promise<void> {
  const argv = process.argv.slice(2);
  const date = readStringFlag(argv, "--date");
  if (!date || !/^\d{4}-\d{2}-\d{2}$/.test(date)) {
    console.error("✗ --date YYYY-MM-DD required");
    process.exit(1);
  }
  const apply = readBoolFlag(argv, "--apply");
  const sharpKey = process.env.SHARPAPI_KEY;
  if (!sharpKey) {
    console.error("✗ SHARPAPI_KEY missing from env");
    process.exit(1);
  }

  let write = false;
  if (apply) {
    if (process.env[NBA_LINES_WRITES_ENV] !== "true") {
      console.error(
        `✗ --apply requires ${NBA_LINES_WRITES_ENV}=true in the env (two-key gate).`,
      );
      process.exit(1);
    }
    write = true;
  }

  console.log(`[nba-refresh-lines] mode=${write ? "WRITE" : "DRY-RUN"}  date=${date}`);
  console.log("─".repeat(70));

  const games = await loadNbaGamesForDate(date);
  console.log(`NBA games on ${date}: ${games.length}`);
  if (games.length === 0) {
    console.log("(no NBA games in DB for this date; run seed-nba-finals.ts first)");
    return;
  }
  const teams = await loadNbaTeams();
  const teamById = new Map<number, TeamRow>(teams.map((t) => [t.id, t]));

  const oddsRows = await fetchNbaOddsPaginated(date, sharpKey);
  console.log(`SharpAPI /odds rows fetched: ${oddsRows.length}`);

  let matched = 0;
  let unmatched = 0;
  let parsed = 0;
  let written = 0;
  let errors = 0;
  const payloads: LineUpsertPayload[] = [];

  for (const r of oddsRows) {
    const home = r.home_team;
    const away = r.away_team;
    if (!home || !away) {
      unmatched++;
      continue;
    }
    const g = matchGame(home, away, games, teamById);
    if (g === null) {
      unmatched++;
      continue;
    }
    matched++;
    // Skip alternate-line + non-main-line rows.
    if (r.is_alternate_line === true) continue;
    if (r.is_main_line === false) continue;
    const market = normalizeMarket(r.market ?? r.market_type);
    const side = normalizeSide(
      r.side ?? r.selection_type ?? r.outcome,
      r.selection,
      home,
      away,
    );
    if (market === null || side === null) continue;
    // Validate side/market consistency:
    if ((market === "moneyline" || market === "spread") && side !== "home" && side !== "away") continue;
    if (market === "total" && side !== "over" && side !== "under") continue;
    const payload = buildLinePayload(r, g.id, market, side);
    if (payload === null) continue;
    parsed++;
    payloads.push(payload);
  }

  console.log(
    `\nProcessed: matched=${matched} unmatched=${unmatched} parsed=${parsed}`,
  );

  if (!write) {
    console.log(`\n[dry-run] would upsert ${payloads.length} lines row(s)`);
    // Show a sample
    for (const p of payloads.slice(0, 6)) {
      console.log(
        `    game_id=${p.game_id} ${p.market_type}/${p.side} book=${p.sportsbook} line=${p.line_value} odds=${p.odds_american}`,
      );
    }
    if (payloads.length > 6) console.log(`    … and ${payloads.length - 6} more`);
    return;
  }

  // Apply: upsert one row at a time. The `lines` table doesn't have a
  // unique constraint we can rely on for upsert; we INSERT and dedupe
  // logically via (game_id, market_type, sportsbook, side, line_value).
  // For safety we delete existing rows for the game/market/sportsbook
  // before re-inserting — this matches the MLB linesService pattern.
  console.log(`\nApplying ${payloads.length} rows…`);
  // Group by (game_id, market_type, sportsbook) for atomic refresh.
  const groups = new Map<string, LineUpsertPayload[]>();
  for (const p of payloads) {
    const k = `${p.game_id}|${p.market_type}|${p.sportsbook}`;
    const arr = groups.get(k) ?? [];
    arr.push(p);
    groups.set(k, arr);
  }
  for (const [key, group] of groups) {
    const [gameIdStr, market, book] = key.split("|");
    const gameId = Number.parseInt(gameIdStr, 10);
    // Delete existing rows for this triplet (player_id IS NULL for game lines).
    const { error: delErr } = await supabase
      .from("lines")
      .delete()
      .eq("game_id", gameId)
      .eq("market_type", market)
      .eq("sportsbook", book)
      .is("player_id", null);
    if (delErr) {
      console.log(`  ✗ delete existing ${key}: ${delErr.message}`);
      errors++;
      continue;
    }
    const { error: insErr } = await supabase.from("lines").insert(group);
    if (insErr) {
      console.log(`  ✗ insert ${key}: ${insErr.message}`);
      errors += group.length;
      continue;
    }
    written += group.length;
  }

  // ── line_history bootstrap (Phase v0c-DE) ─────────────────────────
  // Append-only intraday snapshots so we can show first-observed → current
  // movement on subsequent refreshes. is_opener=false always — SharpAPI
  // does not provide a true opener and we never fake one.
  const nowIso = new Date().toISOString();
  const historyRows: LineHistoryPayload[] = payloads.map((p) => ({
    game_id: p.game_id,
    market_type: p.market_type,
    player_id: null,
    sportsbook: p.sportsbook,
    side: p.side,
    line_value: p.line_value,
    odds_american: p.odds_american,
    is_opener: false,
    recorded_at: nowIso,
  }));
  let historyWritten = 0;
  if (historyRows.length > 0) {
    const { error: histErr } = await supabase.from("line_history").insert(historyRows);
    if (histErr) {
      console.log(`  ✗ line_history insert: ${histErr.message}`);
      errors += historyRows.length;
    } else {
      historyWritten = historyRows.length;
    }
  }

  console.log(`\n─${"─".repeat(70)}`);
  console.log(
    `${write ? "WRITE" : "DRY-RUN"} complete: ${written} lines written, ` +
      `${historyWritten} line_history snapshots appended, ${errors} errors.`,
  );
}

main().catch((e) => {
  console.error("Fatal:", e);
  process.exit(1);
});
