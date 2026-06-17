import { readFileSync } from "node:fs";
const j = JSON.parse(readFileSync("/tmp/sc.json","utf8"));
// the report may be wrapped per-sport
const reports = Array.isArray(j) ? j : (j.results ?? j.reports ?? [j]);
for (const r0 of reports) {
  const r = r0.report ?? r0.result ?? r0;
  console.log(`sport=${r.sport ?? r0.sport ?? "?"} date=${r.requested_date ?? "?"}`);
  console.log("publish_decision:", r.publish_decision);
  console.log("blocking_reasons:", JSON.stringify(r.blocking_reasons ?? []));
  console.log("warnings:", JSON.stringify((r.warnings??[]).filter((w:string)=>/soften|alignment|reconcil/i.test(w))));
  for (const s of r.steps ?? []) {
    if (/g1_automation|p2_5|p2_provider|m2_automodel|s11_publish/.test(s.name||"")) {
      const d = s.details ? " "+JSON.stringify(s.details).slice(0,180) : "";
      console.log(`  ${(s.name||"").padEnd(26)} ${(s.mode||"").padEnd(8)} ${(s.reason||"").slice(0,110)}${d}`);
    }
  }
}
