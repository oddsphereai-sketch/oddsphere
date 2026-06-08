/**
 * Phase 7A — NBA Finals v0a — DB feature-snapshot builder.
 *
 * Reads existing `games`, `teams`, `lines` (all sport='nba') and produces
 * NbaGameSnapshot[] suitable for the pure orchestrator.
 *
 * Hard rules:
 *   • Read-only. No INSERT / UPDATE / DELETE / UPSERT anywhere.
 *   • NO schema migrations. Team ratings would live in a new
 *     `nba_team_ratings` table — that table doesn't exist yet, so v0
 *     graceful-fills every rating with null. data_quality.ratings_present
 *     ends up false → orchestrator emits fallback tier.
 *   • No MLB tables touched. No imports from MLB modules.
 *   • Honest nullability — never invents fake stats.
 *   • Best-effort series context: queries finished prior NBA games
 *     between the same team pair to derive game_number / series score.
 */

import { supabase } from "../../db/supabase";
import { deriveSeriesContext, type PriorGameInput } from "../../automodel/nba/seriesContext";
import type {
  NbaDataQuality,
  NbaGameSnapshot,
  NbaMarketSnapshot,
  NbaPlayerInjury,
  NbaSeriesContext,
  NbaTeamSnapshot,
} from "../../automodel/nba/types";

// ─── DB row types (subset of columns we read) ─────────────────────

type GameRow = {
  id: number;
  external_id: number;
  sport: string;
  home_team_id: number | null;
  away_team_id: number | null;
  game_date: string;
  home_score: number | null;
  away_score: number | null;
};

type TeamRow = {
  id: number;
  external_id: number;
  abbreviation: string;
  sport: string;
};

type LineRow = {
  game_id: number;
  market_type: string;
  sportsbook: string;
  side: string | null;
  line_value: number | null;
  odds_american: number | null;
};

// Sharpbook priority for picking the freshest single value per (market,side).
const BOOK_PRIORITY: readonly string[] = [
  "pinnacle",
  "draftkings",
  "fanduel",
  "betmgm",
  "caesars",
] as const;

function pickPriorityRow(rows: LineRow[]): LineRow | null {
  for (const book of BOOK_PRIORITY) {
    const match = rows.find((r) => r.sportsbook?.toLowerCase() === book);
    if (match !== undefined) return match;
  }
  return rows[0] ?? null;
}

// ─── injury-fetch hook (optional, default to no fetch) ────────────
//
// The feature-snapshot builder does NOT directly fetch injuries — that's
// a network call and we keep the DB read pipeline pure. The injury
// fetcher lives in espnNbaInjuries.ts and is composed by the operator
// script. The builder accepts an optional resolver so the operator can
// inject the ESPN-fetched injuries OR pass `undefined` and get empty
// arrays plus `injuries_known=false`.

export type InjuryResolver = (opts: {
  teamAbbreviation: string;
  teamExternalId: number;
}) => Promise<NbaPlayerInjury[] | null>;

export type BuildNbaSnapshotOptions = {
  /** When provided, called once per team to populate injuries. When
   *  it returns null the slot is treated as "unknown" (injuries_known=false). */
  injuryResolver?: InjuryResolver;
  /** Optional fixed clock for series-context "this game date". Defaults
   *  to the slate date if not supplied. */
  thisGameDate?: string;
};

// ─── main builder ────────────────────────────────────────────────

