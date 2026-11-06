import assert from "node:assert/strict";
import {assertNbaReaderEvidenceComplete,advanceNbaEvidencePage,nbaEvidenceHighWaterError,nbaReaderUnavailableResponse,NBA_READER_PUBLICATION_RELEASE,NBA_READER_FAILURE_LOG_RELEASE,nbaReaderFailureLogSuffix,nbaReaderFailureReceipt} from "../lib/services/nba/nbaReaderPublication";
import {refreshDailyEdgeResponseSnapshot} from "../lib/services/labResponseSnapshotWriter";
import {reconcileNbaMarketConsequence} from "../lib/services/nba/nbaMarketConsequence";
import {gradeNbaR30MarketForAudit} from "../lib/services/nba/nbaMarketReview";

async function main(){
 const previousFetch=globalThis.fetch;let network=0;globalThis.fetch=async()=>{network++;throw Error("unexpected real IO");};
 try{
  assert.doesNotThrow(()=>assertNbaReaderEvidenceComplete([]),"successful empty observations are not an opposition/confirmation gate");
  // Reproduce the dangerous combination: failed price reads can retain a
  // strong independent forecast without any book opposition in the grade.
  const independent={independentMargin:10,independentTotal:230,law:{marginSigma:12,totalSigma:18},spreadHome:-6.5,totalLine:225.5};
  const lost=reconcileNbaMarketConsequence({...independent,context:{eventId:"7",inputFingerprint:"fixed",evaluatedAt:"2026-11-06T19:46:00Z",priceRows:[],splitRows:[],pricesTrusted:false,splitsTrusted:true}});
  assert.equal(lost.margin,independent.independentMargin);assert.equal(lost.total,independent.independentTotal);
  assert.equal(gradeNbaR30MarketForAudit({market:"spread",pick:"home",confidence:68,modelProbabilityOnPick:.68,band:"support",edge:.1,currentPriceAmerican:-110,injuriesKnown:true,dataQualityTier:"high"}).grade,"best_angle");
  for(const family of ["price","split"] as const){
   const ids=Array.from({length:1007},(_,i)=>({id:i*3+2})),highWater=ids.at(-1)!.id;
   let cursor=0;const seen:number[]=[];
   for(let i=0;i<ids.length;i+=71){const page=ids.slice(i,i+71),p=advanceNbaEvidencePage({family,cursor,highWater,rows:page});assert.equal(p.error,null);cursor=p.cursor;seen.push(...page.map(x=>x.id));}
   assert.equal(cursor,highWater);assert.deepEqual(seen,ids.map(x=>x.id),"short backend pages preserve every row and reach the declared frontier");
   assert.equal(advanceNbaEvidencePage({family,cursor:10,highWater:20,rows:[]}).error,`${family}_observation_coverage_incomplete`);
   assert.equal(advanceNbaEvidencePage({family,cursor:10,highWater:20,rows:[{id:10}]}).error,`${family}_observation_id_order_invalid`);
   assert.equal(advanceNbaEvidencePage({family,cursor:10,highWater:20,rows:[{id:21}]}).error,`${family}_observation_id_order_invalid`);
   assert.equal(advanceNbaEvidencePage({family,cursor:0,highWater:NaN,rows:[]}).error,`${family}_observation_high_water_failed`);
   assert.equal(advanceNbaEvidencePage({family,cursor:0,highWater:0,rows:[]}).error,null,"known empty source is valid absence");
  }
  assert.equal(nbaEvidenceHighWaterError("price",0,true),"price_observation_coverage_incomplete","previously attested price history cannot silently disappear into a neutral first-read state");
  assert.equal(nbaEvidenceHighWaterError("price",0,false),null,"first observation absence remains legitimate");
  const old={as_of:"2026-11-06T19:33:00Z",sport:"nba",date:"2026-11-06",games:[{id:"locked",lockedAt:"2026-11-06T19:00:00Z",grade:"best_angle",price:-300}]};
  let stored:unknown=structuredClone(old),writes=0,expirations=0,version:string|undefined;
  const bytes=JSON.stringify(stored);
  const saveSnapshot=(async(args:any)=>{writes++;stored=structuredClone(args.payload);version=args.payloadVersion;return{ok:true,snapshotKey:args.snapshotKey,expiresAt:"new-expiry",staleUntil:"new-stale"};}) as NonNullable<Parameters<typeof refreshDailyEdgeResponseSnapshot>[1]>["saveSnapshot"];
  for(const code of ["price_observation_high_water_failed","price_observation_lookup_failed","price_observation_id_order_invalid","split_observation_high_water_failed","split_observation_lookup_failed","split_observation_id_order_invalid","price_observation_coverage_incomplete","split_observation_coverage_incomplete"]){
   const buildResponse=async()=>{try{assertNbaReaderEvidenceComplete([code]);throw Error("guard did not run");}catch(error){return nbaReaderUnavailableResponse({date:"2026-11-06",now:"2026-11-06T19:46:00Z",error});}};
   const result=await refreshDailyEdgeResponseSnapshot({sport:"nba",date:"2026-11-06"},{buildResponse,saveSnapshot,expireMemberCache:async()=>{expirations++;}});
   assert.equal(result.ok,false);assert.equal(result.status,503);assert.deepEqual(result.sourceReadFailure,{release:NBA_READER_PUBLICATION_RELEASE,codes:[code]});
   assert(result.error?.includes(NBA_READER_FAILURE_LOG_RELEASE));assert(result.error?.includes(code),"the actual existing cron error string must carry the safe phase, not just transient HTTP details");
   assert.equal(JSON.stringify(stored),bytes,"source failure preserves every old payload/locked field and its original as-of");
   assert.equal(writes,0);assert.equal(expirations,0,"a failed rebuild cannot extend freshness or invalidate the good cache");
  }
  const redacted=nbaReaderUnavailableResponse({date:"2026-11-06",now:"2026-11-06T19:46:00Z",error:new Error("private SQL / API token")});
  assert(!(await redacted.text()).includes("private SQL"));
  assert.equal(nbaReaderFailureReceipt(new Response(null,{headers:{"X-Oddsphere-Nba-Reader-Failure":"private SQL / token"}})),undefined);
  assert.equal(nbaReaderFailureLogSuffix(undefined),"");
  assert(!nbaReaderFailureLogSuffix({release:NBA_READER_PUBLICATION_RELEASE,codes:["private SQL / API token"]}).includes("private SQL"));
  const recovered={...old,as_of:"2026-11-06T20:00:00Z",games:[...old.games,{id:"fresh",grade:"lean",price:-300}]};
  const good=await refreshDailyEdgeResponseSnapshot({sport:"nba",date:"2026-11-06"},{buildResponse:async()=>{assertNbaReaderEvidenceComplete([]);return Response.json(recovered);},saveSnapshot,expireMemberCache:async()=>{expirations++;}});
  assert.equal(good.ok,true);assert.deepEqual(stored,recovered);assert.equal(version,NBA_READER_PUBLICATION_RELEASE);
  assert.deepEqual((stored as typeof recovered).games[0],old.games[0],"successful recovery still retains the stored legacy lock");
  assert.equal(writes,1);assert.equal(expirations,1);assert.equal(network,0);
 }finally{globalThis.fetch=previousFetch;}
 console.log("PASS NBA source publication: independent-only failure reproduction, all read-error families, HTTP503/zero writes/exact old locks and clocks, redacted durable diagnostics, known-empty/recovered publication; zero real IO");
}
main().catch(e=>{console.error(e);process.exitCode=1;});
