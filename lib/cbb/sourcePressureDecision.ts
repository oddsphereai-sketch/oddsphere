import type {CbbDecisionSplitContext} from "./decisionSplitContext";
import type {CbbForecast,CbbQuote} from "./types";
import {cbbExactMarketCenter} from "./marketReaderResearch";
import {cbbImpliedProbability} from "./marketEvidence";
import {cbbEvidenceAvailableAt,cbbEvidenceReceiptBounds} from "./marketReceiptTime";

export type CbbPressureDecision={
  book:string;market:CbbQuote["market"];sourceClass:CbbDecisionSplitContext["sourceClass"];
  ownLine:number|null;moneyDirection:-1|0|1|null;ticketDirection:-1|0|1|null;
  sourceAt:string|null;availableBy:string;
  reaction:"toward_money"|"against_money"|"held"|"unbound";
  reactionDirection:-1|0|1|null;reactionDelta:number|null;
  latestDirection:-1|0|1|null;resolution:"unavailable"|"held"|"ongoing"|"contested"|"resumed"|"cancelled"|"reversed";
  baseline:CbbQuote|null;current:CbbQuote|null;reason:string;
};
const family=(book:string)=>book==="ps3838"?"pinnacle":book==="draftkings_network"?"draftkings":book;
const sign=(n:number):-1|0|1=>Math.abs(n)<=1e-7?0:n>0?1:-1;
const share=(a:number|null,b:number|null)=>a===null||b===null?null:sign(a-b);
const pair=(q:CbbQuote)=>JSON.stringify([q.line,q.firstPrice,q.secondPrice]);

/** Pressure changes interpretation, not score amplitude. Only a genuine later
 * own-source price can establish a response; a public aggregate has no book. */
export function readCbbSourcePressure(args:{forecast:CbbForecast;rows:readonly CbbDecisionSplitContext[];quotes:readonly CbbQuote[];
  quarantinedKeys:readonly string[]}):CbbPressureDecision[]{
  const at=Date.parse(args.forecast.asOf),quarantined=new Set(args.quarantinedKeys);
  return args.rows.filter(row=>row.gameId===args.forecast.gameId&&Date.parse(row.availableBy)<=at&&
    Number.isFinite(Date.parse(row.observedAt??row.availableBy))&&at-Date.parse(row.observedAt??row.availableBy)<=3*3600_000).map(row=>{
    const book=family(row.physicalFamily),moneyDirection=share(row.firstMoney,row.secondMoney),ticketDirection=share(row.firstTickets,row.secondTickets);
    const read:CbbPressureDecision={book,market:row.market,sourceClass:row.sourceClass,ownLine:row.line,moneyDirection,ticketDirection,
      sourceAt:row.observedAt,availableBy:row.availableBy,reaction:"unbound",reactionDirection:null,reactionDelta:null,
      latestDirection:null,resolution:"unavailable",
      baseline:null,current:null,reason:"source_contract_or_response_unavailable"};
    if(row.sourceClass==="multi_book_consensus"||row.observedAt===null||row.market!=="moneyline"&&row.line===null||quarantined.has(`${book}:${row.market}`))return read;
    const observed=Date.parse(row.observedAt),earliest=Date.parse(row.receiptEarliest??row.availableBy),available=Date.parse(row.availableBy);
    if(![observed,earliest,available].every(Number.isFinite)||earliest>available||observed>available||available>at)return read;
    const quotes=args.quotes.filter(q=>q.gameId===row.gameId&&family(q.sportsbook)===book&&q.market===row.market&&q.phase==="current"&&
      (q as CbbQuote&{orientationVerified?:boolean}).orientationVerified===true&&
      Number.isFinite(Date.parse(q.providerObservedAt))&&Date.parse(q.providerObservedAt)<=cbbEvidenceAvailableAt(q)&&cbbEvidenceAvailableAt(q)<=at);
    // Identifiable invalid states remain sentinels. Filtering them first would
    // revive an older response and fabricate current action confirmation.
    const validContract=(q:CbbQuote)=>Number.isFinite(q.firstPrice)&&Number.isFinite(q.secondPrice)&&
      Math.abs(q.firstPrice)>=100&&Math.abs(q.secondPrice)>=100&&
      (q.market==="moneyline"?q.line===null:q.line!==null&&Number.isFinite(q.line)&&Number.isInteger(q.line*2));
    if(quotes.some(q=>!validContract(q)))return {...read,reason:"invalid_identifiable_source_state"};
    const byTime=new Map<number,CbbQuote[]>();
    for(const q of quotes){const key=Date.parse(q.providerObservedAt);byTime.set(key,[...(byTime.get(key)??[]),q]);}
    if([...byTime.values()].some(rows=>new Set(rows.map(pair)).size>1))return {...read,reason:"ambiguous_own_source_prices"};
    const ordered=[...byTime.entries()].sort((a,b)=>a[0]-b[0]).map(([,rows])=>rows.sort((a,b)=>cbbEvidenceAvailableAt(a)-cbbEvidenceAvailableAt(b))[0]);
    // No borrowing an older contract behind a changed latest pre-flow state.
    const prior=ordered.filter(q=>Date.parse(q.providerObservedAt)<=observed),latest=prior.at(-1);
    if(!latest||latest.line!==row.line)return read;
    const baseline=[...prior].reverse().find(q=>pair(q)===pair(latest)&&
      prior.slice(prior.indexOf(q)).every(x=>pair(x)===pair(latest))&&cbbEvidenceAvailableAt(q)<=earliest&&observed-Date.parse(q.providerObservedAt)<=2*3600_000);
    const current=ordered.at(-1);
    if(!baseline||!current||Date.parse(current.providerObservedAt)<=observed||
      cbbEvidenceReceiptBounds(current).earliest<available||at-Date.parse(current.providerObservedAt)>3600_000)return read;
    try{
      const center=(q:CbbQuote)=>{
        const a=cbbImpliedProbability(q.firstPrice),b=cbbImpliedProbability(q.secondPrice);
        if(a+b<.98||a+b>1.3)throw new Error("Invalid source hold");
        return cbbExactMarketCenter(args.forecast,q,a/(a+b));
      };
      const origin=center(baseline),post=ordered.filter(q=>Date.parse(q.providerObservedAt)>observed);
      const positions=post.map(q=>center(q)-origin),deltas=positions.map((p,i)=>p-(positions[i-1]??0));
      const moving=deltas.map(sign).filter(d=>d!==0);
      const initial:-1|0|1=moving.length?moving[0]:0,latestDirection=moving.at(-1)??0;
      const delta=positions.at(-1)??0,direction=sign(delta),reversed=moving.some(d=>d!==initial);
      const frontier=Math.max(0,...positions.map(p=>p*initial));
      const resolution=initial===0?"held" as const:direction===0?"cancelled" as const:direction!==initial?"reversed" as const:
        reversed?(delta*initial>=frontier-1e-7?"resumed" as const:"contested" as const):"ongoing" as const;
      return {...read,baseline:structuredClone(baseline),current:structuredClone(current),reactionDelta:delta,reactionDirection:direction,
        latestDirection,resolution,
        reaction:direction===0?"held" as const:moneyDirection!==null&&moneyDirection!==0&&direction===moneyDirection?"toward_money" as const:"against_money" as const,
        reason:"observed_own_contract_pressure_and_later_economic_state"};
    }catch{return {...read,reason:"source_economics_unavailable"};}
  });
}
