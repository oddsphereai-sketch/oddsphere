/**
 * Phase 7L Phase 2 — NHL feature snapshot.
 *
 * Reads the previously-ingested NHL data (games row + team_stats +
 * goalie_stats + lines) and assembles the FeatureSnapshot the model
 * consumes. Pure aggregation; no fetching or DB writes here.
 *
 * Inputs (all read-only):
 *   • games row (sport='nhl', slate_date)
 *   • teams rows (home + away)
 *   • nhl_team_stats rows (playoffs + regular for both teams)
 *   • nhl_goalie_stats rows (selected by manual override OR best-by-GP
 *     fallback per team)
 *   • lines rows (moneyline + total for the game) — for market layer
 *
 * Manual goalie override: callers pass home/away player_external_ids.
 * If unset, fallback selects the goalie with the most games_played
 * for that team in the requested season+season_type.
 */

import { supabase } from "../../db/supabase";
import { isBlockedSportsbook } from "../../config/blockedSportsbooks";
import type { NhlFeatureSnapshot, NhlModelTeam } from "../../automodel/nhlRegularModelV1";
import type { BdlNhlTeamMetrics } from "../../providers/nhl/_ballDontLieNhlClient";
import type { NhlCalibratedTeamState } from "../../automodel/nhlRegularPriors2026";
import type { NhlOpponentAdjustedState } from "../../automodel/nhlOpponentAdjustedState2026";
export {
  nhlGameTypeFromExternalId,
  nhlSeasonStartYearFromExternalId,
} from "./nhlScheduleIdentity";
import {
  nhlGameTypeFromExternalId,
  nhlSeasonStartYearFromExternalId,
} from "./nhlScheduleIdentity";
import { fetchNhlScheduleForDate } from "../../providers/nhl/_nhlApiClient";
import { canonicalizeNhlLineRows } from "./nhlLineBoard";

export type BuildSnapshotOptions = {
  /** games.id (sport='nhl'). */
  gameId: number;
  /** MoneyPuck start-year (2025 for 2025-26 playoffs). */
  season?: number;
  /** Manual goalie overrides — player_external_id from nhl_goalie_stats. */
  homeGoalieExternalId?: number;
  awayGoalieExternalId?: number;
  providerMetricsByTeam?: ReadonlyMap<string, BdlNhlTeamMetrics>;
  providerFeatureSeason?: number | null;
  calibratedStateByTeam?: ReadonlyMap<string, NhlCalibratedTeamState>;
  opponentAdjustedStateByTeam?: ReadonlyMap<string, NhlOpponentAdjustedState>;
  marketEvidence?: {
    mlHomeBetsPct?: number | null;
    mlHomeMoneyPct?: number | null;
    totalOverBetsPct?: number | null;
    totalOverMoneyPct?: number | null;
    mlSplitSource?: "playbook" | "sharpapi" | null;
    mlSplitConfidence?: "high" | "medium" | "low" | "none";
    totalSplitSource?: "playbook" | "sharpapi" | null;
    totalSplitConfidence?: "high" | "medium" | "low" | "none";
  };
  logger?: (msg: string) => void;
};

type DbGameRow = {
  id: number;
  external_id: number;
  sport: string;
  home_team_id: number | null;
  away_team_id: number | null;
  game_date: string;
  slate_date: string;
  status: string;
};

type DbTeamRow = { id: number; abbreviation: string };

type DbTeamStatsRow = {
  team_id: number;
  season: number;
  season_type: "regular" | "playoffs";
  situation: "all" | "5on5" | "4on5" | "5on4" | "other";
  games_played: number | null;
  ice_time: number | null;
  xgoals_pct: number | null;
  x_goals_for: number | null;
  x_goals_against: number | null;
};

type DbGoalieStatsRow = {
  player_external_id: number;
  player_name: string;
  team_abbr: string;
  season: number;
  season_type: "regular" | "playoffs";
  situation: "all" | "5on5" | "4on5" | "5on4" | "other";
  games_played: number | null;
  ice_time: number | null;
  x_goals: number | null;
  goals: number | null;
};

type DbLineRow = {
  market_type: string;
  sportsbook: string;
  side: string;
  line_value: number | null;
  odds_american: number | null;
  implied_probability: number | null;
  observed_at?: string | null;
};

/**
 * Pick the team-stats row most representative of the team for the
 * model: prefer playoffs/all, fall back to regular/all.
 */
