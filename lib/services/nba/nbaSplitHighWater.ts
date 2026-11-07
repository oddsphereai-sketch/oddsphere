import type {PostgrestError,SupabaseClient} from "@supabase/supabase-js";
import {isMissingRpcFunction} from "../../db/missingRpcFunction";
/** Exact existing NBA/event MAX(id); avoid a backward global ID scan for
 * future events with no rows. Errors remain errors, never invented absence. */
export async function readNbaSplitHighWater(client:SupabaseClient,eventIds:string[]):Promise<{id:number;error:PostgrestError|null}>{
 const name="nba_market_split_observation_high_water";
 const r=await client.rpc(name,{p_event_ids:eventIds});
 if(!isMissingRpcFunction(r.error,name))return {id:Number(r.data??0),error:r.error};
 const old=await client.from("market_split_observations_v2").select("id").eq("league","nba").in("canonical_event_id",eventIds).order("id",{ascending:false}).limit(1).maybeSingle();
 return {id:Number(old.data?.id??0),error:old.error};
}
