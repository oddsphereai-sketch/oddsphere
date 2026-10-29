/** Independent fixture-orientation receipts for the fixed historical opening cohort. */
import { readFile, writeFile } from "node:fs/promises";
import { OwlsInsightClient } from "../../lib/providers/owls/owlsInsightClient";
import type { CbbGame, CbbOdds } from "../../lib/cbb/types";

const dir = "/private/tmp/oddsphere-cbb-data";
const weekdays = process.argv.includes("--set=weekdays");
const saturation = process.argv.includes("--set=saturation");
async function main() {
  const capture = JSON.parse(await readFile(`${dir}/${saturation ? "saturation" : weekdays ? "weekday" : "date-diverse"}-opening-raw.json`, "utf8")) as
    { dates: string[]; data: CbbOdds[] };
  const games = JSON.parse(await readFile(`${dir}/games-2025.json`, "utf8")).data as CbbGame[];
  const dateById = new Map(games.map(g => [g.id, g.date.slice(0, 10)]));
  const dates = [...new Set(capture.data.map(o => dateById.get(o.game_id)).filter((d): d is string => Boolean(d)))].sort();
  if (dates.some(date => !capture.dates.includes(date))) throw new Error("provider returned an unrequested CBB date");
  const client = new OwlsInsightClient(process.env.OWLS_INSIGHT_API_KEY ?? "");
  let requests = 0;
  for (const date of dates) {
    const target = `${dir}/owls-cbb-catalog-${date}.json`;
    try { const cached = JSON.parse(await readFile(target, "utf8"));
      if (!Array.isArray(cached.data)) throw new Error(`invalid cached CBB catalog ${date}`);
      console.log(JSON.stringify({ date, cached: true, games: cached.data.length })); continue;
    } catch (error) { if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error; }
    const observations: unknown[] = [];
    for (let offset = 0; offset < 300; offset += 100) {
      if (++requests > 3 * dates.length) throw new Error("CBB date-diverse catalog request budget exhausted");
      const response = await client.get<{ success: boolean; data: { games: unknown[]; pagination: { hasMore: boolean } } }>("/api/v1/history/games", {
        sport: "ncaab", startDate: date, endDate: date, limit: 100, offset,
      });
      if (!response.body.success || !Array.isArray(response.body.data?.games)) throw new Error(`invalid CBB catalog ${date}`);
      observations.push(...response.body.data.games);
      if (!response.body.data.pagination.hasMore) break;
      if (offset === 200) throw new Error(`partial CBB catalog ${date}`);
    }
    await writeFile(target, JSON.stringify({ fetchedAt: new Date().toISOString(), data: observations }));
    console.log(JSON.stringify({ date, cached: false, games: observations.length, cumulativeRequests: requests }));
  }
}
main().catch(error => { console.error(error instanceof Error ? error.message : "CBB catalog capture failed"); process.exitCode = 1; });
