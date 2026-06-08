/**
 * Phase 7A/7B — NBA Finals v0 — DB feature-snapshot builder.
 *
 * Reads existing `games`, `teams`, `lines`, `nba_team_ratings`
 * (all sport='nba') and produces NbaGameSnapshot[] suitable for the
 * pure orchestrator.
 *
 * Hard rules:
 *   • Read-only. No INSERT / UPDATE / DELETE / UPSERT anywhere.
 *   • Phase 7B: `nba_team_ratings` exists (migration v19). When a
 *     team has a row, ORtg/DRtg/NetRtg/Pace are hydrated; absent → still
 *     null, model degrades to fallback tier via existing data_quality.
 *   • No MLB tables touched. No imports from MLB modules.
 *   • Honest nullability — never invents fake stats.
 *   • Best-effort series context: queries finished prior NBA games
 *     between the same team pair to derive game_number / series score.
 *
 * Ratings selection: prefer `season_type='playoffs'` row when present
 * (small-sample but most relevant for Finals), else fall back to
 * `season_type='regular'`. Both are stored separately in the table; the
 * builder reads both and picks the better one per team.
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

// Phase 7B / 7C — nba_team_ratings row shape. v20 added Four Factors columns.
type NbaTeamRatingsRow = {
  team_id: number;
  season: number;
  season_type: "regular" | "playoffs";
  off_rating: number | null;
  def_rating: number | null;
  net_rating: number | null;
  pace: number | null;
  off_efg_pct: number | null;
  off_tov_pct: number | null;
  off_orb_pct: number | null;
  off_ft_rate: number | null;
  def_efg_pct: number | null;
  def_tov_pct: number | null;
  def_drb_pct: number | null;
  def_ft_rate_allowed: number | null;
  source: string;
  source_url: string;
  fetched_at: string;
};

/**
 * Per-team rating provenance attached to the snapshot for admin
 * display. NOT part of the model contract; the model itself reads
 * `off_rating`/`def_rating`/etc. from NbaTeamSnapshot. This is a side
 * channel for the admin UI's source-badge rendering.
 */
export type NbaTeamRatingsProvenance = {
  team_id: number;
  season: number | null;
  season_type: "regular" | "playoffs" | null;
  source: string | null;
  source_url: string | null;
  fetched_at: string | null;
  /** True when the row was actually found and populated (vs null-fallback). */
  populated: boolean;
};

/**
 * Per-game snapshot provenance map. Returned alongside snapshots from
 * `buildNbaFeatureSnapshotsWithProvenance` for the admin route to
 * render source badges per row.
 */
