/**
 * Phase 6B.27 — today-only single-column data correction.
 *
 * Sets prediction_records.play_grade = NULL for exactly the rows that
 * match the audited precondition:
 *   • slate_date = ET today
 *   • sport = mlb
 *   • market = moneyline
 *   • play_grade = 'no_bet'
 *   • no_bet = false
 *   • pick IS NOT NULL
 *   • confidence IS NOT NULL
 *   • id IN (120, 129)             ← explicit whitelist for safety
 *
 * Does NOT touch:
 *   pick · side · line_value · odds · confidence · locked_at · no_bet
 *   best_angle · snapshot_json · prediction_grades · any other column
 *
 * Dry-run unless APPLY=1.
 */
import { createClient } from "@supabase/supabase-js";

const ET_TODAY = new Date().toLocaleDateString("en-CA", { timeZone: "America/New_York" });
const APPLY = process.env.APPLY === "1";

const sb = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
  { auth: { persistSession: false } },
);

const WHITELIST = [120, 129];

async function main() {
  console.log(`\n═══════ play_grade NULL correction · ${ET_TODAY} · ${APPLY ? "APPLY" : "DRY-RUN"} ═══════\n`);

  // Precondition probe: read each whitelisted row and verify ALL gates.
  const { data, error } = await sb
    .from("prediction_records")
    .select("id, sport, slate_date, market, pick, side, no_bet, play_grade, best_angle, confidence, locked_at, snapshot_json")
    .in("id", WHITELIST);
  if (error) { console.error("read failed:", error.message); process.exit(1); }
  if (!data || data.length !== WHITELIST.length) {
    console.error(`expected ${WHITELIST.length} rows, got ${data?.length ?? 0}`);
    process.exit(1);
  }

  const candidates: number[] = [];
  for (const r of data as any[]) {
    const gates = {
      slate_date: r.slate_date === ET_TODAY,
      sport: r.sport === "mlb",
      market: r.market === "moneyline",
      play_grade_no_bet: r.play_grade === "no_bet",
      no_bet_false: r.no_bet === false,
      pick_present: r.pick !== null,
      confidence_present: r.confidence !== null,
    };
    const allOk = Object.values(gates).every(Boolean);
    console.log(`rec=${r.id} ${r.market} pick=${r.pick} conf=${r.confidence} play_grade="${r.play_grade}" no_bet=${r.no_bet}`);
    console.log(`  gates: ${JSON.stringify(gates)}  → ${allOk ? "MATCH" : "SKIP"}`);
    if (allOk) candidates.push(r.id);
  }

  if (candidates.length === 0) {
    console.log("\nNo rows match. Nothing to do.");
    return;
  }

  console.log(`\nWould UPDATE prediction_records SET play_grade = NULL WHERE id IN (${candidates.join(", ")});`);
  console.log(`  → single column write, snapshot_json/no_bet/best_angle/pick/confidence/odds/grades untouched.`);

  if (!APPLY) {
    console.log("\nDry-run only. Re-run with APPLY=1 to commit.");
    return;
  }

  // Apply individually (single-column UPDATE per row), with eq-guards on
  // every read precondition so we cannot accidentally clobber a row that
  // changed between read and write.
  for (const id of candidates) {
    const { error: upErr, data: ret } = await sb
      .from("prediction_records")
      .update({ play_grade: null })
      .eq("id", id)
      .eq("play_grade", "no_bet")
      .eq("no_bet", false)
      .eq("sport", "mlb")
      .eq("market", "moneyline")
      .select("id, play_grade, no_bet, pick, confidence, snapshot_json")
      .maybeSingle();
    if (upErr) {
      console.error(`rec=${id} FAILED: ${upErr.message}`);
      process.exit(1);
    }
    if (!ret) {
      console.error(`rec=${id} UPDATE returned no row (concurrent change?). Aborting.`);
      process.exit(1);
    }
    const sp = (ret as any).snapshot_json ?? {};
    const v22 = sp.v2_2_audit ?? {};
    console.log(`rec=${id} ✓ updated: play_grade=${ret.play_grade}, no_bet=${ret.no_bet}, pick=${ret.pick}, conf=${ret.confidence}`);
    console.log(`         snapshot.v2_2_audit.ml_play_grade still = ${JSON.stringify(v22.ml_play_grade)} (raw preserved)`);
  }

  console.log(`\nApplied: ${candidates.length} row(s).`);
}
main().catch((e) => { console.error("FATAL:", e?.message ?? e); process.exit(1); });
