/**
 * READ-ONLY — faithful play-grade replay validation. Imports the REAL
 * computePlayGrade + resolveMlbBestAngle and checks they reproduce stored
 * play_grade + best_angle from frozen audit inputs. Target ~100%. No writes.
 */
import { supabase } from "../../lib/db/supabase";
import { computePlayGrade } from "../../lib/automodel/playGrade";
import { resolveMlbBestAngle } from "../../lib/services/predictionRecordService";

const START = "2026-06-07";
const PUBLIC = new Set(["best_angle", "lean", "market_aligned", "provisional"]);
const pub = (g: string | null | undefined) => (g != null && PUBLIC.has(String(g)) ? String(g) : null);
const BA_EDGE = { moneyline: 3.0, total: 3.5 } as const;

async function main(): Promise<void> {
  const { data } = await supabase.from("prediction_records")
    .select("slate_date, market, play_grade, best_angle, odds_american, launch_day, no_bet, snapshot_json")
    .eq("sport", "mlb").gte("slate_date", START);
  const rows = (data ?? []).filter((r: any) => r.launch_day !== true && r.no_bet !== true);

  const stat: Record<string, { n: number; gMatch: number; baMatch: number; gMiss: string[] }> = {};
  const bump = (k: string) => (stat[k] ??= { n: 0, gMatch: 0, baMatch: 0, gMiss: [] });

  let baTrue = 0, pgBA = 0;
  for (const r of rows as any[]) {
    const m = r.market; if (m !== "moneyline" && m !== "total") continue;
    const a = r.snapshot_json?.v2_2_audit ?? {};
    const pre = m === "moneyline" ? "ml" : "ou";
    const modelProb = a[`${pre}_model_prob`] ?? null;
    const marketProb = a[`${pre}_market_prob`] ?? null;
    const storedLadder = a[`${pre}_play_grade`] ?? null; // grade-ladder output
    if (modelProb == null && marketProb == null && storedLadder == null) continue;

    const res = computePlayGrade({
      modelProb, marketProb, americanOdds: r.odds_american ?? null,
      dataQualityTier: (a.data_quality_tier ?? "medium"),
      provisional: a.provisional === true, isHeld: false,
      minBestAngleEdgePct: BA_EDGE[m as "moneyline" | "total"], minBestAngleConfidencePct: 56,
      marketProbIsFallback: a[`${pre}_market_prob_was_fallback`] === true,
      bestAngleHardBlockReason: a[`${pre}_best_angle_block_reason`] ?? null,
    });
    // compare ladder grade to stored ladder grade (a.ml_play_grade)
    const ladderMatch = String(res.grade) === String(storedLadder);
    // compare PUBLIC play_grade to stored prediction_records.play_grade
    const pubMatch = pub(res.grade) === pub(r.play_grade);

    // resolveMlbBestAngle vs stored best_angle bool
    const ba = resolveMlbBestAngle({
      baseEligible: res.grade === "best_angle", // production: eligible iff ladder grade is best_angle (+ not hard-blocked, already in grade)
      requiresConfirmation: a[`${pre}_requires_market_confirmation`] === true,
      lineDirection: r.snapshot_json?.line_movement?.direction ?? null,
      opposingPublicMoney: r.snapshot_json?.public_splits?.conflict === true,
    });
    const baMatch = ba.bestAngle === (r.best_angle === true);
    if (r.best_angle === true) baTrue++;
    if (pub(r.play_grade) === "best_angle") pgBA++;

    for (const key of [`${m} (ladder)`, "ALL (ladder)"]) { const s = bump(key); s.n++; if (ladderMatch) s.gMatch++; else if (s.gMiss.length < 6) s.gMiss.push(`${storedLadder}->${res.grade} p=${modelProb?.toFixed?.(3)} mk=${marketProb?.toFixed?.(3)} odds=${r.odds_american}`); }
    for (const key of [`${m} (publicPG)`]) { const s = bump(key); s.n++; if (pubMatch) s.gMatch++; }
    const reg = r.slate_date >= "2026-06-13" ? ">=6/13" : "<6/13";
    for (const key of [`${m} (best_angle bool)`, `${m} BA ${reg}`]) { const s = bump(key); s.n++; if (baMatch) s.baMatch++; }
  }
  console.log("=== FAITHFUL GRADE REPLAY FIDELITY (imported real fns vs stored) ===\n");
  for (const k of Object.keys(stat).sort()) {
    const s = stat[k];
    if (k.includes("best_angle bool") || k.includes(" BA ")) console.log(`  ${k.padEnd(26)} n=${s.n}  match=${(100 * s.baMatch / s.n).toFixed(1)}%`);
    else console.log(`  ${k.padEnd(26)} n=${s.n}  match=${(100 * s.gMatch / s.n).toFixed(1)}%`);
  }
  console.log(`\nstored best_angle=true: ${baTrue}   stored play_grade='best_angle': ${pgBA}  (gap = writer demotions: play_grade keeps 'best_angle' text but best_angle bool=false)`);
  console.log(`\n--- sample ladder mismatches (ML+OU) ---`);
  for (const k of ["ALL (ladder)"]) for (const m of stat[k]?.gMiss ?? []) console.log("   " + m);
}
main().then(() => process.exit(0)).catch(e => { console.error(e); process.exit(1); });
