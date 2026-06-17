/**
 * Read-only ML tally reconciliation for today.
 * v3: correct column names (prediction_grades.result, no scheduled_start).
 */
import { createClient } from "@supabase/supabase-js";
import { computeTrackingAggregate } from "../../lib/services/trackingAggregateService";

const ET_TODAY = new Date().toLocaleDateString("en-CA", { timeZone: "America/New_York" });

const sb = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
  { auth: { persistSession: false } },
);

function expectFromScore(side: string | null, hs: number | null, as: number | null): string {
  if (hs == null || as == null || side == null) return "?";
  if (hs === as) return "push";
  if (side === "home") return hs > as ? "win" : "loss";
  if (side === "away") return as > hs ? "win" : "loss";
  return "?";
}

async function main() {
  console.log(`\n═══════ ML tally reconciliation · slate_date=${ET_TODAY} ═══════\n`);

  const agg = await computeTrackingAggregate({ supabase: sb as any, sport: "mlb", includeLaunchDay: false });
  const ml = agg.bySportMarket.find((b) => b.sport === "mlb" && b.market === "moneyline");
  console.log(`1) Public ML aggregate (since launch, no_bet/launch_day excluded)`);
  console.log(`   picks=${ml?.metrics.picks}  W=${ml?.metrics.wins}  L=${ml?.metrics.losses}  pushes=${ml?.metrics.pushes}  voids=${ml?.metrics.voids}  pending=${ml?.metrics.pending}`);

  const { data: predRows } = await sb
    .from("prediction_records")
    .select("id, game_id, market, pick, side, no_bet, play_grade, best_angle, locked_at, slate_date, launch_day")
    .eq("sport", "mlb")
    .eq("market", "moneyline")
    .eq("slate_date", ET_TODAY)
    .order("id");
  if (!predRows?.length) { console.log("No ML records today.\n"); return; }

  const gameIds = Array.from(new Set(predRows.map((r) => r.game_id)));
  const recordIds = predRows.map((r) => r.id);
  const { data: games } = await sb
    .from("games")
    .select("id, external_id, status, home_score, away_score, home_team_id, away_team_id")
    .in("id", gameIds);
  const gameMap = new Map<number, any>((games ?? []).map((g: any) => [g.id, g]));

  const { data: grades } = await sb
    .from("prediction_grades")
    .select("*")
    .in("prediction_record_id", recordIds)
    .order("graded_at", { ascending: false });
  const gradeMap = new Map<number, any[]>();
  for (const g of (grades ?? []) as any[]) {
    if (!gradeMap.has(g.prediction_record_id)) gradeMap.set(g.prediction_record_id, []);
    gradeMap.get(g.prediction_record_id)!.push(g);
  }

  const teamIds = new Set<number>();
  for (const g of games ?? []) { teamIds.add(g.home_team_id); teamIds.add(g.away_team_id); }
  const { data: teams } = await sb.from("teams").select("id, abbreviation").in("id", Array.from(teamIds));
  const teamMap = new Map<number, any>((teams ?? []).map((t: any) => [t.id, t.abbreviation ?? `#${t.id}`]));

  console.log(`\n2) DB ML rows today (${predRows.length}):\n`);
  let dbW = 0, dbL = 0, dbPending = 0, dbExcluded = 0, dbDupes = 0, dbMissing = 0, dbPush = 0;
  console.log("    rec  matchup       game    ext        locked     pick play_grade   noBet  status              score  expected  result        graded_at            include? reason");
  for (const r of predRows) {
    const g = gameMap.get(r.game_id);
    const matchup = g ? `${teamMap.get(g.away_team_id) ?? "?"}@${teamMap.get(g.home_team_id) ?? "?"}` : "?@?";
    const status = g?.status ?? "?";
    const scoreStr = g ? `${g.away_score ?? "-"}-${g.home_score ?? "-"}` : "?";
    const expected = g ? expectFromScore(r.side, g.home_score ?? null, g.away_score ?? null) : "?";
    const gRows = gradeMap.get(r.id) ?? [];
    if (gRows.length > 1) dbDupes++;
    const stored = gRows[0]?.result ?? "(no row)";
    const gradedAt = gRows[0]?.graded_at?.slice(0, 19) ?? "-";

    let include = "yes", reason = "-";
    if (r.launch_day) { include = "no"; reason = "launch_day"; dbExcluded++; }
    else if (r.no_bet === true) { include = "no"; reason = "no_bet=true"; dbExcluded++; }
    else if (stored === "win") dbW++;
    else if (stored === "loss") dbL++;
    else if (stored === "push") { dbPush++; reason = "push (not W/L)"; }
    else if (stored === "void") { include = "no"; reason = "void"; dbExcluded++; }
    else if (stored === "pending" || stored === "(no row)") { include = "yes (pending)"; reason = stored === "(no row)" ? "no grade row" : "pending"; dbPending++; if (gRows.length === 0) dbMissing++; }

    const extStr = g?.external_id?.slice?.(-10) ?? "-";
    console.log(`    ${String(r.id).padStart(3)}  ${matchup.padEnd(12)}  ${String(r.game_id).padEnd(6)}  ${String(extStr).padEnd(10)} ${(r.locked_at?.slice(11,19) ?? "no").padEnd(8)}   ${(r.pick ?? "?").padEnd(4)}  ${String(r.play_grade ?? "-").padEnd(13)}${String(r.no_bet ?? false).padEnd(6)}  ${status.padEnd(18)}  ${scoreStr.padEnd(5)}  ${expected.padEnd(8)}  ${stored.padEnd(13)} ${gradedAt.padEnd(20)} ${include.padEnd(14)} ${reason}`);
  }

  console.log(`\n3) DB summary (today only): W=${dbW}  L=${dbL}  pushes=${dbPush}  pending=${dbPending}  excluded=${dbExcluded}  dupes=${dbDupes}  missing_grade_rows=${dbMissing}`);

  const finalGames = (games ?? []).filter((g: any) => /final|over/i.test(g.status ?? ""));
  const inProg = (games ?? []).filter((g: any) => /progress|live|in_/i.test(g.status ?? "") && !/final/i.test(g.status ?? ""));
  const sched = (games ?? []).filter((g: any) => /scheduled|pre/i.test(g.status ?? ""));
  const other = (games ?? []).filter((g: any) => !/final|over|progress|live|in_|scheduled|pre/i.test(g.status ?? ""));
  console.log(`\n4) Today's MLB games (${games?.length}): final=${finalGames.length}  in_progress=${inProg.length}  scheduled=${sched.length}  other=${other.length}`);
  console.log(`   Final with both scores non-null: ${finalGames.filter((g: any) => g.home_score != null && g.away_score != null).length}`);
  console.log(`   Final with at least one null score: ${finalGames.filter((g: any) => g.home_score == null || g.away_score == null).length}`);
  for (const g of inProg) console.log(`   IN_PROGRESS: id=${g.id} ext=${g.external_id} status="${g.status}" score=${g.away_score ?? "-"}-${g.home_score ?? "-"}`);
  for (const g of sched) console.log(`   SCHEDULED:   id=${g.id} ext=${g.external_id} status="${g.status}"`);
  for (const g of other) console.log(`   OTHER:       id=${g.id} ext=${g.external_id} status="${g.status}"`);
}
main().catch((e) => { console.error("FATAL:", e?.message ?? e); process.exit(1); });