function pickSituationStats(
  rows: DbTeamStatsRow[],
  situation: "all" | "5on5" | "5on4" | "4on5",
  season: number,
  gameType: 1 | 2 | 3,
): DbTeamStatsRow | null {
  const order = gameType === 3
    ? [[season, "playoffs"], [season, "regular"], [season - 1, "regular"]] as const
    : [[season, "regular"], [season - 1, "regular"]] as const;
  for (const [candidateSeason, seasonType] of order) {
    const found = rows.find((row) => (
      row.season === candidateSeason && row.season_type === seasonType && row.situation === situation
    ));
    if (found) return found;
  }
  return null;
}

/**
 * Compute xG-for-per-60 from raw xG totals and ice_time (in seconds).
 * MoneyPuck "iceTime" is per-team total ice-time in seconds, so per-60
 * = xG / (ice_time / 3600).
 */
function per60(value: number | null, iceTimeSeconds: number | null): number | null {
  if (value === null || iceTimeSeconds === null || iceTimeSeconds <= 0) return null;
  return value / (iceTimeSeconds / 3600);
}

function perGame(value: number | null, gamesPlayed: number | null): number | null {
  if (value === null || gamesPlayed === null || gamesPlayed <= 0) return null;
  return value / gamesPlayed;
}

/**
 * Pick the best goalie row when no manual override is set: most
 * games_played in playoffs for that team's abbreviation. Falls back to
 * regular if no playoff row.
 */
function selectGoalieByDefault(
  rows: DbGoalieStatsRow[],
  teamAbbr: string,
  season: number,
  gameType: 1 | 2 | 3,
): DbGoalieStatsRow | null {
  const order = gameType === 3
    ? [[season, "playoffs"], [season, "regular"], [season - 1, "regular"]] as const
    : [[season, "regular"], [season - 1, "regular"]] as const;
  for (const [candidateSeason, seasonType] of order) {
    const candidates = rows
      .filter((row) => row.team_abbr === teamAbbr && row.season === candidateSeason && row.season_type === seasonType && row.situation === "all")
      .sort((a, b) => (b.games_played ?? 0) - (a.games_played ?? 0));
    if (candidates[0]) return candidates[0];
  }
  return null;
}

function selectGoalieByOverride(
  rows: DbGoalieStatsRow[],
  externalId: number,
): DbGoalieStatsRow | null {
  return rows.find(
    (r) => r.player_external_id === externalId && r.situation === "all" &&
      (r.season_type === "playoffs" || r.season_type === "regular"),
  ) ?? null;
}

function goalieXgsaaPer60(g: DbGoalieStatsRow | null): number | null {
  if (g === null || g.x_goals === null || g.goals === null) return null;
  const saved = g.x_goals - g.goals; // positive = saved more than expected
  return per60(saved, g.ice_time);
}

function americanToImplied(american: number | null): number | null {
  if (american === null || american === 0) return null;
  return american > 0 ? 100 / (american + 100) : -american / (-american + 100);
}

function pickMlImpliedProbHome(lines: DbLineRow[]): { prob: number | null; bookCount: number } {
  const ml = lines.filter((l) => l.market_type === "moneyline" && (l.side === "home" || l.side === "away"));
  if (ml.length === 0) return { prob: null, bookCount: 0 };
  // De-vig by book: for each (sportsbook), find home + away implied probs,
  // normalize them, take the home-side normalized prob, then average across books.
  const byBook = new Map<string, { home?: number; away?: number }>();
  for (const l of ml) {
    const p = l.implied_probability;
    if (p === null) continue;
    const cur = byBook.get(l.sportsbook) ?? {};
    if (l.side === "home") cur.home = p;
    if (l.side === "away") cur.away = p;
    byBook.set(l.sportsbook, cur);
  }
  const devigged: number[] = [];
  for (const { home, away } of byBook.values()) {
    if (home === undefined || away === undefined) continue;
    const sum = home + away;
    if (sum <= 0) continue;
    devigged.push(home / sum);
  }
  if (devigged.length === 0) return { prob: null, bookCount: 0 };
  const avg = devigged.reduce((a, b) => a + b, 0) / devigged.length;
  return { prob: avg, bookCount: devigged.length };
}

