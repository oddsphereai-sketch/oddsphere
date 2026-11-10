/** Actual production writer wiring, real parser/bindings/lock authority, mocked I/O. */
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';
import * as bindings from '../lib/playerPropsAi/siteBindings';
import * as publication from '../lib/playerPropsAi/publication';
import * as authority from '../lib/playerPropsAi/nbaLockAuthority';
import * as lifecycle from '../lib/services/nba/nbaPlayerPropsLifecycle';
import * as product from '../lib/services/nba/nbaPlayerPropsProductContract';
import {attachCapturedNbaParticipationReports,type CapturedNbaParticipationReport} from '../lib/playerPropsAi/participationEligibility';
import type {GamePacket} from '../lib/playerPropsAi/evidenceContract';
import type {reviewPropsForSite} from '../lib/playerPropsAi/siteRuntime';
import type {refreshNbaPlayerPropsPrivateCandidate} from '../lib/services/nba/nbaPlayerPropsPrivateWriter';
import {nbaAuthorityFixture,nbaAuthorityReview} from './test-player-props-ai-nba-lock-authority';

globalThis.fetch=async()=>{throw Error('Actual NBA writer proof forbids HTTP');};
async function main(){
 const original=process.env.NODE_ENV;Object.assign(process.env,{NODE_ENV:'test'});
 try{
 const initial='2026-11-10T22:24:00Z',completed='2026-11-10T22:26:00Z',after='2026-11-10T22:30:01Z';let tick=initial,loads=0,writes=0,tracked=0;
 const f=nbaAuthorityFixture(initial),gameId='nba-bdl:1',ids=new Map([['a','nba-bdl-player:1'],['b','nba-bdl-player:2']]);
 const packet:GamePacket={...f.packet,gameId,players:f.packet.players.map(p=>({...p,id:ids.get(p.id)!})),quotes:f.packet.quotes.map(q=>({...q,playerId:ids.get(q.playerId)!})),executionQuotes:f.packet.executionQuotes!.map(q=>({...q,playerId:ids.get(q.playerId)!}))};
 const nativeRows=[f.row('a'),f.row('a','rebounds')].map(r=>({...r,gameId,playerId:ids.get(r.playerId)!}));
 const games=[{gameId,scheduledStart:packet.start,homeTeam:'NYK',awayTeam:'BOS'}];
 const previous=product.buildNbaPlayerPropsMemberSnapshot({mode:'private_forward_candidate',generatedAt:initial,slateDate:'2026-11-10',games,decisions:nativeRows,inputRows:6});
 const report={eventId:'synthetic-espn-1',teams:new Map([['BOS',[{name:'Synthetic a',status:'questionable',source_player_id:'a',reported_at:null}]],['NYK',[]]])};
 const state={games:Array(100).fill({}),boxes:Array(500).fill({}),advanced:[],players:[1,2].map(playerId=>({playerId,playerName:`Synthetic ${playerId===1?'a':'b'}`,latestTeamId:1}))};
 const observations=packet.quotes.map(q=>({canonicalGameId:gameId,canonicalPlayerId:q.playerId,providerPlayerId:q.playerId.slice(-1),playerName:packet.players.find(p=>p.id===q.playerId)!.name,playerTeam:'1',market:q.market,line:q.line,side:q.side,sportsbook:q.book,americanPrice:q.american,observedAt:q.observedAt,receivedAt:q.receivedAt,provider:q.provider,isOpening:false,isLive:false}));
 type ReviewArgs=Parameters<typeof reviewPropsForSite>[0];
 let published:product.NbaPlayerPropsMemberSnapshot|null=null;
 const modules:Record<string,Record<string,unknown>>={
  siteBindings:bindings,publication,nbaPlayerPropsLifecycle:lifecycle,nbaPlayerPropsProductContract:product,
  nbaLockAuthority:{...authority,observeNbaSourceAuthority:authority.testNbaSourceAuthority(()=>tick),captureNbaHandoffBundle:authority.testNbaHandoffCapture(()=>tick)},
  siteConfig:{propsAiSiteConfig:()=>({integrated:true})},
  espnNbaInjuries:{canonicalNbaAbbreviation:(value:string)=>value,fetchEspnNbaGameInjuries:async(id:string)=>{assert.equal(id,report.eventId);return report;}},
  nbaPlayerPropsSettlementStore:{},
  nbaPlayerPropsCurrentState:{readNbaPlayerPropsCurrentState:async()=>state},
  nbaPlayerPropsLiveCollector:{collectNbaPlayerPropsLiveMarket:async()=>({observations,games:[{canonicalGameId:gameId,providerGameId:'1',scheduledStart:packet.start,homeTeam:'NYK',awayTeam:'BOS'}],teamIdsByGame:{[gameId]:{home:2,away:1}},providerRequests:{balldontlie:0,theOddsApi:0,owls:0},theOddsApiCreditsUsed:0,findings:[]})},
  nbaPlayerPropsPrivateStore:{readNbaPlayerPropsMarketHistory:async()=>null,mergeNbaPlayerPropsMarketHistory:()=>({history:{release:'synthetic',observations},added:0,refreshed:0,conflicts:0}),writeNbaPlayerPropsMarketHistory:async()=>{},readNbaPlayerPropsPrivateSnapshot:async()=>previous,writeNbaPlayerPropsPrivateSnapshot:async(args:{snapshot:product.NbaPlayerPropsMemberSnapshot})=>{writes++;published=args.snapshot;}},
  nbaPlayerPropsPointInTimeFeatures:{buildNbaPlayerPropsPointInTimeFeatures:()=>[1,2].map(player_id=>({game_id:1,player_id,team_id:1,player_name:`Synthetic ${player_id===1?'a':'b'}`}))},
  nbaPlayerPropsFrozenRuntime:{buildNbaPlayerPropsForwardDecisions:()=>nativeRows.map(r=>({...r,release:'synthetic',gameId:1,playerId:1,finalProjection:r.projection}))},
  nbaPlayerPropsMovement:{selectNbaPlayerPropsMovementTarget:(args:{observations:typeof observations;sportsbook:string;side:string})=>args.observations.find(q=>q.sportsbook===args.sportsbook&&q.side===args.side),buildNbaPlayerPropsSameBookMovement:()=>null},
  nbaPlayerPropsReaderContract:{buildNbaPlayerPropsReaderEvidence:()=>({role:[],production:[],matchup:[]})},
  nbaPlayerPropsMemberPrices:{buildNbaPlayerPropsMemberPrices:(args:{target:typeof observations[number]})=>observations.filter(q=>q.canonicalPlayerId===args.target.canonicalPlayerId&&q.market===args.target.market).map(q=>({sportsbook:q.sportsbook,line:q.line,side:q.side,americanPrice:q.americanPrice,observedAt:q.observedAt}))},
  nbaPlayerPropsPrivateTrackingStore:{captureNbaPlayerPropsPrivateTracking:async(args:{snapshot:product.NbaPlayerPropsMemberSnapshot})=>{tracked++;assert.equal(args.snapshot,published);return{conflicts:0};}},
  siteRuntime:{reviewPropsForSite:async(args:ReviewArgs)=>{
   const loaded=await args.load({id:gameId,start:packet.start,away:'BOS',home:'NYK'},{cutoff:initial,stage:'final'} as Parameters<ReviewArgs['load']>[1]);assert(loaded);
   args.onSourceReady?.(loaded,null,initial,true);
   tick=completed;const review=nbaAuthorityReview(loaded,[1,4,5,...Array(13).fill(0)],completed);
   args.onReviewObserved?.(loaded,review,true);args.onReviewReady?.(loaded,review);
   // A later publication lookup crosses lock; the writer must retain the
   // immediately materialized full final rather than dropping AI-only actors.
   tick=after;args.onReviewObserved?.(loaded,review,true);
   return{status:'active',games:[],findings:[]};
  }},
  liveSources:{liveNbaPacket:(args:{participationReports:CapturedNbaParticipationReport[]})=>{loads++;assert.equal(args.participationReports.length,1);const captured=args.participationReports[0];assert.equal(captured.gameId,gameId);assert.equal(captured.expectedEventId,report.eventId);assert.equal(Date.parse(captured.availableAt),Date.parse(initial));const result=attachCapturedNbaParticipationReports(structuredClone(packet),args.participationReports);assert(result.players.every(p=>p.evidence.some(e=>e.kind==='availability')),'Actual writer must forward the fresh exact-game injury report for every source actor');return result;}},
 };
 const moduleFixture={exports:{}};
 class Clock extends Date{constructor(value?:string|number){super(value??tick);}static now(){return Date.parse(tick);}}
 const javascript=ts.transpileModule(readFileSync('lib/services/nba/nbaPlayerPropsPrivateWriter.ts','utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText;
 vm.runInNewContext(javascript,{module:moduleFixture,exports:moduleFixture.exports,Date:Clock,console,require:(request:string)=>{const name=request.split('/').at(-1)!;assert(Object.hasOwn(modules,name),`Unmocked NBA writer dependency ${request}`);return modules[name];}},{filename:'actual-nba-writer-under-offline-test.cjs'});
 const writer=(moduleFixture.exports as {refreshNbaPlayerPropsPrivateCandidate:typeof refreshNbaPlayerPropsPrivateCandidate}).refreshNbaPlayerPropsPrivateCandidate;
 const query={select(){return query;},eq(){return query;},like(){return query;},order(){return query;},limit:async()=>({data:[],error:null})};
 const result=await writer({client:{from:()=>query} as unknown as Parameters<typeof writer>[0]['client'],writerRunId:'synthetic-lease-owner',slateDate:'2026-11-10',season:2026,schedule:[{id:'synthetic-schedule',externalId:report.eventId,startTime:packet.start,slateDate:'2026-11-10',homeTeam:'NYK',awayTeam:'BOS'}] as unknown as Parameters<typeof writer>[0]['schedule'],ballDontLieApiKey:'synthetic-not-real',fullRefresh:false,now:initial,fetchImpl:globalThis.fetch});
 assert.equal(result.status,'published_private');assert.equal(loads,1);assert.equal(writes,1);assert.equal(tracked,1);assert.equal(result.decisions,3);assert.equal(result.locked,3);
 assert(published);const rows=(published as product.NbaPlayerPropsMemberSnapshot).decisions;assert.deepEqual([...new Set(rows.map(r=>r.playerId))].sort(),[...ids.values()].sort());assert(rows.every(r=>r.aiReview?.sourceEligibility?.facts.some(f=>f.source.includes('same-cycle'))&&r.lockedAt===new Date(packet.lock).toISOString()));assert(rows.find(r=>r.playerId==='nba-bdl-player:2'&&r.market==='points'));
 console.log('Actual NBA writer wiring passed: fresh exact-game injury reports reach all source actors; immediate prelock completed-review callbacks publish and track all three scopes/two actors, including an AI-only actor, after later I/O crosses lock. All I/O mocked; zero HTTP/DB/paid calls.');
 }finally{if(original===undefined)Reflect.deleteProperty(process.env,'NODE_ENV');else Object.assign(process.env,{NODE_ENV:original});}
}
void main().catch(error=>{console.error(error);process.exitCode=1;});
