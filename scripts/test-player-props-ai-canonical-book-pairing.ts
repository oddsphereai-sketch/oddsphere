/* eslint-disable @typescript-eslint/no-explicit-any */
/** Injected current collector→wire→member, paired legacy policy and opaque locks. */
import assert from 'node:assert/strict';
import {gzipSync} from 'node:zlib';
import {collectNbaPlayerPropsLiveMarket} from '../lib/services/nba/nbaPlayerPropsLiveCollector';
import {liveNbaPacket} from '../lib/playerPropsAi/liveSources';
import {nbaPlayedStateFixture} from './lib/player-props-ai-nba-played-fixture';
import {verifiedReaderFixture} from './lib/player-props-ai-reader-fixture';
import {parseJointReview} from '../lib/playerPropsAi/request';
import {PROPS_AI_WIRE_RELEASE} from '../lib/playerPropsAi/scenarioCoordinates';
import {encodeCanonicalScenarioLaw} from '../lib/playerPropsAi/generativeCoordinates';
import {siteAiDecisions} from '../lib/playerPropsAi/publication';
import {criticalContextHashes} from '../lib/playerPropsAi/criticalContext';
import {digest} from '../lib/playerPropsAi/evidence';
import {applyNbaSiteAi} from '../lib/playerPropsAi/siteBindings';
import {buildNbaPlayerPropsMemberSnapshot} from '../lib/services/nba/nbaPlayerPropsProductContract';
import {ORIGINAL_PAIRED_PROPS_AI_LAW_RELEASE,ORIGINAL_PAIRED_PROPS_AI_GRADE_RELEASE,ORIGINAL_PAIRED_PROPS_AI_SELECTION_RELEASE,propsAiLawSelectionRelease} from '../lib/playerPropsAi/releases';
import {priceAiLaw,gradeAiEventFromExactPairedMass} from '../lib/playerPropsAi/pricing';
import {primitives,validateLaw,lawForecast,lawEventMass,scenarioStat} from '../lib/playerPropsAi/law';
import {quoteBook} from '../lib/playerPropsAi/executionQuotes';
import {withOriginalDraftCorrectionContext} from '../lib/playerPropsAi/originalDraftCorrectionContext';
import {advanceNbaPlayerPropsCandidateLifecycle} from '../lib/services/nba/nbaPlayerPropsLifecycle';
const at='2030-11-17T18:00:00.000Z',start='2030-11-17T23:00:00.000Z',lock='2030-11-17T22:00:00.000Z',RealDate=Date;
class Clock extends RealDate{constructor(value?:string|number){super(value??at);}static now(){return RealDate.parse(at);}}
globalThis.Date=Clock as DateConstructor;
globalThis.fetch=async()=>{throw Error('INDEPENDENT R97 NETWORK FORBIDDEN');};
const zero=()=>Array(16).fill(0),results:any={};
function review(p:any,w=128,l=100){
 const player=p.players[0],weights=[w,l,...zero().slice(2)],outcomes={points:[21,20,...zero().slice(2)],rebounds:zero(),assists:zero(),threes:zero()};
 const raw={wireRelease:PROPS_AI_WIRE_RELEASE,players:{[player.id]:verifiedReaderFixture(p,player.id,{priorRead:{},evidenceIds:['e0'],gaps:[],law:encodeCanonicalScenarioLaw('nba',player,{weights,outcomes}),confidence:[2],exceptions:[null]})}};
 const parsed=parseJointReview(p,raw),body=JSON.stringify(p);
 return {...parsed,gameId:p.gameId,start:p.start,lock:p.lock,cutoff:p.cutoff,marketScopes:{[player.id]:[...player.markets]},criticalContextHashes:criticalContextHashes(p),model:'synthetic',partProvenance:[],stage:p.stage,issuedAt:at,inputHash:digest(p),inputEvidence:{encoding:'gzip-base64' as const,digest:digest(p),bytes:Buffer.byteLength(body),data:gzipSync(body).toString('base64')}};
}
async function collected(alias:boolean,reverse:boolean,direction:"over"|"under"="over",emptyBooks=false){
 const game={id:99,datetime:start,date:'2030-11-17',home_team:{id:2,abbreviation:'NYK',full_name:'New York Knicks'},visitor_team:{id:1,abbreviation:'BOS',full_name:'Boston Celtics'}};
 const bdl={id:77,game_id:99,player_id:10,team_id:1,player:{id:10,first_name:'Round',last_name:'NinetySeven',team_id:1},vendor:'baselinebook',prop_type:'points',line_value:20.5,updated_at:at,market:{type:'over_under',over_odds:direction==='over'?-180:150,under_odds:direction==='over'?150:-180}};
 const outcome=(side:string,price:number)=>({name:side,description:'Round NinetySeven',point:20.5,price});
 const book=(key:string,outcomes:any[])=>({key,last_update:at,markets:[{key:'player_points',last_update:at,outcomes}]});
 const books=alias?[book('draftkings',[outcome('Over',direction==='over'?-148:128)]),book('draft-kings',[outcome('Under',direction==='over'?128:-148)])]:[book('draftkings',[outcome('Over',direction==='over'?-148:128),outcome('Under',direction==='over'?128:-148)])];if(reverse)books.reverse();
 if(emptyBooks)books.forEach((book,index)=>book.key=index?'???':'---');
 const event={id:'same-event',commence_time:start,home_team:'NYK',away_team:'BOS'};
 const source={game,bdl,event,books},before=digest(source),calls:string[]=[];
 const fetchImpl=async(input:any)=>{const u=String(input);calls.push(u);if(u.includes('/v1/games?'))return Response.json({data:u.includes('season_type=regular')?[game]:[]});if(u.includes('/v2/odds/player_props'))return Response.json({data:[bdl]});if(u.includes('/events?'))return Response.json([event]);if(u.includes('/events/'))return Response.json({...event,bookmakers:books});throw Error('Unexpected synthetic route '+u);};
 const collection=await collectNbaPlayerPropsLiveMarket({slateDate:'2030-11-17',ballDontLieApiKey:'no-key',theOddsApiKey:'no-key',includeOpenings:false,fetchImpl});assert.equal(digest(source),before);
 const state=nbaPlayedStateFixture(at,[10],[18,20,24],[2,4,6]),base=buildNbaPlayerPropsMemberSnapshot({mode:'private_forward_candidate',generatedAt:at,slateDate:'2030-11-17',games:[{gameId:'nba-bdl:99',scheduledStart:start,homeTeam:'NYK',awayTeam:'BOS'}],decisions:[],inputRows:collection.observations.length});
 const p=liveNbaPacket({game:{id:'nba-bdl:99',start,home:'NYK',away:'BOS'},window:{gameId:'nba-bdl:99',stage:'final',cutoff:at,lock},snapshot:base,market:{updatedAt:at,observations:collection.observations},current:state,prior:state,currentObservations:collection.observations} as any);
 const r=review(p,direction==='over'?128:100,direction==='over'?100:128),decisions=siteAiDecisions(p,r,at),member=applyNbaSiteAi(base,p,decisions,at),dk=decisions.find(c=>c.provider==='the_odds_api');assert(dk||emptyBooks);if(emptyBooks)assert(collection.findings.includes('the_odds_api_player_props_capture_failed'));
 return{p,r,base,decisions,member,calls,detail:{alias,reverse,providerCalls:calls.length,oddsCalls:collection.providerRequests.theOddsApi,execution:p.executionQuotes?.map(q=>({book:q.book,side:q.side,price:q.american})),decision:dk?{grade:dk.grade,ev:dk.expectedValue,probability:dk.probability,quotes:dk.evidence.executionEvidence?.pricingQuotes.map(q=>q.side)}:null,memberGrade:member.decisions[0]?.grade}};
}
async function main(){try{
 const plain=await collected(false,false);const mixed=await collected(true,false);const reversed=await collected(true,true);results.aliasCases=[plain.detail,mixed.detail,reversed.detail];
 assert(plain.detail.decision&&mixed.detail.decision&&reversed.detail.decision);
 assert.equal(plain.detail.decision.grade,'Lean');
 results.aliasPairingPreserved=mixed.detail.decision.grade==='Lean'&&reversed.detail.decision.grade==='Lean';
 const direct=(p:any,alias:boolean)=>priceAiLaw({law:plain.r.players[0].law!,market:'points',quotes:p.executionQuotes.filter((q:any)=>q.provider==='the_odds_api').map((q:any)=>({id:q.id,provider:q.provider,book:alias?q.book:'draftkings',line:q.line,side:q.side,american:q.american,availableAt:q.receivedAt,confirmedAt:q.receivedAt,current:true,actionRule:'qualifying_participation'})),now:at,maxAgeMs:900000,confidence:2,exception:null});
 results.directPrice={canonical:direct(mixed.p,false)?.grade,mixed:direct(mixed.p,true)?.grade};assert.deepEqual(results.directPrice,{canonical:'Lean',mixed:'Lean'});
 assert(results.aliasPairingPreserved);
 for(const reverse of [false,true]){const under=await collected(true,reverse,'under');assert(under.detail.decision);assert.equal(under.detail.decision.grade,'Lean');assert(under.member.decisions.some((row:any)=>row.aiReview?.executionEvidence?.selectedQuote?.provider==='the_odds_api'&&row.side==='under'&&row.grade==='Lean'));}
 assert(mixed.member.decisions.some((row:any)=>row.aiReview?.executionEvidence?.selectedQuote?.provider==='the_odds_api'&&row.side==='over'&&row.grade==='Lean'));
 const oldFields={release:ORIGINAL_PAIRED_PROPS_AI_LAW_RELEASE,weights:[...plain.r.players[0].law!.weights],integerWeights:[...plain.r.players[0].law!.integerWeights!],outcomes:structuredClone(plain.r.players[0].law!.outcomes)};const oldLaw={...oldFields,hash:digest(oldFields)};
 const oldQuotes=mixed.p.executionQuotes!.filter(q=>q.provider==='the_odds_api').map(q=>({id:q.id,provider:q.provider,book:q.book,line:q.line,side:q.side,american:q.american,availableAt:q.receivedAt,confirmedAt:q.receivedAt,current:true,actionRule:'qualifying_participation' as const}));
 const oldPriced=priceAiLaw({law:oldLaw,market:'points',quotes:oldQuotes,now:at,maxAgeMs:900000,confidence:2,exception:null});assert.equal(oldPriced?.grade,'Watchlist');assert.equal(oldPriced?.gradeRelease,ORIGINAL_PAIRED_PROPS_AI_GRADE_RELEASE);assert.equal(propsAiLawSelectionRelease(oldLaw.release),ORIGINAL_PAIRED_PROPS_AI_SELECTION_RELEASE);
 const oldCanonical=priceAiLaw({law:oldLaw,market:'points',quotes:oldQuotes.map(q=>({...q,book:'draftkings'})),now:at,maxAgeMs:900000,confidence:2,exception:null});assert.equal(oldCanonical?.grade,'Lean');results.originalR3PolicyExact=true;
 for(const direction of ['over','under'] as const)for(const reverse of [false,true]){const invalid=await collected(true,reverse,direction,true);assert(!invalid.decisions.some(q=>q.provider==='the_odds_api'));assert(invalid.member.decisions.every(q=>Boolean(quoteBook(q.sportsbook))));}
 for(const labels of [['---','???'],['',''],['  ','!!!']]){const invalid=oldQuotes.map((q,i)=>({...q,book:labels[i%2]}));assert.equal(priceAiLaw({law:plain.r.players[0].law!,market:'points',quotes:invalid,now:at,maxAgeMs:900000,confidence:2,exception:null}),null);}
 const opaqueOld=priceAiLaw({law:oldLaw,market:'points',quotes:oldQuotes.map(q=>({...q,book:'---'})),now:at,maxAgeMs:900000,confidence:2,exception:null});assert.equal(opaqueOld?.grade,'Lean');results.unattributedNewBooksRefused=true;
 const complete=structuredClone(mixed.p);complete.executionQuotes=complete.executionQuotes!.filter(q=>q.provider!=='the_odds_api').concat(plain.p.executionQuotes!.filter(q=>q.provider==='the_odds_api').flatMap(q=>[q,{...q,id:q.id+'alias',book:'draft-kings'}]));
 const completeDecisions=siteAiDecisions(complete,plain.r,at);assert.equal(completeDecisions.find(q=>q.provider==='the_odds_api')?.grade,'Lean');results.completeAliasPairsPreserved=true;

 // Independent exact event/mass oracle, including all supported derived sports.
 let state=978123;const random=(n:number)=>{state=(Math.imul(state,1664525)+1013904223)>>>0;return state%n;};let arithmetic=0;
 for(const sport of ['nba','nfl','mlb'] as const)for(let trial=0;trial<120;trial++){
  const markets=sport==='nba'?['points','rebounds','assists','threes','points_rebounds_assists']:sport==='nfl'?['receptions','rushing_yards','receiving_yards','rushing_receiving_yards']:['batter_hits','batter_total_bases','batter_hits_runs_rbis'];
  const scope={markets},weights=Array.from({length:16},()=>random(10001));if(!weights.some(Boolean))weights[0]=1;
  const outcomes=Object.fromEntries(primitives(sport,scope).map(k=>[k,Array.from({length:16},()=>k.endsWith('yards')?random(81)-20:random(11))]));
  if(sport==='nba')outcomes.points=outcomes.threes.map(n=>3*n+random(31));
  if(sport==='mlb'){outcomes.batter_runs_scored=outcomes.batter_home_runs.map(n=>n+random(5));outcomes.batter_rbis=outcomes.batter_home_runs.map(n=>n+random(5));}
  const law=validateLaw(sport,scope,{weights,outcomes}),original=digest(law);
  const value=(m:string,i:number):number=>m==='points_rebounds_assists'?outcomes.points[i]+outcomes.rebounds[i]+outcomes.assists[i]:m==='rushing_receiving_yards'?outcomes.rushing_yards[i]+outcomes.receiving_yards[i]:m==='batter_hits'?outcomes.batter_singles[i]+outcomes.batter_doubles[i]+outcomes.batter_triples[i]+outcomes.batter_home_runs[i]:m==='batter_total_bases'?outcomes.batter_singles[i]+2*outcomes.batter_doubles[i]+3*outcomes.batter_triples[i]+4*outcomes.batter_home_runs[i]:m==='batter_hits_runs_rbis'?value('batter_hits',i)+outcomes.batter_runs_scored[i]+outcomes.batter_rbis[i]:outcomes[m][i];
  for(const m of markets)for(const line of [-.5,0,1,3.5,7,20.5,31])for(const inclusive of [false,true]){
   const oracle={over:0,under:0,push:0,total:weights.reduce((a,b)=>a+b,0),weightedValue:0};
   for(let i=0;i<16;i++){const n=value(m,i),w=weights[i];oracle.weightedValue+=n*w;if(inclusive?n>=line:n>line)oracle.over+=w;else if(inclusive||n<line)oracle.under+=w;else oracle.push+=w;assert.equal(scenarioStat(law,m,i),n);}
   assert.deepEqual(lawEventMass(law,m,line,inclusive),oracle);const f=lawForecast(law,m,line,inclusive);assert.equal(f.mean,oracle.weightedValue/oracle.total);assert.equal(f.over,oracle.over/oracle.total);assert.equal(f.under,oracle.under/oracle.total);assert.equal(f.push,oracle.push/oracle.total);arithmetic++;
  }assert.equal(digest(law),original);
 }
 results.independentMassCases=arithmetic;
 // BigInt grade oracle: probability mass and inclusive paired hold thresholds.
 const B=BigInt,implied=(p:number)=>p>0?[B(100),B(100)+B(p)]:[B(-p),B(100)-B(p)];let grades=0;
 for(let i=0;i<6000;i++){
  const win=random(20001),loss=random(20001),push=random(5001),total=win+loss+push||1;
  if(total===1&&win+loss+push===0)continue;
  const price=(random(2)?1:-1)*(100+random(2000)),opposing=(random(2)?1:-1)*(100+random(2000)),confidence=random(3),exception=i%101===0?'explicit decline':null;
  const [an,ad]=implied(price),[bn,bd]=implied(opposing),hn=an*bd+bn*ad,hd=ad*bd,excess=hn>hd?hn-hd:B(0),required=an*bd-excess;
  const paired=win+loss>0&&hn*B(50)>=B(49)*hd&&hn*B(10)<=B(13)*hd&&B(win)*B(20)>=B(11)*B(total)&&B(win)*hd>=required*B(win+loss);
  const evn=price>0?B(win)*B(price)-B(loss)*B(100):B(win)*B(100)-B(loss)*B(-price),expected=exception?'No Play':confidence===2&&evn>B(0)?'Best Angle':confidence>=1&&evn>B(0)||confidence===2&&paired?'Lean':'Watchlist';
  const actual=gradeAiEventFromExactPairedMass({win,loss,push,total,american:price,opposingAmerican:opposing,confidence,exception});assert.equal(actual.grade,expected);grades++;
 }results.independentGradeCases=grades;
 // Same-context refresh must retain the law but reprice; genuine context changes hold.
 const p2=structuredClone(plain.p),later='2030-11-17T18:02:00.000Z';p2.cutoff=later;p2.quotes=p2.quotes.map(q=>({...q,receivedAt:later}));p2.executionQuotes=p2.executionQuotes!.map(q=>({...q,id:q.id+'new',observedAt:later,receivedAt:later,american:q.side==='over'?150:-170}));
 const saved=digest(plain.r),fresh=siteAiDecisions(p2,plain.r,later);assert(fresh.length>0);assert(fresh.every(d=>d.evidence.lawHash===plain.r.players[0].law!.hash&&d.american===150));assert.equal(digest(plain.r),saved);
 const changed=structuredClone(p2);changed.players[0].evidence[0].value={...changed.players[0].evidence[0].value as any,novelRole:'new actual role'};assert.equal(siteAiDecisions(changed,plain.r,later).length,0);
 const empty=structuredClone(p2);empty.executionQuotes=[];assert.equal(siteAiDecisions(empty,plain.r,later).length,0);results.contextRefreshAndEmptyAuthority=true;
 // Locked bytes win in adapters and writer lifecycle even against malformed new semantics.
 const originalRow=plain.member.decisions[0];const lockedRow={...originalRow,grade:'Watchlist' as const,modelRelease:'player_props_ai_2026_11_16_r46_event_support_and_actor_retention',decisionRelease:ORIGINAL_PAIRED_PROPS_AI_SELECTION_RELEASE,aiReview:{...originalRow.aiReview!,release:'player_props_ai_2026_11_16_r46_event_support_and_actor_retention',lawRelease:oldLaw.release,lawHash:oldLaw.hash,gradeRelease:ORIGINAL_PAIRED_PROPS_AI_GRADE_RELEASE,selectionRelease:ORIGINAL_PAIRED_PROPS_AI_SELECTION_RELEASE},lockedAt:lock};const locked=buildNbaPlayerPropsMemberSnapshot({...plain.member,decisions:[lockedRow],inputRows:1});const lockBytes=JSON.stringify(lockedRow);
 const badChoices=structuredClone(plain.decisions);for(const d of badChoices){delete d.exactEventMass;d.evidence.lawRelease='unknown-release';d.projection=9999;d.probability=0;}
 const retained=applyNbaSiteAi(locked,plain.p,badChoices,at);assert.equal(JSON.stringify(retained.decisions[0]),lockBytes);
 const next=advanceNbaPlayerPropsCandidateLifecycle({now:'2030-11-17T22:05:00Z',previous:locked,candidate:plain.base});assert.equal(JSON.stringify(next.snapshot.decisions[0]),lockBytes);results.legacyLockFirst=true;
 // Numeric reference is all affected actors or none and never truncates diagnostics.
 const fake={...plain.p,players:[...plain.p.players,{...plain.p.players[0],id:'second'}]},stats={points_excluding_made_threes:zero(),rebounds:zero(),assists:zero(),threes:zero()},draft={players:{[fake.players[0].id]:{law:{weights:Array(16).fill(1),outcomes:stats}},second:{law:{weights:Array(16).fill(1),outcomes:stats}}}};
 for(const padding of [0,600,1600,1983]){const feedback={status:'ready',text:'D'.repeat(padding),bytes:padding,affectedActorIds:fake.players.map(p=>p.id)},out=withOriginalDraftCorrectionContext(fake,draft,feedback);if(out!==feedback){assert(out.text.includes('UNACCEPTED'));const parsed=JSON.parse(out.text.split('approved forecast: ')[1].split('\n')[0]);assert.equal(parsed.length,2);assert(Buffer.byteLength(JSON.stringify(out.text).slice(1,-1))<=1984);}else assert.equal(out.text,feedback.text);}
 const oneMissing:{players:Record<string,unknown>}=structuredClone(draft);delete oneMissing.players.second;const compact={status:'ready',text:'Diagnostic.',bytes:11,affectedActorIds:fake.players.map(p=>p.id)};assert.equal(withOriginalDraftCorrectionContext(fake,oneMissing,compact),compact);results.allOrNoneReferences=true;
 results.noMutationOfSourceOrReview=true;results.actualAliasFinding=!results.aliasPairingPreserved;assert.equal(results.actualAliasFinding,false);console.log(JSON.stringify({canonicalBookPairing:true,overAndUnderRecovery:true,originalR3PolicyExact:true,legacyLockFirst:results.legacyLockFirst,massControls:results.independentMassCases,gradeControls:grades,noExternalCalls:true}));
}finally{globalThis.Date=RealDate;}}
void main().catch(error=>{console.error(error);process.exitCode=1;});
