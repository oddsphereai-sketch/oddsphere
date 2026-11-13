import {createHash} from "node:crypto";
import recovery from "../../cbb/artifacts/locked-market-recovery-10882715-r1.json";
import clevelandRecovery from "../../cbb/artifacts/locked-market-recovery-10883106-r2.json";
import type {DailyEdgeGameDto} from "@/app/lab/lib/labTypes";
import type {CbbStoredMemberGame} from "./cbbMemberGameStore";

export const CBB_LOCKED_MARKET_RECOVERY_RELEASE="cbb_locked_market_recovery_registry_2026_11_13_r2_hash_pinned_context" as const;
const recoveries=[recovery,clevelandRecovery];
const canonical=(x:unknown):unknown=>Array.isArray(x)?x.map(canonical):x&&typeof x==="object"
  ?Object.fromEntries(Object.keys(x).sort().map(k=>[k,canonical((x as Record<string,unknown>)[k])])):x;
export function cbbRecoveryPayloadSha256(record:CbbStoredMemberGame){
  return createHash("sha256").update(JSON.stringify(canonical(record))).digest("hex");
}

/** Owner-requested identity correction and append-only historical context.
 * The exact original record is checked first and is never written or regraded.
 * Historical retrieval occurred after lock; it is not original decision evidence. */
function approvedRecovery(record:CbbStoredMemberGame){
  const recovery=recoveries.find(item=>item.gameId===record.snapshot.gameId);
  if(!recovery)return null;
  const f=record.snapshot.board.gameForecast;
  if(record.memberGame.sport!=="cbb"||record.memberGame.external_id!==recovery.gameId||record.snapshot.gameId!==recovery.gameId||
    record.snapshot.startsAt!==recovery.startsAt||record.snapshot.lockedAt!==recovery.lockedAt||
    f?.homeId!==recovery.homeProviderId||f.awayId!==recovery.awayProviderId||
    record.memberGame.awayTeamDisplayName!==recovery.originalAwayDisplayName||
    cbbRecoveryPayloadSha256(record)!==recovery.originalPayloadSha256)return null;
  return recovery;
}
export function cbbLockedRecoveryNamesMatch(record:CbbStoredMemberGame,game:DailyEdgeGameDto){
  if(record.memberGame.homeTeamDisplayName===game.homeTeamDisplayName&&record.memberGame.awayTeamDisplayName===game.awayTeamDisplayName)return true;
  const recovery=approvedRecovery(record);
  return !!recovery&&game.homeTeamDisplayName===record.memberGame.homeTeamDisplayName&&game.awayTeamDisplayName===recovery.awayDisplayName;
}
export function appendCbbLockedMarketRecovery(record:CbbStoredMemberGame,game:DailyEdgeGameDto):DailyEdgeGameDto{
  const recovery=approvedRecovery(record);
  if(game.sport!=="cbb"||game.external_id!==record.snapshot.gameId||!recovery)return game;
  return {...game,awayTeamDisplayName:recovery.awayDisplayName,cbbAwayCollege:recovery.awayCollege,
    cbbRecoveredMarketData:{release:recovery.release,originalPayloadSha256:recovery.originalPayloadSha256,
      book:recovery.book,asOf:recovery.asOf,retrievedAfterLock:true,
      markets:recovery.markets.map(row=>({...row,market:row.market as "moneyline"|"spread"|"total"})),
      note:recovery.meaning}};
}