export type NbaSnapshotProvenance = {
  game_external_id: number;
  schedule_source: "espn_scoreboard";
  /** True if the prior-games window included at least one G1/G2 with finalized scores. */
  series_priors_found: boolean;
  prior_games_window_days: number;
  market_source: "sharpapi" | "none";
  market_book_priority: readonly string[];
  home_ratings: NbaTeamRatingsProvenance;
  away_ratings: NbaTeamRatingsProvenance;
  /** ESPN injuries fetched (true) vs unknown (false) per team. */
  injuries_source: "espn" | "none";
  injuries_known_home: boolean;
  injuries_known_away: boolean;
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

/**
 * Phase 7B — provenance-augmented snapshot builder. Returns BOTH the
 * model-ready snapshots AND a per-game provenance map. The admin route
 * uses both halves; the model orchestrator only consumes the snapshots.
 *
 * The original `buildNbaFeatureSnapshots` (declared further below)
 * delegates to this helper and discards the provenance side channel
 * so existing callers (v0a operator script, tests) remain unchanged.
 */
export async function buildNbaFeatureSnapshotsWithProvenance(
  date: string,
  opts: BuildNbaSnapshotOptions = {},
): Promise<{
  snapshots: NbaGameSnapshot[];
  provenance: NbaSnapshotProvenance[];
}> {
  return runBuild(date, opts);
}

const PRIOR_WINDOW_DAYS = 30;

function pickBestRatingsRow(
  rows: NbaTeamRatingsRow[],
): NbaTeamRatingsRow | null {
  if (rows.length === 0) return null;
  const playoffRow = rows.find((r) => r.season_type === "playoffs");
  if (playoffRow !== undefined) return playoffRow;
  const regularRow = rows.find((r) => r.season_type === "regular");
  return regularRow ?? rows[0];
}

function provenanceFromRow(
  teamId: number,
  row: NbaTeamRatingsRow | null,
): NbaTeamRatingsProvenance {
  if (row === null) {
    return {
      team_id: teamId,
      season: null,
      season_type: null,
      source: null,
      source_url: null,
      fetched_at: null,
      populated: false,
    };
  }
  return {
    team_id: teamId,
    season: row.season,
    season_type: row.season_type,
    source: row.source,
    source_url: row.source_url,
    fetched_at: row.fetched_at,
    populated: true,
  };
}

async function runBuild(
  date: string,
  opts: BuildNbaSnapshotOptions,
): Promise<{
  snapshots: NbaGameSnapshot[];
  provenance: NbaSnapshotProvenance[];
}> {
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
  if (games.length === 0) return { snapshots: [], provenance: [] };

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

  // 4b) NBA team ratings (Phase 7B v19 / Phase 7C v20 — Four Factors).
  // Pulls both regular + playoffs rows for the slate teams' season.
  // v0 uses pickBestRatingsRow (playoff preferred) as before; v1 uses
  // the regularByTeam + playoffByTeam packs separately for shrinkage.
  const slateSeason = Number.parseInt(date.slice(0, 4), 10);
  const ratingsByTeam = new Map<number, NbaTeamRatingsRow>();
  const regularByTeam = new Map<number, NbaTeamRatingsRow>();
  const playoffByTeam = new Map<number, NbaTeamRatingsRow>();
  if (teamIds.size > 0 && Number.isFinite(slateSeason)) {
    const { data: ratingsRows, error: ratingsErr } = await supabase
      .from("nba_team_ratings")
      .select(
        "team_id, season, season_type, off_rating, def_rating, net_rating, pace, off_efg_pct, off_tov_pct, off_orb_pct, off_ft_rate, def_efg_pct, def_tov_pct, def_drb_pct, def_ft_rate_allowed, source, source_url, fetched_at",
      )
      .in("team_id", Array.from(teamIds))
      .eq("season", slateSeason);
    if (ratingsErr !== null) {
      // Non-fatal: missing/erroring ratings → null fields, fallback tier.
      // Log but continue. (Includes the case where v20 migration hasn't
      // been applied yet — the older SELECT shape would fail; the new
      // one degrades gracefully because Postgres returns null for
      // missing columns when present.)
      console.warn(
        `buildNbaFeatureSnapshots: nba_team_ratings query failed (continuing with null ratings): ${ratingsErr.message}`,
      );
    }
    const rowsByTeam = new Map<number, NbaTeamRatingsRow[]>();
    for (const r of (ratingsRows ?? []) as NbaTeamRatingsRow[]) {
      const arr = rowsByTeam.get(r.team_id) ?? [];
      arr.push(r);
      rowsByTeam.set(r.team_id, arr);
      if (r.season_type === "regular") regularByTeam.set(r.team_id, r);
      else if (r.season_type === "playoffs") playoffByTeam.set(r.team_id, r);
    }
    for (const [teamId, rows] of rowsByTeam) {
      const best = pickBestRatingsRow(rows);
      if (best !== null) ratingsByTeam.set(teamId, best);
    }
  }

  // Phase 7C — helper: build a TeamRatingPack from a DB row (or null).
  // Sample-game count is left null when unknown; the v1 model treats null
  // as "trust source" and applies no shrinkage in that case.
  const packFromRow = (
    r: NbaTeamRatingsRow | undefined,
    samplePlayoffGames?: number | null,
  ): import("../../automodel/nba/types").NbaTeamRatingPack | null => {
    if (r === undefined) return null;
    const ff =
      r.off_efg_pct === null &&
      r.off_tov_pct === null &&
      r.off_orb_pct === null &&
      r.off_ft_rate === null &&
      r.def_efg_pct === null &&
      r.def_tov_pct === null &&
      r.def_drb_pct === null &&
      r.def_ft_rate_allowed === null
        ? null
        : {
            off_efg_pct: r.off_efg_pct,
            off_tov_pct: r.off_tov_pct,
            off_orb_pct: r.off_orb_pct,
            off_ft_rate: r.off_ft_rate,
            def_efg_pct: r.def_efg_pct,
            def_tov_pct: r.def_tov_pct,
            def_drb_pct: r.def_drb_pct,
            def_ft_rate_allowed: r.def_ft_rate_allowed,
          };
    return {
      off_rating: r.off_rating,
      def_rating: r.def_rating,
      net_rating: r.net_rating,
      pace: r.pace,
      four_factors: ff,
      sample_games: samplePlayoffGames ?? null,
      source: r.source,
      source_url: r.source_url,
      fetched_at: r.fetched_at,
    };
  };

  // 5) Build per-game snapshots
  const snapshots: NbaGameSnapshot[] = [];
  const provenance: NbaSnapshotProvenance[] = [];
  for (const g of games) {
    const homeTeam = g.home_team_id !== null ? teamById.get(g.home_team_id) : undefined;
    const awayTeam = g.away_team_id !== null ? teamById.get(g.away_team_id) : undefined;
    if (homeTeam === undefined || awayTeam === undefined) continue;

    // Team snapshots — Phase 7B reads `nba_team_ratings`. When a row
    // exists, ORtg/DRtg/NetRtg/Pace are populated; when absent the
    // fields stay null and dataQuality.ratings_present ends up false →
    // model degrades to fallback tier.
    //
    // Phase 7C: ALSO hydrate the separate regular-season and playoff
    // rating packs (with Four Factors). v0 keeps reading the single
    // `off_rating` etc. fields (back-compat). v1 reads the dual packs.
    const homeRatingsRow = ratingsByTeam.get(homeTeam.id) ?? null;
    const awayRatingsRow = ratingsByTeam.get(awayTeam.id) ?? null;

    // Compute per-team playoff sample size from prior NBA games involving
    // each team (finished, with scores) — used by v1 shrinkage.
    const countPlayoffGames = (teamExternalId: number): number =>
      priorGames.filter((p) => {
        const homeExt =
          p.home_team_id !== null
            ? teamById.get(p.home_team_id)?.external_id ?? -1
            : -1;
        const awayExt =
          p.away_team_id !== null
            ? teamById.get(p.away_team_id)?.external_id ?? -1
            : -1;
        return homeExt === teamExternalId || awayExt === teamExternalId;
      }).length;
    const homePlayoffSample = countPlayoffGames(homeTeam.external_id);
    const awayPlayoffSample = countPlayoffGames(awayTeam.external_id);
    // Regular season sample: BBR season pages publish end-of-season
    // aggregates → assume the regular row covers ~82 games when present.
    const REGULAR_SEASON_GAMES_ASSUMED = 82;

    const homeTeamSnap: NbaTeamSnapshot = {
      team_external_id: homeTeam.external_id,
      abbreviation: homeTeam.abbreviation,
      off_rating: homeRatingsRow?.off_rating ?? null,
      def_rating: homeRatingsRow?.def_rating ?? null,
      net_rating: homeRatingsRow?.net_rating ?? null,
      pace: homeRatingsRow?.pace ?? null,
      recent_form_10g_net_rating: null,
      regular_season_ratings: packFromRow(
        regularByTeam.get(homeTeam.id),
        REGULAR_SEASON_GAMES_ASSUMED,
      ),
      playoff_ratings: packFromRow(
        playoffByTeam.get(homeTeam.id),
        homePlayoffSample > 0 ? homePlayoffSample : null,
      ),
    };
    const awayTeamSnap: NbaTeamSnapshot = {
      team_external_id: awayTeam.external_id,
      abbreviation: awayTeam.abbreviation,
      off_rating: awayRatingsRow?.off_rating ?? null,
      def_rating: awayRatingsRow?.def_rating ?? null,
      net_rating: awayRatingsRow?.net_rating ?? null,
      pace: awayRatingsRow?.pace ?? null,
      recent_form_10g_net_rating: null,
      regular_season_ratings: packFromRow(
        regularByTeam.get(awayTeam.id),
        REGULAR_SEASON_GAMES_ASSUMED,
      ),
      playoff_ratings: packFromRow(
        playoffByTeam.get(awayTeam.id),
        awayPlayoffSample > 0 ? awayPlayoffSample : null,
      ),
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

    // Phase 7B — provenance side channel for admin UI badges.
    provenance.push({
      game_external_id: g.external_id,
      schedule_source: "espn_scoreboard",
      series_priors_found: priorGames.some(
        (p) =>
          (p.home_team_id === homeTeam.id && p.away_team_id === awayTeam.id) ||
          (p.home_team_id === awayTeam.id && p.away_team_id === homeTeam.id),
      ),
      prior_games_window_days: PRIOR_WINDOW_DAYS,
      market_source: marketPresent ? "sharpapi" : "none",
      market_book_priority: BOOK_PRIORITY,
      home_ratings: provenanceFromRow(homeTeam.id, homeRatingsRow),
      away_ratings: provenanceFromRow(awayTeam.id, awayRatingsRow),
      injuries_source: opts.injuryResolver !== undefined ? "espn" : "none",
      injuries_known_home: homeInjuriesKnown,
      injuries_known_away: awayInjuriesKnown,
    });
  }
  return { snapshots, provenance };
}

/**
 * Back-compat wrapper for v0a callers (operator script, tests) that
 * only want NbaGameSnapshot[]. Delegates to the with-provenance helper
 * and discards the provenance side channel.
 */
export async function buildNbaFeatureSnapshots(
  date: string,
  opts: BuildNbaSnapshotOptions = {},
): Promise<NbaGameSnapshot[]> {
  const result = await runBuild(date, opts);
  return result.snapshots;
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
