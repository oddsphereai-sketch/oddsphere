import { readFileSync } from "node:fs";
const e = readFileSync(".env.local", "utf8");
for (const l of e.split("\n")) { const m = l.match(/^([A-Z_]+)=(.*)$/); if (m && !(m[1] in process.env)) process.env[m[1]] = m[2]; }
(async () => {
  const { runSlateCycleAutomated } = await import("../../lib/services/automationOrchestrator");
  const env: Record<string, string | undefined> = { ...process.env };
  // REAL reads: provider MODES real_api so BDL/odds/sharp come back live.
  for (const k of ["SLATE_PROVIDER", "ODDS_PROVIDER", "SHARP_SIGNAL_PROVIDER", "PLAYER_STATS_PROVIDER"]) env[k] = "real_api";
  // NO writes: every per-step + master + publish flag off.
  for (const k of ["ORCHESTRATOR_SKIP_CONFIRMATION", "MORNING_SLATE_AUTO_PUBLISH",
    "SLATE_DB_WRITES_ENABLED", "STARTER_DB_WRITES_ENABLED", "PLAYER_INGEST_DB_WRITES_ENABLED",
    "SEASON_PITCHING_DB_WRITES_ENABLED", "FIRST_INNING_DB_WRITES_ENABLED",
    "MLB_MODEL_READINESS_REPAIR_DB_WRITES_ENABLED", "LINES_DB_WRITES_ENABLED",
    "SHARP_SIGNALS_DB_WRITES_ENABLED", "AUTOMODEL_DB_WRITES_ENABLED"]) env[k] = "false";
  const report = await runSlateCycleAutomated({ sport: "mlb", date: "2026-06-13", env, intradayMode: false });
  console.log("=== blocking_reasons (TRUE prod-read state, morning mode) ===");
  for (const r of report.blocking_reasons) console.log(" -", r);
  console.log("\n=== key gate steps ===");
  for (const s of (report as any).steps ?? []) {
    if (/p2_5|g1_min|g1_automation|g3|m2_automodel|p0_provider|s7_lines|p2_provider/.test(s.name || ""))
      console.log(`${(s.name || "").padEnd(28)} ${(s.mode || "").padEnd(8)} ${(s.reason || "").slice(0, 150)}`);
  }
  // also re-run in INTRADAY mode to confirm it would unblock M2
  const report2 = await runSlateCycleAutomated({ sport: "mlb", date: "2026-06-13", env, intradayMode: true });
  const m2b = ((report2 as any).steps ?? []).find((s: any) => s.name === "m2_automodel");
  console.log(`\n[intraday re-run] m2_automodel mode=${m2b?.mode} reason=${(m2b?.reason||"").slice(0,120)}`);
})().catch(e => { console.error("ERR", e?.message || e); process.exit(1); });
