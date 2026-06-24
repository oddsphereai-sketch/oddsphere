/**
 * Read-only MLB Playbook venue/weather context audit.
 *
 * Purpose: observe the projection-moving Playbook venue-weather lane before
 * promotion. No writes. No model changes.
 *
 * Usage:
 *   npx tsx --env-file=.env.local scripts/operator/playbook-mlb-venue-weather-audit.ts --date 2026-06-24
 */

import { supabase } from "../../lib/db/supabase";
import { PlaybookClient } from "../../lib/providers/playbook/playbookClient";
import type { PlaybookVenueWeatherRow } from "../../lib/providers/playbook/types";
import { readStringFlag, todayUTC } from "./_cliCommon";

type GameRow = {
  id: number;
  external_id: number;
  slate_date: string;
  game_date: string;
  status: string | null;
  home_team_id: number;
  away_team_id: number;
  predicted_total?: number | null;
  sport_specific?: unknown;
};
type PredictionRow = {
  game_id: number;
  predicted_total: number | null;
  sport_specific: unknown;
};

type TeamRow = { id: number; abbreviation: string; name: string };
type WeatherRow = {
  game_id: number;
  temperature_f: number | null;
  wind_speed_mph: number | null;
  precipitation_probability: number | null;
  conditions: string | null;
  fetched_at: string | null;
};
type BallparkRow = {
  team_id: number;
  name: string | null;
  park_factor_runs: number | null;
  is_dome: boolean | null;
  is_retractable: boolean | null;
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

function ageMinutes(iso: string | null | undefined): number | null {
  if (!iso) return null;
  const t = new Date(iso).getTime();
  if (!Number.isFinite(t)) return null;
  return Math.round((Date.now() - t) / 60000);
}

function n(v: unknown): number | null {
  return typeof v === "number" && Number.isFinite(v) ? v : null;
}

function fmt(v: unknown): string {
  if (v === null || v === undefined || v === "") return "-";
  if (typeof v === "number") return Number.isInteger(v) ? String(v) : v.toFixed(1);
  return String(v);
}

function candidateRunAdj(row: PlaybookVenueWeatherRow): number {
  const profile = String(row.venue?.parkProfile ?? "").toUpperCase();
  const roof = String(row.venue?.roofStatus?.status ?? "").toUpperCase();
  const temp = n(row.conditions?.tempF);
  const windMph = n(row.conditions?.wind?.mph);
  const windType = String(row.conditions?.wind?.type ?? "").toUpperCase();

  let adj = 0;
  if (profile === "HITTER") adj += 0.25;
  else if (profile === "SLIGHT_HITTER") adj += 0.12;
  else if (profile === "PITCHER") adj -= 0.25;
  else if (profile === "SLIGHT_PITCHER") adj -= 0.12;

  const weatherSuppressed = roof === "CLOSED";
  if (!weatherSuppressed) {
    if (temp !== null && temp >= 88) adj += 0.10;
    if (temp !== null && temp <= 50) adj -= 0.10;
    if (windMph !== null && windMph >= 12 && windType.includes("OUT")) adj += 0.20;
    if (windMph !== null && windMph >= 12 && windType.includes("IN")) adj -= 0.20;
  }
  return Math.round(adj * 100) / 100;
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
    .select("id, external_id, slate_date, game_date, status, home_team_id, away_team_id")
    .eq("sport", "mlb")
    .eq("slate_date", date)
    .order("game_date");
  if (gErr) throw new Error(`games query failed: ${gErr.message}`);
  const games = (gamesRaw ?? []) as GameRow[];
  const gameIds = games.map((g) => g.id);

  const [{ data: teamsRaw }, { data: weatherRaw }, { data: parksRaw }, { data: predsRaw }] = await Promise.all([
    supabase.from("teams").select("id, abbreviation, name").eq("sport", "mlb"),
    gameIds.length
      ? supabase
          .from("weather_forecasts")
          .select("game_id, temperature_f, wind_speed_mph, precipitation_probability, conditions, fetched_at")
          .in("game_id", gameIds)
      : Promise.resolve({ data: [] }),
    supabase.from("ballparks").select("team_id, name, park_factor_runs, is_dome, is_retractable"),
    gameIds.length
      ? supabase
          .from("game_predictions")
          .select("game_id, predicted_total, sport_specific")
          .in("game_id", gameIds)
      : Promise.resolve({ data: [] }),
  ]);

  const teams = new Map((teamsRaw ?? [] as TeamRow[]).map((t) => [t.id, t]));
  const weatherByGame = new Map((weatherRaw ?? [] as WeatherRow[]).map((w) => [w.game_id, w]));
  const parksByTeam = new Map((parksRaw ?? [] as BallparkRow[]).map((p) => [p.team_id, p]));
  const predsByGame = new Map(((predsRaw ?? []) as PredictionRow[]).map((p) => [p.game_id, p]));

  const client = new PlaybookClient(key);
  const res = await client.mlbVenueWeather();
  const playbookByTeam = new Map<string, PlaybookVenueWeatherRow>();
  for (const row of res.body.data ?? []) {
    if (row.teamId) playbookByTeam.set(String(row.teamId).toUpperCase(), row);
  }

  console.log(`[playbook-mlb-venue-weather-audit] date=${date} mode=READ-ONLY`);
  console.log(`Playbook rows=${res.body.data?.length ?? 0} slate games=${games.length}`);
  console.log("game        pbProfile        roof(status/conf)       pbWx                 dbWx               dbPark   predT  pbT   candAdj flags");

  let stale = 0;
  let missing = 0;
  let roofValue = 0;
  let bigDelta = 0;

  for (const g of games) {
    const home = teams.get(g.home_team_id);
    const away = teams.get(g.away_team_id);
    const matchup = `${away?.abbreviation ?? "?"}@${home?.abbreviation ?? "?"}`;
    const pbId = playbookTeamId(home?.abbreviation);
    const pb = pbId ? playbookByTeam.get(pbId) : undefined;
    const wx = weatherByGame.get(g.id);
    const park = parksByTeam.get(g.home_team_id);
    const pred = predsByGame.get(g.id);
    const predictedTotal = n((pred as { predicted_total?: number | null } | undefined)?.predicted_total);
    const pbTotal = n(pb?.impact?.projectedTotal);
    const delta = predictedTotal !== null && pbTotal !== null ? Math.round((pbTotal - predictedTotal) * 10) / 10 : null;
    const flags: string[] = [];
    if (!pb) {
      missing++;
      flags.push("missing_playbook");
    } else {
      if (pb.stale) {
        stale++;
        flags.push(`stale:${pb.staleReason ?? "unknown"}`);
      }
      const roofStatus = String(pb.venue?.roofStatus?.status ?? "").toUpperCase();
      if (roofStatus === "CLOSED" || roofStatus === "OPEN") {
        roofValue++;
        if (park?.is_retractable) flags.push(`roof_${roofStatus.toLowerCase()}`);
      }
      if (delta !== null && Math.abs(delta) >= 1.0) {
        bigDelta++;
        flags.push(`pb_total_delta=${delta > 0 ? "+" : ""}${delta}`);
      }
    }

    const pbWx = pb
      ? `${fmt(pb.conditions?.tempF)}F/${fmt(pb.conditions?.wind?.mph)} ${fmt(pb.conditions?.wind?.type)}`
      : "-";
    const dbWx = wx
      ? `${fmt(wx.temperature_f)}F/${fmt(wx.wind_speed_mph)} age=${fmt(ageMinutes(wx.fetched_at))}m`
      : "-";
    const roof = pb?.venue?.roofStatus
      ? `${fmt(pb.venue.roofStatus.status)}/${fmt(pb.venue.roofStatus.confidence)}`
      : "-";
    console.log(
      `${matchup.padEnd(11)} ${fmt(pb?.venue?.parkProfile).padEnd(16)} ${roof.padEnd(23)} ${pbWx.padEnd(20)} ${dbWx.padEnd(18)} ${fmt(park?.park_factor_runs).padEnd(8)} ${fmt(predictedTotal).padEnd(6)} ${fmt(pbTotal).padEnd(5)} ${fmt(pb ? candidateRunAdj(pb) : null).padEnd(7)} ${flags.join(",") || "-"}`
    );
  }

  console.log(`\nSummary: missingPlaybook=${missing} stale=${stale} roofActionable=${roofValue} absProjectedTotalDelta>=1=${bigDelta}`);
  console.log("Next gate: run this across several slates, then replay candidate adjustments against historical totals before promotion.");
  console.log("✓ Read-only. No writes.");
}

main().catch((e) => {
  console.error(`FATAL: ${(e as Error).message}`);
  process.exit(2);
});
