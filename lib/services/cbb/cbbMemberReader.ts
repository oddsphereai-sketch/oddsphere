import type { supabase } from "@/lib/db/supabase";
import type { DailyEdgeResponse } from "@/app/lab/lib/labTypes";
import { cbbOfficialGameResultFromScores } from "./adaptCbbProvisionalToDailyEdge";
import { readCbbMemberGames } from "./cbbMemberGameStore";

/** The seven-day snapshot indexes the board, but each stored locked game is
 * still the public record. This overlay prevents an older cached board from
 * reinterpreting a lock when a later publication fails. */
export async function overlayCbbLockedMemberGames(board:DailyEdgeResponse,db?:typeof supabase):Promise<DailyEdgeResponse>{
  if(board.sport!=="cbb")throw new Error("CBB reader received a foreign sport");
  const client=db??(await import("@/lib/db/supabase")).supabase;
  const ids=board.games.map(game=>game.external_id);
  if(ids.some(id=>!Number.isSafeInteger(id))||new Set(ids).size!==ids.length)throw new Error("CBB board has ambiguous game IDs");
  const stored=await readCbbMemberGames(ids,client);
  if(ids.some(id=>!stored.has(id)))throw new Error("CBB board references a missing member game record");
  const lockedIds=ids.filter(id=>stored.get(id)!.snapshot.lockedAt!==null);
  const finals=new Map<number,{status:string|null;home_score:number|null;away_score:number|null;game_date:string}>();
  for(let i=0;i<lockedIds.length;i+=100){
    const {data,error}=await client.from("games").select("external_id,status,home_score,away_score,game_date")
      .eq("sport","cbb").in("external_id",lockedIds.slice(i,i+100));
    if(error)throw new Error(`CBB official result read failed: ${error.message}`);
    for(const row of data??[]){
      if(finals.has(row.external_id))throw new Error("CBB official result duplicated");
      finals.set(row.external_id,row);
    }
  }
  const games=board.games.map(game=>{
    const record=stored.get(game.external_id)!;
    if(record.snapshot.startsAt!==game.gameStartAt||record.memberGame.id!==game.id)throw new Error("CBB locked reader identity mismatch");
    if(!record.snapshot.lockedAt)return game;
    const official=finals.get(game.external_id);
    if(!official||!Number.isFinite(Date.parse(official.game_date))||
      Date.parse(official.game_date)!==Date.parse(record.snapshot.startsAt))throw new Error("CBB locked result identity missing");
    return {...structuredClone(record.memberGame),result:cbbOfficialGameResultFromScores(record.snapshot,{
      status:official.status,statusState:official.status==="STATUS_FINAL"?"final":null,
      homeScore:official.home_score,awayScore:official.away_score})};
  });
  return {...board,games};
}