function bestMlBreakEven(lines: DbLineRow[], side: "home" | "away"): number | null {
  const prices = lines
    .filter((line) => line.market_type === "moneyline" && line.side === side && line.odds_american !== null)
    .map((line) => line.odds_american!);
  if (prices.length === 0) return null;
  return americanToImplied(Math.max(...prices));
}

const SHARP_BOOK_PRIORITY = ["circa", "pinnacle", "bookmaker"] as const;

function normalizedBook(value: string): string {
  return value.trim().toLowerCase().replace(/[^a-z0-9]/g, "");
}

function median(values: readonly number[]): number | null {
  if (values.length === 0) return null;
  const ordered = [...values].sort((a, b) => a - b);
  const middle = Math.floor(ordered.length / 2);
  return ordered.length % 2 === 1
    ? ordered[middle]!
    : (ordered[middle - 1]! + ordered[middle]!) / 2;
}

function completeMlByBook(lines: DbLineRow[]): Map<string, number> {
  const byBook = new Map<string, { home?: number; away?: number }>();
  for (const line of lines) {
    if (line.market_type !== "moneyline" || (line.side !== "home" && line.side !== "away")) continue;
    const probability = line.implied_probability ?? americanToImplied(line.odds_american);
    if (probability === null) continue;
    const book = normalizedBook(line.sportsbook);
    const pair = byBook.get(book) ?? {};
    pair[line.side] = probability;
    byBook.set(book, pair);
  }
  const out = new Map<string, number>();
  for (const [book, pair] of byBook) {
    if (pair.home === undefined || pair.away === undefined || pair.home + pair.away <= 0) continue;
    out.set(book, pair.home / (pair.home + pair.away));
  }
  return out;
}

function totalLineByBook(lines: DbLineRow[]): Map<string, number> {
  const values = new Map<string, number[]>();
  for (const line of lines) {
    if (line.market_type !== "total" || line.line_value === null) continue;
    const book = normalizedBook(line.sportsbook);
    const bookValues = values.get(book) ?? [];
    bookValues.push(line.line_value);
    values.set(book, bookValues);
  }
  const out = new Map<string, number>();
  for (const [book, bookValues] of values) {
    const selected = median(bookValues);
    if (selected !== null) out.set(book, selected);
  }
  return out;
}

function preferredCommonBook(current: ReadonlyMap<string, number>, opening: ReadonlyMap<string, number>): string | null {
  const common = [...current.keys()].filter((book) => opening.has(book));
  if (common.length === 0) return null;
  return [...common].sort((a, b) => {
    const aPriority = SHARP_BOOK_PRIORITY.findIndex((book) => a.includes(book));
    const bPriority = SHARP_BOOK_PRIORITY.findIndex((book) => b.includes(book));
    const ai = aPriority === -1 ? SHARP_BOOK_PRIORITY.length : aPriority;
    const bi = bPriority === -1 ? SHARP_BOOK_PRIORITY.length : bPriority;
    return ai - bi || a.localeCompare(b);
  })[0] ?? null;
}

export function selectSameBookNhlMovement(
  currentLines: DbLineRow[],
  openingLines: DbLineRow[],
): { homeProbMove: number | null; totalMove: number | null } {
  const currentMl = completeMlByBook(currentLines);
  const openingMl = completeMlByBook(openingLines);
  const mlBook = preferredCommonBook(currentMl, openingMl);
  const currentTotals = totalLineByBook(currentLines);
  const openingTotals = totalLineByBook(openingLines);
  const totalBook = preferredCommonBook(currentTotals, openingTotals);
  return {
    homeProbMove: mlBook === null ? null : currentMl.get(mlBook)! - openingMl.get(mlBook)!,
    totalMove: totalBook === null ? null : currentTotals.get(totalBook)! - openingTotals.get(totalBook)!,
  };
}

/**
 * Select the MAIN consensus total line for an NHL game. EXPORTED + shared by
 * both the model feature snapshot AND the daily-edge adapter so the pick
 * label, card market line, model edge row, line-movement, and the locked
 * record all reference the SAME line — never one value in one place and a
 * different value in another.
 *
 * 2026-06-14 (Daniel: NHL card showed "Over 4.5" while the stored record said
 * "Over 5.5" and the card line read another value): the old picker took a
 * naive MEDIAN across ALL total rows — including alternate lines and blocked
 * books — so a cross-book 4.5 / 5.5 / 6.5 spread mashed into a wrong "4.5".
 * Now: (1) drop blocked/corrupted books (fliff etc.); (2) pick the modal line
 * by distinct-BOOK count (the consensus main line), NOT a median across an
 * alt-line ladder; (3) on a tie, take the modal value closest to the median
 * (avoids a fringe alt-line winning a tie).
 */
