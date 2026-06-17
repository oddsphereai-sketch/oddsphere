import { createClient } from "@supabase/supabase-js";
import { readFileSync } from "node:fs";
const env = readFileSync(".env.local", "utf8");
for (const l of env.split("\n")) { const m = l.match(/^([A-Z_]+)=(.*)$/); if (m && !(m[1] in process.env)) process.env[m[1]] = m[2]; }
const sb = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, { auth: { persistSession: false } });

async function main() {
  const today = new Date().toISOString().slice(0, 10);
  const tomorrow = new Date(Date.now() + 86400000).toISOString().slice(0, 10);
  const yesterday = new Date(Date.now() - 86400000).toISOString().slice(0, 10);
  const dates = [yesterday, today, tomorrow];
  console.log(`Dates: ${dates.join(", ")}\n`);

  for (const sport of ["mlb", "nba", "nhl", "soccer"]) {
    const { data: gs } = await sb.from("games")
      .select("id, slate_date, slate_status, status")
      .eq("sport", sport).in("slate_date", dates);
    const rows = (gs ?? []) as any[];
    // group by slate_date + slate_status
    const grp: Record<string, number> = {};
    for (const g of rows) {
      const k = `${g.slate_date}|${g.slate_status ?? "null"}`;
      grp[k] = (grp[k] ?? 0) + 1;
    }
    console.log(`=== ${sport.toUpperCase()} games (${rows.length}) ===`);
    for (const k of Object.keys(grp).sort()) console.log(`   ${k} -> ${grp[k]}`);

    const ids = rows.map((g) => g.id);
    if (ids.length > 0) {
      const { data: pr } = await sb.from("prediction_records")
        .select("id, game_id, market, slate_status, slate_date").in("game_id", ids);
      const prRows = (pr ?? []) as any[];
      const pgrp: Record<string, number> = {};
      for (const p of prRows) {
        const k = `${p.slate_date}|status=${p.slate_status ?? "null"}`;
        pgrp[k] = (pgrp[k] ?? 0) + 1;
      }
      console.log(`   prediction_records: ${prRows.length}`);
      for (const k of Object.keys(pgrp).sort()) console.log(`      ${k} -> ${pgrp[k]}`);
    }
    console.log("");
  }

  // data_refresh_log recent for cron health
  const { data: log } = await sb.from("data_refresh_log")
    .select("source, refresh_status, error_message, created_at")
    .order("created_at", { ascending: false }).limit(25);
  console.log("=== recent data_refresh_log (25) ===");
  for (const r of (log ?? []) as any[]) {
    console.log(`   ${r.created_at} ${(r.source ?? "?").padEnd(28)} ${(r.refresh_status ?? "?").padEnd(10)} ${r.error_message ?? ""}`);
  }
}
main().catch((e) => { console.error(e); process.exit(1); });
