/** Bounded, read-only source feasibility probe. No model or writer authority. */
import {readFileSync,writeFileSync,existsSync} from "node:fs";
import {createHash} from "node:crypto";
import {OwlsInsightClient} from "../../lib/providers/owls/owlsInsightClient";

const archivePath="/private/tmp/oddsphere-cbb-stthomas-recovery-20261102/historical-2025-candidate-rows.json";
const outputPath="/private/tmp/oddsphere-cbb-professional-history-feasibility-20261103.json";
const seed="cbb-pro-source-coverage-2026-11-03";
type ArchiveRow={game:{date:string};orientationEventId:string};
type RawRow={book?:string;market?:string;side?:string;price?:number;pointValue?:number|null;
  recordedAt?:string;recordedAtUtc?:string|null;inPlay?:boolean;qualityFlags?:string[]};

function easternStoredClock(actualMs:number){
  const parts=new Intl.DateTimeFormat("en-US",{timeZone:"America/New_York",hourCycle:"h23",year:"numeric",month:"2-digit",day:"2-digit",hour:"2-digit",minute:"2-digit",second:"2-digit"})
    .formatToParts(new Date(actualMs));
  const value=Object.fromEntries(parts.map(part=>[part.type,part.value]));
  return new Date(Date.UTC(Number(value.year),Number(value.month)-1,Number(value.day),Number(value.hour),Number(value.minute),Number(value.second),actualMs%1000)).toISOString();
}
function selectedRows(bytes:Buffer){
  const all=JSON.parse(bytes.toString()) as ArchiveRow[];
  if(all.length!==1070||new Set(all.map(row=>row.orientationEventId)).size!==1070)throw Error("Historical archive cohort changed");
  const rank=(rows:ArchiveRow[])=>rows.sort((a,b)=>{
    const digest=(row:ArchiveRow)=>createHash("sha256").update(`${seed}\n${row.orientationEventId}`).digest("hex");
    return digest(a).localeCompare(digest(b))||a.orientationEventId.localeCompare(b.orientationEventId);
  }).slice(0,10);
  return [...rank(all.filter(row=>row.game.date<"2026-02-28")),...rank(all.filter(row=>row.game.date>="2026-02-28"))];
}
function completePairs(rows:RawRow[],market:"spreads"|"totals"){
  const byTime=new Map<string,RawRow[]>();
  for(const row of rows.filter(row=>row.book==="pinnacle"&&row.market===market&&typeof row.recordedAt==="string"&&
    Number.isFinite(row.price)&&row.price!==0&&Number.isFinite(row.pointValue)&&
    !row.inPlay&&(!row.qualityFlags||row.qualityFlags.length===0))){
    byTime.set(row.recordedAt!,[...(byTime.get(row.recordedAt!)??[]),row]);
  }
  const pairs=[];
  for(const [recordedAt,group] of byTime){
    const first=group.find(row=>row.side===(market==="spreads"?"home":"over"));
    const second=group.find(row=>row.side===(market==="spreads"?"away":"under"));
    if(!first||!second||group.length!==2||
      (market==="spreads"?Math.abs(first.pointValue!+second.pointValue!)>1e-9:
        Math.abs(first.pointValue!-second.pointValue!)>1e-9))continue;
    pairs.push({recordedAt,first,second});
  }
  return pairs.sort((a,b)=>a.recordedAt.localeCompare(b.recordedAt));
}

async function main(){
  if(existsSync(outputPath))throw Error("One-run output already exists; no repeated provider probe");
  const archive=readFileSync(archivePath),selected=selectedRows(archive);
  const client=new OwlsInsightClient(process.env.OWLS_INSIGHT_API_KEY??"");
  const events=[];let firstRemaining:number|null=null,lastRemaining:number|null=null;
  for(const row of selected){
    if(events.length>=20||firstRemaining!==null&&lastRemaining!==null&&firstRemaining-lastRemaining>=500)break;
    const tip=Date.parse(row.game.date),from=tip-(6*60+10)*60_000,to=tip-6*60*60_000;
    if(!Number.isFinite(tip)||from>=to)throw Error("Invalid frozen fixture time");
    const startTime=easternStoredClock(from),endTime=easternStoredClock(to);
    const offsetMs=from-Date.parse(startTime);
    try{
      const response=await client.get<{success:boolean;data?:{snapshots?:RawRow[];count?:number;limit?:number;timeRange?:unknown};meta?:unknown}>(
        "/api/v1/history/odds",{eventId:row.orientationEventId,book:"pinnacle",startTime,endTime,limit:150,offset:0});
      const rows=response.body.data?.snapshots??[];
      const spread=completePairs(rows,"spreads"),total=completePairs(rows,"totals");
      if(firstRemaining===null)firstRemaining=response.rateLimit.remainingMonth;
      lastRemaining=response.rateLimit.remainingMonth;
      events.push({eventId:row.orientationEventId,tipUtc:row.game.date,windowActualUtc:{from:new Date(from).toISOString(),to:new Date(to).toISOString()},
        windowStoredClock:{startTime,endTime},inferredEasternOffsetMs:offsetMs,sourceUtcStatus:"missing_native_utc_inferred_from_documented_eastern_wall_clock",
        responseStatus:response.status,rateLimit:response.rateLimit,returned:rows.length,reportedCount:response.body.data?.count,
        truncated:rows.length===150,spreadPairCount:spread.length,totalPairCount:total.length,
        latestSpread:spread.at(-1)??null,latestTotal:total.at(-1)??null,rawRows:rows});
    }catch(error){events.push({eventId:row.orientationEventId,tipUtc:row.game.date,error:error instanceof Error?error.message:String(error)});}
  }
  const output={authority:"offline_source_feasibility_only",archiveSha256:createHash("sha256").update(archive).digest("hex"),selectionSeed:seed,
    selected:selected.map(row=>row.orientationEventId),executedAt:new Date().toISOString(),requestedEvents:events.length,
    allowanceUnitsReported:firstRemaining!==null&&lastRemaining!==null?firstRemaining-lastRemaining:null,
    completeAxes:events.filter(event=>typeof event.spreadPairCount==="number"&&event.spreadPairCount>0&&
      typeof event.totalPairCount==="number"&&event.totalPairCount>0).length,
    truncated:events.filter(event=>"truncated" in event&&event.truncated).length,productionWrites:0,modelFits:0,events};
  writeFileSync(outputPath,JSON.stringify(output),{flag:"wx",mode:0o600});
  console.log(JSON.stringify({outputPath,selected:output.selected.length,requested:events.length,completeAxes:output.completeAxes,
    truncated:output.truncated,allowanceUnitsReported:output.allowanceUnitsReported,
    failures:events.filter(event=>"error" in event).map(event=>({eventId:event.eventId,error:event.error}))}));
}
main().catch(error=>{console.error(error instanceof Error?error.message:String(error));process.exitCode=1});