export async function buildNbaFeatureSnapshots(
  date: string,
  opts: BuildNbaSnapshotOptions = {},
): Promise<NbaGameSnapshot[]> {
  // Date window: ET-aware slate boundaries are an MLB convention; for
  // NBA v0 we use a simple UTC-day window which is good enough for an
  // internal preview (NBA games rarely cross midnight UTC vs midnight ET
  // within a single calendar slate).
  const startISO = `${date}T00:00:00.000Z`;
  const endISO = `${date}T23:59:59.999Z`;

  // 1) games for the slate (sport='nba')
  const { data: gameRows, error: gamesErr } = await supabase
    .from("games")
    .select(
      "id, external_id, sport, home_team_id, away_team_id, game_date, home_score, away_score",
    )
    .eq("sport", "nba")
    .gte("game_date", startISO)
    .lte("game_date", endISO);
  if (gamesErr !== null) {
    throw new Error(`buildNbaFeatureSnapshots: games query failed: ${gamesErr.message}`);
  }
  const games: GameRow[] = (gameRows ?? []) as GameRow[];
  if (games.length === 0) return [];

  // 2) teams referenced by these games
  const teamIds = new Set<number>();
  for (const g of games) {
    if (g.home_team_id !== null) teamIds.add(g.home_team_id);
    if (g.away_team_id !== null) teamIds.add(g.away_team_id);
  }
  const { data: teamRows, error: teamsErr } = await supabase
    .from("teams")
    .select("id, external_id, abbreviation, sport")
    .eq("sport", "nba")
    .in("id", Array.from(teamIds));
  if (teamsErr !== null) {
    throw new Error(`buildNbaFeatureSnapshots: teams query failed: ${teamsErr.message}`);
  }
  const teams: TeamRow[] = (teamRows ?? []) as TeamRow[];
  const teamById = new Map<number, TeamRow>();
  for (const t of teams) teamById.set(t.id, t);

  // 3) lines for these games (full-game ML / spread / total)
  const gameIds = games.map((g) => g.id);
  const { data: lineRows, error: linesErr } = await supabase
    .from("lines")
    .select(
      "game_id, market_type, sportsbook, side, line_value, odds_american",
    )
    .in("game_id", gameIds)
    .in("market_type", ["moneyline", "spread", "total"]);
  if (linesErr !== null) {
    throw new Error(`buildNbaFeatureSnapshots: lines query failed: ${linesErr.message}`);
  }
  const lines: LineRow[] = (lineRows ?? []) as LineRow[];
  const linesByGame = new Map<number, LineRow[]>();
  for (const l of lines) {
    if (l.game_id === null || l.game_id === undefined) continue;
    const list = linesByGame.get(l.game_id) ?? [];
    list.push(l);
    linesByGame.set(l.game_id, list);
  }

  // 4) Prior NBA games for series context. We pull ALL finished NBA games
  //    in the past 30 days so the series-deriver can identify the current
  //    Finals series from team-pair matching.
  const priorWindowStart = new Date(date);
  priorWindowStart.setDate(priorWindowStart.getDate() - 30);
  const priorStartISO = `${priorWindowStart.toISOString().slice(0, 10)}T00:00:00.000Z`;
  const { data: priorRows, error: priorErr } = await supabase
    .from("games")
    .select(
      "id, external_id, sport, home_team_id, away_team_id, game_date, home_score, away_score",
    )
    .eq("sport", "nba")
    .gte("game_date", priorStartISO)
    .lt("game_date", startISO)
    .not("home_score", "is", null)
    .not("away_score", "is", null);
  if (priorErr !== null) {
    throw new Error(`buildNbaFeatureSnapshots: prior-games query failed: ${priorErr.message}`);
  }
  const priorGames: GameRow[] = (priorRows ?? []) as GameRow[];

  // 5) Build per-game snapshots
  const snapshots: NbaGameSnapshot[] = [];
  for (const g of games) {
    const homeTeam = g.home_team_id !== null ? teamById.get(g.home_team_id) : undefined;
    const awayTeam = g.away_team_id !== null ? teamById.get(g.away_team_id) : undefined;
    if (homeTeam === undefined || awayTeam === undefined) continue;

    // Team snapshots — v0 has no nba_team_ratings table; all ratings null.
    const homeTeamSnap: NbaTeamSnapshot = {
      team_external_id: homeTeam.external_id,
      abbreviation: homeTeam.abbreviation,
      off_rating: null,
      def_rating: null,
      net_rating: null,
      pace: null,
      recent_form_10g_net_rating: null,
    };
    const awayTeamSnap: NbaTeamSnapshot = {
      team_external_id: awayTeam.external_id,
      abbreviation: awayTeam.abbreviation,
      off_rating: null,
      def_rating: null,
      net_rating: null,
      pace: null,
      recent_form_10g_net_rating: null,
    };

    // Injuries via optional resolver
    let homeInjuries: NbaPlayerInjury[] = [];
    let awayInjuries: NbaPlayerInjury[] = [];
    let homeInjuriesKnown = false;
    let awayInjuriesKnown = false;
    if (opts.injuryResolver) {
      try {
        const home = await opts.injuryResolver({
          teamAbbreviation: homeTeam.abbreviation,
          teamExternalId: homeTeam.external_id,
        });
        if (home !== null) {
          homeInjuries = home;
          homeInjuriesKnown = true;
        }
      } catch {
        // resolver errors → unknown, don't fail the whole pipeline
      }
      try {
        const away = await opts.injuryResolver({
          teamAbbreviation: awayTeam.abbreviation,
          teamExternalId: awayTeam.external_id,
        });
        if (away !== null) {
          awayInjuries = away;
          awayInjuriesKnown = true;
        }
      } catch {
        // resolver errors → unknown, don't fail the whole pipeline
      }
    }

    // Market: pick highest-priority book per (market_type, side)
    const gameLines = linesByGame.get(g.id) ?? [];
    const market: NbaMarketSnapshot = buildMarketFromLines(gameLines);

    // Series context from prior team-pair games
    const seriesPriors: PriorGameInput[] = priorGames.map((p) => ({
      game_external_id: p.external_id,
      game_date: p.game_date,
      home_team_external_id:
        p.home_team_id !== null ? teamById.get(p.home_team_id)?.external_id ?? -1 : -1,
      away_team_external_id:
        p.away_team_id !== null ? teamById.get(p.away_team_id)?.external_id ?? -1 : -1,
      home_score: p.home_score,
      away_score: p.away_score,
    }));
    const series: NbaSeriesContext = deriveSeriesContext({
      this_game_home_team_external_id: homeTeam.external_id,
      this_game_away_team_external_id: awayTeam.external_id,
      this_game_date: opts.thisGameDate ?? date,
      prior_games: seriesPriors,
    });
    const seriesContextDerived = series.game_number > 1;

    const ratingsPresent =
      homeTeamSnap.net_rating !== null &&
      awayTeamSnap.net_rating !== null &&
      homeTeamSnap.pace !== null &&
      awayTeamSnap.pace !== null;
    const marketPresent =
      market.ml.home_odds_american !== null ||
      market.spread.home_line !== null ||
      market.total.line !== null;

    const dataQuality: NbaDataQuality = {
      ratings_present: ratingsPresent,
      home_injuries_known: homeInjuriesKnown,
      away_injuries_known: awayInjuriesKnown,
      market_present: marketPresent,
      series_context_derived: seriesContextDerived,
    };

    snapshots.push({
      game_external_id: g.external_id,
      slate_date: date,
      game_time_iso: g.game_date ?? null,
      home_team: homeTeamSnap,
      away_team: awayTeamSnap,
      home_injuries: homeInjuries,
      away_injuries: awayInjuries,
      series,
      market,
      data_quality: dataQuality,
    });
  }
  return snapshots;
}

