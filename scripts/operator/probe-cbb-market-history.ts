import { readFile, writeFile } from "node:fs/promises";
import { OwlsInsightClient, OwlsInsightClientError } from "../../lib/providers/owls/owlsInsightClient";
const dir = "/private/tmp/oddsphere-cbb-data";
async function main() {
  const client = new OwlsInsightClient(process.env.OWLS_INSIGHT_API_KEY ?? "");
  const queries: Array<[string, string, Record<string, string | number>]> = [
    ["owls-cbb-coverage", "/api/v1/history/coverage", {}],
    ["owls-cbb-current", "/api/v1/ncaab/odds", {}],
    ["owls-cbb-splits", "/api/v1/ncaab/splits", {}],
    ["owls-cbb-games-late", "/api/v1/history/games", { sport: "ncaab", startDate: "2026-03-28", endDate: "2026-04-08", limit: 100, offset: 0 }],
    ["owls-cbb-games-early", "/api/v1/history/games", { sport: "ncaab", startDate: "2026-02-07", endDate: "2026-02-07", limit: 100, offset: 0 }],
  ];
  if (process.argv.includes("--samples")) {
    queries.length = 0;
    for (const [file, suffix] of [["owls-cbb-games-early", "early"], ["owls-cbb-games-late", "late"]]) {
      const catalog = JSON.parse(await readFile(`${dir}/${file}.json`, "utf8")).body.data.games as Array<{ eventId: string; commenceTime?: string }>;
      const event = catalog.filter(g => g.commenceTime).sort((a, b) => a.eventId.localeCompare(b.eventId))[0];
      if (event) queries.push([`owls-cbb-history-sample-${suffix}`, "/api/v1/history/odds", { eventId: event.eventId, limit: 20, offset: 0 }]);
    }
  }
  if (process.argv.includes("--closing")) {
    queries.length = 0;
    queries.push(["owls-cbb-closing-sample", "/api/v1/history/closing-odds", { sport: "ncaab", startDate: "2026-02-07", endDate: "2026-02-07", limit: 100, offset: 0 }]);
  }
  if (process.argv.includes("--current")) {
    queries.splice(0, queries.length, ["owls-cbb-current", "/api/v1/ncaab/odds", {}], ["owls-cbb-splits", "/api/v1/ncaab/splits", {}]);
  }
  const receipts = [];
  for (const [name, path, query] of queries) {
    const file = `${dir}/${name}.json`;
    try {
      let capture: { fetchedAt: string; body: unknown };
      try { if (process.argv.includes("--refresh-current") && ["owls-cbb-current", "owls-cbb-splits"].includes(name)) throw new Error("explicit refresh");
        capture = JSON.parse(await readFile(file, "utf8")); } catch {
        const response = await client.get<unknown>(path, query);
        capture = { fetchedAt: new Date().toISOString(), body: response.body };
        const serialized = JSON.stringify({ ...capture, path, query, rateLimit: response.rateLimit });
        if (serialized.includes(process.env.OWLS_INSIGHT_API_KEY!)) throw new Error("credential echo rejected");
        await writeFile(`${dir}/${name}-${Date.parse(capture.fetchedAt)}.json`, serialized);
        await writeFile(file, serialized);
      }
      const body = capture.body as Record<string, unknown>;
      const data = body?.data as Record<string, unknown> | unknown[];
      console.log(JSON.stringify({ name, keys: Object.keys(body ?? {}), meta: body?.meta,
        sample: name.includes("history-sample") ? data : Array.isArray(data) ? { rows: data.length } :
          Object.fromEntries(Object.entries(data ?? {}).map(([key, value]) => [key, Array.isArray(value) ? { rows: value.length } : value])) }));
      receipts.push({ name, status: "captured", fetchedAt: capture.fetchedAt });
    } catch (error) {
      receipts.push({ name, status: "failed", httpStatus: error instanceof OwlsInsightClientError ? error.status : null });
      console.log(JSON.stringify(receipts.at(-1)));
    }
  }
  await writeFile(`${dir}/owls-cbb-discovery-receipts.json`, JSON.stringify({ productionWrites: 0, receipts }, null, 2));
}
main().catch(error => { console.error(error instanceof Error ? error.message : "CBB market discovery failed"); process.exitCode = 1; });
