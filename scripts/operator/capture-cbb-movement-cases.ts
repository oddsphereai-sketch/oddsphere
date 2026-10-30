import { readFile, writeFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import { OwlsInsightClient } from "../../lib/providers/owls/owlsInsightClient";
const dir = "/private/tmp/oddsphere-cbb-data";
async function main() {
  const events = JSON.parse(await readFile(`${dir}/owls-cbb-games-late.json`, "utf8")).body.data.games as Array<{ eventId: string; commenceTime?: string }>;
  const selected = events.filter(e => e.commenceTime).sort((a, b) => a.eventId.localeCompare(b.eventId));
  const client = new OwlsInsightClient(process.env.OWLS_INSIGHT_API_KEY ?? "");
  let requests = 0;
  const receipts = [];
  for (const event of selected) {
    const name = createHash("sha256").update(event.eventId).digest("hex").slice(0, 16), target = `${dir}/owls-cbb-movement-${name}.json`;
    try { const cached = JSON.parse(await readFile(target, "utf8")); receipts.push({ eventId: event.eventId, file: target, complete: cached.complete, rows: cached.rows.length }); continue; } catch { /* capture once */ }
    const rows: unknown[] = [], rawPages = [];
    let complete = false;
    for (let page = 0; page < 5; page++) {
      if (++requests > 60) throw new Error("CBB movement request budget exceeded");
      const query = { eventId: event.eventId, startTime: new Date(Date.parse(event.commenceTime!) - 10 * 3600000).toISOString(),
        endTime: event.commenceTime!, limit: 5000, offset: page * 5000 };
      const response = await client.get<{ success: boolean; data: { eventId: string; snapshots: unknown[] }; meta?: { ignored_params?: unknown[] } }>("/api/v1/history/odds", query);
      if (!response.body.success || response.body.data?.eventId !== event.eventId || !Array.isArray(response.body.data.snapshots) || response.body.meta?.ignored_params?.length) throw new Error("CBB archive identity/query mismatch");
      rawPages.push({ query, fetchedAt: new Date().toISOString(), body: response.body }); rows.push(...response.body.data.snapshots);
      if (response.body.data.snapshots.length < 5000) { complete = true; break; }
    }
    await writeFile(target, JSON.stringify({ eventId: event.eventId, complete, rows, rawPages }));
    receipts.push({ eventId: event.eventId, file: target, complete, rows: rows.length });
    console.log(JSON.stringify({ ...receipts.at(-1), requests }));
  }
  await writeFile(`${dir}/owls-cbb-movement-receipts.json`, JSON.stringify({ productionWrites: 0, requests, receipts }, null, 2));
}
main().catch(error => { console.error(error instanceof Error ? error.message : "CBB movement capture failed"); process.exitCode = 1; });
