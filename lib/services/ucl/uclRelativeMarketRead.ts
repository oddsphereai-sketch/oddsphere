import {createHash} from 'node:crypto';
import type {EplForwardBookVector} from '@/lib/services/epl/eplForwardEvidenceCapture';
import type {EplStoredPriceObservation} from '@/lib/services/epl/buildEplDailyEdgePreview';
import type {SoccerFixtureEventIdentity} from '@/lib/providers/real_api/SharpApiEplMarketProvider';
import {soccerStoredPriceMaxAgeMs} from '@/lib/providers/real_api/CurrentSoccerMarketProvider';
import type {ScoreDistribution} from '@/lib/services/soccer/dixonColes';
import {deriveSoccerMarketProbabilities} from '@/lib/services/soccer/soccerMarketProbabilities';
import {projectUclGoalMarkets,type UclGoalConstraint} from './uclGoalMarketProjection';

export type UclRelativeMarket='match_result'|'total'|'btts';
export type UclRelativeDirection='home'|'draw'|'away'|'over'|'under'|'yes'|'no'|'flat'|'mixed'|'unknown';
export type UclRelativeCapture={observedAt:string;clockBasis:'stored_capture'|'provider_quote'|'oddsphere_capture';line:number|null;probabilities:Record<string,number>;nativeMean:number|null};
export type UclRelativeMarketPath={
 identity:string;book:string;sourceClass:EplForwardBookVector['sourceClass'];provider:string;providerEventId:string|null;
 identityBasis:'native_event'|'exact_stored_fixture_capture';
 independentOfExecutionBook:boolean;baseline:UclRelativeCapture|null;current:UclRelativeCapture;
 factor:number|Record<string,number>|null;direction:UclRelativeDirection;latestLegDirection:UclRelativeDirection;
 latestInformativeDirection:UclRelativeDirection;latestInformativeAt:string|null;latestInformativeStartAt:string|null;latestInformativeFactor:number|Record<string,number>|null;
 retraced:boolean;roundTrip:boolean;conflicted:boolean;baselineRule:'earliest_complete_same_et_day'|'latest_complete_earlier_et_day'|'unavailable';
 captureCount:number;captureHash:string;captures:UclRelativeCapture[];incompleteCaptureCount:number;conflictingCaptureCount:number;unknownCaptureClocks:string[];latestLegFullyObserved:boolean;reason:string;
};
export type UclRelativeMarketAxisReceipt={
 status:'applied'|'unchanged'|'context_only'|'unavailable'|'conflict';reason:string;selected:UclRelativeMarketPath|null;
 candidates:UclRelativeMarketPath[];inactive:Array<{identity:string;reason:string}>;
 direction:UclRelativeDirection;latestLegDirection:UclRelativeDirection;latestInformativeDirection:UclRelativeDirection;
 currentSupportsPick:boolean;latestLegSupportsPick:boolean;latestInformativeSupportsPick:boolean;
 currentTargetProbabilities:Record<string,number>;currentTargetProbabilityBasis:'direct_paired_market'|'poisson_native_total_inference'|'unavailable';
 pickedSide:string;retraced:boolean;roundTrip:boolean;conflicted:boolean;opposingCandidates:boolean;latestLegFullyObserved:boolean;
};
export type UclRelativeMarketReadReceipt={
 method:'original_independent_relative_marginals_joint_kl'|'joint_source_profile_density_ratio';markets:Record<UclRelativeMarket,UclRelativeMarketAxisReceipt>;
 converged:boolean;residual:number;appliedMarkets:UclRelativeMarket[];includedConstraintMarkets:UclRelativeMarket[];reason:string;targets:{match_result?:Record<string,number>;totalMean?:number;bttsYes?:number};
 originalMeans:{home:number;away:number};finalMeans:{home:number;away:number};
 originalProbabilities:ReturnType<typeof deriveSoccerMarketProbabilities>;finalProbabilities:ReturnType<typeof deriveSoccerMarketProbabilities>;
 crossMarketAffectedMarkets?:UclRelativeMarket[];
 sourceProfileResidual?:{baseline:number;current:number};
 sourceProfileStatus?:'not_required'|'applied'|'conflict';
};
export type UclRelativeMarketInput={
 matchId?:number;matchResultVectors?:EplForwardBookVector[];totalVectors:EplForwardBookVector[];bttsVectors?:EplForwardBookVector[];
 storedPriceHistory?:EplStoredPriceObservation[];providerEventId:string|null;fixtureEventIdentities?:SoccerFixtureEventIdentity[];
 evaluatedMatchResultCanonicalBook:string|null;evaluatedTotalCanonicalBook:string|null;evaluatedBttsCanonicalBook:string|null;
 decisionAt:string;kickoff:string;
};
const SIDES:Record<UclRelativeMarket,readonly string[]>={match_result:['home','draw','away'],total:['over','under'],btts:['yes','no']};
const BOOKS=['pinnacle','circa','novig','draftkings','fanduel','betmgm','caesars'];
const EPS=1e-12;
const etFormatter=new Intl.DateTimeFormat('en-CA',{timeZone:'America/New_York',year:'numeric',month:'2-digit',day:'2-digit'});
const etDay=(at:number)=>etFormatter.format(new Date(at));
const book=(value:string|null)=>String(value??'').toLowerCase().replace(/[^a-z0-9]/g,'');
const rank=(value:string)=>{const n=BOOKS.indexOf(value);return n<0?BOOKS.length:n;};
const implied=(a:number)=>a>0?100/(a+100):-a/(-a+100);
function probabilities(rows:Array<{side:string;american:number}>,market:UclRelativeMarket):Record<string,number>|null{
 const p:Record<string,number>={};
 for(const side of SIDES[market]){const values=rows.filter(r=>r.side===side).map(r=>r.american);
  if(!values.length||values.some(a=>!Number.isFinite(a)||Math.abs(a)<100)||new Set(values).size!==1)return null;p[side]=implied(values[0]!);}
 const sum=Object.values(p).reduce((s,v)=>s+v,0);if(sum<.98||sum>1.25)return null;
 const fair=Object.fromEntries(Object.entries(p).map(([k,v])=>[k,v/sum]));return Object.values(fair).every(q=>Number.isFinite(q)&&q>0&&q<1)?fair:null;
}
function poissonCdf(k:number,mu:number):number{
 if(k<0)return 0;let p=Math.exp(-mu),sum=p;for(let n=1;n<=k;n++){p*=mu/n;sum+=p;}return Math.min(1,sum);
}
export function uclPoissonNativeTotalShare(mu:number,line:number):number|null{
 if(!Number.isFinite(mu)||mu<=0||!Number.isFinite(line)||line<0||!Number.isInteger(line*4)||line>512)return null;
 const legs=Number.isInteger(line*2)?[line]:[line-.25,line+.25];let win=0,loss=0;
 for(const leg of legs){win+=1-poissonCdf(Math.floor(leg),mu);loss+=poissonCdf(Math.ceil(leg)-1,mu);}
 return win+loss>0?win/(win+loss):null;
}
export function inferUclNativeTotalMean(line:number,q:number):number|null{
 if(!Number.isFinite(q)||q<=0||q>=1)return null;let low=1e-8,high=Math.max(4,line+2);
 const a=uclPoissonNativeTotalShare(low,line);let b=uclPoissonNativeTotalShare(high,line);
 if(a===null||b===null||a>q+EPS)return null;
 for(let i=0;i<12&&b<q;i++){high*=2;b=uclPoissonNativeTotalShare(high,line);if(b===null)return null;}
 if(b<q)return null;
 for(let i=0;i<80;i++){const mid=(low+high)/2,p=uclPoissonNativeTotalShare(mid,line);if(p===null)return null;if(p<q)low=mid;else high=mid;}
 return(low+high)/2;
}
function capture(market:UclRelativeMarket,line:number|null,observedAt:string,clockBasis:UclRelativeCapture['clockBasis'],p:Record<string,number>):UclRelativeCapture|null{
 const nativeMean=market==='total'?inferUclNativeTotalMean(line!,p.over!):null;
 if(market==='total'&&nativeMean===null)return null;return{observedAt,clockBasis,line,probabilities:p,nativeMean};
}
function factors(market:UclRelativeMarket,a:UclRelativeCapture,b:UclRelativeCapture):number|Record<string,number>{
 if(market==='total')return b.nativeMean!/a.nativeMean!;
 if(market==='btts')return(b.probabilities.yes!/(1-b.probabilities.yes!))/(a.probabilities.yes!/(1-a.probabilities.yes!));
 return Object.fromEntries(SIDES.match_result.map(side=>[side,b.probabilities[side]!/a.probabilities[side]!]));
}
function direction(market:UclRelativeMarket,factor:number|Record<string,number>|null):UclRelativeDirection{
 if(factor===null)return'unknown';
 if(typeof factor==='number'){if(Math.abs(Math.log(factor))<=EPS)return'flat';return market==='total'?(factor>1?'over':'under'):(factor>1?'yes':'no');}
 const values=Object.entries(factor).map(([side,value])=>({side,value:Math.log(value)})).sort((a,b)=>b.value-a.value);
 if(values.every(row=>Math.abs(row.value)<=EPS))return'flat';
 if(Math.abs(values[0]!.value-values[1]!.value)<=EPS)return'mixed';return values[0]!.side as UclRelativeDirection;
}
function supports(market:UclRelativeMarket,factor:number|Record<string,number>|null,side:string):boolean{
 if(factor===null)return false;if(typeof factor==='object')return Number.isFinite(factor[side])&&Math.log(factor[side]!)>EPS;
 return market==='total'?(side==='over'?Math.log(factor)>EPS:Math.log(factor)<-EPS):(side==='yes'?Math.log(factor)>EPS:Math.log(factor)<-EPS);
}
function metric(market:UclRelativeMarket,c:UclRelativeCapture,side:string){return market==='total'?Math.log(c.nativeMean!):market==='btts'?Math.log(c.probabilities.yes!/(1-c.probabilities.yes!)):Math.log(c.probabilities[side]!);}
function historyFor(input:UclRelativeMarketInput,market:UclRelativeMarket,physicalBook:string,currentAt:number):{captures:UclRelativeCapture[];conflicts:number[];incomplete:number[]}{
 const groups=new Map<string,EplStoredPriceObservation[]>();
 for(const row of input.storedPriceHistory??[]){const at=Date.parse(row.recordedAt);
  if(row.providerId!==input.matchId||row.market!==market||book(row.sportsbook)!==physicalBook||!Number.isFinite(at)||at>=currentAt)continue;
  if(market==='total'?(row.line===null||row.line<0||!Number.isInteger(row.line*4)):row.line!==null)continue;
  const key=JSON.stringify([at,row.line]);const list=groups.get(key)??[];list.push(row);groups.set(key,list);}
 const captures:UclRelativeCapture[]=[],conflicts:number[]=[],incomplete:number[]=[];
 for(const rows of groups.values()){
  const conflict=SIDES[market].some(side=>new Set(rows.filter(r=>r.side===side).map(r=>r.american)).size>1);
  if(conflict){conflicts.push(Date.parse(rows[0]!.recordedAt));continue;}const p=probabilities(rows,market);if(!p){incomplete.push(Date.parse(rows[0]!.recordedAt));continue;}
  const c=capture(market,rows[0]!.line,rows[0]!.recordedAt,'stored_capture',p);if(c)captures.push(c);
 }
 return{captures:captures.sort((a,b)=>Date.parse(a.observedAt)-Date.parse(b.observedAt)||(a.line??0)-(b.line??0)),conflicts,incomplete};
}
function chooseAtClock(rows:UclRelativeCapture[],line:number|null):UclRelativeCapture{
 return [...rows].sort((a,b)=>(a.line===line?0:1)-(b.line===line?0:1)||(a.line===2.5?0:1)-(b.line===2.5?0:1)||(a.line??0)-(b.line??0))[0]!;
}
function buildPath(input:UclRelativeMarketInput,market:UclRelativeMarket,vector:EplForwardBookVector,current:UclRelativeCapture):UclRelativeMarketPath{
 const excluded=market==='total'?input.evaluatedTotalCanonicalBook:market==='btts'?input.evaluatedBttsCanonicalBook:input.evaluatedMatchResultCanonicalBook;
 const history=historyFor(input,market,vector.canonicalBook,Date.parse(current.observedAt));
 const sameDay=history.captures.filter(c=>etDay(Date.parse(c.observedAt))===etDay(Date.parse(input.decisionAt)));
 const previous=history.captures.filter(c=>etDay(Date.parse(c.observedAt))<etDay(Date.parse(input.decisionAt)));
 const eligible=sameDay.length?sameDay:previous;
 const time=eligible.length?(sameDay.length?Math.min(...eligible.map(c=>Date.parse(c.observedAt))):Math.max(...eligible.map(c=>Date.parse(c.observedAt)))):null;
 const baseline=time===null?null:chooseAtClock(eligible.filter(c=>Date.parse(c.observedAt)===time),current.line);
 const byClock=new Map<number,UclRelativeCapture[]>();
 for(const c of history.captures){const at=Date.parse(c.observedAt);if(!baseline||at<Date.parse(baseline.observedAt))continue;const rows=byClock.get(at)??[];rows.push(c);byClock.set(at,rows);}
 const full=baseline?[...byClock.entries()].sort(([a],[b])=>a-b).map(([,rows])=>chooseAtClock(rows,current.line)).concat(current):[current];
 const completedClocks=new Set(history.captures.map(c=>Date.parse(c.observedAt)));
 const inWindow=(at:number)=>!!baseline&&at>=Date.parse(baseline.observedAt);
 const incomplete=history.incomplete.filter(at=>inWindow(at)&&!completedClocks.has(at)),conflicting=history.conflicts.filter(inWindow);
 // Newer incomplete stored observations cannot replace a complete pair or
 // support a claim that the latest observed reaction is fully known.
 const laterUnknown=vector.provider==='stored_quote'?(input.storedPriceHistory??[]).filter(row=>
  row.providerId===input.matchId&&row.market===market&&book(row.sportsbook)===vector.canonicalBook&&row.line===vector.line
  &&!row.isOpener&&Date.parse(row.recordedAt)>Date.parse(current.observedAt)&&Date.parse(row.recordedAt)<=Date.parse(input.decisionAt))
  .map(row=>Date.parse(row.recordedAt)):[];
 const unknown=[...new Set([...incomplete,...conflicting,...laterUnknown])].sort((a,b)=>a-b);
 const latestLegStart=full.length>=2?Date.parse(full[full.length-2]!.observedAt):null;
 let latestLegFullyObserved=latestLegStart!==null&&!unknown.some(at=>at>latestLegStart);
 const factor=baseline?factors(market,baseline,current):null,netDirection=direction(market,factor);
 const latestFactor=full.length>=2?factors(market,full[full.length-2]!,current):null;
 let latestInformativeDirection:UclRelativeDirection='unknown',latestInformativeAt:string|null=null,latestInformativeStartAt:string|null=null,latestInformativeFactor:number|Record<string,number>|null=null,retraced=false,everMoved=false;
 const side=market==='match_result'?(netDirection==='home'||netDirection==='away'||netDirection==='draw'?netDirection:'home'):'yes';
 let runningExtreme=metric(market,full[0]!,side);const netSign=baseline?Math.sign(metric(market,current,side)-metric(market,baseline,side)):0;
 for(let i=1;i<full.length;i++){const d=direction(market,factors(market,full[i-1]!,full[i]!));
  if(d!=='flat'){everMoved=true;latestInformativeDirection=d;latestInformativeAt=full[i]!.observedAt;latestInformativeStartAt=full[i-1]!.observedAt;latestInformativeFactor=factors(market,full[i-1]!,full[i]!);}
  const value=metric(market,full[i]!,side);if(netSign>=0){if(value<runningExtreme-EPS)retraced=true;runningExtreme=Math.max(runningExtreme,value);}else{if(value>runningExtreme+EPS)retraced=true;runningExtreme=Math.min(runningExtreme,value);}}
 const evidenceStart=latestInformativeStartAt===null?latestLegStart:Date.parse(latestInformativeStartAt);
 latestLegFullyObserved=evidenceStart!==null&&!unknown.some(at=>at>evidenceStart);
 const selected=new Set<number>([0,Math.max(0,full.length-2),full.length-1]);
 for(const side of market==='match_result'?SIDES.match_result:['yes']){const values=full.map(c=>metric(market,c,side));selected.add(values.indexOf(Math.min(...values)));selected.add(values.indexOf(Math.max(...values)));}
 const bounded=[...selected].sort((a,b)=>a-b).map(i=>full[i]!);
 return{identity:vector.identity,book:vector.canonicalBook,sourceClass:vector.sourceClass,provider:vector.provider,providerEventId:vector.providerEventId,
  identityBasis:vector.provider==='stored_quote'?'exact_stored_fixture_capture':'native_event',
  independentOfExecutionBook:vector.canonicalBook!==excluded,baseline,current,factor,direction:netDirection,latestLegDirection:direction(market,latestFactor),latestInformativeDirection,latestInformativeAt,latestInformativeStartAt,latestInformativeFactor,
  retraced,roundTrip:!!baseline&&netDirection==='flat'&&everMoved,conflicted:!!baseline&&history.conflicts.some(at=>at>=Date.parse(baseline.observedAt)),
  baselineRule:baseline?(sameDay.length?'earliest_complete_same_et_day':'latest_complete_earlier_et_day'):'unavailable',
  captureCount:full.length,incompleteCaptureCount:incomplete.length,conflictingCaptureCount:conflicting.length,unknownCaptureClocks:unknown.length?[new Date(unknown[0]!).toISOString(),...(unknown.length>1?[new Date(unknown[unknown.length-1]!).toISOString()]:[])]:[],latestLegFullyObserved,captureHash:createHash('sha256').update(JSON.stringify(full)).digest('hex'),captures:bounded,
  reason:baseline?(netDirection==='flat'?'paired_path_net_unchanged':'paired_path_relative_innovation'):'no_complete_baseline_before_current_original_clock'};
}
function exactStoredCapture(input:UclRelativeMarketInput,market:UclRelativeMarket,vector:EplForwardBookVector):boolean{
 if(vector.provider!=='stored_quote'||!['/line_history','/oddsphere/ucl/stored-line-history'].includes(vector.providerEndpoint)
  ||vector.providerEventId!==null||!Number.isSafeInteger(input.matchId)||input.matchId!<=0
  ||vector.outcomes.length!==SIDES[market].length||vector.outcomes.some(o=>o.fetchedAtSource!=='oddsphere_capture'))return false;
 const times=vector.outcomes.map(o=>Date.parse(o.fetchedAt??''));
 if(times.some(t=>!Number.isFinite(t))||new Set(times).size!==1)return false;
 const rows=(input.storedPriceHistory??[]).filter(row=>row.providerId===input.matchId&&row.market===market
  &&book(row.sportsbook)===vector.canonicalBook&&row.line===vector.line&&!row.isOpener&&Date.parse(row.recordedAt)===times[0]);
 if(rows.some(row=>!SIDES[market].includes(row.side))||!probabilities(rows,market))return false;
 if(!SIDES[market].every(side=>{
  const quotes=vector.outcomes.filter(o=>o.side===side),stored=rows.filter(row=>row.side===side);
  return quotes.length===1&&stored.length>0&&stored.every(row=>row.american===quotes[0]!.american);
 }))return false;
 const later=new Map<number,EplStoredPriceObservation[]>(),now=Date.parse(input.decisionAt);
 for(const row of input.storedPriceHistory??[]){const at=Date.parse(row.recordedAt);
  if(row.providerId!==input.matchId||row.market!==market||book(row.sportsbook)!==vector.canonicalBook||row.line!==vector.line
   ||row.isOpener||!Number.isFinite(at)||at<=times[0]!||at>now)continue;
  later.set(at,[...(later.get(at)??[]),row]);
 }
 return ![...later.values()].some(rows=>probabilities(rows,market)!==null);
}
function pathsFor(input:UclRelativeMarketInput,market:UclRelativeMarket):{paths:UclRelativeMarketPath[];inactive:Array<{identity:string;reason:string}>}{
 const vectors=market==='match_result'?input.matchResultVectors??[]:market==='total'?input.totalVectors:input.bttsVectors??[];
 const now=Date.parse(input.decisionAt),start=Date.parse(input.kickoff),inactive:Array<{identity:string;reason:string}>=[];
 const valid:Array<{vector:EplForwardBookVector;current:UclRelativeCapture;key:string;signature:string}>=[];
 for(const vector of vectors){let reason:string|null=null;const times=vector.outcomes.map(o=>Date.parse(o.fetchedAt??''));
  const stored=vector.provider==='stored_quote',storedAttested=stored&&exactStoredCapture(input,market,vector);
  if(!Number.isFinite(now)||!Number.isFinite(start)||now>=start)reason='decision_not_before_kickoff';
  else if(vector.market!==market||!vector.canonicalBook||!['named_originator','named_retail','named_other'].includes(vector.sourceClass)||['kalshi','polymarket'].includes(vector.canonicalBook))reason='wrong_market_or_unnamed_book';
  else if(stored?!storedAttested:!vector.providerEventId||(input.fixtureEventIdentities!==undefined?!input.fixtureEventIdentities.some(r=>r.provider===vector.provider&&r.providerEventId===vector.providerEventId&&r.market===market&&r.sportsbook===vector.canonicalBook):input.providerEventId===null||input.providerEventId!==vector.providerEventId))reason=stored?'stored_capture_not_exact_fixture_pair':'provider_event_identity_mismatch';
  else if(times.length!==SIDES[market].length||times.some(t=>!Number.isFinite(t)||t>now||t>=start||now-t>soccerStoredPriceMaxAgeMs(input.kickoff,now))||Math.max(...times)-Math.min(...times)>60_000)reason='original_quote_stale_future_or_incomplete';
  else if(market==='total'?(vector.line===null||vector.line<0||!Number.isInteger(vector.line*4)):vector.line!==null)reason='invalid_exact_contract';
  const p=reason?null:probabilities(vector.outcomes,market);
  if(!reason&&!p)reason='incomplete_conflicting_or_implausible_price_pair';
  const c=!reason&&p?capture(market,vector.line,new Date(Math.min(...times)).toISOString(),storedAttested?'stored_capture':vector.outcomes.every(o=>o.fetchedAtSource==='provider')?'provider_quote':'oddsphere_capture',p):null;
  if(!reason&&!c)reason='native_total_inverse_unavailable';
  if(reason||!c){inactive.push({identity:vector.identity,reason:reason??'invalid_current_capture'});continue;}
  valid.push({vector,current:c,key:JSON.stringify([vector.canonicalBook,vector.line,Math.min(...times),Math.max(...times)]),signature:JSON.stringify(SIDES[market].map(side=>vector.outcomes.find(o=>o.side===side)?.american))});
 }
 const signatures=new Map<string,Set<string>>();for(const row of valid){const set=signatures.get(row.key)??new Set<string>();set.add(row.signature);signatures.set(row.key,set);}
 const byBook=new Map<string,UclRelativeMarketPath[]>();
 for(const row of valid){if(signatures.get(row.key)!.size>1){inactive.push({identity:row.vector.identity,reason:'conflicting_same_physical_book_contract_clock'});continue;}
  const path=buildPath(input,market,row.vector,row.current),list=byBook.get(path.book)??[];list.push(path);byBook.set(path.book,list);}
 const paths=[...byBook.values()].map(rows=>rows.sort((a,b)=>(a.baseline?0:1)-(b.baseline?0:1)
  ||(market==='total'?(a.current.line===2.5?0:1)-(b.current.line===2.5?0:1):0)
  ||Date.parse(b.current.observedAt)-Date.parse(a.current.observedAt)||a.identity.localeCompare(b.identity))[0]!);
 return{paths:paths.sort((a,b)=>(a.baseline?0:1)-(b.baseline?0:1)
  ||rank(a.book)-rank(b.book)||a.book.localeCompare(b.book)),inactive};
}
function meanGoals(joint:ScoreDistribution){let home=0,away=0;for(let h=0;h<joint.length;h++)for(let a=0;a<joint[h]!.length;a++){home+=h*joint[h]![a]!;away+=a*joint[h]![a]!;}return{home,away};}
function emptyAxis():UclRelativeMarketAxisReceipt{return{status:'unavailable',reason:'no_current_paired_source',selected:null,candidates:[],inactive:[],direction:'unknown',latestLegDirection:'unknown',latestInformativeDirection:'unknown',currentSupportsPick:false,latestLegSupportsPick:false,latestInformativeSupportsPick:false,currentTargetProbabilities:{},currentTargetProbabilityBasis:'unavailable',pickedSide:'',retraced:false,roundTrip:false,conflicted:false,opposingCandidates:false,latestLegFullyObserved:false};}
function factorOpposes(market:UclRelativeMarket,factor:number|Record<string,number>|null,side:UclRelativeDirection):boolean{
 if(factor===null||['unknown','flat','mixed'].includes(side))return false;
 if(typeof factor==='object')return Number.isFinite(factor[side])&&Math.log(factor[side]!)<-EPS;
 return market==='total'?(side==='over'?factor<1-EPS:factor>1+EPS):(side==='yes'?factor<1-EPS:factor>1+EPS);
}
export function deriveUclRelativeMarketRead(base:ScoreDistribution,input:UclRelativeMarketInput):{joint:ScoreDistribution;receipt:UclRelativeMarketReadReceipt}{
 const original=deriveSoccerMarketProbabilities({joint:base,totalLine:2.5}),axes:Record<UclRelativeMarket,UclRelativeMarketAxisReceipt>={match_result:emptyAxis(),total:emptyAxis(),btts:emptyAxis()};
 const groups:Array<{market:UclRelativeMarket;before:UclGoalConstraint[];after:UclGoalConstraint[]}>=[],targets:UclRelativeMarketReadReceipt['targets']={};
 for(const market of ['match_result','total','btts'] as const){const data=pathsFor(input,market),axis=axes[market],path=data.paths[0]??null;
  Object.assign(axis,{selected:path,candidates:data.paths,inactive:data.inactive});
  if(!path)continue;
  Object.assign(axis,{status:path.baseline?(path.direction==='flat'?'unchanged':'applied'):'context_only',reason:path.reason,direction:path.direction,latestLegDirection:path.latestLegDirection,
   latestInformativeDirection:path.latestInformativeDirection,latestLegFullyObserved:path.latestLegFullyObserved,retraced:path.retraced,roundTrip:path.roundTrip,conflicted:path.conflicted,
   opposingCandidates:data.paths.slice(1).some(other=>factorOpposes(market,other.factor,path.direction))});
  axis.currentTargetProbabilities=market==='total'?(()=>{const p=uclPoissonNativeTotalShare(path.current.nativeMean!,2.5)!;return{over:p,under:1-p};})():{...path.current.probabilities};
  axis.currentTargetProbabilityBasis=market==='total'?'poisson_native_total_inference':'direct_paired_market';
  if(!path.baseline)continue;
  const constraints=(c:UclRelativeCapture):UclGoalConstraint[]=>market==='match_result'
   ?['home','draw'].map(side=>({identity:`profile_mr:${side}`,target:c.probabilities[side]!,feature:(h,a)=>side==='home'?(h>a?1:0):(h===a?1:0)}))
   :market==='total'?[{identity:'profile_native_total_mean',target:c.nativeMean!,feature:(h,a)=>h+a}]
   :[{identity:'profile_btts',target:c.probabilities.yes!,feature:(h,a)=>h>0&&a>0?1:0}];
  groups.push({market,before:constraints(path.baseline),after:constraints(path.current)});
 }
 let joint=base,residual=0,converged=true,applied:UclRelativeMarket[]=[],included:UclRelativeMarket[]=[];
 let sourceProfileResidual:{baseline:number;current:number}|undefined;
 const hasInnovation=groups.some(g=>axes[g.market].direction!=='flat');
 if(hasInnovation){
  // One joint innovation, not separately frozen original marginals. Build
  // baseline/current source profiles against the SAME reference law, then
  // apply their density ratio once to the original statistical forecast.
  // Current book probabilities are never adopted as final targets. Flat
  // axes retain source context without freezing the forecast's BTTS/Total.
  const priority:UclRelativeMarket[]=['total','match_result','btts'];
  const subsets=Array.from({length:(1<<groups.length)-1},(_,i)=>groups.filter((_,j)=>(i+1)&(1<<j)))
   .sort((a,b)=>b.filter(g=>axes[g.market].direction!=='flat').length-a.filter(g=>axes[g.market].direction!=='flat').length||b.length-a.length||priority.reduce((score,m,i)=>score+((b.some(g=>g.market===m)?1:0)-(a.some(g=>g.market===m)?1:0))*(1<<(priority.length-i)),0));
  let found=false;
  for(const subset of subsets){
   const before=projectUclGoalMarkets(base,subset.flatMap(g=>g.before));
   const after=projectUclGoalMarkets(base,subset.flatMap(g=>g.after));
   if(!before.converged||!after.converged)continue;
   if(base.some((row,h)=>row.some((p,a)=>p>0&&(!(before.joint[h]![a]!>0)||!(after.joint[h]![a]!>0)))))continue;
   const logs=base.map((row,h)=>row.map((p,a)=>p>0&&before.joint[h]![a]!>0&&after.joint[h]![a]!>0
    ?Math.log(p)+Math.log(after.joint[h]![a]!)-Math.log(before.joint[h]![a]!):-Infinity));
   const shift=Math.max(...logs.flat()),raw=logs.map(row=>row.map(v=>Math.exp(v-shift))),mass=raw.flat().reduce((s,p)=>s+p,0);
   if(!Number.isFinite(mass)||mass<=0)continue;
   included=subset.map(g=>g.market);applied=included.filter(m=>axes[m].direction!=='flat');
   joint=applied.length?raw.map(row=>row.map(p=>p/mass)):base;
   sourceProfileResidual={baseline:before.residual,current:after.residual};
   residual=Math.max(before.residual,after.residual);found=true;break;
  }
  if(!found){converged=false;residual=1;}
  for(const group of groups)if(!included.includes(group.market)){axes[group.market].status='conflict';axes[group.market].conflicted=true;axes[group.market].reason='relative_joint_marginal_incompatible_or_projection_unavailable';}
 }
 const final=deriveSoccerMarketProbabilities({joint,totalLine:2.5});
 for(const market of ['match_result','total','btts'] as const){const axis=axes[market],path=axis.selected;
  const p=market==='match_result'?final.match_result:market==='total'?final.total:final.btts;
  axis.pickedSide=SIDES[market].reduce((best,side)=>(p as unknown as Record<string,number>)[side]!>(p as unknown as Record<string,number>)[best]!?side:best,SIDES[market][0]!);
  if(path){axis.opposingCandidates=axis.candidates.filter(other=>other.book!==path.book).some(other=>
    factorOpposes(market,other.factor,axis.pickedSide as UclRelativeDirection)||factorOpposes(market,other.latestInformativeFactor,axis.pickedSide as UclRelativeDirection));
   axis.currentSupportsPick=supports(market,path.factor,axis.pickedSide);
   const last=path.captures.length>=2?path.captures[path.captures.length-2]:null;
   axis.latestLegSupportsPick=!!last&&supports(market,factors(market,last,path.current),axis.pickedSide);
   axis.latestInformativeSupportsPick=supports(market,path.latestInformativeFactor,axis.pickedSide);
   if(path.latestLegDirection==='flat'&&axis.latestInformativeSupportsPick)axis.latestLegSupportsPick=true;
  }
 }
 return{joint,receipt:{method:'joint_source_profile_density_ratio',markets:axes,targets,converged,residual,sourceProfileResidual,
  sourceProfileStatus:!hasInnovation?'not_required':applied.length?'applied':'conflict',appliedMarkets:applied,includedConstraintMarkets:included,
  crossMarketAffectedMarkets:(['match_result','total','btts'] as const).filter(m=>!applied.includes(m)&&
   (m==='match_result'?SIDES.match_result.some(s=>Math.abs(final.match_result[s as 'home'|'draw'|'away']-original.match_result[s as 'home'|'draw'|'away'])>1e-9)
    :m==='total'?Math.abs(final.total.over-original.total.over)>1e-9:Math.abs(final.btts.yes-original.btts.yes)>1e-9)),
  reason:applied.length?'observed_relative_paths_applied_jointly':hasInnovation?'relative_projection_unavailable':'no_nonflat_complete_paired_market_path',
  originalMeans:meanGoals(base),finalMeans:meanGoals(joint),originalProbabilities:original,finalProbabilities:final}};
}
