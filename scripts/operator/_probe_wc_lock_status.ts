/**
 * READ-ONLY: report tonight's WC fixture lock state so we can decide
 * whether a model rerun is safe (pre-kickoff/pre-lock) or risky
 * (already locked / kicked off).
 */
import { supabase } from "../../lib/db/supabase";

async function main(): Promise<void> {
  console.log("─── Soccer fixtures on slate 2026-06-11 ───");
  const { data: games, error } = await supabase
    .from("games")
    .select("id, external_id, sport, status, home_team_id, away_team_id, game_date, slate_date")
    .eq("sport", "soccer")
    .eq("slate_date", "2026-06-11");
  if (error !== null) { console.error(error); process.exit(1); }

  const teamIds = new Set<number>();
  for (const g of (games ?? []) as any[]) {
    if (g.home_team_id) teamIds.add(g.home_team_id);
    if (g.away_team_id) teamIds.add(g.away_team_id);
  }
  const { data: teams } = await supabase
    .from("teams")
    .select("id, abbreviation, display_name, primary_color, secondary_color, logo_url")
    .in("id", [...teamIds]);
  const teamById = new Map<number, any>((teams ?? []).map((t: any) => [t.id, t]));

  const nowIso = new Date().toISOString();
  for (const g of (games ?? []) as any[]) {
    const home = g.home_team_id ? teamById.get(g.home_team_id) : null;
    const away = g.away_team_id ? teamById.get(g.away_team_id) : null;
    const homeName = home?.display_name ?? "?";
    const awayName = away?.display_name ?? "?";
    const kickoff = new Date(g.game_date);
    const minutesToKickoff = Math.floor((kickoff.getTime() - Date.now()) / 60000);
    const lockBoundary = new Date(kickoff.getTime() - 60 * 60 * 1000);
    const lockState =
      Date.now() < lockBoundary.getTime() ? "pre-T60 (safe to rerun)" :
      Date.now() < kickoff.getTime() ? "in T-60 lock window (LOCKED)" :
      "post-kickoff (TOO LATE)";

    console.log(
      `\n  game_id=${g.id} ext=${g.external_id} ${away?.abbreviation}@${home?.abbreviation} (${awayName} vs ${homeName})\n` +
      `    kickoff:   ${g.game_date}  (T${minutesToKickoff < 0 ? "+" : "-"}${Math.abs(minutesToKickoff)} min from now)\n` +
      `    status:    ${g.status}\n` +
      `    lock-state: ${lockState}\n` +
      `    home: id=${g.home_team_id} primary_color=${home?.primary_color ?? "NULL"} secondary=${home?.secondary_color ?? "NULL"} logo_url=${home?.logo_url ?? "NULL"}\n` +
      `    away: id=${g.away_team_id} primary_color=${away?.primary_color ?? "NULL"} secondary=${away?.secondary_color ?? "NULL"} logo_url=${away?.logo_url ?? "NULL"}`,
    );
  }

  console.log("\n─── prediction_records lock state for these games ───");
  const gameIds = (games ?? []).map((g: any) => g.id);
  const { data: prs } = await supabase
    .from("prediction_records")
    .select("id, game_id, market, pick, held, no_bet, locked_at, play_grade")
    .in("game_id", gameIds);
  for (const p of (prs ?? []) as any[]) {
    console.log(
      `  pr_id=${p.id} game=${p.game_id} ${p.market}/${p.pick} held=${p.held} no_bet=${p.no_bet} ` +
      `locked_at=${p.locked_at ?? "(unlocked)"} grade=${p.play_grade}`,
    );
  }

  console.log(`\n  now: ${nowIso}`);
}

main().catch((e) => { console.error(e); process.exit(1); });
