/** Manual API test entry point. All calls in this task share the fixed $2 local ledger. */
import { readFileSync, mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { countInput, evaluateApiCase, TestBudget, caseReservation } from "./api-eval";
import { invariant, request, instant, etDate, validateReview, type Review } from "./core";
import type { GamePacket } from "./catalog";
import type { Model } from "./validation";
import { readableRequest } from "./readable";
import { compileMarketReport } from "./market-report";
import { planPartitions } from "./partitions";
import { pointForecasts } from "./point-forecast";
const arg = (name: string) => process.argv.find(s => s.startsWith(`--${name}=`))?.slice(name.length + 3);
async function main() {
  const file = arg("packet"), mode = arg("mode") ?? "count", model = (arg("model") ?? "gpt-6-luna") as Model;
  invariant(file, "--packet=LOCAL_PACKET required");
  invariant(["gpt-6-luna", "gpt-6.1-terra"].includes(model), "Unpriced model");
  let packet = JSON.parse(readFileSync(file, "utf8")) as GamePacket;
  const maxOutput = Number(arg("max-output") ?? 12000);
  if (arg("as-of-now") === "true") {
    const now = new Date().toISOString(); invariant(etDate(now) === etDate(packet.start) && instant(now) < instant(packet.lock), "Current evaluation must occur on game day before lock");
    packet = compileMarketReport({ ...packet, cutoff: now,
      players: packet.players.map(p => ({ ...p, evidence: p.evidence.filter(e => !e.id.startsWith("market-report:") && instant(e.availableAt) <= instant(now)) })),
      quotes: packet.quotes.filter(q => instant(q.receivedAt) <= instant(now)),
      sourceLimitations: [...packet.sourceLimitations, "manual day-of test at actual issue time, not a production lock review"] });
  }
  const format = (arg("format") ?? "readable") as "codec" | "readable";
  invariant(format === "codec" || format === "readable", "Unknown input format");
  if (mode === "count") {
    const count = await countInput(format === "readable" ? readableRequest(packet, model, maxOutput) : request(packet, model, maxOutput));
    console.log(JSON.stringify({ model, game: packet.gameId, stage: packet.stage, apiInputTokens: count, generationCalls: 0 })); return;
  }
  invariant(mode === "generate", "--mode=count or --mode=generate required");
  const label = arg("label"); invariant(label && /^[a-z0-9_-]+$/i.test(label), "Unique --label required for a deliberate test attempt");
  const root = "/private/tmp/oddsphere-props-ai-eval-20261106";
  mkdirSync(root, { recursive: true, mode: 0o700 });
  const started = performance.now();
  if (arg("partition") === "true") {
    invariant(format === "readable", "Partition planning requires the readable format");
    const parts = await planPartitions(packet, model, maxOutput), budget = new TestBudget(path.join(root, "ledger.json"));
    const planned = parts.map((p, i) => ({ ...p, label: `${label}_part${i + 1}` }));
    budget.reserveMany(planned.map(p => caseReservation(p.packet, model, maxOutput, p.label, p.inputTokens, format)));
    const receipts = [];
    for (const part of planned) receipts.push(await evaluateApiCase({ packet: part.packet, model, maxOutput, budget, label: part.label, format,
      preReservedInputCount: part.inputTokens, outputFile: path.join(root, `${part.label}.response.json`) }));
    const failures = receipts.filter(r => r.qualityError);
    if (!failures.length) {
      const merged: Review = { players: receipts.flatMap(r => (JSON.parse(readFileSync(r.outputFile.replace(/\.json$/, ".review.json"), "utf8")) as Review).players) };
      validateReview(packet, merged);
      writeFileSync(path.join(root, `${label}.review.json`), JSON.stringify(merged), { mode: 0o600, flag: "wx" });
      writeFileSync(path.join(root, `${label}.points.json`), JSON.stringify({ issuedAt: new Date().toISOString(), points: pointForecasts(packet, merged) }), { mode: 0o600, flag: "wx" });
    }
    const report = { label, model, logicalReviews: 1, apiRequests: parts.length, fullPlayers: packet.players.length,
      fullMarkets: packet.players.reduce((n, p) => n + p.markets.length, 0), fullReviewPassed: failures.length === 0,
      actualUsdConservativeNoCacheDiscount: receipts.reduce((n, r) => n + r.actualUsdConservativeNoCacheDiscount, 0),
      inputTokens: receipts.reduce((n, r) => n + r.inputTokens, 0), outputTokens: receipts.reduce((n, r) => n + r.outputTokens, 0),
      failures: failures.map(r => ({ id: r.id, error: r.qualityError })), elapsedSeconds: (performance.now() - started) / 1000 };
    writeFileSync(path.join(root, `${label}.result.json`), JSON.stringify(report, null, 2), { mode: 0o600, flag: "wx" });
    console.log(JSON.stringify(report)); return;
  }
  const result = await evaluateApiCase({ packet, model, maxOutput,
    budget: new TestBudget(path.join(root, "ledger.json")), label, format,
    outputFile: path.join(root, `${label}.response.json`) });
  const report = { ...result, elapsedSeconds: (performance.now() - started) / 1000 };
  writeFileSync(path.join(root, `${label}.result.json`), JSON.stringify(report, null, 2), { mode: 0o600, flag: "wx" });
  console.log(JSON.stringify(report));
}
void main().catch(error => { console.error(JSON.stringify({ error: (error as Error).message.replace(/sk-[A-Za-z0-9_-]+/g, "[redacted]"), causeCode: (error as { cause?: { code?: string } }).cause?.code ?? null })); process.exitCode = 1; });
