/* eslint-disable @typescript-eslint/no-explicit-any -- Reused public normalized fixtures and deliberately malformed contract controls exercise real admission/member paths. */
/** Future contract purpose must not alter raw inventory or legacy law authority. */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { createHash } from "node:crypto";
import { resolve } from "node:path";
import vm from "node:vm";
import ts from "typescript";
import { normalizeBallDontLieNbaPlayerProps } from "../lib/services/nba/nbaPlayerPropsProviders";
import { mergeNbaPlayerPropsMarketHistory } from "../lib/services/nba/nbaPlayerPropsPrivateStore";
import { liveNbaPacket } from "../lib/playerPropsAi/liveSources";
import { nbaAuthorityFixture } from "./test-player-props-ai-nba-lock-authority";
import { nbaPlayedStateFixture } from "./lib/player-props-ai-nba-played-fixture";
import { verifiedReaderFixture } from "./lib/player-props-ai-reader-fixture";
import { evidenceAliases } from "../lib/playerPropsAi/input";
import { independentPriorEvents } from "../lib/playerPropsAi/priorEvents";
import { criticalContextHashes } from "../lib/playerPropsAi/criticalContext";
import { digest, validatePacket } from "../lib/playerPropsAi/evidence";
import { validateLaw, type AcceptedPlayerLaw, type PlayerLaw } from "../lib/playerPropsAi/law";
import { encodeCanonicalScenarioLaw, GENERATIVE_MEANING, generativeMeaningForRelease } from "../lib/playerPropsAi/generativeCoordinates";
import { parseJointReview, jointReviewRequest } from "../lib/playerPropsAi/request";
import { sourceForecastIssues, validateSourceForecast } from "../lib/playerPropsAi/forecastSanity";
import { isSupportedMemberExecutionContract, quoteContract } from "../lib/playerPropsAi/executionQuotes";
import { siteAiDecisions } from "../lib/playerPropsAi/publication";
import { applyNbaSiteAi } from "../lib/playerPropsAi/siteBindings";
import { PROPS_AI_RELEASE, PROPS_AI_LAW_RELEASE, PROPS_AI_MEMBER_CONTRACT_RELEASE, PRIOR_PROPS_AI_LAW_RELEASE, LEGACY_PROPS_AI_LAW_RELEASE,
  propsAiLawHasMemberExecutionContracts, propsReviewHasMemberExecutionContracts } from "../lib/playerPropsAi/releases";
import { PROPS_AI_WIRE_RELEASE } from "../lib/playerPropsAi/scenarioCoordinates";
import type { GamePacket, Player } from "../lib/playerPropsAi/evidenceContract";
import type { AcceptedGameReview } from "../lib/playerPropsAi/reviewer";

