/** READ-ONLY — inspect raw stored prediction_records.edge units by market. */
import { supabase } from "../../lib/db/supabase";

async function main(): Promise<void> {
  const { data } = await supabase.from("prediction_records")
    .select("market, side, model_probability, market_probability, edge, play_grade, snapshot_json")
    .eq("sport", "mlb").gte("slate_date", "2026-06-07");
  const rows = (data ?? []) as any[];
  const byMkt: Record<string, number[]> = {};
  let recomputeMismatch = 0, recomputeChecked = 0;
  for (const r of rows) {
    if (r.edge === null) continue;
    (byMkt[r.market] ??= []).push(r.edge);
    // cross-check: does stored edge ≈ (model-market)*100 (pp) ?
    if (r.model_probability !== null && r.market_probability !== null) {
      recomputeChecked++;
      const pp = (r.model_probability - r.market_probability) * 100;
      const frac = r.model_probability - r.market_probability;
      const matchPp = Math.abs(r.edge - pp) < 0.6;
      const matchFrac = Math.abs(r.edge - frac) < 0.01;
      if (!matchPp && !matchFrac) recomputeMismatch++;
    }
  }
  for (const [m, arr] of Object.entries(byMkt)) {
    arr.sort((a, b) => a - b);
    const min = arr[0], max = arr[arr.length - 1];
    const abs = arr.map(Math.abs);
    const meanAbs = abs.reduce((a, b) => a + b, 0) / abs.length;
    const over1 = abs.filter(x => x > 1).length;     // would be normal if pp
    const over50 = abs.filter(x => x > 50).length;    // impossible if pp from prob diff
    const under1 = abs.filter(x => x < 1).length;
    console.log(`\n${m}: n=${arr.length}`);
    console.log(`  min=${min.toFixed(3)} max=${max.toFixed(3)} mean|edge|=${meanAbs.toFixed(3)}`);
    console.log(`  |edge|<1: ${under1}  |edge|>1: ${over1}  |edge|>50 (impossible-as-pp): ${over50}`);
    console.log(`  samples: ${arr.slice(0, 5).map(x => x.toFixed(2)).join(", ")} ... ${arr.slice(-5).map(x => x.toFixed(2)).join(", ")}`);
  }
  console.log(`\nRecompute check (stored edge vs (model-market)): checked=${recomputeChecked} mismatch(neither pp nor frac)=${recomputeMismatch}`);

  // FI specifically: is edge / odds present?
  const fi = rows.filter(r => r.market === "first_inning");
  const fiEdgeNonNull = fi.filter(r => r.edge !== null).length;
  console.log(`\nFI rows=${fi.length} edge-nonNull=${fiEdgeNonNull}`);
}
main().then(() => process.exit(0)).catch(e => { console.error(e); process.exit(1); });
