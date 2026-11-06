import {appendCbbLockedMarketRecovery,cbbLockedRecoveryNamesMatch} from "./cbbLockedMarketRecovery";
import type { supabase } from "@/lib/db/supabase";
import type { DailyEdgeResponse } from "@/app/lab/lib/labTypes";
import { cbbOfficialGameResultFromScores } from "./adaptCbbProvisionalToDailyEdge";
import { readCbbMemberGames,CBB_COMPATIBLE_MEMBER_STORE_RELEASES } from "./cbbMemberGameStore";

export const CBB_MEMBER_READER_RELEASE="cbb_member_reader_2026_11_06_r2_verified_market_recovery" as const;

type OfficialSchool={external_id:number|string;display_name:string};
type OfficialResult={status:string|null;home_score:number|null;away_score:number|null;game_date:string;
  home_team:OfficialSchool|OfficialSchool[]|null;away_team:OfficialSchool|OfficialSchool[]|null};

type MemberLockIndex = {snapshot_key:string;storeRelease:string;gameId:string;startsAt:string;
  lockedAt:string|null;memberId:string;memberExternalId:string;memberStart:string;memberLock:string|null};

/** Verify every indexed identity/lock, downloading full evidence only for locks and corrected unlocked clocks.
 * An unopened board must not repeatedly transfer every game's chart history. */
async function readLockIndex(board:DailyEdgeResponse,client:typeof supabase):Promise<Map<number,MemberLockIndex>>{
  const ids=board.games.map(game=>game.external_id),rows=new Map<number,MemberLockIndex>();
  for(let i=0;i<ids.length;i+=100){
    const {data,error}=await client.from("lab_response_snapshots").select(
      "snapshot_key,storeRelease:payload->>release,gameId:payload->snapshot->>gameId,startsAt:payload->snapshot->>startsAt,lockedAt:payload->snapshot->>lockedAt,memberId:payload->memberGame->>id,memberExternalId:payload->memberGame->>external_id,memberStart:payload->memberGame->>gameStartAt,memberLock:payload->memberGame->>lockedAt"
    ).in("snapshot_key",ids.slice(i,i+100).map(id=>`cbb::member-game::${id}`));
    if(error)throw new Error(`CBB member lock index read failed: ${error.message}`);
    for(const raw of data??[]){
      const row=raw as unknown as MemberLockIndex,id=Number(row.gameId);
      const game=board.games.find(game=>game.external_id===id);
      if(!game||rows.has(id)||row.snapshot_key!==`cbb::member-game::${id}`||
        !CBB_COMPATIBLE_MEMBER_STORE_RELEASES.includes(row.storeRelease as typeof CBB_COMPATIBLE_MEMBER_STORE_RELEASES[number])||
        !Number.isFinite(Date.parse(row.startsAt))||row.memberStart!==row.startsAt||row.memberId!==game.id||
        Number(row.memberExternalId)!==id||row.memberLock!==row.lockedAt||
        row.lockedAt!==null&&(typeof row.lockedAt!=="string"||!Number.isFinite(Date.parse(row.lockedAt)))){
        throw new Error("CBB locked reader identity mismatch or corrupt lock index");
      }
      rows.set(id,row);
    }
  }
  if(ids.some(id=>!rows.has(id)))throw new Error("CBB board references a missing member game record");
  return rows;
}

/** The seven-day snapshot indexes the board, but each stored locked game is
 * still the public record. This overlay prevents an older cached board from
 * reinterpreting a lock when a later publication fails. */
export async function overlayCbbLockedMemberGames(board:DailyEdgeResponse,db?:typeof supabase):Promise<DailyEdgeResponse>{
  if(board.sport!=="cbb")throw new Error("CBB reader received a foreign sport");
  const client=db??(await import("@/lib/db/supabase")).supabase;
  const ids=board.games.map(game=>game.external_id);
  if(ids.some(id=>!Number.isSafeInteger(id))||new Set(ids).size!==ids.length)throw new Error("CBB board has ambiguous game IDs");
  const index=await readLockIndex(board,client);
  // A cached board and the sole writer's per-game records are not one database
  // transaction. Reconcile only a genuinely changed unlocked clock from its
  // complete saved DTO instead of blanking the entire cached board. Unchanged
  // unlocked games keep the cheap scalar-index path and fetch no full history.
  const resolvedIds=ids.filter(id=>index.get(id)!.lockedAt!==null||
    Date.parse(index.get(id)!.startsAt)!==Date.parse(board.games.find(g=>g.external_id===id)!.gameStartAt??""));
  const stored=await readCbbMemberGames(resolvedIds,client);
  if(resolvedIds.some(id=>!stored.has(id)))throw new Error("CBB board references a missing authoritative member game record");
  const lockedIds=resolvedIds.filter(id=>stored.get(id)!.snapshot.lockedAt!==null);
  const finals=new Map<number,OfficialResult>();
  for(let i=0;i<lockedIds.length;i+=100){
    const {data,error}=await client.from("games").select("external_id,status,home_score,away_score,game_date,home_team:teams!games_home_team_id_fkey(external_id,display_name),away_team:teams!games_away_team_id_fkey(external_id,display_name)")
      .eq("sport","cbb").in("external_id",lockedIds.slice(i,i+100));
    if(error)throw new Error(`CBB official result read failed: ${error.message}`);
    for(const row of data??[]){
      if(finals.has(row.external_id))throw new Error("CBB official result duplicated");
      finals.set(row.external_id,row);
    }
  }
  const games=board.games.map(game=>{
    if(!stored.has(game.external_id))return game;
    const record=stored.get(game.external_id)!;
    if(record.memberGame.id!==game.id||!cbbLockedRecoveryNamesMatch(record,game)||
      Date.parse(record.snapshot.startsAt)!==Date.parse(index.get(game.external_id)!.startsAt)||
      index.get(game.external_id)!.lockedAt!==null&&record.snapshot.lockedAt!==index.get(game.external_id)!.lockedAt)
      throw new Error("CBB authoritative reader identity mismatch");
    if(record.snapshot.lockedAt===null)return structuredClone(record.memberGame);
    const official=finals.get(game.external_id);
    const home=Array.isArray(official?.home_team)?official.home_team[0]:official?.home_team;
    const away=Array.isArray(official?.away_team)?official.away_team[0]:official?.away_team;
    const outcome=record.snapshot.board.gameForecast;
    if(!official||!Number.isFinite(Date.parse(official.game_date))||!home||!away||
      home.display_name!==record.memberGame.homeTeamDisplayName||away.display_name!==record.memberGame.awayTeamDisplayName||
      outcome&&(Number(home.external_id)!==outcome.homeId||Number(away.external_id)!==outcome.awayId))
      throw new Error("CBB locked result identity missing or school changed");
    return appendCbbLockedMarketRecovery(record,{...structuredClone(record.memberGame),result:cbbOfficialGameResultFromScores(record.snapshot,{
      status:official.status,statusState:official.status==="STATUS_FINAL"?"final":null,
      homeScore:official.home_score,awayScore:official.away_score})});
  });
  return {...board,games};
}
