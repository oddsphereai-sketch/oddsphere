/**
 * Read-only MLB Playbook injuries audit.
 *
 * Purpose: compare Playbook's injury feed against the active injuries that
 * currently feed MLB projections. No writes. No model changes.
 *
 * Usage:
 *   npx tsx --env-file=.env.local scripts/operator/playbook-mlb-injuries-audit.ts --date 2026-06-24
 */

import { supabase } from "../../lib/db/supabase";
import { PlaybookClient } from "../../lib/providers/playbook/playbookClient";
import type {
  PlaybookInjuryPlayer,
  PlaybookInjuryTeamRow,
} from "../../lib/providers/playbook/types";
import { readStringFlag, todayUTC } from "./_cliCommon";

type GameRow = {
  id: number;
  external_id: number;
  game_date: string;
  home_team_id: number;
  away_team_id: number;
  home_pitcher_id: number | null;
  away_pitcher_id: number | null;
};

type TeamRow = {
  id: number;
  abbreviation: string;
  name: string;
};

type PlayerRow = {
  id: number;
  full_name: string;
  team_id: number | null;
};

type LineupRow = {
  game_id: number;
  team_id: number;
  player_id: number;
  batting_position: number | null;
  starting_position: string | null;
};

type InjuryRow = {
  player_id: number | null;
  status: string | null;
  detail: string | null;
  short_comment: string | null;
  updated_at: string | null;
  is_active: boolean | null;
};

const PLAYBOOK_MLB_TEAM_ID_BY_ODDSPHERE_ABBR: Record<string, string> = {
  LAA: "ANA",
  CWS: "CHA",
  CHC: "CHN",
  KC: "KCA",
  LAD: "LAN",
  NYY: "NYA",
  NYM: "NYN",
  SD: "SDN",
  SF: "SFN",
  STL: "SLN",
  TB: "TBA",
  WSH: "WAS",
};

function playbookTeamId(abbr: string | undefined): string | null {
  if (!abbr) return null;
  const upper = abbr.toUpperCase();
  return PLAYBOOK_MLB_TEAM_ID_BY_ODDSPHERE_ABBR[upper] ?? upper;
}

