/** Exact API tokenization only. No Responses generation calls, retries or production writes. */
import { readFileSync, writeFileSync } from "node:fs";
import { countInput } from "./api-eval";
import { readableRequest } from "./readable";
import { digest, invariant } from "./core";
import type { GamePacket } from "./catalog";
const arg = (key: string) => process.argv.find(v => v.startsWith(`--${key}=`))?.slice(key.length + 3);
async function main() {
  const input = arg("manifest"), out = arg("out"); invariant(input && out && out.startsWith("/private/tmp/"), "--manifest=LOCAL_JSON --out=/private/tmp/NEW_FILE required");
  const manifest = JSON.parse(readFileSync(input, "utf8")) as { packets: { sport: string; gameId: string; stage: string; research: string }[] };
  invariant(manifest.packets.length <= 100, "Count-only job bound exceeded");
  const jobs = manifest.packets.flatMap(row => ["gpt-6-luna", "gpt-6.1-terra"].map(model => ({ ...row, model })));
  const results: object[] = [], errors: object[] = [];
  for (let i = 0; i < jobs.length; i += 2) {
    const settled = await Promise.allSettled(jobs.slice(i, i + 2).map(async row => {
      const packet = JSON.parse(readFileSync(row.research, "utf8")) as GamePacket, body = readableRequest(packet, row.model, 16000);
      return { sport: row.sport, gameId: row.gameId, stage: row.stage, model: row.model, apiInputTokens: await countInput(body), packetDigest: digest(packet), requestDigest: digest(body) };
    }));
    settled.forEach((result, n) => { if (result.status === "fulfilled") results.push(result.value); else errors.push({ ...jobs[i + n], error: result.reason.message }); });
  }
  writeFileSync(out, JSON.stringify({ inputSource: input, generatedAt: new Date().toISOString(), generationCalls: 0, expectedCounts: jobs.length, counts: results, errors, complete: errors.length === 0 }), { mode: 0o600, flag: "wx" });
  console.log(JSON.stringify({ out, counts: results.length, errors: errors.length, generationCalls: 0 }));
}
void main().catch(error => { console.error((error as Error).message.replace(/sk-[A-Za-z0-9_-]+/g, "[redacted]")); process.exitCode = 1; });
