/**
 * Tracking audit — concrete numbers for every concern Daniel raised.
 *
 *   1. Per sport: count prediction_records, broken down by:
 *      best_angle / play_grade=lean / play_grade=provisional / no_bet / held / pick=Toss-Up
 *   2. Run trackingAggregateService and dump the bySportMarket buckets
 *      with their bestAngles/leans counts so we can see why NHL / NBA / WC
 *      are or aren't appearing in "Best Angles by category".
 *
 * Read-only.
 */
import { supabase } from "../../lib/db/supabase";
import { computeTrackingAggregate } from "../../lib/services/trackingAggregateService";

async function main(): Promise<void> {
  const sports = ["mlb", "nba", "nhl", "soccer"] as const;

  console.log("========== Per-sport prediction_records dimension counts ==========");
  for (const sport of sports) {
    const { data } = await supabase
      .from("prediction_records")
      .select("market, pick, best_angle, play_grade, held, no_bet, launch_day", { count: "exact" })
      .eq("sport", sport);
    const list = (data ?? []) as Array<{
      market: string; pick: string | null; best_angle: boolean | null;
      play_grade: string | null; held: boolean | null; no_bet: boolean | null;
      launch_day: boolean | null;
    }>;
    const counts = {
      total: list.length,
      best_angle: list.filter((r) => r.best_angle === true).length,
      lean: list.filter((r) => r.play_grade === "lean").length,
      provisional: list.filter((r) => r.play_grade === "provisional").length,
      best_angle_play_grade: list.filter((r) => r.play_grade === "best_angle").length,
      caution: list.filter((r) => r.play_grade === "caution").length,
      watchlist: list.filter((r) => r.play_grade === "watchlist").length,
      no_play: list.filter((r) => r.play_grade === "no_play").length,
      no_bet_true: list.filter((r) => r.no_bet === true).length,
      held_true: list.filter((r) => r.held === true).length,
      toss_up: list.filter((r) => String(r.pick ?? "").toUpperCase() === "TOSS-UP").length,
      launch_day: list.filter((r) => r.launch_day === true).length,
    };
    console.log(`  ${sport}: ${JSON.stringify(counts)}`);
    // Per-market for this sport
    const markets = new Set(list.map((r) => r.market));
    for (const m of markets) {
      const ms = list.filter((r) => r.market === m);
      const ba = ms.filter((r) => r.best_angle === true).length;
      const le = ms.filter((r) => r.play_grade === "lean").length;
      console.log(`     ${m.padEnd(15)} total=${String(ms.length).padStart(4)}  best_angle=${ba}  lean=${le}  no_bet=${ms.filter((r) => r.no_bet === true).length}  held=${ms.filter((r) => r.held === true).length}`);
    }
  }

  // Now the aggregator output — what the tracking page actually sees.
  console.log("\n\n========== trackingAggregateService output (no sport filter) ==========");
  const agg = await computeTrackingAggregate({ supabase });
  console.log(`  rowsConsidered=${agg.rowsConsidered}  rowsCounted=${agg.rowsCounted}`);
  console.log(`  bestAngles: total=${agg.bestAngles.picks ?? "?"}  wins=${agg.bestAngles.wins ?? "?"}  losses=${agg.bestAngles.losses ?? "?"}  pending=${agg.bestAngles.pending ?? "?"}`);
  console.log(`  leans:      total=${agg.leans.picks ?? "?"}  wins=${agg.leans.wins ?? "?"}  losses=${agg.leans.losses ?? "?"}  pending=${agg.leans.pending ?? "?"}`);

  console.log("\n  bySportMarket buckets (Best Angles by category source):");
  for (const b of agg.bySportMarket) {
    const oTotal = b.metrics.picks ?? 0;
    const baTotal = b.bestAngles.picks ?? 0;
    const baPend = b.bestAngles.pending ?? 0;
    const leTotal = b.leans.picks ?? 0;
    const lePend = b.leans.pending ?? 0;
    console.log(`    ${b.sport}/${b.market}: overall=${oTotal}  BA total=${baTotal} pend=${baPend}  Lean total=${leTotal} pend=${lePend}`);
  }
}

main().catch((e) => { console.error(e); process.exit(1); });
