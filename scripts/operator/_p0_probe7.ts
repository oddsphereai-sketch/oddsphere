import { createClient } from "@supabase/supabase-js";
import { readFileSync } from "node:fs";
const env = readFileSync(".env.local","utf8");
for (const l of env.split("\n")) { const m = l.match(/^([A-Z_]+)=(.*)$/); if (m && !(m[1] in process.env)) process.env[m[1]] = m[2]; }
const sb = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, { auth: { persistSession: false } });
async function main() {
  // Get the BIH/CAN total snapshot in full to check what reader paths exist
  const { data } = await sb.from("prediction_records").select("id, market, snapshot_json").eq("game_id", 15754).eq("market", "total").limit(1);
  const row = (data ?? [])[0] as any;
  if (!row) { console.log("no row"); return; }
  console.log("BIH/CAN total snapshot keys:");
  const s = row.snapshot_json;
  console.log("  top-level:", Object.keys(s));
  console.log("  model.raw_probabilities.total_at_canonical:", JSON.stringify(s.model?.raw_probabilities?.total_at_canonical));
  console.log("  model.expected_total:", s.model?.expected_total);
  console.log("  model.lambda_home/away:", s.model?.lambda_home, "/", s.model?.lambda_away);
  console.log("  market.devigged_probabilities sample:");
  for (const k of ["total|over|2.5","total|under|2.5","total|over|3.0","total|under|3.0","match_result|home","match_result|draw","match_result|away","double_chance|home_or_draw","btts|yes"]) {
    console.log(`    ${k} = ${s.market?.devigged_probabilities?.[k]}`);
  }
  console.log("  market.edge_pp sample:");
  for (const k of ["total|over|2.5","total|under|2.5","match_result|home","double_chance|home_or_draw","btts|yes"]) {
    console.log(`    ${k} = ${s.market?.edge_pp?.[k]}`);
  }
  console.log("  decision.displayed_side:", s.decision?.displayed_side);
  console.log("  decision.pick:", s.decision?.pick);
  console.log("  decision.total_projection_reconciliation present?", s.decision?.total_projection_reconciliation !== undefined);

  // Now check the BIH/CAN MR snapshot
  console.log("\n\nBIH/CAN match_result snapshot:");
  const { data: mr } = await sb.from("prediction_records").select("id, snapshot_json, pick, no_bet, no_bet_reason, hold_reason, play_grade, locked_at").eq("game_id", 15754).eq("market", "match_result").limit(1);
  const mrr = (mr ?? [])[0] as any;
  console.log("  pick=", mrr.pick, " grade=", mrr.play_grade, " no_bet=", mrr.no_bet, " locked=", mrr.locked_at !== null);
  console.log("  no_bet_reason=", mrr.no_bet_reason);
  console.log("  hold_reason=", mrr.hold_reason);
  console.log("  model.raw_probabilities.match_result:", JSON.stringify(mrr.snapshot_json.model?.raw_probabilities?.match_result));
  console.log("  market.devigged_probabilities[match_result|*]:");
  for (const k of ["match_result|home","match_result|draw","match_result|away"]) {
    console.log(`    ${k} = ${mrr.snapshot_json.market?.devigged_probabilities?.[k]}`);
  }
  console.log("  decision.displayed_side:", mrr.snapshot_json.decision?.displayed_side);
}
main().catch(e => { console.error(e); process.exit(1); });
