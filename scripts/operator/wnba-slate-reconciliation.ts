/**
 * WNBA slate reconciliation (READ-ONLY).
 *
 * Ticket context: prerequisite for o-wnba-playbook-splits. Daniel flagged that
 * the official ET slate for a day can have more games than our DB shows.
 *
 * Reconciles, for a target ET slate date, FOUR views:
 *   1. Official slate  — passed via --official "AWY@HOM,AWY@HOM" (no API).
 *   2. OddSphere DB    — games.slate_date == target (what we'd actually serve).
 *   3. Playbook splits — bucketed by ET(startTime) (precise tip time).
 *   4. SharpAPI odds   — bucketed by ET(event_start_time) (precise tip time).
 *
 * WHY: BallDontLie WNBA games carry NO precise tip time, so the seed dates by
 * BDL's UTC calendar day. WNBA slates are ET-anchored, so ET-evening games
 * (tip after 00:00Z) roll to the NEXT slate and prior-night games land on
 * today. Playbook + SharpAPI both expose a precise tip time that fixes this.
 *
 * USAGE:
 *   npx tsx --env-file=.env.local scripts/operator/wnba-slate-reconciliation.ts \
 *     [--date YYYY-MM-DD] [--official "PHX@IND,MIN@WSH,POR@CHI,ATL@GS"] [--json]
 *
 * SAFETY: read-only. No DB writes, no splits ingest, no grading, no movement.
 * Keys from env only; never printed.
 */

import { supabase } from "../../lib/db/supabase";
import { readStringFlag, readBoolFlag } from "./_cliCommon";
import { currentSlateDate, computeSlateDate, addDaysToSlate } from "../../lib/dates/slateDate";
import { PlaybookClient } from "../../lib/providers/playbook/playbookClient";
import { normalizeTeamAbbr, buildGameKey } from "../../lib/providers/playbook/playbookTeamNormalizer";

const SHARP_BASE = "https://api.sharpapi.io/api/v1";
const PLAYBOOK_KEY = process.env.PLAYBOOK_API_KEY ?? "";
const SHARP_KEY = process.env.SHARPAPI_KEY ?? "";

