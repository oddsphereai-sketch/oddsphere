/**
 * READ-ONLY — Caution-grade visibility audit (MLB + soccer).
 *
 * Dumps current prediction_records for MLB and soccer and tallies
 * play_grade values (case-sensitive) to answer: are "Caution" grades
 * present in the DB, and would the casing bug suppress them?
 *
 * Pure read; no mutations. Usage:
 *   npx tsx scripts/operator/_audit_caution_visibility.ts
 */

import { createClient } from "@supabase/supabase-js";
import { readFileSync } from "node:fs";

const envFile = readFileSync(".env.local", "utf8");
for (const line of envFile.split("\n")) {
  const m = line.match(/^([A-Z_]+)=(.*)$/);
  if (m === null) continue;
  if (!(m[1] in process.env)) process.env[m[1]] = m[2];
}

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
  { auth: { persistSession: false } },
);

type Row = {
  sport: string | null;
  game_id: number | null;
  market: string | null;
  pick: string | null;
  play_grade: string | null;
  no_bet: boolean | null;
  held: boolean | null;
  hold_reason: string | null;
  slate_date: string | null;
  created_at: string | null;
};

async function main() {
  // Pull the most recent ~30 days of records across MLB + soccer.
  const sinceIso = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000)
    .toISOString()
    .slice(0, 10);

  const { data, error } = await supabase
    .from("prediction_records")
    .select(
      "sport, game_id, market, pick, play_grade, no_bet, held, hold_reason, slate_date, created_at",
    )
    .in("sport", ["mlb", "soccer", "ucl"])
    .gte("slate_date", sinceIso)
    .order("slate_date", { ascending: false })
    .limit(5000);

  if (error) {
    console.error("QUERY ERROR:", error.message);
    process.exit(1);
  }

  const rows = (data ?? []) as Row[];
  console.log(`\n=== prediction_records since ${sinceIso} — ${rows.length} rows ===\n`);

  // Per-sport play_grade tally (case-sensitive).
  const tally: Record<string, Record<string, number>> = {};
  const cautionLike = new Set([
    "Caution",
    "Watchlist",
    "Lean",
    "Best Angle",
    "caution",
    "watchlist",
    "lean",
    "best_angle",
  ]);
  const cautionLikeCounts: Record<string, number> = {};

  for (const r of rows) {
    const sport = r.sport ?? "(null)";
    const pg = r.play_grade ?? "(null)";
    tally[sport] ??= {};
    tally[sport][pg] = (tally[sport][pg] ?? 0) + 1;
    if (cautionLike.has(pg)) {
      const k = `${sport}::${pg}`;
      cautionLikeCounts[k] = (cautionLikeCounts[k] ?? 0) + 1;
    }
  }

  for (const sport of Object.keys(tally).sort()) {
    console.log(`--- sport=${sport} play_grade tally (case-sensitive) ---`);
    const entries = Object.entries(tally[sport]).sort((a, b) => b[1] - a[1]);
    for (const [pg, n] of entries) {
      console.log(`   ${JSON.stringify(pg).padEnd(22)} ${n}`);
    }
    console.log("");
  }

  console.log("--- caution-like {Caution,Watchlist,Lean,Best Angle + lowercase} per sport ---");
  if (Object.keys(cautionLikeCounts).length === 0) {
    console.log("   (none found)");
  }
  for (const [k, n] of Object.entries(cautionLikeCounts).sort()) {
    console.log(`   ${k.padEnd(28)} ${n}`);
  }
  console.log("");

  // Today's slate detail dump per sport.
  const today = new Date().toISOString().slice(0, 10);
  console.log(`=== TODAY (${today}) row detail ===\n`);
  const todayRows = rows.filter((r) => r.slate_date === today);
  if (todayRows.length === 0) {
    console.log("   (no rows for today's slate_date — showing most recent slate per sport)\n");
    for (const sport of ["mlb", "soccer", "ucl"]) {
      const sp = rows.filter((r) => r.sport === sport);
      if (sp.length === 0) continue;
      const latest = sp[0].slate_date;
      console.log(`   ${sport} latest slate_date=${latest}`);
      for (const r of sp.filter((x) => x.slate_date === latest).slice(0, 25)) {
        console.log(
          `     game=${r.game_id} mkt=${(r.market ?? "").padEnd(13)} pick=${String(r.pick).padEnd(10)} pg=${JSON.stringify(r.play_grade).padEnd(16)} no_bet=${r.no_bet} held=${r.held} hold=${r.hold_reason ?? ""}`,
        );
      }
      console.log("");
    }
  } else {
    for (const r of todayRows) {
      console.log(
        `   ${String(r.sport).padEnd(7)} game=${r.game_id} mkt=${(r.market ?? "").padEnd(13)} pick=${String(r.pick).padEnd(10)} pg=${JSON.stringify(r.play_grade).padEnd(16)} no_bet=${r.no_bet} held=${r.held} hold=${r.hold_reason ?? ""}`,
      );
    }
  }
  console.log("\n=== done (read-only) ===");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
