import {instant,invariant} from "./evidence";
import type {GamePacket} from "./evidenceContract";
export type CapturedReviewWindow={gameId:string;stage:GamePacket["stage"];cutoff:string;lock:string};
export function capturedReviewSlots(game:{gameId:string;start:string;lock:string},window:CapturedReviewWindow|undefined,historical:()=>{stage:GamePacket["stage"];at:string}[]){
  if(!window)return historical();
  if(game.gameId!==window.gameId)return [];
  invariant(instant(window.cutoff)<instant(window.lock)&&instant(window.lock)<=instant(game.start),"Live source outside pre-lock review window");
  return [{stage:window.stage,at:window.cutoff}];
}
