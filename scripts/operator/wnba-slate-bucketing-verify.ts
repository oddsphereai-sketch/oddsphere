/**
 * WNBA slate bucketing verification (READ-ONLY by default).
 *
 * Ticket: o-wnba-slate-bucketing-fix.
 *
 * Proves that anchoring slate_date to the real tip time (ET) yields the
 * correct slate. For each WNBA game it computes the ET-correct slate from
 * games.game_date (the real SharpAPI/Playbook tip, once hydrated) and compares
 * it to the stored slate_date, flags mismatches, lists duplicate matchups, and
 * asserts the target ET date resolves to the expected pregame set.
 *
 * The production fix lives in refreshWnbaLines (slate_date := computeSlateDate
 * (tip)) and self-corrects SCHEDULED games. This script (a) verifies that, and
 * (b) offers a gated one-time reconcile for LEGACY rows refreshWnbaLines won't
 * touch — i.e. FINAL games mis-bucketed by the old UTC-date seed (e.g. NY@LV).
 *
 * USAGE:
 *   # read-only verify
 *   npx tsx --env-file=.env.local scripts/operator/wnba-slate-bucketing-verify.ts \
 *     --date 2026-06-24 --expect "PHX@IND,MIN@WSH,POR@CHI,ATL@GS"
 *   # apply legacy reconcile (two-key gate: --write AND env)
 *   AUTOMODEL_DB_WRITES_ENABLED=true npx tsx --env-file=.env.local \
 *     scripts/operator/wnba-slate-bucketing-verify.ts --date 2026-06-24 --write
 *
 * SAFETY: read-only unless --write + AUTOMODEL_DB_WRITES_ENABLED=true. Touches
 * ONLY games.slate_date (re-bucket) — never grades, signals, lines, +EV, RLM,
 * CLV, or movement. No Playbook splits ingest.
 */

import { supabase } from "../../lib/db/supabase";
import { readStringFlag, readBoolFlag, validateWriteGate } from "./_cliCommon";
import { computeSlateDate, addDaysToSlate } from "../../lib/dates/slateDate";
import { WNBA_TEAMS_BY_BDL_ID } from "../../lib/services/wnba/wnbaTeams";

const TERMINAL = new Set(["final", "complete", "completed", "closed"]);

/** A game_date is a real tip when it parses and is NOT the seed's UTC midnight. */
function realTip(gameDate: string | null): boolean {
  if (!gameDate) return false;
  const d = new Date(gameDate);
  if (Number.isNaN(d.getTime())) return false;
  return !(d.getUTCHours() === 0 && d.getUTCMinutes() === 0 && d.getUTCSeconds() === 0);
}

type GameRow = {
  id: number; external_id: number | null; slateStored: string; gameDate: string | null;
  status: string; matchup: string; etCorrect: string | null;
};

async function load(window: { from: string; to: string }): Promise<GameRow[]> {
  const { data: teams } = await supabase.from("teams").select("id, external_id").eq("sport", "wnba");
  const bdlByTeamId = new Map<number, number>();
  for (const t of teams ?? []) bdlByTeamId.set(t.id as number, t.external_id as number);
  const abbr = (teamId: number | null) => {
    const bdl = teamId == null ? null : bdlByTeamId.get(teamId);
    return bdl != null ? WNBA_TEAMS_BY_BDL_ID[bdl]?.abbr ?? "?" : "?";
  };
  const { data: games } = await supabase
    .from("games")
    .select("id, external_id, slate_date, game_date, status, home_team_id, away_team_id")
    .eq("sport", "wnba")
    .gte("slate_date", window.from)
    .lte("slate_date", window.to);
  return (games ?? []).map((g) => {
    const gameDate = (g.game_date as string) ?? null;
    return {
      id: g.id as number,
      external_id: (g.external_id as number) ?? null,
      slateStored: g.slate_date as string,
      gameDate,
      status: String(g.status ?? "").toLowerCase(),
      matchup: `${abbr(g.away_team_id as number)}@${abbr(g.home_team_id as number)}`,
      etCorrect: realTip(gameDate) ? computeSlateDate("wnba", gameDate!) : null,
    };
  });
}

