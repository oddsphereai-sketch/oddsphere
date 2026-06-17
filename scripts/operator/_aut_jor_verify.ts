/** READ-ONLY — verify JOR@AUT now appears on the 2026-06-16 soccer board. */
import { buildSoccerDailyEdgeAdapted } from "../../lib/services/soccer/buildSoccerDailyEdgeAdapted";
async function main() {
  for (const d of ["2026-06-16", "2026-06-17"]) {
    const res = await buildSoccerDailyEdgeAdapted(d);
    console.log(`\n=== slate ${d}: ${res.games.length} games (state=${res.slateState}) ===`);
    for (const g of res.games) {
      const mk = g.markets;
      const present = ["moneyline", "total", "first_inning"].filter(m => (mk as any)[m]?.pick != null || (mk as any)[m]?.verdict?.label).map(m => m);
      console.log(`  ${g.awayTeam} vs ${g.homeTeam}  ${g.gameTime}  lock=${g.lockState}  markets=${Object.keys(mk).join("/")}  MR=${mk.moneyline?.verdict?.label} T=${mk.total?.verdict?.label} BTTS=${mk.first_inning?.verdict?.label}`);
    }
  }
}
main().then(() => process.exit(0)).catch(e => { console.error(e); process.exit(1); });
