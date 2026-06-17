import { createClient } from "@supabase/supabase-js";
const ET_TODAY = new Date().toLocaleDateString("en-CA", { timeZone: "America/New_York" });
const sb = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, { auth: { persistSession: false } });
async function main() {
  const { data: games } = await sb.from("games").select("id, external_id, status, game_date, home_team_id, away_team_id").eq("sport", "mlb").eq("slate_date", ET_TODAY).order("id");
  const ids = (games ?? []).map((g: any) => g.id);
  const { data: recs } = await sb.from("prediction_records").select("game_id, market, locked_at").in("game_id", ids).eq("slate_date", ET_TODAY);
  const teamIds = new Set<number>();
  for (const g of games ?? []) { teamIds.add((g as any).home_team_id); teamIds.add((g as any).away_team_id); }
  const { data: teams } = await sb.from("teams").select("id, abbreviation").in("id", Array.from(teamIds));
  const teamMap = new Map((teams ?? []).map((t: any) => [t.id, t.abbreviation]));
  const lockMap = new Map<string, string | null>();
  for (const r of (recs ?? []) as any[]) lockMap.set(`${r.game_id}::${r.market}`, r.locked_at);
  console.log(`\n═══════ Per-game lock audit · ${ET_TODAY} ═══════\n`);
  console.log("game  matchup     scheduled(UTC)       status               ML_locked OU_locked FI_locked started? lock-before-start?");
  for (const g of (games ?? []) as any[]) {
    const matchup = `${teamMap.get(g.away_team_id) ?? "?"}@${teamMap.get(g.home_team_id) ?? "?"}`;
    const ml = lockMap.get(`${g.id}::moneyline`);
    const ou = lockMap.get(`${g.id}::total`);
    const fi = lockMap.get(`${g.id}::first_inning`);
    const started = /progress|final|over|live/i.test(g.status ?? "");
    const earliestLock = [ml, ou, fi].filter((x): x is string => !!x).sort()[0];
    const lockBeforeStart = earliestLock && g.game_date ? (new Date(earliestLock) < new Date(g.game_date) ? "yes" : "NO") : (started ? "?" : "n/a");
    console.log(`${g.id} ${matchup.padEnd(11)} ${(g.game_date?.slice(0,19) ?? "?").padEnd(20)} ${(g.status ?? "?").padEnd(20)} ${(ml?.slice(11,19) ?? "no").padEnd(9)} ${(ou?.slice(11,19) ?? "no").padEnd(9)} ${(fi?.slice(11,19) ?? "no").padEnd(9)} ${String(started).padEnd(8)} ${lockBeforeStart}`);
  }
}
main();