globalThis.fetch = async () => { throw new Error("Member contract admission controls forbid all real HTTP"); };
const at="2026-11-10T22:23:00Z",start="2026-11-10T23:30:00Z",lock="2026-11-10T22:30:00Z";
const v=(n:number)=>Array<number>(16).fill(n),pad=(a:number[])=>[...a,...v(a.at(-1)??0).slice(a.length)];
const clone=<T,>(x:T):T=>structuredClone(x),same=(a:unknown,b:unknown,m?:string)=>assert.equal(JSON.stringify(a),JSON.stringify(b),m);
type Direction="over"|"under";
function nbaFixture(options:{ordinary?:boolean;milestoneLine?:number;combo?:boolean;players?:number}={}){
 const f=nbaAuthorityFixture(),ids=Array.from({length:options.players??2},(_,i)=>i+1),raw=ids.flatMap(id=>[
  ...(options.ordinary===false?[]:[{id:id*10,game_id:7,player_id:id,player:{first_name:"Synthetic",last_name:String(id),team_id:1},prop_type:"points",vendor:"book",line_value:15.5,updated_at:at,market:{type:"over_under",over_odds:-110,under_odds:-110}}]),
  {id:id*10+1,game_id:7,player_id:id,player:{first_name:"Synthetic",last_name:String(id),team_id:1},prop_type:"assists",vendor:"book",line_value:options.milestoneLine??6,updated_at:at,market:{type:"milestone",odds:150}},
  ...(options.combo?[{id:id*10+2,game_id:7,player_id:id,player:{first_name:"Synthetic",last_name:String(id),team_id:1},prop_type:"points_rebounds",vendor:"book",line_value:40,updated_at:at,market:{type:"milestone",odds:150}}]:[]),
 ]);
 const rawBefore=JSON.stringify(raw),normalized=normalizeBallDontLieNbaPlayerProps({values:raw,fetchedAt:at,events:{"7":{canonicalGameId:"g",homeTeam:"NYK",awayTeam:"BOS",scheduledStart:start}},canonicalPlayers:Object.fromEntries(ids.map(id=>[String(id),`nba-bdl-player:${id}`]))});
 assert.equal(normalized.rejectedRows,0);assert.equal(JSON.stringify(raw),rawBefore);
 const observations=normalized.rows.map(q=>({...q,receivedAt:at})),market=mergeNbaPlayerPropsMarketHistory({previous:null,current:observations,slateDate:"2026-11-10",capturedAt:at}).history;
 const baseline=f.snapshot(ids.map(id=>({...f.row(),decisionKey:`native:${id}:points`,playerId:`nba-bdl-player:${id}`,playerName:`Synthetic ${id}`}))),state=nbaPlayedStateFixture("2026-11-10T22:20:00Z",ids,[14,18,20],options.combo?[4,8,6]:[4,6,8]);
 const packet=liveNbaPacket({game:{id:"g",start,home:"NYK",away:"BOS"},window:{gameId:"g",stage:"final",cutoff:at,lock},snapshot:baseline,market,prior:state,current:state,currentObservations:observations});
 validatePacket(packet);assert.equal(packet.players.length,ids.length);
 return{packet,baseline,empty:f.snapshot([]),raw,observations};
}
function nbaLaw(direction:Direction="over",assists=v(3)):PlayerLaw{
 return{weights:pad(direction==="over"?[2,6,2]:[8,1,1]).map((n,i)=>i<3?n:0),outcomes:{points:pad([14,18,20]),rebounds:pad([4,6,8]),assists,threes:v(1)}};
}
function rawReview(packet:GamePacket,laws:PlayerLaw|((p:Player)=>PlayerLaw)){
 const aliases=evidenceAliases(packet);
 return{wireRelease:PROPS_AI_WIRE_RELEASE,players:Object.fromEntries(packet.players.map(p=>[p.id,verifiedReaderFixture(packet,p.id,{
  priorRead:Object.fromEntries(independentPriorEvents(p).map(e=>[[...aliases].find(([,id])=>id===e.sourceId)![0],e.preferredOutcome])),
  evidenceIds:[[...aliases].find(([,id])=>id===p.evidence[0].id)![0]],gaps:[],confidence:p.markets.map(()=>2),exceptions:p.markets.map(()=>null),law:encodeCanonicalScenarioLaw(packet.sport,p,typeof laws==="function"?laws(p):laws),
 })]))};
}
function accepted(packet:GamePacket,raw:unknown):AcceptedGameReview{
 const parsed=parseJointReview(packet,raw),hash=digest(packet);
 return{...parsed,release:PROPS_AI_RELEASE,gameId:packet.gameId,sourceGameId:packet.gameId,start:packet.start,lock:packet.lock,cutoff:packet.cutoff,stage:packet.stage,issuedAt:at,inputHash:hash,inputEvidence:{digest:hash},criticalContextHashes:criticalContextHashes(packet),marketScopes:Object.fromEntries(packet.players.map(p=>[p.id,p.markets])),model:"synthetic-never-sent",partProvenance:[]} as unknown as AcceptedGameReview;
}
function eraLaw(law:AcceptedPlayerLaw,release:typeof LEGACY_PROPS_AI_LAW_RELEASE|typeof PRIOR_PROPS_AI_LAW_RELEASE):AcceptedPlayerLaw{
 const body=release===LEGACY_PROPS_AI_LAW_RELEASE?{release,weights:[...law.weights],outcomes:clone(law.outcomes)}:{release,weights:[...law.weights],integerWeights:[...law.integerWeights!],outcomes:clone(law.outcomes)};
 return{...body,hash:digest(body)} as AcceptedPlayerLaw;
}
/** Reuse only two existing PUBLIC fixture builders, not their policy/oracles.
 * They normalize real provider shapes and invoke live source construction. */
