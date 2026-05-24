/**
 * GET /api/lab/player-props
 *
 * Tonight's player props for the requested sport, filterable by:
 *   • prop_market — UI key (hits / home_runs / total_bases / strikeouts / er_allowed);
 *                   translated to the DB column value (e.g., "batter_hits")
 *   • tier        — comma-separated subset of premium/strong/good/skip
 *                   (per Phase 3C: tier is a query-time filter, not a write-time gate)
 *   • minEdge     — decimal 0..1; filters |edge_pct| >= minEdge*100
 *   • signals     — comma-separated UI signal keys (V1: not yet derived from
 *                   data; filter has no effect)
 *   • player_id   — single-player view (used by PlayerDrillDown)
 *   • date        — slate date (YYYY-MM-DD); defaults today UTC
 *
 * Three round-trips:
 *   (1) games for the slate → game_ids
 *   (2) prop_predictions for those games, joined to players+teams, with
 *       filters applied
 *   (3) historical resolved props for the involved (player_id, prop_market)
 *       pairs → last 10 win/loss outcomes for each card
 *
 * "Last 10" is real but sparse: a player's history may only contain 3–4
 * resolved predictions, which is what Decision E accepted ("may show <10
 * games for low-volume players"). `recent10.length` is the honest sample
 * size; `hitsLast10` counts the wins in that sample.
 *
 * Auth: public read.
 */

import { supabase } from "@/lib/db/supabase";
import type { Sport } from "@/lib/types/domain/Sport";
import { currentSlateDate, isSlateDate } from "@/lib/dates/slateDate";
import type {
  PlayerDto,
  PlayerPropDto,
  PlayerPropsResponse,
  PropTier,
} from "@/app/lab/lib/labTypes";

const VALID_SPORTS: Sport[] = ["mlb", "nba", "nfl", "cbb", "cfb", "nhl", "ucl"];
const LIVE_SPORTS: Sport[] = ["mlb"];
const ALL_TIERS: PropTier[] = ["premium", "strong", "good", "skip"];

// ─── Prop-market translation: UI key ↔ DB prop_market ─────────────────────
// V1 supports MLB only. NBA/NFL/NHL keys live in PROP_TYPE_META for layout
// purposes but have no DB rows yet — when those sports come online, add the
// translations here.
const UI_TO_DB_PROP_MARKET: Record<string, string> = {
  hits:         "batter_hits",
  home_runs:    "batter_home_runs",
  total_bases:  "batter_total_bases",
  strikeouts:   "pitcher_strikeouts",
  er_allowed:   "pitcher_earned_runs",
  rbis:         "batter_rbis",
};

const DB_TO_UI_PROP_MARKET: Record<string, string> = Object.fromEntries(
  Object.entries(UI_TO_DB_PROP_MARKET).map(([ui, db]) => [db, ui])
);

// ───────────────────────────────────────────────────────────────────────────
// Helpers (time + odds)
// ───────────────────────────────────────────────────────────────────────────

function formatTimeET(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "—";
  const hour24 = (d.getUTCHours() + 24 - 4) % 24;
  const minutes = d.getUTCMinutes();
  const ampm = hour24 >= 12 ? "PM" : "AM";
  const display = hour24 % 12 === 0 ? 12 : hour24 % 12;
  return `${display}:${String(minutes).padStart(2, "0")} ${ampm}`;
}

function formatOdds(americanOdds: number | null): string {
  if (americanOdds === null || americanOdds === undefined) return "—";
  if (americanOdds >= 0) return `+${americanOdds}`;
  return String(americanOdds);
}

// (slate-window helpers removed in 5E.1 — see lib/dates/slateDate.ts.)
//
// Date resolution: if ?date= is present and games exist on that slate, use it.
// Otherwise fall back to the most recent slate_date with games for this sport,
// signalled to the client via `fallback_used`.
async function resolveSlateDate(sport: Sport, requested: string): Promise<string> {
  const { data: probe } = await supabase
    .from("games")
    .select("slate_date")
    .eq("sport", sport)
    .eq("slate_date", requested)
    .limit(1);
  if ((probe ?? []).length > 0) return requested;

  const { data: latest } = await supabase
    .from("games")
    .select("slate_date")
    .eq("sport", sport)
    .order("slate_date", { ascending: false })
    .limit(1);
  return (latest ?? [])[0]?.slate_date ?? requested;
}

// ───────────────────────────────────────────────────────────────────────────
// Filter parsing
// ───────────────────────────────────────────────────────────────────────────

