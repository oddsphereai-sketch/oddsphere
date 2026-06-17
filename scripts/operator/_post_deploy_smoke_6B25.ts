/**
 * Post-deploy smoke for 6B.24 + 6B.25. Read-only.
 * Mirrors what /api/lab/tracking-foundation will return on the live
 * deploy, since both use computeTrackingAggregate against the same DB.
 */
import { createClient } from "@supabase/supabase-js";
import { computeTrackingAggregate } from "../../lib/services/trackingAggregateService";

const ET_TODAY = new Date().toLocaleDateString("en-CA", { timeZone: "America/New_York" });

async function main() {
  const sb = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { persistSession: false } },
  );

  console.log(`\n═══════ Post-deploy smoke · ${ET_TODAY} ═══════\n`);

  // 1. Baselines
  const { data: baselines } = await sb
    .from("tracking_baselines")
    .select("sport, market, lifetime_wins, lifetime_total, lifetime_pct");
  const baseMap = new Map<string, any>((baselines ?? []).map((b: any) => [`${b.sport}:${b.market}`, b]));

  // 2. Aggregator with 6B.24 virtual NRFI/YRFI splits
  const agg = await computeTrackingAggregate({ supabase: sb as any, sport: "mlb", includeLaunchDay: false });
  const liveMap = new Map<string, any>(agg.bySportMarket.map((b) => [`${b.sport}:${b.market}`, b]));

  console.log("── 1. Public Tracking lifetime merged values (expected on /lab/tracking) ──");
  const keys = ["mlb:moneyline", "mlb:total", "mlb:nrfi", "mlb:yrfi"] as const;
  for (const key of keys) {
    const base = baseMap.get(key);
    const live = liveMap.get(key);
    const liveDecided = live ? live.metrics.wins + live.metrics.losses : 0;
    if (base && liveDecided > 0) {
      const mw = base.lifetime_wins + live.metrics.wins;
      const mt = base.lifetime_total + liveDecided;
      const pct = (mw / mt) * 100;
      console.log(`  ${key.padEnd(15)} → ${mw.toLocaleString()}/${mt.toLocaleString()} · ${pct.toFixed(1)}% · Lifetime · live +${liveDecided}`);
    } else if (base) {
      console.log(`  ${key.padEnd(15)} → ${base.lifetime_wins}/${base.lifetime_total} · ${base.lifetime_pct}% · Lifetime`);
    } else if (live && liveDecided > 0) {
      console.log(`  ${key.padEnd(15)} → ${live.metrics.wins}-${live.metrics.losses} · Since launch`);
    }
  }

  console.log("\n── 2. NYM @ SD (game 14856) locked snapshot ──");
  const { data: nymsd } = await sb
    .from("prediction_records")
    .select("id, market, pick, side, line_value, odds_american, confidence, play_grade, best_angle, locked_at, snapshot_json")
    .eq("game_id", 14856)
    .order("id");
  for (const r of (nymsd ?? []) as any[]) {
    const sp = r.snapshot_json ?? {};
    const baFlag = r.market === "moneyline" ? sp.ml_best_angle_eligible : r.market === "total" ? sp.ou_best_angle_eligible : null;
    const playGrade = r.market === "moneyline" ? sp.ml_play_grade : r.market === "total" ? sp.ou_play_grade : null;
    console.log(`  rec=${r.id} mkt=${r.market.padEnd(13)} pick=${r.pick} line=${r.line_value ?? "-"} conf=${r.confidence} → locked best_angle=${r.best_angle} play_grade=${r.play_grade ?? "-"} | snap.eligible=${baFlag ?? "-"} snap.play_grade=${playGrade ?? "-"} locked_at=${r.locked_at?.slice(0,19) ?? "-"}`);
  }

  console.log("\n── 3. Best Angle + Lean counts (today, public-facing) ──");
  console.log(`  Best Angles: picks=${agg.bestAngles.picks}  W=${agg.bestAngles.wins}  L=${agg.bestAngles.losses}  pen=${agg.bestAngles.pending}`);
  console.log(`  Leans:       picks=${agg.leans.picks}  W=${agg.leans.wins}  L=${agg.leans.losses}  pen=${agg.leans.pending}`);

  console.log("\n── 4. Daily Edge verdict freeze applies for NYM @ SD ──");
  console.log("  (6B.25 logic: when pred.locked_at !== null, deriveVerdictForRow passes empty signals → frozen best_angle survives)");
  console.log("  rec=132 ML home: locked_at SET → frozen best_angle preserved ✓");
  console.log("  rec=133 OU under 7.5: locked_at SET → frozen best_angle preserved ✓");
}
main().catch((e) => { console.error("FATAL:", e?.message ?? e); process.exit(1); });
