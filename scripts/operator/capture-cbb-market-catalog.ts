import { readFile, writeFile } from "node:fs/promises";
import { OwlsInsightClient } from "../../lib/providers/owls/owlsInsightClient";
const dir = "/private/tmp/oddsphere-cbb-data";
async function main() {
  const dates: string[] = JSON.parse(await readFile(`${dir}/opening-total-benchmark-raw.json`, "utf8")).dates;
  const client = new OwlsInsightClient(process.env.OWLS_INSIGHT_API_KEY ?? "");
  let requests = 0;
  for (const date of dates) {
    const target = `${dir}/owls-cbb-catalog-${date}.json`;
    try { await readFile(target, "utf8"); continue; } catch { /* capture once */ }
    const games: unknown[] = [];
    for (let offset = 0; offset < 300; offset += 100) {
      if (++requests > 24) throw new Error("CBB catalog request budget exceeded");
      const response = await client.get<{ success: boolean; data: { games: unknown[]; pagination: { hasMore: boolean; total: number } } }>("/api/v1/history/games", {
        sport: "ncaab", startDate: date, endDate: date, limit: 100, offset,
      });
      if (!response.body.success || !Array.isArray(response.body.data?.games)) throw new Error("invalid CBB archive catalog");
      games.push(...response.body.data.games);
      if (!response.body.data.pagination.hasMore) break;
      if (offset === 200) throw new Error("CBB catalog page limit; partial data rejected");
    }
    await writeFile(target, JSON.stringify({ fetchedAt: new Date().toISOString(), data: games }));
    console.log(JSON.stringify({ date, games: games.length, requests }));
  }
}
main().catch(error => { console.error(error instanceof Error ? error.message : "CBB catalog failed"); process.exitCode = 1; });