function parseTiers(raw: string | null): PropTier[] {
  if (!raw) return ALL_TIERS;
  const parts = raw
    .split(",")
    .map((p) => p.trim().toLowerCase())
    .filter((p): p is PropTier => (ALL_TIERS as string[]).includes(p));
  return parts.length > 0 ? parts : ALL_TIERS;
}

function parseSignals(raw: string | null): string[] {
  if (!raw) return [];
  return raw
    .split(",")
    .map((s) => s.trim().toLowerCase())
    .filter((s) => s.length > 0);
}

function parseMinEdge(raw: string | null): number {
  if (!raw) return 0;
  const n = Number(raw);
  if (Number.isNaN(n) || n < 0) return 0;
  // Tolerate caller sending "10" meaning 10% instead of "0.1"
  return n > 1 ? n / 100 : n;
}

// ───────────────────────────────────────────────────────────────────────────
// Row shapes (Supabase select projections)
// ───────────────────────────────────────────────────────────────────────────

type GameRow = {
  id: number;
  game_date: string;
  home_team: { id: number; abbreviation: string } | null;
  away_team: { id: number; abbreviation: string } | null;
};

type PropRow = {
  id: number;
  game_id: number;
  player_id: number;
  prop_market: string;
  prop_line: number;
  model_probability: number | null;
  edge_pct: number | null;
  confidence_score: number | null;
  tier: string | null;
  best_odds_american: number | null;
  computed_at: string;
  /** JSONB array of Signal strings (5F.2); empty if signals haven't been derived. */
  signals: string[] | null;
  player: {
    full_name: string;
    position_abbr: string | null;
    team_id: number | null;
  } | null;
};

type ResultRow = {
  prop_prediction_id: number;
  outcome: string;
  resolved_at: string;
};

type HistoryRow = {
  id: number;
  player_id: number;
  prop_market: string;
  computed_at: string;
};

// ───────────────────────────────────────────────────────────────────────────
// Route
// ───────────────────────────────────────────────────────────────────────────

