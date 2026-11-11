import * as completionWindow from '../lib/playerPropsAi/completionWindow';
/** Actual production writer wiring, real parser/bindings/lock authority, mocked I/O. */
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';
import * as evidence from '../lib/playerPropsAi/evidence';
import * as nbaSourceIdentity from '../lib/playerPropsAi/nbaSourceIdentity';
import * as bindings from '../lib/playerPropsAi/siteBindings';
import * as publication from '../lib/playerPropsAi/publication';
import * as authority from '../lib/playerPropsAi/nbaLockAuthority';
import * as lifecycle from '../lib/services/nba/nbaPlayerPropsLifecycle';
import * as product from '../lib/services/nba/nbaPlayerPropsProductContract';
import {attachCapturedNbaParticipationReports,type CapturedNbaParticipationReport} from '../lib/playerPropsAi/participationEligibility';
import type {GamePacket} from '../lib/playerPropsAi/evidenceContract';
import type {reviewPropsForSite} from '../lib/playerPropsAi/siteRuntime';
import type {refreshNbaPlayerPropsPrivateCandidate} from '../lib/services/nba/nbaPlayerPropsPrivateWriter';
import {nbaAuthorityFixture,nbaAuthorityReview} from '../scripts/test-player-props-ai-nba-lock-authority';

