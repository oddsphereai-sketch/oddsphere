import { BdlClient } from "../../lib/providers/real_api/_bdlClient";
const k = process.env.BALLDONTLIE_API_KEY!;
async function main() {
  const c = new BdlClient(k);
  console.log("BDL /games?dates[]=2026-06-08 (slate provider production call):");
  const rows = await c.fetchAll<any>({ path: "/games", query: { "dates[]": "2026-06-08", per_page: 100 }, maxPages: 5 });
  console.log(`  returned ${rows.length} games`);
  for (const r of rows) {
    const home = r.home_team?.abbreviation ?? "?";
    const away = r.away_team?.abbreviation ?? "?";
    if (home === "BAL" || away === "BAL") {
      console.log(`\n  ★ BAL game: id=${r.id}  ${away}@${home}  date=${r.date}  status=${r.status}`);
      console.log(`     home_team_pitcher: ${JSON.stringify(r.home_team_pitcher)}`);
      console.log(`     away_team_pitcher: ${JSON.stringify(r.away_team_pitcher)}`);
      console.log(`     home_team_pitcher_id: ${r.home_team_pitcher_id ?? "null"}`);
      console.log(`     away_team_pitcher_id: ${r.away_team_pitcher_id ?? "null"}`);
      // Lineups fallback
      console.log(`\n     /lineups?game_ids[]=${r.id} fallback:`);
      try {
        const lr = await c.fetchAll<any>({ path: "/lineups", query: { "game_ids[]": String(r.id), per_page: 200 }, maxPages: 3 });
        console.log(`       ${lr.length} lineup rows`);
        const probables = lr.filter((l: any) => l.is_probable_pitcher === true);
        console.log(`       ${probables.length} is_probable_pitcher=true`);
        for (const p of probables) console.log(`          team_id=${p.team_id} player_id=${p.player_id} position=${p.position}`);
        const allPitchers = lr.filter((l: any) => l.position === "P" || l.position === "SP");
        console.log(`       ${allPitchers.length} pitcher rows (any)`);
        for (const p of allPitchers.slice(0,10)) console.log(`          team_id=${p.team_id} player_id=${p.player_id} pos=${p.position} probable=${p.is_probable_pitcher} starter=${p.is_starter}`);
      } catch (e) { console.log(`       lineups error: ${(e as Error).message}`); }
    } else {
      console.log(`  ${away}@${home}  id=${r.id}  home_pid=${r.home_team_pitcher_id ?? r.home_team_pitcher?.id ?? "null"}`);
    }
  }
}
main().catch((e) => { console.error("FATAL:", e?.message ?? e); process.exit(1); });