function otherSportFixture(sport:"nfl"|"mlb",direction:Direction){
 const file=resolve("scripts/test-player-props-ai-exact-paired-confidence.ts"),text=readFileSync(file,"utf8"),ast=ts.createSourceFile(file,text,ts.ScriptTarget.ES2022,true);
 const declarations:string[]=[];for(const n of ast.statements){if(ts.isImportDeclaration(n))declarations.push(n.getFullText(ast));if(ts.isFunctionDeclaration(n)&&n.name&&["sourceFixture","accepted"].includes(n.name.text))declarations.push(n.getFullText(ast));}
 assert(declarations.filter(d=>/function (sourceFixture|accepted)\(/.test(d)).length===2,"Reusable actual-source fixture shape changed");
 const vmModule={exports:{} as any},code=declarations.join("\n")+`\nconst at=${JSON.stringify(at)},start=${JSON.stringify(start)},lock=${JSON.stringify(lock)},v=(n)=>Array(16).fill(n),z=()=>v(0);module.exports={sourceFixture,accepted};`;
 vm.runInNewContext(ts.transpileModule(code,{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022,esModuleInterop:true}}).outputText,{module:vmModule,exports:vmModule.exports,require:createRequire(file),console,Buffer,Date,structuredClone,process},{filename:"public-normalized-contract-fixtures.cjs"});
 const fixture=vmModule.exports.sourceFixture(sport,direction),review=vmModule.exports.accepted(fixture.packet,direction);return{fixture,review};
}
const issueCodes=(p:GamePacket,l:AcceptedPlayerLaw)=>sourceForecastIssues(p,p.players[0],l).map(i=>i.code);
const eventTuple=(c:ReturnType<typeof siteAiDecisions>[number])=>({playerId:c.playerId,market:c.market,line:c.line,side:c.side,american:c.american,projection:c.projection,probability:c.probability,expectedValue:c.expectedValue,grade:c.grade,lawHash:c.evidence.lawHash});

