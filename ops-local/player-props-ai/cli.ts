/** Offline only: no network requests, API calls, environment loading or database writes. */
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { fromCachedExport, type CachedExport } from "./adapters";
import { coverage, digest, pack, unpack, invariant, request, stable, validatePacket, reviewKey } from "./core";
import { PRODUCT_RELEASE } from "./catalog";
import { evaluate, monthPlan } from "./validation";
import { compileMarketReport } from "./market-report";

const arg = (name: string) => process.argv.find(v => v.startsWith(`--${name}=`))?.slice(name.length + 3);
function destination(name: string) {
  const value = arg(name); invariant(value, `--${name}=PATH required`);
  const resolved = path.resolve(value), root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
  invariant(resolved !== root && !resolved.startsWith(`${root}${path.sep}`), "Private validation artifacts must stay outside the repository");
  return resolved;
}
function save(file: string, value: unknown) {
  mkdirSync(path.dirname(file), { recursive: true, mode: 0o700 });
  writeFileSync(file, JSON.stringify(value), { mode: 0o600, flag: "wx" });
}
const mode = process.argv[2], input = arg("input");
invariant(input, "--input=LOCAL_JSON required");
const source = JSON.parse(readFileSync(input, "utf8"));
if (mode === "build") {
  const out = destination("out-dir"), built = fromCachedExport(source as CachedExport);
  const manifest = built.packets.map(packet => {
    const counts = validatePacket(packet), key = reviewKey(packet);
    invariant(stable(unpack(pack(packet))) === stable(packet), "Evidence codec roundtrip failed");
    const research = compileMarketReport(packet);
    invariant(stable(unpack(pack(research))) === stable(research), "Research codec roundtrip failed");
    const name = `${packet.sport}-${packet.gameId.replace(/[^a-z0-9-]/gi, "_")}-${packet.stage}`;
    const raw = path.join(out, `${name}.packet.json`), payload = path.join(out, `${name}.request.json`), researchFile = path.join(out, `${name}.research.json`);
    save(raw, packet);
    save(researchFile, research);
    const body = request(research, packet.stage === "early" ? "gpt-6-luna" : "gpt-6.1-terra", 12_000);
    save(payload, body);
    return { key, sport: packet.sport, gameId: packet.gameId, stage: packet.stage, start: packet.start,
      cutoff: packet.cutoff, counts, evidenceDigest: digest(packet), raw, payload, research: researchFile, aiInputQuotes: research.quotes.length,
      rawBytes: Buffer.byteLength(JSON.stringify(packet)), encodedInputBytes: Buffer.byteLength(body.input),
      model: body.model, maxOutputTokens: body.max_output_tokens,
      evidenceComplete: false, limitations: packet.sourceLimitations };
  });
  invariant(new Set(manifest.map(p => p.key)).size === manifest.length, "Duplicate logical review");
  const report = { release: PRODUCT_RELEASE, scope: "full catalog; no player or market sampling", sourceDigest: digest(source),
    inputReadOnly: true, productionWrites: 0, aiGenerationCalls: 0, providerCalls: 0, actualBilledUsd: 0,
    accuracyImprovementProven: false, monthlyBudgetValidated: false,
    coverage: coverage(built.packets), skipped: built.skipped, absentSportSources: built.absentSportSources, packets: manifest };
  const file = path.join(out, "manifest.json"); save(file, report);
  console.log(JSON.stringify({ manifest: file, packets: manifest.length, playersAcrossReviewSlots: manifest.reduce((n, p) => n + p.counts.players, 0), actualBilledUsd: 0, monthlyBudgetValidated: false }));
} else if (mode === "plan" || mode === "evaluate") {
  const output = destination("out");
  save(output, mode === "plan" ? monthPlan(source as Parameters<typeof monthPlan>[0]) : evaluate(source.rows, source.trainingThrough));
  console.log(JSON.stringify({ output }));
} else {
  throw new Error("Expected build, plan or evaluate. This CLI never invokes AI or publishes a prediction.");
}