async function main(): Promise<void> {
  const argv = process.argv.slice(2);
  const date = readStringFlag(argv, "--date") ?? new Date().toISOString().slice(0, 10);
  const json = readBoolFlag(argv, "--json");
  const expect = (readStringFlag(argv, "--expect") ?? "")
    .split(",").map((s) => s.trim().toUpperCase()).filter(Boolean).sort();
  const { writeMode } = validateWriteGate(argv); // --write + env, else dry-run

  console.log(`[wnba-slate-bucketing-verify] date=${date} mode=${writeMode ? "APPLY" : "DRY-RUN"}`);

  const window = { from: addDaysToSlate(date, -2), to: addDaysToSlate(date, 3) };
  const games = await load(window);

  // ET-correct pregame set for the target date (scheduled + non-terminal).
  const etPregame = games
    .filter((g) => g.etCorrect === date && !TERMINAL.has(g.status))
    .map((g) => g.matchup).sort();
  const storedOnDate = games.filter((g) => g.slateStored === date).map((g) => `${g.matchup}(${g.status})`).sort();

  // Mismatches: stored slate != ET-correct (have real tip).
  const mismatches = games.filter((g) => g.etCorrect && g.etCorrect !== g.slateStored)
    .map((g) => ({ id: g.id, matchup: g.matchup, status: g.status, from: g.slateStored, to: g.etCorrect! }));

  // Duplicate matchups within the window (same matchup, multiple rows).
  const byMatchup = new Map<string, GameRow[]>();
  for (const g of games) { if (!byMatchup.has(g.matchup)) byMatchup.set(g.matchup, []); byMatchup.get(g.matchup)!.push(g); }
  const duplicates = [...byMatchup.entries()].filter(([, rows]) => rows.length > 1)
    .map(([matchup, rows]) => ({ matchup, rows: rows.map((r) => ({ id: r.id, ext: r.external_id, stored: r.slateStored, etCorrect: r.etCorrect, hasTip: realTip(r.gameDate), status: r.status })) }));

  const noTip = games.filter((g) => !g.etCorrect && g.slateStored >= window.from).map((g) => `${g.matchup}@${g.slateStored}(${g.status})`);

  const expectMatch = expect.length > 0 && JSON.stringify(etPregame) === JSON.stringify(expect);

  const report = {
    date, window, expect, etPregameSlate: etPregame, expectMatch,
    storedOnDate, mismatches, duplicates, gamesWithoutRealTip: noTip,
  };

  if (json) console.log(JSON.stringify(report, null, 2));
  else {
    console.log(`\nET-correct pregame slate for ${date}: [${etPregame.join(", ")}]`);
    if (expect.length) console.log(`Expected:                         [${expect.join(", ")}]  -> ${expectMatch ? "✓ MATCH" : "✗ MISMATCH"}`);
    console.log(`\nStored on slate_date=${date}: [${storedOnDate.join(", ")}]`);
    if (mismatches.length) {
      console.log(`\nSlate mismatches (stored != ET-correct) — ${mismatches.length}:`);
      for (const m of mismatches) console.log(`  ${m.matchup.padEnd(9)} ${m.status.padEnd(10)} ${m.from} -> ${m.to}`);
    } else console.log("\nNo slate mismatches among games with a real tip.");
    if (duplicates.length) {
      console.log(`\nDuplicate matchups in window — ${duplicates.length}:`);
      for (const d of duplicates) { console.log(`  ${d.matchup}:`); for (const r of d.rows) console.log(`    id=${r.id} ext=${r.ext} stored=${r.stored} etCorrect=${r.etCorrect ?? "?"} hasTip=${r.hasTip} status=${r.status}`); }
    }
    if (noTip.length) console.log(`\n⚠ Games still without a real tip (need refreshWnbaLines): ${noTip.join(", ")}`);
  }

  // ── Gated legacy reconcile: re-bucket rows refreshWnbaLines won't touch ──
  if (writeMode) {
    let fixed = 0;
    for (const m of mismatches) {
      const { error } = await supabase.from("games").update({ slate_date: m.to }).eq("id", m.id).eq("sport", "wnba");
      if (error) console.error(`  ✗ reconcile ${m.matchup}: ${error.message}`);
      else { fixed++; console.log(`  ✓ re-bucketed ${m.matchup}: ${m.from} -> ${m.to}`); }
    }
    console.log(`\nReconcile applied: ${fixed}/${mismatches.length} rows re-bucketed (slate_date only). Duplicates reported, NOT auto-deleted.`);
  } else if (mismatches.length) {
    console.log(`\n(${mismatches.length} legacy rows would be re-bucketed with --write + AUTOMODEL_DB_WRITES_ENABLED=true. Scheduled games self-correct via refreshWnbaLines.)`);
  }

  process.exit(expect.length && !expectMatch ? 1 : 0);
}

main().catch((e) => { console.error(`FATAL: ${(e as Error).message}`); process.exit(2); });