export function selectMainNhlTotalLine(
  // Minimal structural shape — accepts DbLineRow AND the adapter's line rows.
  lines: ReadonlyArray<{ market_type: string; sportsbook: string; line_value: number | null }>,
): number | null {
  const clean = lines.filter(
    (l) => l.market_type === "total" && l.line_value !== null && !isBlockedSportsbook(l.sportsbook),
  );
  if (clean.length === 0) return null;
  // Distinct books per line value (a book quoting both over+under = one book).
  const booksByLine = new Map<number, Set<string>>();
  for (const l of clean) {
    const v = l.line_value!;
    if (!booksByLine.has(v)) booksByLine.set(v, new Set());
    booksByLine.get(v)!.add(l.sportsbook);
  }
  const distinct = [...booksByLine.keys()].sort((a, b) => a - b);
  const maxBooks = Math.max(...[...booksByLine.values()].map((s) => s.size));
  const modes = distinct.filter((v) => booksByLine.get(v)!.size === maxBooks);
  if (modes.length === 1) return modes[0]!;
  // Tie-break: modal value closest to the median of the distinct lines.
  const median = distinct[Math.floor(distinct.length / 2)]!;
  return modes.reduce(
    (best, v) => (Math.abs(v - median) < Math.abs(best - median) ? v : best),
    modes[0]!,
  );
}

/** Resolve the actual paired puck line offered by the books. Near pick'em
 * moneylines do not reliably identify which team a sportsbook assigns -1.5,
 * so the model must consume the quoted pair rather than infer it from a
 * rounded no-vig moneyline probability. */
export function selectMainNhlPuckLinePair(
  lines: ReadonlyArray<{ market_type: string; sportsbook: string; side: string; line_value: number | null }>,
): { home: number | null; away: number | null } {
  const clean = lines.filter((line) => (
    line.market_type === "spread"
    && line.line_value !== null
    && (line.side === "home" || line.side === "away")
    && !isBlockedSportsbook(line.sportsbook)
  ));
  const byBook = new Map<string, { home: Set<number>; away: Set<number> }>();
  for (const line of clean) {
    const book = normalizedBook(line.sportsbook);
    const sides = byBook.get(book) ?? { home: new Set<number>(), away: new Set<number>() };
    sides[line.side as "home" | "away"].add(line.line_value!);
    byBook.set(book, sides);
  }
  const counts = new Map<string, { home: number; away: number; books: Set<string> }>();
  for (const [book, sides] of byBook) {
    for (const home of sides.home) {
      for (const away of sides.away) {
        if (Math.abs(home + away) >= 0.01) continue;
        const key = `${home}|${away}`;
        const candidate = counts.get(key) ?? { home, away, books: new Set<string>() };
        candidate.books.add(book);
        counts.set(key, candidate);
      }
    }
  }
  const selected = [...counts.values()].sort((a, b) => (
    b.books.size - a.books.size
    || Math.abs(Math.abs(a.home) - 1.5) - Math.abs(Math.abs(b.home) - 1.5)
    || a.home - b.home
  ))[0];
  return selected ? { home: selected.home, away: selected.away } : { home: null, away: null };
}

function puckLineBreakEvenProbabilities(
  lines: DbLineRow[],
  selected: { home: number | null; away: number | null },
): { home: number | null; away: number | null } {
  if (selected.home === null || selected.away === null) return { home: null, away: null };
  const bestPrices: { home: number[]; away: number[] } = { home: [], away: [] };
  for (const line of lines) {
    if (line.market_type !== "spread" || (line.side !== "home" && line.side !== "away")) continue;
    const expectedLine = line.side === "home" ? selected.home : selected.away;
    if (line.line_value === null || Math.abs(line.line_value - expectedLine) >= 0.01) continue;
    if (line.odds_american !== null) bestPrices[line.side].push(line.odds_american);
  }
  return {
    home: bestPrices.home.length === 0 ? null : americanToImplied(Math.max(...bestPrices.home)),
    away: bestPrices.away.length === 0 ? null : americanToImplied(Math.max(...bestPrices.away)),
  };
}

