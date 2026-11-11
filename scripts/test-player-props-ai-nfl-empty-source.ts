/* eslint-disable @typescript-eslint/no-explicit-any -- Synthetic captured provider shapes exercise the real native builder/parser/writer boundaries without I/O. */
import assert from 'node:assert/strict';
import {buildTeamDepthSnapshot} from '../lib/services/football/balldontlieNflRoster';
import {buildNflPlayerPropsRuntimeFeatureRows,buildNflPlayerPropsRuntimeBoard} from '../lib/services/football/nflPlayerPropsRuntime';
import {buildNflPlayerPropsExactBoard} from '../lib/services/football/nflPlayerPropsMarketBoard';
import {reconcileNflPlayerPropsProductionSnapshot} from '../lib/services/football/nflPlayerPropsProductionContract';
import {liveNflPacket} from '../lib/playerPropsAi/liveSources';
import {siteAiDecisions} from '../lib/playerPropsAi/publication';
import {applyNflSiteAi} from '../lib/playerPropsAi/siteBindings';
import {testNflHandoffCapture,testNflSourceAuthority,mergeNflHandoffs} from '../lib/playerPropsAi/nflLockAuthority';
import {digest} from '../lib/playerPropsAi/evidence';
import {criticalContextHashes} from '../lib/playerPropsAi/criticalContext';
import {parseJointReview} from '../lib/playerPropsAi/request';
import {independentPriorEvents} from '../lib/playerPropsAi/priorEvents';
import {evidenceAliases} from '../lib/playerPropsAi/input';
import {PROPS_AI_WIRE_RELEASE} from '../lib/playerPropsAi/scenarioCoordinates';
import {verifiedReaderFixture} from './lib/player-props-ai-reader-fixture';
import type {AcceptedGameReview} from '../lib/playerPropsAi/reviewer';
import type {GamePacket} from '../lib/playerPropsAi/evidenceContract';