function redact(s: string): string {
  let o = s;
  for (const k of [PLAYBOOK_KEY, SHARP_KEY]) if (k) o = o.split(k).join("***");
  return o.replace(/api_key=[^&\s"']+/gi, "api_key=***");
}

type Row = { key: string | null; away: string; home: string; tipUtc: string | null; etDay: string | null; status?: string };

async function dbRows(targetDate: string): Promise<Row[]> {
  const { data: teams } = await supabase.from("teams").select("id, abbreviation");
  const ab = new Map<number, string>();
  for (const t of teams ?? []) ab.set(t.id as number, (t.abbreviation as string) ?? "");
  const { data: games } = await supabase
    .from("games")
    .select("id, home_team_id, away_team_id, slate_date, game_date, status")
    .eq("sport", "wnba").eq("slate_date", targetDate);
  return (games ?? []).map((g) => {
    const away = ab.get(g.away_team_id as number) ?? "?";
    const home = ab.get(g.home_team_id as number) ?? "?";
    return { key: `${away}@${home}`, away, home, tipUtc: (g.game_date as string) ?? null, etDay: targetDate, status: String(g.status ?? "") };
  });
}

async function playbookRows(): Promise<Row[]> {
  const c = new PlaybookClient(PLAYBOOK_KEY);
  const res = await c.splits("wnba");
  return (res.body.data ?? []).map((g) => {
    const tip = g.startTime ?? null;
    return {
      key: buildGameKey("wnba", g.awayTeamName, g.homeTeamName),
      away: normalizeTeamAbbr("wnba", g.awayTeamName) ?? String(g.awayTeamName ?? "?"),
      home: normalizeTeamAbbr("wnba", g.homeTeamName) ?? String(g.homeTeamName ?? "?"),
      tipUtc: tip,
      etDay: tip ? computeSlateDate("wnba", tip) : null,
    };
  });
}

async function sharpRows(): Promise<Row[]> {
  const url = `${SHARP_BASE}/odds?league=wnba&market_type=moneyline&limit=100`;
  const r = await fetch(url, { headers: { Authorization: `Bearer ${SHARP_KEY}` } });
  const j: any = await r.json();
  const data: any[] = j.data ?? (Array.isArray(j) ? j : []);
  // Collapse to one row per event_id (odds rows repeat per book/selection).
  const byEvent = new Map<string, any>();
  for (const row of data) {
    const ev = String(row.event_id ?? row.event_uuid ?? `${row.away_team}@${row.home_team}`);
    if (!byEvent.has(ev)) byEvent.set(ev, row);
  }
  // Dedupe further by normalized key (SharpAPI emits variant team-name strings).
  const byKey = new Map<string, Row>();
  for (const row of byEvent.values()) {
    const tip = row.event_start_time ?? row.commence_time ?? null;
    const key = buildGameKey("wnba", row.away_team, row.home_team);
    const out: Row = {
      key,
      away: normalizeTeamAbbr("wnba", row.away_team) ?? String(row.away_team ?? "?"),
      home: normalizeTeamAbbr("wnba", row.home_team) ?? String(row.home_team ?? "?"),
      tipUtc: tip,
      etDay: tip ? computeSlateDate("wnba", tip) : null,
    };
    const k = key ?? `${out.away}@${out.home}`;
    if (!byKey.has(k)) byKey.set(k, out);
  }
  return [...byKey.values()];
}

async function main(): Promise<void> {
  const argv = process.argv.slice(2);
  if (argv.includes("--write")) { console.error("✗ READ-ONLY."); process.exit(1); }
  const date = readStringFlag(argv, "--date") ?? currentSlateDate("wnba");
  const json = readBoolFlag(argv, "--json");
  const official = (readStringFlag(argv, "--official") ?? "")
    .split(",").map((s) => s.trim().toUpperCase()).filter(Boolean);

  if (!PLAYBOOK_KEY) { console.error("✗ PLAYBOOK_API_KEY not set."); process.exit(1); }

  console.log(`[wnba-slate-reconciliation] targetET=${date} (read-only)`);

  const db = await dbRows(date);
  let pbAll: Row[] = [], shAll: Row[] = [];
  try { pbAll = await playbookRows(); } catch (e) { console.error("Playbook fetch failed:", redact((e as Error).message)); }
  try { shAll = SHARP_KEY ? await sharpRows() : []; } catch (e) { console.error("SharpAPI fetch failed:", redact((e as Error).message)); }

  const pb = pbAll.filter((r) => r.etDay === date);
  const sh = shAll.filter((r) => r.etDay === date);

  // Universe of keys for the target ET day across providers (+ official).
  const officialSet = new Set(official);
  const keys = new Set<string>([...officialSet]);
  for (const r of [...db, ...pb, ...sh]) if (r.key) keys.add(r.key);

  const dbSet = new Set(db.map((r) => r.key));
  const pbSet = new Set(pb.map((r) => r.key));
  const shSet = new Set(sh.map((r) => r.key));
  const dbFinal = new Set(db.filter((r) => /final|complete|closed/i.test(r.status ?? "")).map((r) => r.key));

  const matrix = [...keys].sort().map((k) => ({
    game: k,
    official: officialSet.size ? officialSet.has(k) : "n/a",
    oddsphereDb: dbSet.has(k) ? (dbFinal.has(k) ? "yes(FINAL)" : "yes") : "—",
    playbook: pbSet.has(k) ? "yes" : "—",
    sharpapi: shSet.has(k) ? "yes" : "—",
  }));

  // Where did the DB put the official games that are missing today?
  const dbMissing = [...officialSet].filter((k) => !dbSet.has(k) || dbFinal.has(k));
  const elsewhere: Record<string, string[]> = {};
  if (dbMissing.length) {
    for (const offset of [-1, 1, 2]) {
      const d = addDaysToSlate(date, offset);
      const rows = await dbRows(d);
      const hits = rows.filter((r) => r.key && dbMissing.includes(r.key)).map((r) => `${r.key}(${r.status})`);
      if (hits.length) elsewhere[d] = hits;
    }
  }

  const report = {
    targetEtDate: date,
    counts: {
      official: officialSet.size || "n/a",
      oddsphereDbOnSlate: db.length,
      oddsphereDbPregame: db.filter((r) => !dbFinal.has(r.key)).length,
      playbookEtDay: pb.length,
      sharpapiEtDay: sh.length,
    },
    matrix,
    officialMissingFromDbToday: dbMissing,
    dbPlacedMissingGamesOn: elsewhere,
  };

  if (json) { console.log(JSON.stringify(report, null, 2)); }
  else {
    console.log(`\nCounts — official:${report.counts.official} | DB-on-slate:${db.length} (pregame ${report.counts.oddsphereDbPregame}) | Playbook(ET):${pb.length} | SharpAPI(ET):${sh.length}\n`);
    console.log("game        official  oddsphereDb  playbook  sharpapi");
    for (const m of matrix) {
      console.log(`  ${m.game.padEnd(9)} ${String(m.official).padEnd(8)}  ${String(m.oddsphereDb).padEnd(11)} ${String(m.playbook).padEnd(8)}  ${m.sharpapi}`);
    }
    if (dbMissing.length) {
      console.log(`\n⚠ Official games NOT on today's DB slate (or stored as FINAL): ${dbMissing.join(", ")}`);
      for (const [d, hits] of Object.entries(elsewhere)) console.log(`   → found on DB slate_date ${d}: ${hits.join(", ")}`);
    }
  }

  const providersAgree = pb.length === sh.length && pb.length === [...pbSet].filter((k) => shSet.has(k)).length;
  const dbComplete = officialSet.size > 0 && [...officialSet].every((k) => dbSet.has(k) && !dbFinal.has(k));
  console.log(`\nProviders (Playbook vs SharpAPI) agree on ET slate: ${providersAgree ? "yes" : "no"}`);
  console.log(`${dbComplete ? "✓" : "✗"} OddSphere DB ${dbComplete ? "matches" : "does NOT match"} the official ET slate (pregame).`);
  process.exit(0);
}

main().catch((e) => { console.error(`FATAL: ${redact((e as Error).message ?? String(e))}`); process.exit(2); });