function buildMarketFromLines(lines: LineRow[]): NbaMarketSnapshot {
  // Group by (market_type, side) then pick the priority book row.
  const groups = new Map<string, LineRow[]>();
  for (const l of lines) {
    const key = `${l.market_type}::${l.side ?? "none"}`;
    const list = groups.get(key) ?? [];
    list.push(l);
    groups.set(key, list);
  }
  const get = (mkt: string, side: string): LineRow | null => {
    return pickPriorityRow(groups.get(`${mkt}::${side}`) ?? []);
  };
  const mlHome = get("moneyline", "home");
  const mlAway = get("moneyline", "away");
  const spreadHome = get("spread", "home");
  const spreadAway = get("spread", "away");
  const totalOver = get("total", "over");
  const totalUnder = get("total", "under");

  // For TOTAL, the line value lives on both sides; prefer over's value.
  // For SPREAD, the home_line is the value we want (negative = home favored).
  return {
    ml: {
      home_odds_american: mlHome?.odds_american ?? null,
      away_odds_american: mlAway?.odds_american ?? null,
    },
    spread: {
      home_line: spreadHome?.line_value ?? null,
      home_odds_american: spreadHome?.odds_american ?? null,
      away_odds_american: spreadAway?.odds_american ?? null,
    },
    total: {
      line: totalOver?.line_value ?? totalUnder?.line_value ?? null,
      over_odds_american: totalOver?.odds_american ?? null,
      under_odds_american: totalUnder?.odds_american ?? null,
    },
  };
}

// Exposed for tests — pure transform without DB dependency.
export const __NBA_FEATURE_SNAPSHOT_TEST__ = {
  buildMarketFromLines,
};
