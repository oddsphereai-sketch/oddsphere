import type { SupabaseClient } from "@supabase/supabase-js";
import { addDaysToSlate } from "../../dates/slateDate";

export const CBB_SETTLEMENT_FIXTURE_CATCHUP_MAX_DATES = 3;
/** One existing leased seed path. No provider calls when the ledger is clear. */
export async function readCbbSettlementFixtureCatchupDates(db:SupabaseClient,today:string):Promise<string[]> {
  const {data,error}=await db.from("prediction_records")
    .select("slate_date,games!inner(status),prediction_grades!inner(result)")
    .eq("sport","cbb").not("locked_at","is",null).eq("prediction_grades.result","pending")
    .gte("slate_date",addDaysToSlate(today,-6)).lt("slate_date",addDaysToSlate(today,-1))
    .order("slate_date",{ascending:true}).limit(1000);
  if(error)throw new Error(`CBB settlement fixture catch-up read failed: ${error.message}`);
  const dates=(data??[]).flatMap(row=>{
    const games=Array.isArray(row.games)?row.games:[row.games];
    return games.some(game=>game&&!['STATUS_FINAL','STATUS_CANCELED'].includes(game.status))?[row.slate_date]:[];
  });
  return [...new Set(dates)].sort().slice(0,CBB_SETTLEMENT_FIXTURE_CATCHUP_MAX_DATES);
}