function cleanString(v: unknown): string | null {
  if (typeof v !== "string") return null;
  const trimmed = v.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function normalizeName(name: string | null | undefined): string {
  return (name ?? "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/\b(jr|sr|ii|iii|iv)\b\.?/g, "")
    .replace(/[^a-z0-9]+/g, " ")
    .trim()
    .replace(/\s+/g, " ");
}

function statusLooksUnavailable(status: string | null | undefined): boolean {
  const s = (status ?? "").toLowerCase();
  return (
    s.includes("out") ||
    s.includes("il") ||
    s.includes("injured") ||
    s.includes("doubtful") ||
    s.includes("suspended")
  );
}

function fmt(v: unknown): string {
  if (v === null || v === undefined || v === "") return "-";
  return String(v);
}

function ageMinutes(iso: string | null | undefined): number | null {
  if (!iso) return null;
  const t = new Date(iso).getTime();
  if (!Number.isFinite(t)) return null;
  return Math.round((Date.now() - t) / 60000);
}

function rowTeamKey(row: PlaybookInjuryTeamRow): string | null {
  const id = cleanString(row.teamId)?.toUpperCase();
  if (id) return id;
  return cleanString(row.teamAbbr)?.toUpperCase() ?? null;
}

function playerLabel(p: PlaybookInjuryPlayer): string {
  const bits = [
    fmt(p.name),
    fmt(p.status),
    fmt(p.statusContext),
    fmt(p.reason),
  ].filter((x) => x !== "-");
  return bits.join(" · ") || "-";
}

async function main(): Promise<void> {
  const argv = process.argv.slice(2);
  if (argv.includes("--write")) {
    console.error("READ-ONLY. --write is not supported.");
    process.exit(1);
  }

  const date = readStringFlag(argv, "--date") ?? todayUTC();
  const key = process.env.PLAYBOOK_API_KEY;
  if (!key) throw new Error("missing PLAYBOOK_API_KEY");

  const { data: gamesRaw, error: gErr } = await supabase
    .from("games")
    .select("id, external_id, game_date, home_team_id, away_team_id, home_pitcher_id, away_pitcher_id")
    .eq("sport", "mlb")
    .eq("slate_date", date)
    .order("game_date");
  if (gErr) throw new Error(`games query failed: ${gErr.message}`);

  const games = (gamesRaw ?? []) as GameRow[];
  const teamIds = [...new Set(games.flatMap((g) => [g.home_team_id, g.away_team_id]))];
  const gameIds = games.map((g) => g.id);

  const [{ data: teamsRaw, error: tErr }, { data: playersRaw, error: pErr }, { data: lineupsRaw, error: lErr }] =
    await Promise.all([
      supabase.from("teams").select("id, abbreviation, name").eq("sport", "mlb").in("id", teamIds),
      teamIds.length
        ? supabase.from("players").select("id, full_name, team_id").in("team_id", teamIds)
        : Promise.resolve({ data: [], error: null }),
      gameIds.length
        ? supabase
            .from("lineups")
            .select("game_id, team_id, player_id, batting_position, starting_position")
            .in("game_id", gameIds)
        : Promise.resolve({ data: [], error: null }),
    ]);
  if (tErr) throw new Error(`teams query failed: ${tErr.message}`);
  if (pErr) throw new Error(`players query failed: ${pErr.message}`);
  if (lErr) throw new Error(`lineups query failed: ${lErr.message}`);

  const players = (playersRaw ?? []) as PlayerRow[];
  const playerIds = players.map((p) => p.id);
  const { data: injuriesRaw, error: iErr } = playerIds.length
    ? await supabase
        .from("player_injuries")
        .select("player_id, status, detail, short_comment, updated_at, is_active")
        .in("player_id", playerIds)
        .eq("is_active", true)
    : { data: [], error: null };
  if (iErr) throw new Error(`player_injuries query failed: ${iErr.message}`);

  const teams = new Map(((teamsRaw ?? []) as TeamRow[]).map((t) => [t.id, t]));
  const playerById = new Map(players.map((p) => [p.id, p]));
  const playerByTeamAndName = new Map<string, PlayerRow>();
  for (const p of players) {
    if (p.team_id === null) continue;
    playerByTeamAndName.set(`${p.team_id}:${normalizeName(p.full_name)}`, p);
  }

  const dbInjuriesByPlayer = new Map<number, InjuryRow[]>();
  for (const row of (injuriesRaw ?? []) as InjuryRow[]) {
    if (row.player_id === null) continue;
    const list = dbInjuriesByPlayer.get(row.player_id) ?? [];
    list.push(row);
    dbInjuriesByPlayer.set(row.player_id, list);
  }

  const top3ByTeam = new Map<number, Set<number>>();
  for (const l of (lineupsRaw ?? []) as LineupRow[]) {
    if (l.batting_position === null || l.batting_position < 1 || l.batting_position > 3) continue;
    const set = top3ByTeam.get(l.team_id) ?? new Set<number>();
    set.add(l.player_id);
    top3ByTeam.set(l.team_id, set);
  }

  const pitcherIds = new Set(
    games
      .flatMap((g) => [g.home_pitcher_id, g.away_pitcher_id])
      .filter((id): id is number => typeof id === "number"),
  );

  const client = new PlaybookClient(key);
  const res = await client.injuries("mlb");
  const playbookRows = res.body.data ?? [];
  const playbookByTeam = new Map<string, PlaybookInjuryTeamRow>();
  for (const row of playbookRows) {
    const key = rowTeamKey(row);
    if (key) playbookByTeam.set(key, row);
  }

  console.log(`[playbook-mlb-injuries-audit] date=${date} mode=READ-ONLY`);
  console.log(
    `Playbook rows=${playbookRows.length} slate teams=${teamIds.length} reportDate=${fmt(res.body.reportDate)} updatedAt=${fmt(res.body.updatedAt)} remaining=${fmt(res.requestsRemaining)}`,
  );
  console.log("team  pbInj dbInj mapped unavailable top3 starter age flags");

  let missingPlaybookTeams = 0;
  let playbookPlayers = 0;
  let mappedPlayers = 0;
  let dbOnlyActive = 0;
  let playbookUnavailable = 0;
  let top3Unavailable = 0;
  let starterUnavailable = 0;
  const statusCounts = new Map<string, number>();
  const pbReportAgeMinutes = ageMinutes(res.body.updatedAt ?? null);

  for (const teamId of teamIds) {
    const team = teams.get(teamId);
    const pbId = playbookTeamId(team?.abbreviation);
    const pb = pbId ? playbookByTeam.get(pbId) : undefined;
    const pbPlayers = pb?.players ?? [];
    const dbActivePlayers = players.filter((p) => p.team_id === teamId && dbInjuriesByPlayer.has(p.id));
    const flags: string[] = [];

    if (!pb) {
      missingPlaybookTeams++;
      flags.push("missing_playbook_team");
    }

    let teamMapped = 0;
    let teamUnavailable = 0;
    let teamTop3 = 0;
    let teamStarter = 0;

    const mappedPbIds = new Set<number>();
    for (const pbPlayer of pbPlayers) {
      playbookPlayers++;
      const statusKey = cleanString(pbPlayer.status) ?? "unknown";
      statusCounts.set(statusKey, (statusCounts.get(statusKey) ?? 0) + 1);
      const name = cleanString(pbPlayer.name);
      const mapped = name ? playerByTeamAndName.get(`${teamId}:${normalizeName(name)}`) : undefined;
      if (mapped) {
        mappedPlayers++;
        teamMapped++;
        mappedPbIds.add(mapped.id);
      }
      const unavailable =
        statusLooksUnavailable(cleanString(pbPlayer.status)) ||
        statusLooksUnavailable(cleanString(pbPlayer.statusContext));
      if (unavailable) {
        playbookUnavailable++;
        teamUnavailable++;
        if (mapped && top3ByTeam.get(teamId)?.has(mapped.id)) {
          top3Unavailable++;
          teamTop3++;
        }
        if (mapped && pitcherIds.has(mapped.id)) {
          starterUnavailable++;
          teamStarter++;
        }
      }
    }

    const dbOnly = dbActivePlayers.filter((p) => !mappedPbIds.has(p.id));
    dbOnlyActive += dbOnly.length;
    if (dbOnly.length > 0) flags.push(`db_only=${dbOnly.length}`);
    if (teamTop3 > 0) flags.push(`top3_unavailable=${teamTop3}`);
    if (teamStarter > 0) flags.push(`starter_unavailable=${teamStarter}`);

    const age = ageMinutes(pb?.updatedAt ?? res.body.updatedAt ?? null);
    console.log(
      `${fmt(team?.abbreviation).padEnd(5)} ${String(pbPlayers.length).padEnd(5)} ${String(dbActivePlayers.length).padEnd(5)} ${String(teamMapped).padEnd(6)} ${String(teamUnavailable).padEnd(11)} ${String(teamTop3).padEnd(4)} ${String(teamStarter).padEnd(7)} ${fmt(age).padEnd(4)} ${flags.join(",") || "-"}`,
    );

    if (argv.includes("--verbose") && pbPlayers.length > 0) {
      for (const p of pbPlayers) {
        console.log(`  - ${playerLabel(p)}`);
      }
    }
  }

  console.log(
    `\nSummary: missingPlaybookTeams=${missingPlaybookTeams} playbookPlayers=${playbookPlayers} mappedPlayers=${mappedPlayers} playbookUnavailable=${playbookUnavailable} top3Unavailable=${top3Unavailable} starterUnavailable=${starterUnavailable} dbOnlyActive=${dbOnlyActive}`,
  );
  const statusSummary = [...statusCounts.entries()]
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .map(([status, count]) => `${status}:${count}`)
    .join(", ");
  console.log(`Status distribution: ${statusSummary || "-"}`);
  console.log(
    `Freshness: reportAgeMinutes=${fmt(pbReportAgeMinutes)} ` +
      `${pbReportAgeMinutes !== null && pbReportAgeMinutes > 360 ? "STALE_FOR_MODEL_PROMOTION" : "fresh_enough_for_audit"}`,
  );
  console.log("✓ Read-only. No writes.");
}

main().catch((e) => {
  console.error(e instanceof Error ? e.message : String(e));
  process.exit(1);
});