globalThis.fetch=async()=>{throw Error('NFL successful-empty controls forbid real HTTP');};
Object.assign(process.env,{NODE_ENV:'test'});
const at='2026-11-11T00:12:00Z',past='2026-11-11T00:11:00Z',later='2026-11-11T00:11:30Z',start='2026-11-11T01:20:00Z',lock='2026-11-11T00:20:00Z';
const game={id:'synthetic',start,away:'KC',home:'BUF'},history={release:'synthetic canonical past stat logs',updatedAt:at,games:[0,1].map(i=>({gameId:`played-${i}`,scheduledStart:`2026-11-0${1+i}T18:00:00Z`,homeTeam:'KC',awayTeam:'NYJ'})),stats:[0,1].map(i=>({gameId:`played-${i}`,scheduledStart:`2026-11-0${1+i}T18:00:00Z`,playerId:'666',playerName:'Marquise Brown',team:'KC',receptions:i?8:4,receiving_yards:i?80:40})),teamStats:[],playMetrics:[]};
function fixture({native=false,two=false,status=null,clear=false,sourceNative=false}:{native?:boolean;two?:boolean;status?:string|null;clear?:boolean;sourceNative?:boolean}={}){
 const awayDepth=buildTeamDepthSnapshot({team:'KC',capturedAt:past,sourceSnapshotId:'synthetic',rows:[{player:{id:666,first_name:'Marquise',last_name:'Brown',position:'WR'},injury_status:status}]});
 const context:any={providerSnapshotGeneratedAt:at,capturedAt:at,games:[{canonicalGameId:game.id,scheduledStart:start,awayTeam:'KC',homeTeam:'BUF',awayDepth,homeDepth:{provider:'balldontlie',team:'BUF',capturedAt:past,roster:[]},injuries:{eventId:game.id,awayTeam:'KC',homeTeam:'BUF',source:'BALLDONTLIE',sourceLabel:'synthetic',sourceUrl:null,reportUpdatedAt:clear?later:past,playerClearances:clear?[{teamAbbreviation:'KC',name:'Marquise Brown',reportedAt:later}]:[],teams:[{abbreviation:'KC',teamName:'KC',players:[]},{abbreviation:'BUF',teamName:'BUF',players:[]}]},mainMarket:{currentBooks:[]},weather:null}]};
 const observations:any[]=(two?['receptions','receiving_yards']:['receptions']).flatMap(market=>['over','under'].map(side=>({provider:'balldontlie',providerObservationId:market+side,providerEventId:game.id,canonicalGameId:game.id,providerPlayerId:'666',playerName:'Marquise Brown',playerTeam:'KC',sportsbook:'synthetic-book',market,providerMarket:market,offerType:'over_under',side,line:market==='receptions'?6.5:49.5,americanPrice:-110,observedAt:at,fetchedAt:at,receivedAt:at,isOpening:false,isLive:false,homeTeam:'BUF',awayTeam:'KC',scheduledStart:start})));
 const snapshot:any={generatedAt:at,observations,games:[{providerGameId:game.id,scheduledStart:start,awayTeam:'KC',homeTeam:'BUF'}]};
 const features=buildNflPlayerPropsRuntimeFeatureRows({snapshot,context}),offers=buildNflPlayerPropsExactBoard({snapshots:[snapshot],evaluatedAt:at});
 const board=buildNflPlayerPropsRuntimeBoard({offers,features:native?features:[],evaluatedAt:at});
 const sourceBoard=sourceNative?buildNflPlayerPropsRuntimeBoard({offers,features,evaluatedAt:at}):board;
 const baseline=reconcileNflPlayerPropsProductionSnapshot({season:2026,week:10,evaluatedAt:at,nextBoard:sourceBoard,previous:null});
 const packet=liveNflPacket({game,window:{gameId:game.id,stage:'final',cutoff:at,lock},snapshot:baseline,observations:snapshot,history,context} as never);
 return{packet,board,offers,baseline,snapshot,context};
}
function accepted(packet:GamePacket,decline=false):AcceptedGameReview{
 const player=packet.players[0],aliases=evidenceAliases(packet),v=(n:number)=>Array<number>(16).fill(n);
 const raw=verifiedReaderFixture(packet,player.id,{priorRead:Object.fromEntries(independentPriorEvents(player).map(e=>[[...aliases].find(([,id])=>id===e.sourceId)![0],e.preferredOutcome])),evidenceIds:[[...aliases][0][0]],law:decline?null:{weights:v(1),outcomes:{receptions:[4,...v(8).slice(1)],...(player.markets.includes('receiving_yards')?{receiving_yards:[40,...v(80).slice(1)]}:{})}},confidence:player.markets.map(()=>decline?0:2),gaps:decline?['forecast_declined']:[],exceptions:player.markets.map(()=>decline?'forecast_declined':null)});
 const parsed=parseJointReview(packet,{wireRelease:PROPS_AI_WIRE_RELEASE,players:{[player.id]:raw}}),hash=digest(packet);
 return{...parsed,gameId:packet.gameId,sourceGameId:packet.sourceGameId??packet.gameId,start,lock,cutoff:at,stage:'final',issuedAt:at,inputHash:hash,inputEvidence:{digest:hash} as AcceptedGameReview['inputEvidence'],criticalContextHashes:criticalContextHashes(packet),marketScopes:{[player.id]:player.markets},model:'synthetic-never-dispatched',partProvenance:[]};
}


