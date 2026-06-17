import { readFileSync } from "node:fs";
const envFile = readFileSync(".env.local", "utf8");
for (const line of envFile.split("\n")) {
  const m = line.match(/^([A-Z_]+)=(.*)$/);
  if (m && !(m[1] in process.env)) process.env[m[1]] = m[2];
}
(async () => {
  const { buildSoccerDailyEdgeAdapted } = await import("../../lib/services/soccer/buildSoccerDailyEdgeAdapted");
  for (const date of ["2026-06-12"]) {
    const res = await buildSoccerDailyEdgeAdapted(date);
    console.log(`\n##### slate_date=${date}  sport=${res.sport}  games returned=${res.games.length}`);
    for (const g of res.games as any[]) {
      console.log(`\n=== ${g.matchup}  lockState=${g.lockState ?? g.lock_state}  gameId=${g.gameId ?? g.game_id}`);
      const markets = g.markets ?? {};
      for (const [slot, m] of Object.entries(markets) as any[]) {
        if (!m) continue;
        console.log(`  slot=${slot.padEnd(13)} verdict=${String(m.verdict?.label ?? m.verdict).padEnd(11)} pick=${String(m.pick ?? "—").padEnd(14)} price=${String(m.priceAmerican).padEnd(7)} open=${String(m.lineOpenAmerican).padEnd(7)} held=${m.held}`);
      }
      // soccer context presence
      const ctxKeys = ["soccerMatchResultContext","soccerTotalContext","soccerBttsContext","soccerDoubleChanceContext"];
      for (const [slot, m] of Object.entries(markets) as any[]) {
        if (!m) continue;
        const present = ctxKeys.filter(k => m[k] != null);
        if (present.length) console.log(`     slot=${slot} contexts: ${present.join(", ")}`);
      }
    }
  }
})().then(()=>process.exit(0)).catch(e=>{console.error("ERR", e); process.exit(1);});
