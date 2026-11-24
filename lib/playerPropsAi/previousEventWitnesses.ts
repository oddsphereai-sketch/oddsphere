/** Optional navigation over an unaccepted draft; never a law or source repair. */
import type {GamePacket} from './evidenceContract';
import {inspectGenerativeDraft} from './generativeAdmission';
import {sourceForecastEventConstraints,unqualifiedEventTail} from './forecastSanity';
import {lawForecast,scenarioStat,validateLaw} from './law';
import {COMPLETE_CORRECTION_MAX_BYTES} from './completeCorrectionFeedback';

type Feedback={status:string;text?:string;bytes:number;affectedActorIds:string[]};
export const PREVIOUS_EVENT_WITNESSES_RELEASE='player_props_correction_2026_11_23_r1_previous_event_witnesses' as const;

/** Append all applicable witnesses or none. Complete original diagnostics,
 * numeric references and valid declines always keep their existing allowance. */
export function withPreviousEventWitnesses<T extends Feedback>(packet:GamePacket,draft:unknown,feedback:T):T{
 if(feedback.status!=='ready'||typeof feedback.text!=='string'||!feedback.affectedActorIds.length)return feedback;
 const before=feedback.text,rows:string[]=[];
 try{
  const inspected=inspectGenerativeDraft(packet,draft);
  for(const id of feedback.affectedActorIds){
   const index=packet.players.findIndex(p=>p.id===id),player=packet.players[index],row=inspected.canonical.players[id];
   if(!player||!row?.law||inspected.coordinates.some(c=>c.playerId===id)||!Array.isArray(row.exceptions)||row.exceptions.length!==player.markets.length)return feedback;
   const law=validateLaw(packet.sport,player,row.law);
   const events=new Map<string,ReturnType<typeof sourceForecastEventConstraints>[number]>();
   for(const event of sourceForecastEventConstraints(packet,player,law.release)){
    const key=JSON.stringify([event.market,event.line,event.inclusive]),old=events.get(key);
    // The stronger independent-source requirement wins over a duplicate price
    // event. A push cannot make a failing independent tail look previously valid.
    if(!old||event.rule==='both_sides_positive')events.set(key,event);
   }
   for(const event of events.values()){
    const market=player.markets.indexOf(event.market);
    if(market<0||row.exceptions[market]!==null)continue;
    const f=lawForecast(law,event.market,event.line,event.inclusive);
    const valid=event.rule==='both_sides_positive'?f.over>0&&f.under>0:!unqualifiedEventTail(f,event.oneWayYes);
    if(!valid)continue;
    const witness=(test:(value:number)=>boolean)=>{
     const i=law.weights.findIndex((w,i)=>w>0&&test(scenarioStat(law,event.market,i)));
     return i<0?'-':String(i);
    };
    const over=witness(v=>event.inclusive?v>=event.line:v>event.line),under=witness(v=>v<event.line),push=event.inclusive?'-':witness(v=>v===event.line);
    rows.push(`P${index}M${market}@${event.line}${event.inclusive?'Y':'O'}:${over}/${under}/${push}`);
   }
  }
 }catch{return feedback;}
 if(!rows.length)return feedback;
 const text=before+'\nREJECTED-draft passing event witnesses, NOT evidence/approved values. P/M=original zero-based actor/market; O means >line, Y means >=line. Entries event/complement/push are positive-weight scenario indices (-=absent); complement is <line, ordinary push is =line. '+rows.join('; ')+'. Recheck ALL source requirements after changing weights/coordinates; keep required support or explicitly except the scope. Never copy/auto-retain these values.';
 const bytes=Buffer.byteLength(text,'utf8'),serializedBytes=Buffer.byteLength(JSON.stringify(text).slice(1,-1),'utf8');
 if(!/^[\x00-\x7f]*$/.test(text)||bytes>COMPLETE_CORRECTION_MAX_BYTES||serializedBytes>COMPLETE_CORRECTION_MAX_BYTES)return feedback;
 return{...feedback,text,bytes};
}
