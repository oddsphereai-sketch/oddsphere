import { readFileSync } from "node:fs";
const e=readFileSync(".env.local","utf8");for(const l of e.split("\n")){const m=l.match(/^([A-Z_]+)=(.*)$/);if(m&&!(m[1] in process.env))process.env[m[1]]=m[2];}
(async()=>{
  const { runSlateCycleAutomated } = await import("../../lib/services/automationOrchestrator");
  // Read-only: keep provider keys, force EVERY write flag off so effective_write_mode=false everywhere.
  const env: Record<string,string|undefined> = { ...process.env };
  for (const k of ["ORCHESTRATOR_SKIP_CONFIRMATION","MORNING_SLATE_AUTO_PUBLISH",
    "SLATE_DB_WRITES_ENABLED","STARTER_DB_WRITES_ENABLED","PLAYER_INGEST_DB_WRITES_ENABLED",
    "SEASON_PITCHING_DB_WRITES_ENABLED","FIRST_INNING_DB_WRITES_ENABLED",
    "MLB_MODEL_READINESS_REPAIR_DB_WRITES_ENABLED","LINES_DB_WRITES_ENABLED",
    "SHARP_SIGNALS_DB_WRITES_ENABLED","AUTOMODEL_DB_WRITES_ENABLED"]) env[k]="false";
  const report = await runSlateCycleAutomated({ sport: "mlb", date: "2026-06-13", env, intradayMode: false });
  console.log("=== TOP-LEVEL ===");
  console.log("blocking_reasons:", JSON.stringify(report.blocking_reasons, null, 1));
  console.log("warnings:", JSON.stringify(report.warnings?.slice(0,6), null, 1));
  console.log("provider_date_alignment:", JSON.stringify((report as any).provider_date_alignment));
  console.log("\n=== STEPS (name / mode / reason) ===");
  for (const s of (report as any).steps ?? []) {
    const det = s.details ? ` [${JSON.stringify(s.details).slice(0,160)}]` : "";
    console.log(`${(s.name||"").padEnd(30)} ${(s.mode||"").padEnd(9)} ${s.reason||""}${det}`);
  }
})().catch(e=>{console.error("ERR",e?.message||e);process.exit(1);});
