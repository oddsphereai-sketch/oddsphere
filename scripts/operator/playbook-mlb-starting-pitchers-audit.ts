/**
 * Read-only MLB Playbook starting-pitcher audit.
 *
 * Purpose: compare Playbook's confirmed/probable starters against the starter
 * IDs feeding our MLB projection snapshots. No writes. No model changes.
 *
 * Usage:
 *   npx tsx --env-file=.env.local scripts/operator/playbook-mlb-starting-pitchers-audit.ts --date 2026-06-24
 */

import { supabase } from "../../lib/db/supabase";
import { PlaybookClient } from "../../lib/providers/playbook/playbookClient";
import type { PlaybookStartingPitchersRow } from "../../lib/providers/playbook/types";
import { readStringFlag, todayUTC } from "./_cliCommon";

type GameRow = {
  id: number;
  external_id: number;
  slate_date: string;
  game_date: string;
  status: string | null;
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
  external_id: number | null;
  full_name: string;
  team_id: number | null;
  throws: string | null;
  active: boolean | null;
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

function matchupKey(awayId: string | null, homeId: string | null): string | null {
  if (!awayId || !homeId) return null;
  return `${awayId.toUpperCase()}@${homeId.toUpperCase()}`;
}

function ageMinutes(iso: string | null | undefined): number | null {
  if (!iso) return null;
  const t = new Date(iso).getTime();
  if (!Number.isFinite(t)) return null;
  return Math.round((Date.now() - t) / 60000);
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

function namesMatch(a: string | null | undefined, b: string | null | undefined): boolean {
  const aa = normalizeName(a);
  const bb = normalizeName(b);
  return aa.length > 0 && bb.length > 0 && aa === bb;
}

function throwsMatch(a: string | null | undefined, b: string | null | undefined): boolean | null {
  if (!a || !b) return null;
  const aa = a.trim().toUpperCase().slice(0, 1);
  const bb = b.trim().toUpperCase().slice(0, 1);
  if (!aa || !bb) return null;
  return aa === bb;
}

function fmt(v: unknown): string {
  if (v === null || v === undefined || v === "") return "-";
  return String(v);
}

function closestPlaybookRow(
  rows: PlaybookStartingPitchersRow[],
  gameDateIso: string
): PlaybookStartingPitchersRow | undefined {
  if (rows.length <= 1) return rows[0];
  const gameTs = new Date(gameDateIso).getTime();
  if (!Number.isFinite(gameTs)) return rows[0];
  return [...rows].sort((a, b) => {
    const at = new Date(a.startTime ?? "").getTime();
    const bt = new Date(b.startTime ?? "").getTime();
    const ad = Number.isFinite(at) ? Math.abs(at - gameTs) : Number.MAX_SAFE_INTEGER;
    const bd = Number.isFinite(bt) ? Math.abs(bt - gameTs) : Number.MAX_SAFE_INTEGER;
    return ad - bd;
  })[0];
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
    .select(
      "id, external_id, slate_date, game_date, status, home_team_id, away_team_id, home_pitcher_id, away_pitcher_id"
    )
    .eq("sport", "mlb")
    .eq("slate_date", date)
    .order("game_date");
  if (gErr) throw new Error(`games query failed: ${gErr.message}`);

  const games = (gamesRaw ?? []) as GameRow[];
  const teamIds = [...new Set(games.flatMap((g) => [g.home_team_id, g.away_team_id]))];
  const pitcherIds = [
    ...new Set(
      games
        .flatMap((g) => [g.home_pitcher_id, g.away_pitcher_id])
        .filter((id): id is number => typeof id === "number")
    ),
  ];

  const [{ data: teamsRaw, error: tErr }, { data: playersRaw, error: pErr }] = await Promise.all([
    supabase.from("teams").select("id, abbreviation, name").eq("sport", "mlb").in("id", teamIds),
    pitcherIds.length
      ? supabase
          .from("players")
          .select("id, external_id, full_name, team_id, throws, active")
          .in("id", pitcherIds)
      : Promise.resolve({ data: [], error: null }),
  ]);
  if (tErr) throw new Error(`teams query failed: ${tErr.message}`);
  if (pErr) throw new Error(`players query failed: ${pErr.message}`);

  const teams = new Map(((teamsRaw ?? []) as TeamRow[]).map((t) => [t.id, t]));
  const players = new Map(((playersRaw ?? []) as PlayerRow[]).map((p) => [p.id, p]));

  const client = new PlaybookClient(key);
  const res = await client.mlbStartingPitchers();
  const playbookRows = res.body.data ?? [];

  const playbookByMatchup = new Map<string, PlaybookStartingPitchersRow[]>();
  for (const row of playbookRows) {
    const key = matchupKey(row.awayTeamId ?? null, row.homeTeamId ?? null);
    if (!key) continue;
    const existing = playbookByMatchup.get(key) ?? [];
    existing.push(row);
    playbookByMatchup.set(key, existing);
  }

  console.log(`[playbook-mlb-starting-pitchers-audit] date=${date} mode=READ-ONLY`);
  console.log(`Playbook rows=${playbookRows.length} slate games=${games.length}`);
  console.log("game        pbStart            dbHome -> pbHome              dbAway -> pbAway              flags");

  let matchedGames = 0;
  let missingPlaybookGames = 0;
  let missingDbStarterSides = 0;
  let missingPlaybookStarterSides = 0;
  let nameMismatches = 0;
  let throwsMismatches = 0;
  let staleSides = 0;

  for (const g of games) {
    const home = teams.get(g.home_team_id);
    const away = teams.get(g.away_team_id);
    const homePbId = playbookTeamId(home?.abbreviation);
    const awayPbId = playbookTeamId(away?.abbreviation);
    const key = matchupKey(awayPbId, homePbId);
    const pb = key ? closestPlaybookRow(playbookByMatchup.get(key) ?? [], g.game_date) : undefined;
    const matchup = `${away?.abbreviation ?? "?"}@${home?.abbreviation ?? "?"}`;

    const dbHome = g.home_pitcher_id !== null ? players.get(g.home_pitcher_id) : undefined;
    const dbAway = g.away_pitcher_id !== null ? players.get(g.away_pitcher_id) : undefined;
    const pbHome = pb?.starters?.home ?? null;
    const pbAway = pb?.starters?.away ?? null;
    const flags: string[] = [];

    if (!pb) {
      missingPlaybookGames++;
      flags.push("missing_playbook_game");
    } else {
      matchedGames++;
    }

    for (const side of ["home", "away"] as const) {
      const dbStarter = side === "home" ? dbHome : dbAway;
      const pbStarter = side === "home" ? pbHome : pbAway;
      if (!dbStarter) {
        missingDbStarterSides++;
        flags.push(`${side}_db_starter_missing`);
      }
      if (!pbStarter?.name) {
        missingPlaybookStarterSides++;
        flags.push(`${side}_playbook_starter_missing`);
      }
      if (dbStarter && pbStarter?.name && !namesMatch(dbStarter.full_name, pbStarter.name)) {
        nameMismatches++;
        flags.push(`${side}_name_mismatch`);
      }
      const handOk = throwsMatch(dbStarter?.throws, pbStarter?.throws);
      if (handOk === false) {
        throwsMismatches++;
        flags.push(`${side}_throws_mismatch`);
      }
      const age = ageMinutes(pbStarter?.lastSeenAt);
      if (age !== null && age > 180) {
        staleSides++;
        flags.push(`${side}_pb_seen_${age}m_ago`);
      }
    }

    const homeText = `${fmt(dbHome?.full_name)}(${fmt(dbHome?.throws)}) -> ${fmt(pbHome?.name)}(${fmt(pbHome?.throws)})`;
    const awayText = `${fmt(dbAway?.full_name)}(${fmt(dbAway?.throws)}) -> ${fmt(pbAway?.name)}(${fmt(pbAway?.throws)})`;
    console.log(
      `${matchup.padEnd(11)} ${fmt(pb?.startTime).padEnd(18)} ${homeText.padEnd(28)} ${awayText.padEnd(28)} ${
        flags.join(",") || "-"
      }`
    );
  }

  console.log(
    `\nSummary: matchedGames=${matchedGames} missingPlaybookGames=${missingPlaybookGames} ` +
      `missingDbStarterSides=${missingDbStarterSides} missingPlaybookStarterSides=${missingPlaybookStarterSides} ` +
      `nameMismatches=${nameMismatches} throwsMismatches=${throwsMismatches} stalePlaybookSides=${staleSides}`
  );
  console.log("Next gate: use this as a pre-model warning/cross-check before any Playbook starter promotion.");
  console.log("✓ Read-only. No writes.");
}

main().catch((e) => {
  console.error(`FATAL: ${(e as Error).message}`);
  process.exit(2);
});
