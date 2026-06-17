import { readFileSync } from "node:fs";
const j = JSON.parse(readFileSync("/tmp/sc.json","utf8"));
const r = j.runs[0].details;
console.log("status:", j.runs[0].status, "| records_updated:", j.runs[0].records_updated);
console.log("bdl_game_count:", r.bdl_game_count, "| sharp_ev_count:", r.sharp_ev_count, "| intraday:", r.intraday_mode);
console.log("reconciliation:", JSON.stringify(r.reconciliation));
console.log("provider_date_alignment:", JSON.stringify(r.provider_date_alignment));
console.log("publish_decision:", r.publish_decision);
console.log("blocking_reasons:", JSON.stringify(r.blocking_reasons ?? []));
const softenW = (r.warnings??[]).filter((w:string)=>/soften|alignment|reconcil/i.test(w));
console.log("soften warnings:", JSON.stringify(softenW, null, 1));
console.log("\n=== key steps ===");
for (const s of r.steps ?? []) {
  if (/g1_automation|p2_5|p2_provider|m2_automodel|s11_publish|g2_starter|g1_min/.test(s.name||"")) {
    const d = s.details ? " "+JSON.stringify(s.details).slice(0,200) : "";
    console.log(`${(s.name||"").padEnd(26)} ${(s.mode||"").padEnd(8)} ${(s.reason||"").slice(0,120)}${d}`);
  }
}
