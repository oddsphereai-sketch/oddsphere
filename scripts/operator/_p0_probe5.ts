import { createClient } from "@supabase/supabase-js";
import { readFileSync } from "node:fs";
const env = readFileSync(".env.local","utf8");
for (const l of env.split("\n")) { const m = l.match(/^([A-Z_]+)=(.*)$/); if (m && !(m[1] in process.env)) process.env[m[1]] = m[2]; }
const sb = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, { auth: { persistSession: false } });
async function main() {
  // get one row to see all columns
  const { data: sample } = await sb.from("prediction_records").select("*").limit(1);
  if (sample && sample.length > 0) {
    console.log("prediction_records columns:");
    for (const k of Object.keys(sample[0] as any)) console.log("  ", k);
  }
  console.log("\n=== BIH/CAN game 15754 + PAR/USA game 15755 predictions ===");
  const { data: ps } = await sb.from("prediction_records").select("id, game_id, market, pick, grade, locked_at, created_at, snapshot_json").in("game_id", [15754, 15755]).order("game_id");
  console.log(`rows: ${ps?.length}`);
  for (const p of (ps ?? []) as any[]) {
    const comp = p.snapshot_json?.competition;
    const mv = p.snapshot_json?.model_version;
    const hasReconcile = p.snapshot_json?.decision?.total_projection_reconciliation !== undefined;
    const displayed = p.snapshot_json?.decision?.displayed_side;
    const noBet = p.snapshot_json?.decision?.no_bet;
    const noBetReason = p.snapshot_json?.decision?.no_bet_reason;
    const lambdaH = p.snapshot_json?.model?.lambda_home;
    const lambdaA = p.snapshot_json?.model?.lambda_away;
    const expectedTotal = p.snapshot_json?.model?.expected_total;
    const totalLine = p.snapshot_json?.model?.raw_probabilities?.total_at_canonical?.line;
    const probOver = p.snapshot_json?.model?.raw_probabilities?.total_at_canonical?.over;
    console.log(`\n  pr${p.id} g${p.game_id} ${p.market.padEnd(15)}`);
    console.log(`    pick=${p.pick}  grade=${p.grade}  locked=${p.locked_at}  created=${p.created_at}`);
    console.log(`    snapshot.competition=${comp}  model_version=${mv}`);
    console.log(`    snapshot.decision.displayed_side=${displayed}  no_bet=${noBet}  reason=${noBetReason}`);
    console.log(`    snapshot.model: λH=${lambdaH} λA=${lambdaA} E[total]=${expectedTotal}  line=${totalLine}  P(over)=${probOver}`);
    console.log(`    snapshot.decision.total_projection_reconciliation present? ${hasReconcile}`);
    if (hasReconcile) {
      const r = p.snapshot_json.decision.total_projection_reconciliation;
      console.log(`      raw_projected_total=${r.raw_projected_total}`);
      console.log(`      mean_direction_side=${r.mean_direction_side}`);
      console.log(`      raw_probability_side=${r.raw_probability_side}  raw_value_side=${r.raw_value_side}`);
      console.log(`      holistic_side=${r.holistic_side}  reconciled_total_side=${r.reconciled_total_side}`);
      console.log(`      displayed_total_side=${r.displayed_total_side}  side_selection_reason=${r.side_selection_reason}`);
      console.log(`      reconciled_confidence_pct=${r.reconciled_confidence_pct}  invariant_side_matches_total=${r.invariant_side_matches_total}`);
      console.log(`      grade_cap=${r.grade_cap}  hold=${r.hold}`);
    }
  }
}
main().catch(e => { console.error(e); process.exit(1); });
