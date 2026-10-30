/** Small provider-coverage probe, not a bookmaker-history reconstruction. */
import { readFile, writeFile } from "node:fs/promises";
import { CbbBallDontLieClient } from "../../lib/cbb/ballDontLie";
const dir = "/private/tmp/oddsphere-cbb-data";
async function main() {
  const target = `${dir}/historical-odds-probe.json`;
  try { const cached = JSON.parse(await readFile(target, "utf8")); console.log(JSON.stringify(cached.summary)); return; } catch { /* bounded first capture */ }
  const dates = ["2024-11-04", "2025-11-03", "2026-01-17", "2026-03-21"];
  const client = new CbbBallDontLieClient(process.env.BALLDONTLIE_API_KEY ?? "", { maxRequests: 12 });
  const opening = await client.odds(dates, "opening"), current = await client.odds(dates, "current");
  const summary = { dates, opening: opening.length, current: current.length, providerRequests: client.calls,
    warning: "Retrospectively retrieved provider rows; pregame timestamps and orientation require separate verification before any betting result claim." };
  await writeFile(target, JSON.stringify({ fetchedAt: new Date().toISOString(), productionWrites: 0, summary, opening, current }, null, 2));
  console.log(JSON.stringify(summary));
}
main().catch(error => { console.error(error instanceof Error ? error.message : "historical odds probe failed"); process.exitCode = 1; });
