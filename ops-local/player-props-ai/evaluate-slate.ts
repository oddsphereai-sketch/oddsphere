/** One manual full-slate research evaluation. Reserves ALL requests before the first generation. */
import { readFileSync, writeFileSync } from "node:fs";
import { planPartitions } from "./partitions";
import { caseReservation, evaluateApiCase, TestBudget } from "./api-eval";
import { invariant } from "./core";
import type { GamePacket } from "./catalog";
const arg = (key: string) => process.argv.find(v => v.startsWith(`--${key}=`))?.slice(key.length + 3);
async function main() {
  const file = arg("manifest"), label = arg("label"); invariant(file && label && /^[a-z0-9_-]+$/i.test(label), "--manifest=LOCAL_JSON --label=UNIQUE required");
  const manifest = JSON.parse(readFileSync(file, "utf8")) as { prepared: { file: string; gameId: string }[] };
  invariant(manifest.prepared.length > 0 && manifest.prepared.length <= 16, "Slate bound exceeded");
  const planned = [];
  for (const [i, game] of manifest.prepared.entries()) {
    const packet = JSON.parse(readFileSync(game.file, "utf8")) as GamePacket;
    const parts = await planPartitions(packet, "gpt-6-luna", 16000);
    for (const [n, part] of parts.entries()) planned.push({ ...part, label: `${label}_g${i + 1}_p${n + 1}` });
  }
  const root = "/private/tmp/oddsphere-props-ai-eval-20261106", budget = new TestBudget(`${root}/ledger.json`);
  budget.reserveMany(planned.map(p => caseReservation(p.packet, "gpt-6-luna", 16000, p.label, p.inputTokens, "readable")));
  console.log(JSON.stringify({ status: "entire_slate_reserved", games: manifest.prepared.length, requests: planned.length }));
  const receipts = [];
  for (const p of planned) {
    const result = await evaluateApiCase({ packet: p.packet, model: "gpt-6-luna", maxOutput: 16000, budget, label: p.label, format: "readable", preReservedInputCount: p.inputTokens, outputFile: `${root}/${p.label}.response.json` });
    receipts.push(result);
    console.log(JSON.stringify({ completed: receipts.length, total: planned.length, gameId: p.packet.gameId, cost: result.actualUsdConservativeNoCacheDiscount, qualityError: result.qualityError }));
  }
  const report = { games: manifest.prepared.length, requests: planned.length, knownCost: receipts.reduce((n, r) => n + r.actualUsdConservativeNoCacheDiscount, 0), failures: receipts.filter(r => r.qualityError), receipts, productionWrites: 0 };
  writeFileSync(`${root}/${label}.slate-result.json`, JSON.stringify(report), { mode: 0o600, flag: "wx" });
}
void main().catch(error => { console.error((error as Error).message.replace(/sk-[A-Za-z0-9_-]+/g, "[redacted]")); process.exitCode = 1; });
