/**
 * WNBA Phase 2 — Stage 1 seed service (2026-06-23).
 *
 * Writes the WNBA slate into the DB so the route reads snapshots instead of
 * live-computing. Mirrors NBA's seedNbaGamesService pattern: upsert the 15
 * franchises into `teams` (onConflict sport,external_id), resolve BDL team id →
 * teams.id, then upsert the day's games into `games` (onConflict sport,external_id).
 *
 * Source: BallDontLie `/wnba/v1/games?dates[]=`. BDL's `date` is the game's US
 * calendar date at midnight UTC (no precise tip time here) — so slate_date is
 * taken from that date string directly (NOT computeSlateDate on the midnight
 * timestamp, which would shift to the previous ET day). game_date is the same
 * placeholder for now; the real tip time is refined from SharpAPI
 * event_start_time during refreshWnbaLines (needed for T-60 lock — Stage 2).
 *
 * Only the 15 real franchises seed; All-Star / national / TBD squads drop out.
 */

import type { SupabaseClient } from "@supabase/supabase-js";
import { computeSlateDate } from "../../dates/slateDate";
import { PlaybookClient } from "../../providers/playbook/playbookClient";
import { resolveTeam } from "../../providers/playbook/playbookTeamNormalizer";
import { WNBA_TEAMS_BY_BDL_ID, isRealWnbaTeam } from "./wnbaTeams";

const BDL = "https://api.balldontlie.io/wnba/v1";

export type SeedWnbaResult = {
  mode: "ok" | "no-events";
  teamsUpserted: number;
  gamesUpserted: number;
  games: Array<{ external_id: number; slate_date: string; matchup: string; status: string }>;
  errors: string[];
};

type BdlRow = {
  id: number;
  date: string;
  season: number;
  postseason: boolean;
  status: string;
  home_team?: { id: number };
  visitor_team?: { id: number };
  home_score?: number;
  away_score?: number;
};

let playbookSlateCache:
  | { key: string; loadedAt: number; map: Map<string, string> }
  | null = null;

function hasSpecificTipTime(value: string | null | undefined): value is string {
  if (!value) return false;
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return false;
  return d.getUTCHours() !== 0 || d.getUTCMinutes() !== 0 || d.getUTCSeconds() !== 0;
}

async function bdlGamesByDate(key: string, dates: string[]): Promise<BdlRow[]> {
  const qs = dates.map((d) => `dates[]=${d}`).join("&");
  const out: BdlRow[] = [];
  let cursor: number | undefined;
  for (let p = 0; p < 6; p++) {
    const r = await fetch(`${BDL}/games?${qs}&per_page=100${cursor ? `&cursor=${cursor}` : ""}`, {
      headers: { Authorization: key },
    });
    if (!r.ok) throw new Error(`BDL games HTTP ${r.status}`);
    const j = (await r.json()) as { data?: BdlRow[]; meta?: { next_cursor?: number } };
    out.push(...(j.data ?? []));
    cursor = j.meta?.next_cursor;
    if (!cursor) break;
  }
  return out;
}

async function playbookSlateByMatchup(key: string): Promise<Map<string, string>> {
  if (playbookSlateCache && playbookSlateCache.key === key && Date.now() - playbookSlateCache.loadedAt < 5 * 60_000) {
    return playbookSlateCache.map;
  }
  const out = new Map<string, string>();
  const client = new PlaybookClient(key);
  const rows = (await client.splits("wnba")).body.data ?? [];
  for (const row of rows) {
    const away = resolveTeam("wnba", row.awayTeamName)?.abbr;
    const home = resolveTeam("wnba", row.homeTeamName)?.abbr;
    if (!away || !home || !row.startTime) continue;
    out.set(`${away}@${home}`, computeSlateDate("wnba", row.startTime));
  }
  playbookSlateCache = { key, loadedAt: Date.now(), map: out };
  return out;
}

