/** Offline only. Replays original archived PDFs; never reads/writes production. */
import fs from "node:fs";
import path from "node:path";
import { gzipSync } from "node:zlib";
import { getDocumentProxy } from "unpdf";
import { nbaHistoricalReportAdmittedAt, parseNbaHistoricalInjuryPages, verifyNbaHistoricalReportClock,
  NBA_HISTORICAL_PLAYER_STATE_SOURCE_RELEASE, type PdfCell } from "../../../lib/research/nba/nbaHistoricalPlayerStateSources";

async function main() {
  const [source, destination] = process.argv.slice(2);
  if (!source || !destination || process.argv.length !== 4) throw Error("usage: normalize-nba-historical-injury-archive.ts <archive-directory> <new-output.json.gz>");
  if (fs.existsSync(destination)) throw Error("append_only_destination_exists");
  const files = fs.readdirSync(source).filter(f => /^injury-.*\.receipt\.json$/.test(f)).sort();
  if (!files.length || files.length > 4000) throw Error("invalid_archive_budget");
  const results = [];
  for (const file of files) {
    const receipt = JSON.parse(fs.readFileSync(path.join(source, file), "utf8"));
    if (!/^injury-[\d-]+-[\dAPM]+$/.test(receipt.key)) throw Error("invalid_receipt_key");
    if (receipt.status !== 200 || receipt.error) { results.push({ key: receipt.key, status: "unavailable", reason: receipt.error ?? `http_${receipt.status}` }); continue; }
    try {
      const bytes = new Uint8Array(fs.readFileSync(path.join(source, receipt.key + ".pdf")));
      // PDF.js may transfer/detach its input; preserve original bytes for SHA.
      const doc = await getDocumentProxy(bytes.slice());
      let pages: PdfCell[][], creationDate: string;
      try {
        if (doc.numPages < 1 || doc.numPages > 60) throw Error("pdf_page_budget");
        const meta = await doc.getMetadata(); creationDate = String((meta.info as { CreationDate?: string }).CreationDate ?? ""); pages = [];
        for (let i = 1; i <= doc.numPages; i++) {
          const page = await doc.getPage(i), content = await page.getTextContent();
          pages.push(content.items.flatMap(t => "str" in t ? [{ text: t.str, x: t.transform[4], y: t.transform[5], width: t.width }] : []));
        }
      } finally { await doc.loadingTask.destroy(); }
      const text = pages.map(p => p.map(c => c.text).join(" ")).join("\n");
      const clock = verifyNbaHistoricalReportClock({ bytes, url: receipt.url, text, creationDate, lastModified: receipt.lastModified, fetchedAt: receipt.receivedAt });
      if (clock.rawSha256 !== receipt.sha256 || bytes.length !== receipt.bytes) throw Error("raw_receipt_mismatch");
      const sections = parseNbaHistoricalInjuryPages(pages);
      results.push({ key: receipt.key, status: "normalized", clock, sections,
        targets: receipt.targets.map((t: { cutoff: string; tip: string; home: string; away: string; gameId: number }) => ({ ...t,
          admittedAtCutoff: nbaHistoricalReportAdmittedAt(clock, t.cutoff),
          // Report may contain tomorrow's games; match both date and orientation.
          sections: sections.filter(s => {
            const et = new Intl.DateTimeFormat("en-US", { timeZone: "America/New_York", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date(t.tip));
            return s.gameDate === et && s.matchup === `${t.away}@${t.home}`;
          }) })) });
    } catch (error) { results.push({ key: receipt.key, status: "unverified", reason: error instanceof Error ? error.message : "invalid_source" }); }
    if (results.length % 100 === 0) console.log(JSON.stringify({ completed: results.length, planned: files.length }));
  }
  const summary = { reports: results.length, statuses: results.reduce<Record<string, number>>((a, r) => { a[r.status] = (a[r.status] ?? 0) + 1; return a; }, {}),
    reasons: results.reduce<Record<string, number>>((a, r) => { if ("reason" in r) a[r.reason!] = (a[r.reason!] ?? 0) + 1; return a; }, {}), productionWrites: 0, providerRequests: 0, mayFit: false };
  fs.writeFileSync(destination, gzipSync(JSON.stringify({ release: NBA_HISTORICAL_PLAYER_STATE_SOURCE_RELEASE, normalizedAt: new Date().toISOString(), summary, results })), { flag: "wx", mode: 0o600 });
  console.log(JSON.stringify(summary));
}
main().catch(e => { console.error(e); process.exitCode = 1; });
