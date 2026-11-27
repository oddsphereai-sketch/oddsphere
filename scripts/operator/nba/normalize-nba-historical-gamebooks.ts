/** Offline primary-source replay. No database, provider, model fit or writer. */
import fs from "node:fs";
import path from "node:path";
import { gzipSync } from "node:zlib";
import { getDocumentProxy } from "unpdf";
import { NBA_HISTORICAL_GAMEBOOK_RELEASE, verifyNbaOriginalGamebook } from "../../../lib/research/nba/nbaHistoricalGamebook";

async function main() {
  const [source, destination] = process.argv.slice(2);
  if (!source || !destination || process.argv.length !== 4) throw Error("usage: normalize-nba-historical-gamebooks.ts <archive-directory> <new-output.json.gz>");
  if (fs.existsSync(destination)) throw Error("append_only_destination_exists");
  const files = fs.readdirSync(source).filter(f => /^book-\d+(\.retry-\d+)?\.receipt\.json$/.test(f)).sort();
  if (!files.length || files.length > 4000) throw Error("gamebook_read_budget");
  const groups = new Map<number, { key: string; status?: number; error?: string; sha256: string; bytes: number;
    url: string; receivedAt: string; lastModified: string; targets: { gameId: number; tip: string; home: string; away: string }[] }[]>();
  for (const file of files) {
    const r = JSON.parse(fs.readFileSync(path.join(source, file), "utf8"));
    if (!/^book-\d+(\.retry-\d+)?$/.test(r.key) || r.targets?.length !== 1 || !Number.isSafeInteger(r.targets[0].gameId)) throw Error("invalid_gamebook_receipt_identity");
    const id = r.targets[0].gameId; groups.set(id, [...(groups.get(id) ?? []), r]);
  }
  const results = [];
  for (const [gameId, receipts] of groups) {
    const successes = receipts.filter(r => r.status === 200 && !r.error);
    if (!successes.length) { results.push({ gameId, status: "unavailable", reason: "no_successful_original_receipt" }); continue; }
    if (new Set(successes.map(r => r.sha256)).size !== 1) { results.push({ gameId, status: "unverified", reason: "conflicting_original_bodies" }); continue; }
    successes.sort((a, b) => Date.parse(a.receivedAt) - Date.parse(b.receivedAt));
    const r = successes[0]!;
    try {
      const bytes = new Uint8Array(fs.readFileSync(path.join(source, r.key + ".pdf")));
      if (bytes.length !== r.bytes || bytes.length > 4000000) throw Error("gamebook_raw_byte_budget_or_mismatch");
      const doc = await getDocumentProxy(bytes.slice()); let firstPageText: string, creationDate: string;
      try {
        const meta = await doc.getMetadata(); creationDate = String((meta.info as { CreationDate?: string }).CreationDate ?? "");
        const page = await doc.getPage(1), content = await page.getTextContent();
        firstPageText = content.items.flatMap(t => "str" in t ? [t.str + (t.hasEOL ? "\n" : "")] : []).join("");
      } finally { await doc.loadingTask.destroy(); }
      const target = r.targets[0]!, book = verifyNbaOriginalGamebook({ bytes, url: r.url, sha256: r.sha256, creationDate,
        lastModified: r.lastModified, fetchedAt: r.receivedAt, firstPageText, gameId, startAt: target.tip, away: target.away, home: target.home });
      results.push({ gameId, status: "normalized", receiptKey: r.key, book });
    } catch (e) { results.push({ gameId, status: "unverified", receiptKey: r.key, reason: e instanceof Error ? e.message : "invalid_original" }); }
    if (results.length % 200 === 0) console.log(JSON.stringify({ completed: results.length, planned: groups.size }));
  }
  const summary = { games: results.length, statuses: results.reduce<Record<string, number>>((a, r) => { a[r.status] = (a[r.status] ?? 0) + 1; return a; }, {}),
    reasons: results.reduce<Record<string, number>>((a, r) => { if ("reason" in r) a[r.reason!] = (a[r.reason!] ?? 0) + 1; return a; }, {}),
    productionWrites: 0, providerRequests: 0, historicalFits: 0, mayFit: false };
  fs.writeFileSync(destination, gzipSync(JSON.stringify({ release: NBA_HISTORICAL_GAMEBOOK_RELEASE, normalizedAt: new Date().toISOString(), summary, results })), { flag: "wx", mode: 0o600 });
  console.log(JSON.stringify(summary));
}
main().catch(e => { console.error(e); process.exitCode = 1; });
