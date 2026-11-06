/** Local full-product source integration. Generates artifacts only; never calls AI. */
import { readFileSync, mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fromCachedExport } from "./adapters";
import { enrichCachedPacket, mlbPackets, type EnrichedSource } from "./enrichment";
import { compileMarketReport } from "./market-report";
import { coverage, digest, invariant, validatePacket, reviewKey } from "./core";
import { readableRequest } from "./readable";
const arg = (key: string) => process.argv.find(v => v.startsWith(`--${key}=`))?.slice(key.length + 3);
const input = arg("input"), out = arg("out-dir"), nfl = arg("nflverse");
invariant(input && out && out.startsWith("/private/tmp/"), "--input=EXPORT --out-dir=/private/tmp/NEW_DIRECTORY required");
const source = JSON.parse(readFileSync(input, "utf8")) as EnrichedSource;
if (nfl) source.nflVerse = JSON.parse(readFileSync(nfl, "utf8"));
const base = fromCachedExport(source), packets = [...base.packets.map(p => enrichCachedPacket(p, source)), ...mlbPackets(source)];
mkdirSync(out, { recursive: true, mode: 0o700 });
const rows = packets.map(raw => {
  validatePacket(raw);
  const packet = compileMarketReport(raw), name = `${packet.sport}-${packet.gameId.replace(/[^a-z0-9-]/gi, "_")}-${packet.stage}`;
  const file = path.join(out, `${name}.packet.json`), research = path.join(out, `${name}.research.json`), payload = path.join(out, `${name}.request.json`);
  const body = readableRequest(packet, "gpt-6-luna", 16000);
  for (const [p, v] of [[file, raw], [research, packet], [payload, body]] as const) writeFileSync(p, JSON.stringify(v), { mode: 0o600, flag: "wx" });
  return { key: reviewKey(packet), sport: packet.sport, gameId: packet.gameId, stage: packet.stage, start: packet.start, counts: validatePacket(packet), raw: file, research, payload, inputBytes: Buffer.byteLength(body.input), digest: digest(packet) };
});
const report = { sourceDigest: digest(source), sourceModified: false, productionWrites: 0, apiCalls: 0, scope: "full required catalog; unqualified/unpriced heads explicitly flagged", monthlyBudgetValidated: false, accuracyImprovementProven: false,
  coverage: coverage(packets), skipped: base.skipped, packets: rows };
writeFileSync(path.join(out, "manifest.json"), JSON.stringify(report), { mode: 0o600, flag: "wx" });
console.log(JSON.stringify({ manifest: path.join(out, "manifest.json"), packets: rows.length, sports: report.coverage.map(c => ({ sport: c.sport, gamesAcrossSlots: c.games, missingMarkets: c.missingMarkets, complete: c.complete })) }));
