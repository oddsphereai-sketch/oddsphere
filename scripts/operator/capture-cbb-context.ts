/** Read-only, local receipts. Does not schedule a collector or publish predictions. */
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { createHash } from "node:crypto";
import { SharpApiClient } from "../../lib/providers/real_api/_sharpApiClient";
import { PlaybookClient } from "../../lib/providers/playbook/playbookClient";
import { canonicalCbbTeamName } from "../../lib/cbb/dataset";
import type { CbbGame } from "../../lib/cbb/types";

const dir = resolve(process.argv.find(arg => arg.startsWith("--out="))?.slice(6) ?? "/private/tmp/oddsphere-cbb-data");
if (process.argv.some(arg => /^(--write|--publish|--activate)/.test(arg))) throw new Error("CBB context capture cannot publish");
type Receipt = { source: string; status: string; fetchedAt: string; sha256: string | null; reason: string | null };
async function main() {
  await mkdir(dir, { recursive: true });
  const receipts: Receipt[] = [];
  async function capture(name: string, load: () => Promise<unknown>) {
    let fetchedAt = new Date().toISOString();
    try {
      const file = resolve(dir, `${name}.json`);
      let body: unknown;
      try {
        if (process.argv.includes("--refresh")) throw new Error("explicit refresh");
        const cached = JSON.parse(await readFile(file, "utf8"));
        body = cached; fetchedAt = cached.fetchedAt;
      }
      catch {
        const requestStartedAt = fetchedAt;
        const data = await load(); fetchedAt = new Date().toISOString();
        body = { requestStartedAt, fetchedAt, data };
        let serialized = JSON.stringify(body);
        for (const key of [process.env.PLAYBOOK_API_KEY, process.env.SHARPAPI_KEY, process.env.BALLDONTLIE_API_KEY]) {
          if (key) serialized = serialized.split(key).join("[REDACTED]");
        }
        // Retain raw captures independently of the convenient local latest-file pointer.
        await writeFile(resolve(dir, `${name}-${Date.parse(fetchedAt)}.json`), serialized);
        await writeFile(file, serialized);
      }
      receipts.push({ source: name, status: "captured", fetchedAt, sha256: createHash("sha256").update(JSON.stringify(body)).digest("hex"), reason: null });
    } catch { receipts.push({ source: name, status: "failed", fetchedAt, sha256: null, reason: "source_request_failed" }); }
  }
  const sharpKey = process.env.SHARPAPI_KEY;
  if (sharpKey) {
    const client = new SharpApiClient(sharpKey);
    for (const path of ["/events", "/splits"]) await capture(`sharp-${path.slice(1)}`, async () => {
      const all: unknown[] = []; let offset = 0;
      for (let page = 0; page < 10; page++) {
        const response = await client.fetch<unknown[]>({ path, query: { league: "ncaab", offset, limit: 100 }, retryRateLimitInternally: false });
        if (!Array.isArray(response.data)) throw new Error("malformed Sharp CBB rows");
        all.push(...response.data);
        if (!response.pagination?.has_more) return all;
        const next = response.pagination.next_offset;
        if (next === undefined || next <= offset) throw new Error("Sharp CBB pagination did not advance");
        offset = next;
      }
      throw new Error("Sharp CBB request budget exhausted; partial data rejected");
    });
    await capture("sharp-event-odds", async () => {
      const games: CbbGame[] = JSON.parse(await readFile(resolve(dir, "games-2026.json"), "utf8")).data;
      const events: Array<{ id: string; home_team: string; away_team: string; start_time: string; event_type: string }> =
        JSON.parse(await readFile(resolve(dir, "sharp-events.json"), "utf8")).data;
      const selected = events.filter(event => event.event_type === "fixture" && games.some(game => {
        if (game.date.slice(0, 10) > "2026-11-03" || Math.abs(Date.parse(game.date) - Date.parse(event.start_time)) > 10 * 60_000) return false;
        const home = [game.home_team.full_name, game.home_team.college].filter(Boolean).map(value => canonicalCbbTeamName(value!));
        const away = [game.visitor_team.full_name, game.visitor_team.college].filter(Boolean).map(value => canonicalCbbTeamName(value!));
        const eh = canonicalCbbTeamName(event.home_team), ea = canonicalCbbTeamName(event.away_team);
        return (home.includes(eh) && away.includes(ea)) || (home.includes(ea) && away.includes(eh));
      }));
      if (selected.length > 30) throw new Error("exact-event research request budget exhausted");
      const result: unknown[] = [];
      for (const event of selected) {
        let offset = 0;
        for (let page = 0; page < 5; page++) {
          const response = await client.fetch<unknown[]>({ path: "/odds", query: { event_id: event.id, offset, limit: 100 }, retryRateLimitInternally: false });
          if (!Array.isArray(response.data)) throw new Error("malformed exact-event odds");
          result.push(...response.data);
          if (!response.pagination?.has_more) break;
          const next = response.pagination.next_offset;
          if (next === undefined || next <= offset || page === 4) throw new Error("partial exact-event prices rejected");
          offset = next;
        }
      }
      return result;
    });
  } else receipts.push({ source: "sharp", status: "unavailable", fetchedAt: new Date().toISOString(), sha256: null, reason: "local_credential_missing" });
  const playbookKey = process.env.PLAYBOOK_API_KEY;
  if (playbookKey) {
    const client = new PlaybookClient(playbookKey);
    await capture("playbook-lines", async () => (await client.lines("ncaab")).body);
    await capture("playbook-splits", async () => (await client.splits("ncaab")).body);
    await capture("playbook-injuries", async () => (await client.injuries("ncaab")).body);
  } else receipts.push({ source: "playbook", status: "unavailable", fetchedAt: new Date().toISOString(), sha256: null, reason: "local_credential_missing" });
  await capture("espn-injuries", async () => {
    const response = await fetch("https://site.api.espn.com/apis/site/v2/sports/basketball/mens-college-basketball/injuries", { signal: AbortSignal.timeout(20_000) });
    if (!response.ok) throw new Error("ESPN injury source failed");
    return response.json();
  });
  await writeFile(resolve(dir, "context-receipts.json"), JSON.stringify({ productionWrites: 0, receipts }, null, 2));
  console.log(JSON.stringify(receipts));
}
main().catch(error => { console.error(error instanceof Error ? error.message : "CBB context failed"); process.exitCode = 1; });