async function main(){
 const {collectNflPlayerPropsObservations,__NFL_PLAYER_PROPS_COLLECTOR_TEST__}=await import('../lib/services/football/nflPlayerPropsCollector');
 const {buildNflPlayerPropsInferenceContextFromForwardEvidence}=await import('../lib/services/football/nflPlayerPropsInferenceContext');
 const {NFL_FORWARD_EVIDENCE_SCHEMA_RELEASE}=await import('../lib/services/football/nflForwardEvidence');
 const {NFL_PLAYER_PROPS_EMPTY_CURRENT_RELEASE,NFL_PLAYER_PROPS_CURRENT_FIXTURE_RELEASE}=await import('../lib/services/football/nflPlayerPropsContract');
 const {reviewPropsForSite}=await import('../lib/playerPropsAi/siteRuntime');
 const {PROPS_AI_CONTROL_RELEASE}=await import('../lib/playerPropsAi/siteConfig');
 const {PROPS_AI_CALENDAR_RELEASE}=await import('../lib/playerPropsAi/calendar');
 const {validatePacket}=await import('../lib/playerPropsAi/evidence');
 Object.assign(process.env,{PLAYER_PROPS_AI_SITE_ENABLED:'true',PLAYER_PROPS_AI_PAID_RUNS_ENABLED:'true',PLAYER_PROPS_AI_OPENAI_API_KEY:'synthetic-never-real',OWLS_INSIGHT_BASE_URL:'https://synthetic.owls.test'});
 const emptyAt='2026-11-11T00:14:00Z',after='2026-11-11T00:20:00.001Z',f=fixture({native:true}),review=accepted(f.packet);
 const applied=applyNflSiteAi(f.board,f.packet,siteAiDecisions(f.packet,review,at),at,f.board.decisions);
 const previous=reconcileNflPlayerPropsProductionSnapshot({season:2026,week:10,evaluatedAt:at,nextBoard:applied,previous:null});
 assert(previous.memberDecisions.some(r=>r.grade==='Best Angle'&&r.aiReview));
 const raw=(patch:Record<string,unknown>={})=>({id:1,game_id:game.id,player_id:666,vendor:'synthetic-book',prop_type:'receptions',line_value:6.5,updated_at:emptyAt,market:{type:'over_under',over_odds:-110,under_odds:-110},...patch});
 type Mode='empty'|'healthy'|'404'|'422'|'failed'|'partial'|'unknown_cursor'|'malformed_meta'|'unknown_market'|'unsupported'|'future_quote'|'unknown_identity'|'owls_failed'|'owls_partial'|'owls_unknown'|'opening_only'|'delayed'|'owls_empty';
 const requests:string[]=[];
 async function collect(mode:Mode='empty'){
  let clockAt=emptyAt;const OriginalDate=Date;class SyntheticDate extends Date{constructor(value?:string|number){super(value??clockAt);}static now(){return OriginalDate.parse(clockAt);}}
  globalThis.Date=SyntheticDate as DateConstructor;
  try{return await collectNflPlayerPropsObservations({season:2026,week:10,phase:'regular',ballDontLieApiKey:'synthetic',owlsInsightApiKey:mode.startsWith('owls_')?'synthetic':'',includeOpenings:mode==='opening_only',includeReferenceResearch:false,fetchImpl:async url=>{
   const u=new URL(String(url)),path=u.pathname;requests.push(u.hostname+path);
   if(u.hostname==='synthetic.owls.test')return mode==='owls_empty'?Response.json({data:[]}):mode==='owls_failed'?Response.json({error:'synthetic'},{status:503}):mode==='owls_partial'?Response.json({data:[],meta:{next_cursor:'next'}}):Response.json({data:[{gameId:'owls-game',homeTeam:'BUF',awayTeam:'KC',commenceTime:start,books:[{key:'synthetic',props:[{category:'unrecognized'}]}]}]});
   if(path==='/nfl/v1/games'){if(mode==='delayed')clockAt='2026-11-11T00:14:01Z';return Response.json({data:[{id:game.id,season:2026,week:10,date:start,home_team:{abbreviation:'BUF',full_name:'Buffalo'},visitor_team:{abbreviation:'KC',full_name:'Kansas City'}}]});}
   if(path==='/nfl/v1/players')return Response.json({data:mode==='unknown_identity'?[]:[{id:666,first_name:'Marquise',last_name:'Brown',team:{abbreviation:'KC'}}]});
   if(path==='/nfl/v1/odds/player_props/opening')return Response.json({data:[{...raw(),opened_at:past}]});
   assert.equal(path,'/nfl/v1/odds/player_props');if(mode==='delayed')clockAt='2026-11-11T00:14:02Z';
   if(mode==='404'||mode==='422'||mode==='failed')return Response.json({error:'synthetic'},{status:mode==='failed'?503:Number(mode)});
   const values=mode==='healthy'?[raw()]:mode==='unknown_market'?[raw({prop_type:'undocumented'})]:mode==='unsupported'?[raw({prop_type:'first_td'})]:mode==='future_quote'?[raw({updated_at:'2026-11-11T00:15:00Z'})]:mode==='unknown_identity'?[raw({player_id:999})]:[];
   return Response.json({data:values,...(mode==='partial'?{meta:{next_cursor:'next'}}:mode==='unknown_cursor'?{meta:{next_cursor:{unknown:true}}}:mode==='malformed_meta'?{meta:'unknown'}:{})});
  }});}finally{globalThis.Date=OriginalDate;}
 }
 const collected=await collect();assert.equal(collected.emptyCurrentGames.length,1);assert.equal(collected.snapshot.collectionComplete,true);assert.equal(collected.snapshot.observations.length,0);
 const proof=collected.emptyCurrentGames[0];assert.equal(proof.release,NFL_PLAYER_PROPS_EMPTY_CURRENT_RELEASE);assert.equal(proof.availableAt,new Date(emptyAt).toISOString());
 const context=buildNflPlayerPropsInferenceContextFromForwardEvidence({snapshot:collected.snapshot,capturedAt:emptyAt,evidence:[{id:'synthetic-forward',providerGameId:game.id,capturedAt:past,payloadSha256:'synthetic',payload:{schemaRelease:NFL_FORWARD_EVIDENCE_SCHEMA_RELEASE,season:2026,week:10,capturedAt:past,game:{scheduledStart:start,away:{abbreviation:'KC'},home:{abbreviation:'BUF'}},market:{currentBooks:[{sportsbook:'synthetic-book',total:{line:43},spread:{homeLine:-2.5}}]},coverage:{rosterAndDepth:true},startersAndDepth:{away:f.context.games[0].awayDepth,home:f.context.games[0].homeDepth},injuries:f.context.games[0].injuries,weather:null}}] as never});assert.equal(context.games.length,1);
 const emptyOffers=buildNflPlayerPropsExactBoard({snapshots:[collected.snapshot],evaluatedAt:emptyAt}),emptyNative=buildNflPlayerPropsRuntimeBoard({offers:emptyOffers,features:[],evaluatedAt:emptyAt});assert.equal(emptyNative.decisions.length,0);
 const aiBaseline=reconcileNflPlayerPropsProductionSnapshot({season:2026,week:10,evaluatedAt:emptyAt,nextBoard:emptyNative,previous});
 const input={game,window:{gameId:game.id,stage:'final' as const,cutoff:emptyAt,lock},snapshot:aiBaseline,observations:collected.snapshot,history,context,emptyCurrentGame:proof,withdrawalSnapshot:previous};
 const original=digest(input),packet=liveNflPacket(input as never);assert.equal(packet.sourceOfferSetStatus,'empty');assert.equal(packet.sourceInputRelease,NFL_PLAYER_PROPS_EMPTY_CURRENT_RELEASE);assert.deepEqual(packet.executionQuotes,[]);assert.deepEqual(packet.quotes,[]);assert.deepEqual(packet.sourceOfferSetEvidence,proof);validatePacket(packet);assert.equal(digest(input),original);
 assert(packet.players.length>0&&packet.players.every(p=>!p.id.startsWith('nfl-bdl-player:')),'Withdrawal context retains actual cached aliases without guessing current IDs');
 assert.equal(siteAiDecisions(packet,review,emptyAt).length,0);
 let counts=0,claims=0,generations=0,loads=0,ready=0,observed=0;const frames:ReturnType<typeof mergeNflHandoffs>[]=[];
 const calendar={release:PROPS_AI_CALENDAR_RELEASE,month:'2026-11',capturedAt:emptyAt,games:[{sport:'nfl',id:'espn:nfl:1',start,lock,away:'KC',home:'BUF',confirmed:true}],sources:{nba:{complete:true,source:'synthetic'},nfl:{complete:true,source:'synthetic'},mlb:{complete:true,source:'synthetic'}}};
 const job={job_key:'synthetic-final',sport:'nfl',game_id:'espn:nfl:1',game_day:'2026-11-10',stage:'final',scheduled_start:start,lock_at:lock,due_at:'2026-11-10T23:55:00Z',state:'pending'};
 const client={from(table:string){let selection='';const q:any={};for(const method of ['eq','gte','in','lte','gt','order','limit'])q[method]=()=>q;q.select=(s:string)=>{selection=s;return q;};const resolve=async()=>({data:table==='player_props_ai_control'?{release:PROPS_AI_CONTROL_RELEASE,paid_enabled:true}:table==='player_props_ai_calendars'?{release:calendar.release,captured_at:emptyAt,payload:calendar}:selection==='*'?[job]:[{result:review}],error:null});q.single=resolve;q.maybeSingle=resolve;q.then=(yes:any,no:any)=>resolve().then(yes,no);return q;},async rpc(name:string){if(name==='player_props_ai_plan_v4')return{data:{funded:true},error:null};if(name==='player_props_ai_reap')return{data:0,error:null};if(name==='player_props_ai_claim')claims++;throw Error('No paid claim or other RPC allowed: '+name);}};
 const runtime=await reviewPropsForSite({client:client as never,sport:'nfl',games:[game],writerRunId:'synthetic-owner',clock:()=>emptyAt,deadline:Date.now()+300000,load:(_game,window)=>{loads++;return liveNflPacket({...input,window} as never);},onSourceReady:(p,r,_at,lookup)=>{ready++;frames.push(testNflSourceAuthority(()=>emptyAt)(p,r,lookup),testNflHandoffCapture(()=>emptyAt)(emptyNative.decisions,p,r,'native'));},onReviewObserved:(p,r,lookup)=>{observed++;frames.push(testNflSourceAuthority(()=>emptyAt)(p,r,lookup));},fetchImpl:async url=>{if(String(url).endsWith('/input_tokens'))counts++;else generations++;throw Error('Empty current source must not count or generate');}});
 assert.equal(runtime.status,'active');assert.equal(ready,1);assert.equal(observed,1);assert.equal(loads,3);assert.equal(counts+claims+generations,0);assert(runtime.findings.includes('review_deferred_empty_current_offers:synthetic'));assert.equal(runtime.coverage?.[0].eligiblePlayers,0);assert.equal(runtime.coverage?.[0].players,0);assert.equal(runtime.coverage?.[0].unreviewedScopes,0);assert.equal(runtime.coverage?.[0].withdrawalContextPlayers,packet.players.length);
 const handoff=mergeNflHandoffs(frames);assert(handoff.executionAuthorities?.length);assert(handoff.executionAuthorities!.every(a=>a.quotes.length===0));
 const reconcile=(prior=previous,at=lock,authority=handoff)=>reconcileNflPlayerPropsProductionSnapshot({season:2026,week:10,evaluatedAt:at,nextBoard:emptyNative,previous:prior,lockHandoff:authority});
 assert.equal(reconcile().memberDecisions.length,0,'Successful empty producer suppresses both prior AI sides at first lock');
 assert.equal(reconcile(f.baseline).memberDecisions.length,0,'The same empty current execution suppresses prior native rows');
 const quoteOnly=fixture(),quoteReview=accepted(quoteOnly.packet),quoteAi=applyNflSiteAi(quoteOnly.board,quoteOnly.packet,siteAiDecisions(quoteOnly.packet,quoteReview,at),at,quoteOnly.board.decisions);
 assert.equal(quoteOnly.board.decisions.length,0);const quotePrevious=reconcileNflPlayerPropsProductionSnapshot({season:2026,week:10,evaluatedAt:at,nextBoard:quoteAi});assert(quotePrevious.memberDecisions.length>0&&quotePrevious.memberDecisions.every(r=>r.aiReview?.nativeQualification));
 const quoteWithdrawal=liveNflPacket({...input,withdrawalSnapshot:quotePrevious} as never),quoteFrames=mergeNflHandoffs([testNflSourceAuthority(()=>emptyAt)(quoteWithdrawal,quoteReview,true)]);
 assert.equal(reconcileNflPlayerPropsProductionSnapshot({season:2026,week:10,evaluatedAt:lock,nextBoard:emptyNative,previous:quotePrevious,lockHandoff:quoteFrames}).memberDecisions.length,0,'AI-only scopes with no native heads are suppressed by actual game-wide execution withdrawal, independently of stored aliases');
 const locked=reconcileNflPlayerPropsProductionSnapshot({season:2026,week:10,evaluatedAt:lock,nextBoard:applied,previous});const preserved=reconcile(locked);assert.deepEqual(preserved.memberDecisions,locked.memberDecisions);assert.deepEqual(preserved.board.decisions,locked.board.decisions);
 const late=mergeNflHandoffs([testNflSourceAuthority(()=>after)(packet,review,true)]);assert(reconcile(previous,after,late).memberDecisions.some(r=>r.aiReview),'A postlock observation cannot suppress or backdate withdrawal');
 assert.throws(()=>liveNflPacket({...input,emptyCurrentGame:undefined} as never),/no offered supported players/);
 for(const change of [()=>({...input,observations:{...collected.snapshot,collectionComplete:false}}),()=>({...input,observations:{...collected.snapshot,generatedAt:'2026-11-11T00:15:00Z'}}),()=>({...input,emptyCurrentGame:{...proof,gameId:'other'}}),()=>({...input,emptyCurrentGame:{...proof,scheduledStart:'2026-11-11T02:20:00Z'}}),()=>({...input,emptyCurrentGame:{...proof,awayTeam:'TB'}}),()=>({...input,emptyCurrentGame:{...proof,providerReceipts:{balldontlie:'2026-11-11T00:13:00Z'}}}),()=>({...input,withdrawalSnapshot:{...previous,generatedAt:'2026-11-11T00:15:00Z'}})])assert.throws(()=>liveNflPacket(change() as never));
 assert.throws(()=>liveNflPacket({...input,withdrawalSnapshot:{...previous,board:{...previous.board,decisions:[]},memberDecisions:[]}} as never),/no exact available withdrawal identity/);
 assert.throws(()=>validatePacket({...packet,players:[]}),/No players/,'Ordinary empty-player law admission remains forbidden');
 await assert.rejects(collect('failed'),/HTTP 503/);
 for(const mode of ['partial','unknown_cursor','malformed_meta'] as const)await assert.rejects(collect(mode),/complete|continu|metadata|pagination/i,mode);
 for(const mode of ['404','422','unknown_market','unsupported','future_quote','unknown_identity','owls_failed','owls_partial','owls_unknown'] as const){const bad=await collect(mode);assert.equal(bad.emptyCurrentGames.length,0,mode);assert.throws(()=>liveNflPacket({...input,observations:bad.snapshot,emptyCurrentGame:bad.emptyCurrentGames[0]} as never),(error:unknown)=>error instanceof Error,mode);}
 const opening=await collect('opening_only');assert.equal(opening.emptyCurrentGames.length,1,'Genuine current 2xx empty remains distinct from the separately captured opening');assert(opening.snapshot.observations.some(q=>q.isOpening));assert.deepEqual(liveNflPacket({...input,observations:opening.snapshot,emptyCurrentGame:opening.emptyCurrentGames[0]} as never).executionQuotes,[],'Opening-only history cannot become current execution');
 const delayed=await collect('delayed');assert.equal(delayed.snapshot.fetchedAt,new Date(emptyAt).toISOString());assert.equal(delayed.emptyCurrentGames[0].availableAt,'2026-11-11T00:14:02.000Z');assert.equal(delayed.snapshot.generatedAt,delayed.emptyCurrentGames[0].availableAt);assert.equal(liveNflPacket({...input,window:{...input.window,cutoff:'2026-11-11T00:14:03Z'},observations:delayed.snapshot,emptyCurrentGame:delayed.emptyCurrentGames[0]} as never).sourceOfferSetStatus,'empty','Empty authority uses actual response completion, never job start');
 const auxiliaryEmpty=await collect('owls_empty');assert.equal(auxiliaryEmpty.emptyCurrentGames.length,1);assert(auxiliaryEmpty.emptyCurrentGames[0].providerReceipts.owls);assert.equal(liveNflPacket({...input,observations:auxiliaryEmpty.snapshot,emptyCurrentGame:auxiliaryEmpty.emptyCurrentGames[0]} as never).sourceOfferSetStatus,'empty');
 const healthy=await collect('healthy');assert.equal(healthy.emptyCurrentGames.length,0);const returned=liveNflPacket({...input,snapshot:f.baseline,observations:healthy.snapshot,emptyCurrentGame:undefined} as never);assert.equal(returned.players[0].id,'nfl-bdl-player:666');assert.equal(returned.executionQuotes?.length,2);assert.notEqual(returned.sourceOfferSetStatus,'empty');assert(returned.sourceLimitations.some(s=>s.includes('collection-time fixture context')));
 const row=healthy.snapshot.observations[0],bound=row.collectedFixture!;assert.equal(bound.release,NFL_PLAYER_PROPS_CURRENT_FIXTURE_RELEASE);assert.equal(bound.providerGameId,row.providerEventId);assert.equal(bound.availableAt,new Date(emptyAt).toISOString());
 const fixtureFree={...row,scheduledStart:null,homeTeam:null,awayTeam:null};delete fixtureFree.collectedFixture;const bind=__NFL_PLAYER_PROPS_COLLECTOR_TEST__.bindCurrentRowsToSchedule,originalRow=digest(fixtureFree),boundAgain=bind([fixtureFree],healthy.snapshot.games,emptyAt)[0];
 for(const key of ['observedAt','receivedAt','fetchedAt','providerObservationId','providerPlayerId','line','side','americanPrice'] as const)assert.equal(boundAgain[key],row[key]);assert.equal(digest(fixtureFree),originalRow);
 for(const games of [[],[healthy.snapshot.games[0],healthy.snapshot.games[0]]])assert.throws(()=>bind([fixtureFree],games,emptyAt),/missing or ambiguous/);
 for(const bad of [{...fixtureFree,canonicalGameId:'other'},{...fixtureFree,scheduledStart:'2026-11-11T02:20:00Z'},{...fixtureFree,homeTeam:'TB'},{...fixtureFree,awayTeam:'CHI'}])assert.throws(()=>bind([bad],healthy.snapshot.games,emptyAt),/identity conflict/);assert.throws(()=>bind([{...fixtureFree,isOpening:true}],healthy.snapshot.games,emptyAt),/requires current BDL/);
 const choices=siteAiDecisions(returned,review,emptyAt);assert(choices.length>0,'Genuine returned current quotes can reuse the exact accepted law');const recovered=applyNflSiteAi(f.board,returned,choices,emptyAt,f.board.decisions);assert(recovered.decisions.some(r=>r.aiReview?.lawHash===review.players[0].law?.hash&&r.grade==='Best Angle'));
 const restoredFrames=mergeNflHandoffs([...frames,testNflSourceAuthority(()=>emptyAt)(returned,review,true),testNflHandoffCapture(()=>emptyAt)(recovered.decisions,returned,review,'ai',f.board.decisions)]);
 const recoveredLock=reconcileNflPlayerPropsProductionSnapshot({season:2026,week:10,evaluatedAt:lock,nextBoard:recovered,previous,lockHandoff:restoredFrames});assert(recoveredLock.memberDecisions.some(r=>r.aiReview?.lawHash===review.players[0].law?.hash&&r.grade==='Best Angle'));
 assert.equal(digest(input),original);console.log('NFL successful-empty source passed: actual collector/forward context/native/source/site callbacks/firstlock suppression of prior AI and native rows, cached aliases only, zero paid counts/claims/generation, real receipt/fixture/clock proof, HTTP404/422/error/partial/unknown/rejected/unsupported/future/identity/auxiliary-provider refusal, opening isolation, same-law current return promotion, postlock refusal and exact stored locks. All I/O mocked. Requests='+requests.length);
}
main().catch(error=>{console.error(error);process.exitCode=1;});