globalThis.fetch=async()=>{throw Error('Actual NBA writer proof forbids HTTP');};
async function runCase(mode:'majority_out'|'all_out'|'missing_healthy_features'|'same_name_other_team'){
 const original=process.env.NODE_ENV;Object.assign(process.env,{NODE_ENV:'test'});
 try{
 const initial='2026-11-10T22:24:00Z',completed='2026-11-10T22:26:00Z',after='2026-11-10T22:30:01Z';let tick=initial,loads=0,writes=0,tracked=0;
 const f=nbaAuthorityFixture(initial),gameId='nba-bdl:1',ids=new Map([['a','nba-bdl-player:1'],['b','nba-bdl-player:2']]);
 const packet:GamePacket={...f.packet,sourceInputRelease:nbaSourceIdentity.PROPS_AI_NBA_CURRENT_SOURCE_RELEASE,gameId,players:f.packet.players.map(p=>({...p,id:ids.get(p.id)!})),quotes:f.packet.quotes.map(q=>({...q,playerId:ids.get(q.playerId)!})),executionQuotes:f.packet.executionQuotes!.map(q=>({...q,playerId:ids.get(q.playerId)!}))};
 packet.players.push({...packet.players[1],id:'nba-bdl-player:3',name:'Synthetic c',evidence:packet.players[1].evidence.map(e=>({...e,id:e.id+':c'}))});for(const key of ['quotes','executionQuotes'] as const){packet[key]!.push(...packet[key]!.filter(q=>q.playerId==='nba-bdl-player:2').map(q=>({...q,id:q.id+':c',playerId:'nba-bdl-player:3'})));}
 const nativeRows=[f.row('a'),f.row('a','rebounds')].map(r=>({...r,gameId,playerId:ids.get(r.playerId)!}));
 nativeRows.push({...nativeRows[0],playerId:'nba-bdl-player:3',playerName:'Synthetic c',decisionKey:'native:c:points'});
 if(mode==='same_name_other_team'){packet.players[2].name='Synthetic a';packet.players[2].team='NYK';packet.players[2].opponent='BOS';Object.assign(nativeRows[2],{playerName:'Synthetic a',team:'NYK',opponent:'BOS'});}
 const games=[{gameId,scheduledStart:packet.start,homeTeam:'NYK',awayTeam:'BOS'}];
 const previous=product.buildNbaPlayerPropsMemberSnapshot({mode:'private_forward_candidate',generatedAt:initial,slateDate:'2026-11-10',games,decisions:nativeRows,inputRows:6});
 const report={eventId:'1001',teams:new Map([['BOS',[{name:'Synthetic a',status:'out',source_player_id:'a',reported_at:null},{name:'Synthetic b',status:'out',source_player_id:'b',reported_at:null}]],['NYK',[]]])};
 if(mode==='all_out')report.teams.get('BOS')!.push({name:'Synthetic c',status:'out',source_player_id:'c',reported_at:null});
 if(mode==='missing_healthy_features')report.teams.set('BOS',[]);
 const state={games:Array(100).fill({}),boxes:Array(500).fill({}),advanced:[],players:[1,2,3].map(playerId=>({playerId,playerName:`Synthetic ${String.fromCharCode(96+playerId)}`,latestTeamId:1}))};
 if(mode==='same_name_other_team')Object.assign(state.players[2],{playerName:'Synthetic a',latestTeamId:2});
 const observations=packet.quotes.map(q=>({canonicalGameId:gameId,canonicalPlayerId:q.playerId,providerPlayerId:q.playerId.slice(-1),playerName:packet.players.find(p=>p.id===q.playerId)!.name,playerTeam:mode==='same_name_other_team'&&q.playerId==='nba-bdl-player:3'?'2':'1',market:q.market,line:q.line,side:q.side,sportsbook:q.book,americanPrice:q.american,observedAt:q.observedAt,receivedAt:q.receivedAt,provider:q.provider,isOpening:false,isLive:false}));
 type ReviewArgs=Parameters<typeof reviewPropsForSite>[0];
 let published:product.NbaPlayerPropsMemberSnapshot|null=null;
 const modules:Record<string,Record<string,unknown>>={completionWindow,sourceContextAudit:await import('../lib/playerPropsAi/sourceContextAudit'),
  evidence,nbaSourceIdentity,siteBindings:bindings,publication,nbaPlayerPropsLifecycle:lifecycle,nbaPlayerPropsProductContract:product,
  nbaLockAuthority:{...authority,observeNbaSourceAuthority:authority.testNbaSourceAuthority(()=>tick),captureNbaHandoffBundle:authority.testNbaHandoffCapture(()=>tick)},
  siteConfig:{propsAiSiteConfig:()=>({integrated:true})},
  espnNbaInjuries:{canonicalNbaAbbreviation:(value:string)=>value,fetchEspnNbaGameInjuries:async(id:string|number)=>{assert.equal(String(id),report.eventId);return report;}},
  nbaPlayerPropsSettlementStore:{},
  nbaPlayerPropsCurrentState:{readNbaPlayerPropsCurrentState:async()=>state},
  nbaPlayerPropsLiveCollector:{collectNbaPlayerPropsLiveMarket:async()=>({observations,games:[{canonicalGameId:gameId,providerGameId:'1',scheduledStart:packet.start,homeTeam:'NYK',awayTeam:'BOS'}],teamIdsByGame:{[gameId]:{home:2,away:1}},providerRequests:{balldontlie:0,theOddsApi:0,owls:0},theOddsApiCreditsUsed:0,findings:[]})},
  nbaPlayerPropsPrivateStore:{readNbaPlayerPropsMarketHistory:async()=>null,mergeNbaPlayerPropsMarketHistory:()=>({history:{release:'synthetic',observations},added:0,refreshed:0,conflicts:0}),writeNbaPlayerPropsMarketHistory:async()=>{},readNbaPlayerPropsPrivateSnapshot:async()=>previous,writeNbaPlayerPropsPrivateSnapshot:async(args:{snapshot:product.NbaPlayerPropsMemberSnapshot})=>{assert(args.snapshot.decisions.length>0,"The real canonical store rejects a generic zero-row slate");writes++;published=args.snapshot;}},
  nbaPlayerPropsPointInTimeFeatures:{buildNbaPlayerPropsPointInTimeFeatures:()=>(mode==='missing_healthy_features'?[3]:[1,2,3]).map(player_id=>({game_id:1,player_id,team_id:mode==='same_name_other_team'&&player_id===3?2:1,player_name:mode==='same_name_other_team'&&player_id===3?'Synthetic a':`Synthetic ${String.fromCharCode(96+player_id)}`}))},
  nbaPlayerPropsFrozenRuntime:{buildNbaPlayerPropsForwardDecisions:(args:{features:{player_id:number}[]})=>{if(mode==='same_name_other_team')assert(args.features.some(f=>f.player_id===3),'An Out player on BOS cannot erase the distinct same-name native player on NYK');return nativeRows.filter(r=>args.features.some(f=>r.playerId.endsWith(':'+f.player_id))).map(r=>({...r,release:'synthetic',gameId:1,playerId:Number(r.playerId.split(':').at(-1)),finalProjection:r.projection}));}},
  nbaPlayerPropsMovement:{selectNbaPlayerPropsMovementTarget:(args:{observations:typeof observations;sportsbook:string;side:string})=>args.observations.find(q=>q.sportsbook===args.sportsbook&&q.side===args.side),buildNbaPlayerPropsSameBookMovement:()=>null},
  nbaPlayerPropsReaderContract:{buildNbaPlayerPropsReaderEvidence:()=>({role:[],production:[],matchup:[]})},
  nbaPlayerPropsMemberPrices:{buildNbaPlayerPropsMemberPrices:(args:{target:typeof observations[number]})=>observations.filter(q=>q.canonicalPlayerId===args.target.canonicalPlayerId&&q.market===args.target.market).map(q=>({sportsbook:q.sportsbook,line:q.line,side:q.side,americanPrice:q.americanPrice,observedAt:q.observedAt}))},
  nbaPlayerPropsPrivateTrackingStore:{captureNbaPlayerPropsPrivateTracking:async(args:{snapshot:product.NbaPlayerPropsMemberSnapshot})=>{tracked++;assert.equal(args.snapshot,published);return{conflicts:0};}},
  siteRuntime:{reviewPropsForSite:async(args:ReviewArgs)=>{
   const loaded=await args.load({id:gameId,start:packet.start,away:'BOS',home:'NYK'},{cutoff:initial,stage:'final'} as Parameters<ReviewArgs['load']>[1]);assert(loaded);
   await args.onSourceReady?.(loaded,null,initial,true);
   if(mode==='all_out')assert.equal(writes,0,"Unavailable native rows preserve LKG until a complete review is ready");
   tick=completed;const review=nbaAuthorityReview(loaded,[1,4,5,...Array(13).fill(0)],completed);
   await args.onReviewObserved?.(loaded,review,true);await args.onReviewReady?.(loaded,review);
   // A later publication lookup crosses lock; the writer must retain the
   // immediately materialized full final rather than dropping AI-only actors.
   tick=after;await args.onReviewObserved?.(loaded,review,true);
   return{status:'active',games:[],findings:[]};
  }},
  liveSources:{liveNbaPacket:(args:{participationReports:CapturedNbaParticipationReport[]})=>{loads++;assert.equal(args.participationReports.length,1);const captured=args.participationReports[0];assert.equal(captured.gameId,gameId);assert.equal(captured.start,packet.start);assert.equal(captured.expectedEventId,report.eventId);assert.equal(Date.parse(captured.availableAt),Date.parse(initial));const result=attachCapturedNbaParticipationReports(structuredClone(packet),args.participationReports);assert(result.players.every(p=>p.evidence.some(e=>e.kind==='availability')),'Actual writer must forward the fresh exact-game injury report for every source actor');return result;}},
 };
 const moduleFixture={exports:{}};
 class Clock extends Date{constructor(value?:string|number){super(value??tick);}static now(){return Date.parse(tick);}}
 const javascript=ts.transpileModule(readFileSync('lib/services/nba/nbaPlayerPropsPrivateWriter.ts','utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText;
 vm.runInNewContext(javascript,{module:moduleFixture,exports:moduleFixture.exports,Date:Clock,console,require:(request:string)=>{const name=request.split('/').at(-1)!;assert(Object.hasOwn(modules,name),`Unmocked NBA writer dependency ${request}`);return modules[name];}},{filename:'actual-nba-writer-under-offline-test.cjs'});
 const writer=(moduleFixture.exports as {refreshNbaPlayerPropsPrivateCandidate:typeof refreshNbaPlayerPropsPrivateCandidate}).refreshNbaPlayerPropsPrivateCandidate;
 const query={select(){return query;},eq(){return query;},like(){return query;},order(){return query;},limit:async()=>({data:[],error:null})};
 const schedule=[{id:'synthetic-schedule',externalId:Number(report.eventId),gameStartAt:packet.start,slateDate:'2026-11-10',status:'STATUS_SCHEDULED',homeTeam:'NYK',homeTeamDisplayName:'New York',homeTeamLogo:'',awayTeam:'BOS',awayTeamDisplayName:'Boston',awayTeamLogo:'',venue:null}] satisfies Parameters<typeof writer>[0]['schedule'];
 const result=await writer({client:{from:()=>query} as unknown as Parameters<typeof writer>[0]['client'],writerRunId:'synthetic-lease-owner',slateDate:'2026-11-10',season:2026,schedule,ballDontLieApiKey:'synthetic-not-real',fullRefresh:false,now:initial,fetchImpl:globalThis.fetch});
 if(mode==='missing_healthy_features'){assert.equal(result.status,'last_known_good_preserved');assert.equal(loads,0);assert.equal(writes,0);assert(result.findings.includes('feature_coverage_below_80_percent:1/3'));return;}
 assert.equal(result.status,'published_private');assert.equal(loads,1);assert.equal(writes,mode==='all_out'?2:3);assert.equal(tracked,writes);
 assert(published);const rows=(published as product.NbaPlayerPropsMemberSnapshot).decisions;
 assert.equal(rows.length,4);assert.equal(result.locked,4);
 const unavailableRows=rows.filter(row=>(mode==='all_out'||['nba-bdl-player:1','nba-bdl-player:2'].includes(row.playerId)));
 assert(unavailableRows.length===(mode==='all_out'?4:3)&&unavailableRows.every(row=>row.grade==='No Play'&&row.aiReview?.sourceEligibility?.blocked));
 if(mode!=='all_out')assert(rows.some(row=>row.playerId==='nba-bdl-player:3'&&row.grade==='Best Angle'&&row.aiReview&&!row.aiReview.sourceEligibility?.blocked),'Healthy actor must be reviewed, published and tracked despite two unavailable actors');
 assert(!result.findings.some(f=>f.startsWith('feature_coverage_below_80_percent')));
 console.log(`Actual writer ${mode} control passed: all three source actors reviewed, ${unavailableRows.length} unavailable scopes No Play, ${rows.filter(r=>r.grade==='Best Angle').length} current Best Angle; all four scopes publish and lock. No HTTP/paid calls.`);
 }finally{if(original===undefined)Reflect.deleteProperty(process.env,'NODE_ENV');else Object.assign(process.env,{NODE_ENV:original});}
}
async function main(){for(const mode of ['same_name_other_team','majority_out','all_out','missing_healthy_features'] as const)await runCase(mode);}
void main().catch(error=>{console.error(error);process.exitCode=1;});
