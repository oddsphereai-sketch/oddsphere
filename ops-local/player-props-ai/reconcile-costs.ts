/** Local receipt reconciliation only. Original receipts and prior ledger quotes are retained. */
import { readdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { TestBudget } from "./api-eval";
import { bill, type Model } from "./validation";
import { invariant } from "./core";
const root = process.argv[2], out = process.argv[3];
invariant(root?.startsWith("/private/tmp/") && out?.startsWith("/private/tmp/"), "Private local root and NEW audit output required");
const receipts = readdirSync(root).filter(n => n.endsWith(".response.json")).map(n => JSON.parse(readFileSync(path.join(root, n), "utf8")));
const budget = new TestBudget(path.join(root, "ledger.json"));
const report = budget.transaction(ledger => {
  const corrections = [];
  for (const a of ledger.attempts) {
    const receipt = receipts.find(r => r.id === a.id); if (!receipt?.response?.usage) continue;
    const u = receipt.response.usage, writes = u.input_tokens_details?.cache_write_tokens ?? 0;
    const twelve = u.input_tokens_details?.cache_write_tokens_details?.ttl_12h_tokens ?? 0;
    const corrected = bill(a.model as Model, { input: u.input_tokens, output: u.output_tokens, cacheWrite30m: writes - twelve, cacheWrite12h: twelve });
    invariant(corrected <= a.reservedUsd, "Receipt exceeds original reserve; explicit reconciliation required");
    if (a.actualUsd !== null && Math.abs(corrected - a.actualUsd) > 1e-12) {
      const correction = { id: a.id, previousUsd: a.actualUsd, correctedUsd: corrected, at: new Date().toISOString(), reason: "Include default 30-minute cache-write pricing; no cache-read discount assumed" };
      corrections.push(correction); a.billingCorrection = correction; a.actualUsd = corrected;
    }
  }
  const known = ledger.attempts.reduce((n, a) => n + (a.actualUsd ?? 0), 0);
  const unknown = ledger.attempts.reduce((n, a) => n + (a.actualUsd === null ? a.reservedUsd : 0), 0);
  invariant(known + unknown <= ledger.ceilingUsd, "Total evaluation ceiling exceeded");
  return { known, unknown, held: known + unknown, ceiling: ledger.ceilingUsd, attempts: ledger.attempts.length, corrections, originalReceiptsModified: false };
});
writeFileSync(out, JSON.stringify(report, null, 2), { mode: 0o600, flag: "wx" });
console.log(JSON.stringify({ ...report, corrections: report.corrections.length }));