export async function GET(request: Request) {
  const url = new URL(request.url);
  const sportParam = url.searchParams.get("sport");
  const sport: Sport =
    sportParam && (VALID_SPORTS as string[]).includes(sportParam)
      ? (sportParam as Sport)
      : "mlb";

  const dateParam = url.searchParams.get("date");
  const requestedDate = isSlateDate(dateParam) ? dateParam : currentSlateDate(sport);

  const propMarketUi = url.searchParams.get("prop_market");
  const tiers = parseTiers(url.searchParams.get("tier"));
  const minEdge = parseMinEdge(url.searchParams.get("minEdge"));
  const signals = parseSignals(url.searchParams.get("signals"));
  const playerIdRaw = url.searchParams.get("player_id");
  const playerId = playerIdRaw && /^\d+$/.test(playerIdRaw) ? Number(playerIdRaw) : null;

  const baseFilters = {
    prop_market: propMarketUi,
    tiers,
    minEdge,
    signals,
    player_id: playerIdRaw,
  };

  // ─── Empty response for non-live sports ──────────────────────────────────
  if (!LIVE_SPORTS.includes(sport)) {
    const body: PlayerPropsResponse = {
      as_of: new Date().toISOString(),
      sport,
      date: requestedDate,
      requested_date: requestedDate,
      fallback_used: false,
      filters: baseFilters,
      entries: [],
    };
    return Response.json(body, {
      headers: { "Cache-Control": "public, s-maxage=30, stale-while-revalidate=120" },
    });
  }

  // Resolve actual slate (fallback to most recent if requested is empty).
  const effectiveDate = await resolveSlateDate(sport, requestedDate);

  // ─── (1) Games for the slate ─────────────────────────────────────────────
  const { data: gameData, error: gameErr } = await supabase
    .from("games")
    .select(
      `id, game_date, slate_date,
       home_team:home_team_id (id, abbreviation),
       away_team:away_team_id (id, abbreviation)`
    )
    .eq("sport", sport)
    .eq("slate_date", effectiveDate);
  if (gameErr) return Response.json({ error: gameErr.message }, { status: 500 });

  const games = (gameData ?? []) as unknown as GameRow[];
  if (games.length === 0) {
    const body: PlayerPropsResponse = {
      as_of: new Date().toISOString(),
      sport,
      date: effectiveDate,
      requested_date: requestedDate,
      fallback_used: effectiveDate !== requestedDate,
      filters: baseFilters,
      entries: [],
    };
    return Response.json(body, {
      headers: { "Cache-Control": "public, s-maxage=30, stale-while-revalidate=120" },
    });
  }

  const gameById = new Map<number, GameRow>(games.map((g) => [g.id, g]));

  // ─── (2) Prop predictions with filters ───────────────────────────────────
  let propsQuery = supabase
    .from("prop_predictions")
    .select(
      `id, game_id, player_id, prop_market, prop_line,
       model_probability, edge_pct, confidence_score, tier,
       best_odds_american, computed_at, signals,
       player:player_id (full_name, position_abbr, team_id)`
    )
    .in("game_id", Array.from(gameById.keys()))
    .in("tier", tiers as string[])
    .order("edge_pct", { ascending: false, nullsFirst: false });

  if (propMarketUi) {
    const dbMarket = UI_TO_DB_PROP_MARKET[propMarketUi];
    if (dbMarket) propsQuery = propsQuery.eq("prop_market", dbMarket);
    else {
      // Unknown UI key — return empty rather than ignoring the filter silently.
      const body: PlayerPropsResponse = {
        as_of: new Date().toISOString(),
        sport,
        date: effectiveDate,
        requested_date: requestedDate,
        fallback_used: effectiveDate !== requestedDate,
        filters: baseFilters,
        entries: [],
      };
      return Response.json(body);
    }
  }

  if (playerId !== null) {
    propsQuery = propsQuery.eq("player_id", playerId);
  }

  // Signal chip filter (5F.2): AND-semantics — each requested signal must be
  // present in the row's signals[]. Uses the JSONB containment operator (@>)
  // via a stringified JSON array. PostgREST routes this through the GIN index
  // from migration v4. (Note: passing the raw array to .contains() fails as
  // "invalid input syntax for type json" because PostgREST emits `cs.[a,b]`
  // which is text-array syntax, not JSONB.)
  if (signals.length > 0) {
    propsQuery = propsQuery.contains("signals", JSON.stringify(signals));
  }

  const { data: propData, error: propErr } = await propsQuery;
  if (propErr) return Response.json({ error: propErr.message }, { status: 500 });
  const props = (propData ?? []) as unknown as PropRow[];

  // Apply minEdge filter in TS (|edge_pct| >= minEdge*100). Doing it here
  // rather than in PG simplifies the SQL — minEdge is typically 0/0.05/0.1/0.15.
  const minEdgePct = minEdge * 100;
  const edgeFiltered =
    minEdgePct > 0
      ? props.filter((p) => Math.abs(p.edge_pct ?? 0) >= minEdgePct)
      : props;

  if (edgeFiltered.length === 0) {
    const body: PlayerPropsResponse = {
      as_of: new Date().toISOString(),
      sport,
      date: effectiveDate,
      requested_date: requestedDate,
      fallback_used: effectiveDate !== requestedDate,
      filters: baseFilters,
      entries: [],
    };
    return Response.json(body, {
      headers: { "Cache-Control": "public, s-maxage=30, stale-while-revalidate=120" },
    });
  }

  // ─── (3) History for "Last N" — build last-10 outcomes per (player, market) ─
  const distinctPairs = new Set<string>();
  for (const p of edgeFiltered) {
    distinctPairs.add(`${p.player_id}:${p.prop_market}`);
  }
  const distinctPlayerIds = Array.from(new Set(edgeFiltered.map((p) => p.player_id)));
  const distinctMarkets = Array.from(new Set(edgeFiltered.map((p) => p.prop_market)));

  // Pull historical prop_predictions for these players+markets, ordered by
  // computed_at DESC so we can take the most recent N per pair.
  const { data: historyData, error: histErr } = await supabase
    .from("prop_predictions")
    .select("id, player_id, prop_market, computed_at")
    .in("player_id", distinctPlayerIds)
    .in("prop_market", distinctMarkets)
    .order("computed_at", { ascending: false });
  if (histErr) return Response.json({ error: histErr.message }, { status: 500 });
  const historyRows = (historyData ?? []) as HistoryRow[];

  // Resolve outcomes for those historical predictions.
  const allHistoryIds = historyRows.map((h) => h.id);
  let resultsRows: ResultRow[] = [];
  if (allHistoryIds.length > 0) {
    const { data: resultData, error: resultErr } = await supabase
      .from("prediction_results")
      .select("prop_prediction_id, outcome, resolved_at")
      .in("prop_prediction_id", allHistoryIds);
    if (resultErr) return Response.json({ error: resultErr.message }, { status: 500 });
    resultsRows = (resultData ?? []) as ResultRow[];
  }
  const outcomeByPropId = new Map<number, string>();
  for (const r of resultsRows) outcomeByPropId.set(r.prop_prediction_id, r.outcome);

  // Build per-pair history: up to 10 resolved outcomes, ordered oldest→newest.
  const recentByPair = new Map<string, boolean[]>();
  const historyByPair = new Map<string, HistoryRow[]>();
  for (const h of historyRows) {
    const key = `${h.player_id}:${h.prop_market}`;
    if (!distinctPairs.has(key)) continue;
    const arr = historyByPair.get(key) ?? [];
    arr.push(h);
    historyByPair.set(key, arr);
  }
  for (const [pair, rows] of historyByPair.entries()) {
    // rows are sorted DESC; collect resolved outcomes, take top 10, reverse to
    // oldest-first.
    const resolved: boolean[] = [];
    for (const h of rows) {
      const outcome = outcomeByPropId.get(h.id);
      if (outcome === "win") resolved.push(true);
      else if (outcome === "loss") resolved.push(false);
      // push/void/unresolved → skip (don't pollute the "last 10")
      if (resolved.length === 10) break;
    }
    recentByPair.set(pair, resolved.reverse());
  }

  // ─── (4) Assemble DTOs ───────────────────────────────────────────────────
  // Distinct team ids for join lookup.
  const teamIds = new Set<number>();
  for (const p of edgeFiltered) {
    if (p.player?.team_id) teamIds.add(p.player.team_id);
  }
  const { data: teamData } = await supabase
    .from("teams")
    .select("id, abbreviation")
    .in("id", Array.from(teamIds));
  const teamAbbr = new Map<number, string>();
  for (const t of (teamData ?? []) as Array<{ id: number; abbreviation: string }>) {
    teamAbbr.set(t.id, t.abbreviation);
  }

  function buildEntry(row: PropRow): PlayerPropDto | null {
    const game = gameById.get(row.game_id);
    if (!game || !row.player) return null;
    const playerTeam = row.player.team_id ? teamAbbr.get(row.player.team_id) ?? "—" : "—";
    const homeAbbr = game.home_team?.abbreviation ?? "—";
    const awayAbbr = game.away_team?.abbreviation ?? "—";
    const isHome = row.player.team_id === game.home_team?.id;
    const opponent = isHome ? `vs ${awayAbbr}` : `@ ${homeAbbr}`;
    const propType = DB_TO_UI_PROP_MARKET[row.prop_market] ?? row.prop_market;

    const edgePct = row.edge_pct ?? 0;
    const side: "over" | "under" = edgePct >= 0 ? "over" : "under";
    const edgeAbs = Math.min(1, Math.abs(edgePct) / 100);

    const pairKey = `${row.player_id}:${row.prop_market}`;
    const recent = recentByPair.get(pairKey) ?? [];
    const hits = recent.filter(Boolean).length;

    const player: PlayerDto = {
      id: String(row.player_id),
      name: row.player.full_name,
      team: playerTeam,
      opponent,
      gameTime: formatTimeET(game.game_date),
      position: row.player.position_abbr ?? "—",
    };

    return {
      id: String(row.id),
      sport,
      player,
      propType,
      line: row.prop_line,
      side,
      odds: formatOdds(row.best_odds_american),
      hitsLast10: hits,
      recent10: recent,
      edge: edgeAbs,
      edgeRaw: edgePct / 100,
      tier: (row.tier ?? "good") as PropTier,
      signals: Array.isArray(row.signals) ? row.signals : [],
    };
  }

  const entries: PlayerPropDto[] = [];
  for (const p of edgeFiltered) {
    const dto = buildEntry(p);
    if (dto) entries.push(dto);
  }

  // Signal filter applied server-side via .contains() above (AND-semantics
  // against the GIN index). DTO list is already correctly filtered — no
  // post-process needed.
  const finalEntries = entries;

  const body: PlayerPropsResponse = {
    as_of: new Date().toISOString(),
    sport,
    date: effectiveDate,
    requested_date: requestedDate,
    fallback_used: effectiveDate !== requestedDate,
    filters: baseFilters,
    entries: finalEntries,
  };
  return Response.json(body, {
    headers: { "Cache-Control": "public, s-maxage=30, stale-while-revalidate=120" },
  });
}