/**
 * Build a complete feature snapshot for a single NHL game. Throws on
 * fatal missing data (no game row, no teams). Soft-fails (null fields)
 * on missing stats — the model handles nulls with safe fallbacks.
 */
export async function buildNhlFeatureSnapshot(
  opts: BuildSnapshotOptions,
): Promise<{ snapshot: NhlFeatureSnapshot; meta: { home_goalie?: string; away_goalie?: string; market_line?: number | null } }> {
  const log = opts.logger ?? (() => {});

  // 1. Game row.
  const { data: gameData, error: gameErr } = await supabase
    .from("games")
    .select("id, external_id, sport, home_team_id, away_team_id, game_date, slate_date, status")
    .eq("id", opts.gameId)
    .eq("sport", "nhl")
    .single();
  if (gameErr || !gameData) throw new Error(`game ${opts.gameId} not found or not NHL: ${gameErr?.message ?? "no row"}`);
  const game = gameData as DbGameRow;
  if (game.home_team_id === null || game.away_team_id === null) {
    throw new Error(`game ${opts.gameId} missing team_ids`);
  }

  // 2. Teams.
  const { data: teamsData, error: teamsErr } = await supabase
    .from("teams")
    .select("id, abbreviation")
    .in("id", [game.home_team_id, game.away_team_id]);
  if (teamsErr || !teamsData || teamsData.length < 2) {
    throw new Error(`teams lookup failed: ${teamsErr?.message ?? "missing rows"}`);
  }
  const teams = teamsData as DbTeamRow[];
  const homeTeam = teams.find((t) => t.id === game.home_team_id)!;
  const awayTeam = teams.find((t) => t.id === game.away_team_id)!;
  const gameType = nhlGameTypeFromExternalId(game.external_id);
  if (gameType === null) throw new Error(`game ${opts.gameId} has invalid NHL external_id ${game.external_id}`);
  const featureSeason = opts.season ?? nhlSeasonStartYearFromExternalId(game.external_id);
  log(`Snapshot for game ${opts.gameId}: ${awayTeam.abbreviation} @ ${homeTeam.abbreviation}`);

  // 3. Team stats for both teams + the season.
  const { data: teamStatsData, error: teamStatsErr } = await supabase
    .from("nhl_team_stats")
    .select("team_id, season, season_type, situation, games_played, ice_time, xgoals_pct, x_goals_for, x_goals_against")
    .in("team_id", [game.home_team_id, game.away_team_id])
    .in("season", [featureSeason, featureSeason - 1]);
  if (teamStatsErr) throw new Error(`team stats lookup: ${teamStatsErr.message}`);
  const teamStats = (teamStatsData as DbTeamStatsRow[] | null) ?? [];
  const homeTeamStats = teamStats.filter((r) => r.team_id === game.home_team_id);
  const awayTeamStats = teamStats.filter((r) => r.team_id === game.away_team_id);
  const homeStatsAll = pickSituationStats(homeTeamStats, "all", featureSeason, gameType);
  const awayStatsAll = pickSituationStats(awayTeamStats, "all", featureSeason, gameType);
  const homeStats5on5 = pickSituationStats(homeTeamStats, "5on5", featureSeason, gameType);
  const awayStats5on5 = pickSituationStats(awayTeamStats, "5on5", featureSeason, gameType);
  const homeStats5on4 = pickSituationStats(homeTeamStats, "5on4", featureSeason, gameType);
  const awayStats5on4 = pickSituationStats(awayTeamStats, "5on4", featureSeason, gameType);
  const homeStats4on5 = pickSituationStats(homeTeamStats, "4on5", featureSeason, gameType);
  const awayStats4on5 = pickSituationStats(awayTeamStats, "4on5", featureSeason, gameType);

  // 4. Goalie stats — full table for the season. Filter team-side.
  const { data: goalieData, error: goalieErr } = await supabase
    .from("nhl_goalie_stats")
    .select("player_external_id, player_name, team_abbr, season, season_type, situation, games_played, ice_time, x_goals, goals")
    .in("season", [featureSeason, featureSeason - 1]);
  if (goalieErr) throw new Error(`goalie stats lookup: ${goalieErr.message}`);
  const goalies = (goalieData as DbGoalieStatsRow[] | null) ?? [];

  const homeGoalie = opts.homeGoalieExternalId !== undefined
    ? selectGoalieByOverride(goalies, opts.homeGoalieExternalId)
    : selectGoalieByDefault(goalies, homeTeam.abbreviation, featureSeason, gameType);
  const awayGoalie = opts.awayGoalieExternalId !== undefined
    ? selectGoalieByOverride(goalies, opts.awayGoalieExternalId)
    : selectGoalieByDefault(goalies, awayTeam.abbreviation, featureSeason, gameType);

  if (homeGoalie) log(`  home goalie: ${homeGoalie.player_name} (id=${homeGoalie.player_external_id}, ${homeGoalie.season_type})`);
  else log(`  home goalie: <none found>`);
  if (awayGoalie) log(`  away goalie: ${awayGoalie.player_name} (id=${awayGoalie.player_external_id}, ${awayGoalie.season_type})`);
  else log(`  away goalie: <none found>`);

  // 5. Lines (moneyline + total + the actual paired puck line) for the
  // market layer.
  const { data: linesData } = await supabase
    .from("lines")
    .select("market_type, sportsbook, side, line_value, odds_american, implied_probability, fetched_at")
    .eq("game_id", opts.gameId)
    .is("player_id", null)
    .in("market_type", ["moneyline", "total", "spread"]);
  // #39 — drop blocked books (fliff, kalshi) at the load point so every
  // downstream selection (ML implied prob, total line) is clean. Previously
  // only selectMainNhlTotalLine filtered; the ML implied-prob path did not.
  const lines = canonicalizeNhlLineRows((((linesData ?? []) as Array<DbLineRow & { fetched_at: string | null }>).filter(
    (l) => !isBlockedSportsbook(l.sportsbook),
  ).map((line) => ({ ...line, observed_at: line.fetched_at }))));
  const { prob: marketHomeProb, bookCount } = pickMlImpliedProbHome(lines);
  const marketTotalLine = selectMainNhlTotalLine(lines);
  const marketPuckLine = selectMainNhlPuckLinePair(lines);
  const marketPuckProbabilities = puckLineBreakEvenProbabilities(lines, marketPuckLine);
  log(`  market: ML home prob=${marketHomeProb?.toFixed(3) ?? "n/a"} (${bookCount} books), total line=${marketTotalLine?.toFixed(1) ?? "n/a"}`);

  const { data: historyData } = await supabase
    .from("line_history")
    .select("market_type, sportsbook, side, line_value, odds_american, recorded_at")
    .eq("game_id", opts.gameId)
    .is("player_id", null)
    .in("market_type", ["moneyline", "total"])
    .order("recorded_at", { ascending: true });
  const historyLines = canonicalizeNhlLineRows(((historyData ?? []) as Array<{
    market_type: string; sportsbook: string; side: string; line_value: number | null;
    odds_american: number | null; recorded_at: string | null;
  }>).filter((raw) => !isBlockedSportsbook(raw.sportsbook)).map((raw) => ({
      market_type: raw.market_type,
      sportsbook: raw.sportsbook,
      side: raw.side,
      line_value: raw.line_value,
      odds_american: raw.odds_american,
      implied_probability: americanToImplied(raw.odds_american),
      observed_at: raw.recorded_at,
    })), { scopeKey: (row) => row.observed_at ?? "unknown" });
  const firstObservationByBookMarket = new Map<string, number>();
  for (const row of historyLines) {
    const key = `${normalizedBook(row.sportsbook)}:${row.market_type}`;
    const observedAt = Date.parse(row.observed_at ?? "");
    if (!Number.isFinite(observedAt)) continue;
    const first = firstObservationByBookMarket.get(key);
    if (first === undefined || observedAt < first) firstObservationByBookMarket.set(key, observedAt);
  }
  const openingLines = historyLines.filter((row) => {
    const key = `${normalizedBook(row.sportsbook)}:${row.market_type}`;
    return Date.parse(row.observed_at ?? "") === firstObservationByBookMarket.get(key);
  });
  const marketOpenHomeProb = pickMlImpliedProbHome(openingLines).prob;
  const marketOpenTotalLine = selectMainNhlTotalLine(openingLines);
  const sameBookMovement = selectSameBookNhlMovement(lines, openingLines);

  // 6. Series context — fetch fresh from NHL API at prediction time.
  // Cheap (~1 HTTP call per snapshot); always up-to-date (NHL API
  // updates wins immediately after each game).
  let homeSeriesWins = 0;
  let awaySeriesWins = 0;
  let seriesAbbrev: string | null = null;
  let gameNumberInSeries = 0;
  let gamesToWin = 4;
  if (gameType === 3) {
    try {
      const scheduleEvents = await fetchNhlScheduleForDate(game.slate_date);
      const apiEvent = scheduleEvents.find((e) => e.nhl_game_id === String(game.external_id));
      const series = apiEvent?.series ?? null;
      if (series && series.top_seed_abbrev && series.bottom_seed_abbrev) {
        seriesAbbrev = series.series_abbrev || null;
        gameNumberInSeries = series.game_number_in_series;
        gamesToWin = series.games_to_win;
        if (series.top_seed_abbrev === homeTeam.abbreviation) {
          homeSeriesWins = series.top_seed_wins;
          awaySeriesWins = series.bottom_seed_wins;
        } else if (series.bottom_seed_abbrev === homeTeam.abbreviation) {
          homeSeriesWins = series.bottom_seed_wins;
          awaySeriesWins = series.top_seed_wins;
        }
      }
    } catch (e) {
      log(`  ⚠ series context fetch failed (continuing without): ${(e as Error).message}`);
    }
  }
  const isElim = (seriesAbbrev !== null) && (homeSeriesWins === gamesToWin - 1 || awaySeriesWins === gamesToWin - 1);

  const { data: priorGamesData } = await supabase
    .from("games")
    .select("external_id, game_date, home_team_id, away_team_id")
    .eq("sport", "nhl")
    .lt("game_date", game.game_date)
    .or(`home_team_id.in.(${game.home_team_id},${game.away_team_id}),away_team_id.in.(${game.home_team_id},${game.away_team_id})`)
    .order("game_date", { ascending: false })
    .limit(40);
  const priorGames = ((priorGamesData ?? []) as Array<{
    external_id: number; game_date: string; home_team_id: number | null; away_team_id: number | null;
  }>).filter((row) => nhlGameTypeFromExternalId(row.external_id) === 2);
  const restDays = (teamId: number): number | null => {
    const prior = priorGames.find((row) => row.home_team_id === teamId || row.away_team_id === teamId);
    if (!prior) return null;
    const days = (Date.parse(game.game_date) - Date.parse(prior.game_date)) / 86_400_000;
    return Number.isFinite(days) ? Math.max(0, Math.min(10, days)) : null;
  };

  // 7. Build the model snapshot.
  const homeModel: NhlModelTeam = {
    abbreviation: homeTeam.abbreviation,
    xgoals_pct: homeStatsAll?.xgoals_pct ?? null,
    x_goals_for_per_60: per60(homeStatsAll?.x_goals_for ?? null, homeStatsAll?.ice_time ?? null),
    x_goals_against_per_60: per60(homeStatsAll?.x_goals_against ?? null, homeStatsAll?.ice_time ?? null),
    five_x_goals_for_per_60: per60(homeStats5on5?.x_goals_for ?? null, homeStats5on5?.ice_time ?? null),
    five_x_goals_against_per_60: per60(homeStats5on5?.x_goals_against ?? null, homeStats5on5?.ice_time ?? null),
    pp_x_goals_for_per_60: per60(homeStats5on4?.x_goals_for ?? null, homeStats5on4?.ice_time ?? null),
    pk_x_goals_against_per_60: per60(homeStats4on5?.x_goals_against ?? null, homeStats4on5?.ice_time ?? null),
    pp_x_goals_for_per_game: perGame(homeStats5on4?.x_goals_for ?? null, homeStats5on4?.games_played ?? null),
    pk_x_goals_against_per_game: perGame(homeStats4on5?.x_goals_against ?? null, homeStats4on5?.games_played ?? null),
    pp_xgoals_pct: homeStats5on4?.xgoals_pct ?? null,
    pk_xgoals_pct: homeStats4on5?.xgoals_pct ?? null,
    goalie_xgsaa_per_60: goalieXgsaaPer60(homeGoalie),
    rest_days: restDays(game.home_team_id),
    series_wins: homeSeriesWins,
    is_home: true,
    provider_metrics: opts.providerMetricsByTeam?.get(homeTeam.abbreviation) ?? null,
    calibrated_state: opts.calibratedStateByTeam?.get(homeTeam.abbreviation) ?? null,
    opponent_adjusted_attack: opts.opponentAdjustedStateByTeam?.get(homeTeam.abbreviation)?.attack ?? null,
    opponent_adjusted_defense_weakness: opts.opponentAdjustedStateByTeam?.get(homeTeam.abbreviation)?.defenseWeakness ?? null,
  };
  const awayModel: NhlModelTeam = {
    abbreviation: awayTeam.abbreviation,
    xgoals_pct: awayStatsAll?.xgoals_pct ?? null,
    x_goals_for_per_60: per60(awayStatsAll?.x_goals_for ?? null, awayStatsAll?.ice_time ?? null),
    x_goals_against_per_60: per60(awayStatsAll?.x_goals_against ?? null, awayStatsAll?.ice_time ?? null),
    five_x_goals_for_per_60: per60(awayStats5on5?.x_goals_for ?? null, awayStats5on5?.ice_time ?? null),
    five_x_goals_against_per_60: per60(awayStats5on5?.x_goals_against ?? null, awayStats5on5?.ice_time ?? null),
    pp_x_goals_for_per_60: per60(awayStats5on4?.x_goals_for ?? null, awayStats5on4?.ice_time ?? null),
    pk_x_goals_against_per_60: per60(awayStats4on5?.x_goals_against ?? null, awayStats4on5?.ice_time ?? null),
    pp_x_goals_for_per_game: perGame(awayStats5on4?.x_goals_for ?? null, awayStats5on4?.games_played ?? null),
    pk_x_goals_against_per_game: perGame(awayStats4on5?.x_goals_against ?? null, awayStats4on5?.games_played ?? null),
    pp_xgoals_pct: awayStats5on4?.xgoals_pct ?? null,
    pk_xgoals_pct: awayStats4on5?.xgoals_pct ?? null,
    goalie_xgsaa_per_60: goalieXgsaaPer60(awayGoalie),
    rest_days: restDays(game.away_team_id),
    series_wins: awaySeriesWins,
    is_home: false,
    provider_metrics: opts.providerMetricsByTeam?.get(awayTeam.abbreviation) ?? null,
    calibrated_state: opts.calibratedStateByTeam?.get(awayTeam.abbreviation) ?? null,
    opponent_adjusted_attack: opts.opponentAdjustedStateByTeam?.get(awayTeam.abbreviation)?.attack ?? null,
    opponent_adjusted_defense_weakness: opts.opponentAdjustedStateByTeam?.get(awayTeam.abbreviation)?.defenseWeakness ?? null,
  };

  const snapshot: NhlFeatureSnapshot = {
    home: homeModel,
    away: awayModel,
    market: {
      market_home_prob: marketHomeProb,
      best_home_ml_prob: bestMlBreakEven(lines, "home"),
      best_away_ml_prob: bestMlBreakEven(lines, "away"),
      market_open_home_prob: marketOpenHomeProb,
      market_total_line: marketTotalLine,
      market_open_total_line: marketOpenTotalLine,
      same_book_home_prob_move: sameBookMovement.homeProbMove,
      same_book_total_move: sameBookMovement.totalMove,
      market_home_puck_line: marketPuckLine.home,
      market_away_puck_line: marketPuckLine.away,
      market_home_puck_prob: marketPuckProbabilities.home,
      market_away_puck_prob: marketPuckProbabilities.away,
      market_book_count: bookCount,
      ml_home_bets_pct: opts.marketEvidence?.mlHomeBetsPct ?? null,
      ml_home_money_pct: opts.marketEvidence?.mlHomeMoneyPct ?? null,
      total_over_bets_pct: opts.marketEvidence?.totalOverBetsPct ?? null,
      total_over_money_pct: opts.marketEvidence?.totalOverMoneyPct ?? null,
      ml_split_source: opts.marketEvidence?.mlSplitSource ?? null,
      ml_split_confidence: opts.marketEvidence?.mlSplitConfidence ?? "none",
      total_split_source: opts.marketEvidence?.totalSplitSource ?? null,
      total_split_confidence: opts.marketEvidence?.totalSplitConfidence ?? "none",
    },
    series: {
      series_abbrev: seriesAbbrev,
      game_number_in_series: gameNumberInSeries,
      is_elimination_game: isElim,
    },
    game_type: gameType,
    feature_season: featureSeason,
    provider_feature_season: opts.providerFeatureSeason ?? null,
  };

  return {
    snapshot,
    meta: {
      home_goalie: homeGoalie?.player_name,
      away_goalie: awayGoalie?.player_name,
      market_line: marketTotalLine,
    },
  };
}