export async function seedWnbaGames(opts: {
  supabase: SupabaseClient;
  slateDate: string;
  apply: boolean;
  logger?: (m: string) => void;
}): Promise<SeedWnbaResult> {
  const { supabase, slateDate, apply, logger = () => {} } = opts;
  const key = process.env.BALLDONTLIE_API_KEY;
  if (!key) throw new Error("missing BALLDONTLIE_API_KEY");
  const errors: string[] = [];

  // 1. Seed the 15 franchises; build BDL id → teams.id map.
  const teamIdByBdl = new Map<number, number>();
  let teamsUpserted = 0;
  if (apply) {
    for (const [bdlIdStr, meta] of Object.entries(WNBA_TEAMS_BY_BDL_ID)) {
      const bdlId = Number(bdlIdStr);
      const payload = {
        external_id: bdlId,
        sport: "wnba",
        abbreviation: meta.abbr,
        display_name: meta.name,
        short_display_name: meta.abbr,
        name: meta.name,
        slug: meta.abbr.toLowerCase(),
        location: "",
        provider_ids: { bdl: { id: bdlIdStr } },
      };
      const { data, error } = await supabase
        .from("teams")
        .upsert(payload, { onConflict: "sport,external_id" })
        .select("id")
        .single();
      if (error) {
        errors.push(`team ${meta.abbr}: ${error.message}`);
        continue;
      }
      teamIdByBdl.set(bdlId, data!.id as number);
      teamsUpserted++;
    }
  }
  // Always (re)load the id map from DB so games can resolve FKs (covers dry-run
  // and any teams that already existed).
  {
    const { data } = await supabase.from("teams").select("id,external_id").eq("sport", "wnba");
    for (const t of data ?? []) teamIdByBdl.set(t.external_id as number, t.id as number);
  }

  // 2. Fetch BDL games for slateDate + next UTC day (ET boundary). BDL's WNBA
  // date can be a UTC placeholder, so when Playbook is configured we use its
  // real startTime to bucket the game into the correct ET betting slate.
  const next = new Date(+new Date(`${slateDate}T00:00:00Z`) + 86400000).toISOString().slice(0, 10);
  const raw = await bdlGamesByDate(key, [slateDate, next]);
  const existingByExternalId = new Map<number, { game_date: string | null; slate_date: string | null }>();
  if (raw.length > 0) {
    const { data: existing } = await supabase
      .from("games")
      .select("external_id, game_date, slate_date")
      .eq("sport", "wnba")
      .in("external_id", raw.map((g) => g.id));
    for (const row of existing ?? []) {
      existingByExternalId.set(row.external_id as number, {
        game_date: (row.game_date as string | null) ?? null,
        slate_date: (row.slate_date as string | null) ?? null,
      });
    }
  }
  let playbookSlate = new Map<string, string>();
  if (process.env.PLAYBOOK_API_KEY) {
    try {
      playbookSlate = await playbookSlateByMatchup(process.env.PLAYBOOK_API_KEY);
    } catch (e) {
      errors.push(`playbook slate bucket: ${e instanceof Error ? e.message : String(e)}`);
    }
  }
  const slateFor = (g: BdlRow): string => {
    const homeAbbr = WNBA_TEAMS_BY_BDL_ID[g.home_team!.id]?.abbr ?? "?";
    const awayAbbr = WNBA_TEAMS_BY_BDL_ID[g.visitor_team!.id]?.abbr ?? "?";
    const playbookDate = playbookSlate.get(`${awayAbbr}@${homeAbbr}`);
    if (playbookDate) return playbookDate;
    const existingTip = existingByExternalId.get(g.id)?.game_date;
    if (hasSpecificTipTime(existingTip)) return computeSlateDate("wnba", existingTip);
    if (hasSpecificTipTime(g.date)) return computeSlateDate("wnba", g.date);
    return String(g.date).slice(0, 10);
  };
  const games = raw.filter((g) => {
    if (
      g.home_team == null ||
      g.visitor_team == null ||
      !isRealWnbaTeam(g.home_team.id) ||
      !isRealWnbaTeam(g.visitor_team.id)
    ) {
      return false;
    }
    return slateFor(g) === slateDate;
  });
  if (games.length === 0) {
    logger(`wnba seed ${slateDate}: no real-franchise games`);
    return { mode: "no-events", teamsUpserted, gamesUpserted: 0, games: [], errors };
  }

  // 3. Upsert games.
  let gamesUpserted = 0;
  const planned: SeedWnbaResult["games"] = [];
  for (const g of games) {
    const homeId = teamIdByBdl.get(g.home_team!.id) ?? null;
    const awayId = teamIdByBdl.get(g.visitor_team!.id) ?? null;
    const isFinal = ["post", "final"].includes(String(g.status).toLowerCase());
    const status = isFinal ? "final" : "scheduled";
    const hs = typeof g.home_score === "number" ? g.home_score : null;
    const as = typeof g.away_score === "number" ? g.away_score : null;
    const homeAbbr = WNBA_TEAMS_BY_BDL_ID[g.home_team!.id]?.abbr ?? "?";
    const awayAbbr = WNBA_TEAMS_BY_BDL_ID[g.visitor_team!.id]?.abbr ?? "?";
    const gameSlateDate = slateFor(g);
    const existingTip = existingByExternalId.get(g.id)?.game_date;
    const gameDate = hasSpecificTipTime(existingTip) ? existingTip : g.date;
    planned.push({ external_id: g.id, slate_date: gameSlateDate, matchup: `${awayAbbr}@${homeAbbr}`, status });
    if (apply) {
      const payload = {
        external_id: g.id,
        sport: "wnba",
        home_team_id: homeId,
        away_team_id: awayId,
        game_date: gameDate, // placeholder UTC; refined from SharpAPI tip time in refreshWnbaLines
        slate_date: gameSlateDate,
        season: g.season,
        season_type: g.postseason ? "postseason" : "regular",
        postseason: !!g.postseason,
        status,
        home_score: isFinal ? hs : null,
        away_score: isFinal ? as : null,
      };
      const { error } = await supabase.from("games").upsert(payload, { onConflict: "sport,external_id" });
      if (error) {
        errors.push(`game ${g.id}: ${error.message}`);
        continue;
      }
      gamesUpserted++;
    }
  }
  logger(`wnba seed ${slateDate}: teams ${teamsUpserted}, games ${apply ? gamesUpserted : planned.length} (apply=${apply})`);
  return { mode: "ok", teamsUpserted, gamesUpserted, games: planned, errors };
}
