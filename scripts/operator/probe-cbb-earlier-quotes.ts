import { readFile, writeFile } from "node:fs/promises";
import { CbbBallDontLieClient } from "../../lib/cbb/ballDontLie";
const file = "/private/tmp/oddsphere-cbb-data/earlier-quote-probe-20261028.json";
async function main() {
  const cached = await readFile(file, "utf8").then(JSON.parse).catch(() => null);
  if (cached) { console.log(cached.summary); return; }
  const dates = ["2024-02-17", "2025-02-15"];
  const client = new CbbBallDontLieClient(process.env.BALLDONTLIE_API_KEY ?? "", { maxRequests: 8 });
  const data = await client.odds(dates, "opening");
  const summary = { dates, rows: data.length, requests: client.calls,
    observedOpeningDates: [...new Set(data.map(r => r.opened_at?.slice(0, 10) ?? "unknown"))], productionWrites: 0 };
  await writeFile(file, JSON.stringify({ fetchedAt: new Date().toISOString(), summary, data })); console.log(summary);
}
main().catch(e => { console.error(e instanceof Error ? e.message : "CBB earlier quote probe failed"); process.exitCode = 1; });