function main(){
 const checks:string[]=[];let promotions=0,demotions=0;const check=(name:string,fn:()=>void)=>{fn();checks.push(name);};
 check("prospective execution policy registers current identity and preserves explicit R38/R3",()=>{assert(propsReviewHasMemberExecutionContracts(PROPS_AI_RELEASE));assert(propsAiLawHasMemberExecutionContracts(PROPS_AI_LAW_RELEASE));assert(propsReviewHasMemberExecutionContracts("player_props_ai_2026_11_14_r38_exact_confidence_and_evidence"));assert(propsAiLawHasMemberExecutionContracts("player_props_ai_law_2026_11_14_r3_exact_paired_confidence"));for(const old of [LEGACY_PROPS_AI_LAW_RELEASE,PRIOR_PROPS_AI_LAW_RELEASE,"future-unknown"])assert(!propsAiLawHasMemberExecutionContracts(old));for(const old of ["player_props_ai_2026_11_11_r35_terminal_wave_guard","player_props_ai_2026_11_11_r36_urgent_slot_cohorts","player_props_ai_2026_11_14_r37_complete_evidence_health","future-unknown"])assert(!propsReviewHasMemberExecutionContracts(old));});
 check("old generative meaning remains verbatim while both future request fields receive purpose",()=>{assert.equal(PROPS_AI_MEMBER_CONTRACT_RELEASE,"player_props_ai_member_contract_2026_11_14_r1_nba_ou_execution");assert.equal(createHash("sha256").update(GENERATIVE_MEANING).digest("hex"),"a324e0df067808bf4a0b5bbb0d6cb9210c232862cad761e1708d3e1d707f24e2");for(const old of ["player_props_ai_2026_11_11_r36_urgent_slot_cohorts","future-unknown"])assert.equal(generativeMeaningForRelease(old),GENERATIVE_MEANING);assert(generativeMeaningForRelease(PROPS_AI_RELEASE).startsWith(GENERATIVE_MEANING));const f=nbaFixture(),request=jointReviewRequest(f.packet,"gpt-6-luna",7000);for(const field of [request.instructions,request.input]){assert(field.includes("NBA Yes/milestone quotes remain market references"));assert(field.includes("ordinary Over/Under"));}});
 for(const direction of ["over","under"] as const){
  const f=nbaFixture(),before=JSON.stringify(f),law=nbaLaw(direction),raw=rawReview(f.packet,law),review=accepted(f.packet,raw),choices=siteAiDecisions(f.packet,review,at),member=applyNbaSiteAi(f.empty,f.packet,choices,at);
  check(`normalized two-actor ${direction} admits all scopes without invented decline`,()=>{assert.equal(review.players.length,2);same(review.players.map(p=>p.playerId),f.packet.players.map(p=>p.id));for(const p of review.players){same(p.law!.outcomes,law.outcomes);same(p.sourceDeclinedMarkets,[]);assert(p.exceptions.every(e=>e===null));}same(review.marketScopes,Object.fromEntries(f.packet.players.map(p=>[p.id,p.markets])));assert(f.packet.players.every(p=>p.markets.includes("assists")&&p.markets.includes("points")));assert(f.packet.quotes.some(q=>q.side==="yes"));});
  check(`${direction} ordinary member targets retain exact tuple and zero Yes rows`,()=>{assert.equal(member.decisions.length,2);assert(member.decisions.every(r=>r.market==="points"&&r.side===direction&&r.grade==="Best Angle"));assert(!member.decisions.some(r=>(r.side as string)==="yes"));const control=clone(f.packet);control.quotes=control.quotes.filter(q=>isSupportedMemberExecutionContract("nba",q));control.executionQuotes=control.executionQuotes!.filter(q=>isSupportedMemberExecutionContract("nba",q));const controlReview=accepted(control,rawReview(control,law)),controlChoices=siteAiDecisions(control,controlReview,at);same(choices.filter(c=>c.market==="points").map(eventTuple),controlChoices.map(eventTuple));const after=new Set(member.decisions.map(r=>r.decisionKey));const before=applyNbaSiteAi(f.empty,control,controlChoices,at).decisions.filter(r=>r.grade==="Best Angle"||r.grade==="Lean");demotions+=before.filter(r=>!after.has(r.decisionKey)).length;});
  check(`${direction} original R1/R2 tail decisions remain strict and hash-exact`,()=>{for(const release of [LEGACY_PROPS_AI_LAW_RELEASE,PRIOR_PROPS_AI_LAW_RELEASE] as const){const old=eraLaw(review.players[0].law!,release),oldBefore=JSON.stringify(old);assert(issueCodes(f.packet,old).includes("unsupported_priced_event_certainty"));assert.throws(()=>validateSourceForecast(f.packet,f.packet.players[0],old,f.packet.players[0].markets.map(()=>null)),/no opposing tail/);assert.equal(JSON.stringify(old),oldBefore);}promotions+=member.decisions.filter(r=>r.grade==="Best Angle"||r.grade==="Lean").length;});
  assert.equal(JSON.stringify(f),before,"Full raw source/quotes/actors/inventory remain byte-exact through admission and actual member publication");
 }
 check("unsupported Yes-only actor is reviewed but never materializes NBA Yes rows",()=>{const f=nbaFixture({ordinary:false,milestoneLine:3}),law={...nbaLaw("over",pad([2,4,3])),weights:[1,1,1,...v(0).slice(3)]},review=accepted(f.packet,rawReview(f.packet,law)),choices=siteAiDecisions(f.packet,review,at),member=applyNbaSiteAi(f.empty,f.packet,choices,at);assert(choices.some(c=>c.side==="yes"),"Control has a mathematically qualified Yes candidate before the existing member contract gate");assert.equal(member.decisions.length,0);assert.equal(review.players.length,2);for(const p of review.players){assert(Array.isArray(p.sourceDeclinedMarkets));same(p.sourceDeclinedMarkets,[]);}});
 check("supported ordinary zero-tail still refuses even after implicit Yes at same integer",()=>{const f=nbaFixture({ordinary:false,milestoneLine:3,players:1}),p=f.packet.players[0],yes=f.packet.quotes.find(q=>q.side==="yes")!;delete yes.offerContract;const over={...yes,id:"ordinary-after-implicit-yes",side:"over" as const,offerContract:"two_way" as const};f.packet.quotes=[yes,over];f.packet.executionQuotes=clone(f.packet.quotes);const law=nbaLaw();assert.throws(()=>accepted(f.packet,rawReview(f.packet,law)),/missing opposing priced tail|no opposing tail|S:qt/);const issues=sourceForecastIssues(f.packet,p,validateLaw("nba",p,law));assert(issues.some(i=>i.code==="unsupported_priced_event_certainty"&&i.events?.some(e=>e.contract==="two_way")));});
 check("supported ordinary O/U certainty still fails unchanged",()=>{const f=nbaFixture(),law={...nbaLaw(),outcomes:{...nbaLaw().outcomes,points:v(18)}};assert.throws(()=>accepted(f.packet,rawReview(f.packet,law)),/opposing.*tail|opposite.*mass/);});
 check("independent milestone prior remains strict despite NBA reference-only quote",()=>{const f=nbaFixture(),p=f.packet.players[0];p.evidence.push({id:"actual-independent-assist-prior",kind:"independent_model",source:"synthetic independent supplied prior",availableAt:at,value:{market:"assists",line:6,offerContract:"milestone",independentProjection:3,selectedSide:"yes",independentSelectedSideProbability:.3,independentUnder:.7}});assert.throws(()=>accepted(f.packet,rawReview(f.packet,nbaLaw())),/opposing prior tail|S:pt|independent source assigns both outcomes/);});
 check("reference-only quotes cannot waive mean or unavailable source support",()=>{const f=nbaFixture();assert.throws(()=>accepted(f.packet,rawReview(f.packet,nbaLaw("over",v(300)))),/outside supplied|outside_supplied|S:mean/);const missing=clone(f.packet);for(const p of missing.players)for(const e of p.evidence)if(e.kind==="recent_games"&&e.value&&typeof e.value==="object"&&!Array.isArray(e.value)&&e.value.box)(e.value.box as Record<string,unknown>).ast=0;assert.throws(()=>accepted(missing,rawReview(missing,nbaLaw())),/numeric_support_unavailable|source-grounded/);});
 check("reference-only combo quote cannot waive observed joint dependence",()=>{const f=nbaFixture({combo:true});assert.throws(()=>accepted(f.packet,rawReview(f.packet,nbaLaw())),/dependence|joint variation|S:dep/);});
 check("supported but unpriced ordinary contract is not mislabeled unsupported or reviewed price",()=>{const f=nbaFixture({ordinary:false}),packet=clone(f.packet);for(const q of packet.quotes){q.side="over";q.offerContract="two_way";q.receivedAtProvenance="snapshot_availability";}packet.executionQuotes=clone(packet.quotes);const before=digest(packet),review=accepted(packet,rawReview(packet,nbaLaw()));assert(packet.quotes.every(q=>isSupportedMemberExecutionContract("nba",q)));assert.equal(siteAiDecisions(packet,review,at).length,0);assert.equal(review.players.length,2);assert.equal(digest(packet),before);});
 check("invalid provider price remains normalization refusal rather than an invented member quote",()=>{const raw=[{id:999,game_id:7,player_id:1,prop_type:"points",vendor:"book",line_value:15.5,updated_at:at,market:{type:"over_under",over_odds:0,under_odds:-110}}],before=digest(raw),parsed=normalizeBallDontLieNbaPlayerProps({values:raw,fetchedAt:at});assert.equal(parsed.rejectedRows,1);assert.equal(parsed.rows.length,0);assert.equal(digest(raw),before);});
 for(const sport of ["nfl","mlb"] as const)for(const direction of ["over","under"] as const){
  const {fixture,review}=otherSportFixture(sport,direction),p=fixture.packet.players[0],market=sport==="nfl"?"receptions":"batter_hits",base=fixture.packet.executionQuotes[0],before=JSON.stringify(fixture.packet);
  check(`${sport} ${direction} supported ordinary normalized wire remains valid`,()=>{assert.equal(review.players.length,1);assert(siteAiDecisions(fixture.packet,review,at).some(c=>c.side===direction));assert.equal(JSON.stringify(fixture.packet),before);});
  check(`${sport} ${direction} supported milestone zero-tail remains strict through full wire`,()=>{const packet=clone(fixture.packet),q={...base,id:`${sport}-supported-milestone`,market,side:"yes" as const,line:40,offerContract:"milestone" as const};packet.quotes.push(q);packet.executionQuotes.push(clone(q));assert(isSupportedMemberExecutionContract(sport,q));const law=review.players[0].law!;assert(sourceForecastIssues(packet,p,law).some(i=>i.code==="unsupported_priced_event_certainty"&&i.events?.some(e=>e.contract==="milestone")));assert.throws(()=>accepted(packet,rawReview(packet,{weights:[...law.integerWeights!],outcomes:clone(law.outcomes)})),/S:qt|opposing priced tail/);});
  check(`${sport} ${direction} canonical dedup separates implicit Yes from ordinary same integer`,()=>{const packet=clone(fixture.packet),raw:PlayerLaw={weights:[...review.players[0].law!.integerWeights!],outcomes:clone(review.players[0].law!.outcomes)},k=sport==="nfl"?4:1;if(sport==="nfl")raw.outcomes.receptions=v(k);else{raw.outcomes.batter_singles=v(k);raw.outcomes.batter_doubles=v(0);raw.outcomes.batter_triples=v(0);raw.outcomes.batter_home_runs=v(0);}const yes={...base,id:`${sport}-implicit`,market,side:"yes" as const,line:k};delete yes.offerContract;packet.quotes=[yes,{...yes,id:`${sport}-ordinary`,side:"over",offerContract:"two_way"}];const law=validateLaw(sport,p,raw),events=sourceForecastIssues(packet,p,law).filter(i=>i.code==="unsupported_priced_event_certainty").flatMap(i=>i.events??[]);same(events.map(e=>e.contract),["milestone","two_way"]);for(const release of [LEGACY_PROPS_AI_LAW_RELEASE,PRIOR_PROPS_AI_LAW_RELEASE] as const){const old=eraLaw(law,release),oldEvents=sourceForecastIssues(packet,p,old).filter(i=>i.code==="unsupported_priced_event_certainty").flatMap(i=>i.events??[]);same(oldEvents.map(e=>e.contract),["milestone"]);}assert.equal(quoteContract(yes),"milestone");});
 }
 assert.deepEqual({promotions,demotions},{promotions:4,demotions:0});
 console.log(JSON.stringify({memberContractAdmission:true,cases:checks.length,syntheticOrdinaryPromotions:promotions,syntheticOrdinaryDemotions:demotions,rawInventoryPreserved:true,allSportCanonicalContractDedup:true,legacyAdmissionRetained:true,realHTTP:0,paidCalls:0,checks}));
}
main();
