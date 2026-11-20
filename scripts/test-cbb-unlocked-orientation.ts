import assert from "node:assert/strict";
import { buildCbbProvisionalBoard } from "../lib/cbb/provisionalBoard";
import { attachCbbGameOutcome } from "../lib/cbb/gameForecastBoard";
import type { CbbForecast, CbbGame, CbbQuote } from "../lib/cbb/types";
import { writeCbbMemberGame, cbbMemberGameForReader } from "../lib/services/cbb/cbbMemberGameStore";
import { canRebuildCbbUnlockedOrientation, cbbOrientationArchiveIdentity } from "../lib/services/cbb/cbbUnlockedOrientation";

const at="2026-11-20T15:00:00Z",start="2026-11-20T19:00:00Z";
const team=(id:number,name:string)=>({id,name,full_name:name,college:name,abbreviation:name,conference_id:1});
const game:CbbGame={id:777,date:start,season:2026,status:"pre",period:0,home_score:0,away_score:0,
  home_team:team(50,"UAB"),visitor_team:team(58,"George Washington")};
const flipped={...game,home_team:game.visitor_team,visitor_team:game.home_team};
const f:CbbForecast={release:"synthetic-test",gameId:777,asOf:at,homeId:50,awayId:58,homeScore:70,awayScore:80,
  margin:-10,total:150,possessions:70,homeWinProbability:.2,inputStatus:"complete",issues:[],uncertainty:{marginSd:11,totalSd:16,
    marginTotalCorrelation:0,marginCorrection:0,totalCorrection:0,fitThroughSeason:2025,games:3000}};
const quote:CbbQuote={gameId:777,sportsbook:"fanduel",market:"moneyline",line:null,firstPrice:300,secondPrice:-400,
  providerObservedAt:at,fetchedAt:at,phase:"current"};
const oldBoard=attachCbbGameOutcome(buildCbbProvisionalBoard(f,[quote]),f,null);
const rebuiltForecast={...f,homeId:58,awayId:50,homeScore:82,awayScore:69,margin:13,total:151,homeWinProbability:.84};
const rebuiltBoard=attachCbbGameOutcome(buildCbbProvisionalBoard(rebuiltForecast,[{...quote,firstPrice:-450,secondPrice:350}]),rebuiltForecast,null);
const stored=new Map<string,Record<string,unknown>>();let archiveFails=false;let archiveWrites=0;
const db={from:()=>({select:()=>({eq:(_:string,key:string)=>({maybeSingle:async()=>({data:stored.has(key)?{payload:stored.get(key)}:null,error:null})})}),
  upsert:async(row:{snapshot_key:string;payload:unknown},options?:{ignoreDuplicates?:boolean})=>{
    if(row.snapshot_key.includes("orientation-original")){
      archiveWrites++;if(archiveFails)return {error:{message:"archive unavailable"}};
    }
    if(!options?.ignoreDuplicates||!stored.has(row.snapshot_key))stored.set(row.snapshot_key,structuredClone(row.payload) as Record<string,unknown>);
    return {error:null};
  }})} as unknown as Parameters<typeof writeCbbMemberGame>[1];

async function main(){
 const first=await writeCbbMemberGame({game,candidate:oldBoard,homeLogo:null,awayLogo:null,now:at},db);
 const original=structuredClone(first.record),bytes=JSON.stringify(original),key="cbb::member-game::777";
 assert(canRebuildCbbUnlockedOrientation(original,flipped,at));
 assert(!canRebuildCbbUnlockedOrientation(original,flipped,"2026-11-20T18:00:00Z"));
 assert(!canRebuildCbbUnlockedOrientation(original,{...flipped,date:"2026-11-20T15:30:00Z"},at));
 assert(!canRebuildCbbUnlockedOrientation(original,{...flipped,visitor_team:team(11,"Notre Dame")},at));
 assert(!canRebuildCbbUnlockedOrientation(original,{...flipped,visitor_team:team(50,"Other school")},at));
 for(const candidate of [null,oldBoard]){
   await assert.rejects(writeCbbMemberGame({game:flipped,candidate,homeLogo:null,awayLogo:null,now:at},db),/school identity changed/);
   assert.equal(JSON.stringify(stored.get(key)),bytes);assert.equal(archiveWrites,0);
 }
 archiveFails=true;
 await assert.rejects(writeCbbMemberGame({game:flipped,candidate:rebuiltBoard,homeLogo:null,awayLogo:null,now:at},db),/archive failed/);
 assert.equal(JSON.stringify(stored.get(key)),bytes,"Archive failure cannot replace the original");
 archiveFails=false;
 await assert.rejects(writeCbbMemberGame({game:flipped,candidate:rebuiltBoard,homeLogo:null,awayLogo:null,now:at,clock:()=>"2026-11-20T18:00:00Z"},db),/original changed|cutoff/);
 assert.equal(JSON.stringify(stored.get(key)),bytes,"A late write cannot rebuild a due original");
 let clockReads=0;
 await assert.rejects(writeCbbMemberGame({game:flipped,candidate:rebuiltBoard,homeLogo:null,awayLogo:null,now:at,
   clock:()=>++clockReads===1?at:"2026-11-20T18:00:00Z"},db),/crossed original or new cutoff/);
 assert.equal(JSON.stringify(stored.get(key)),bytes,"Crossing T-60 during archival cannot replace the original");
 const rebuilt=await writeCbbMemberGame({game:flipped,candidate:rebuiltBoard,homeLogo:null,awayLogo:null,now:at},db);
 const archive=cbbOrientationArchiveIdentity(original);
 assert.deepEqual(stored.get(archive.key)?.original,original,"All original fields survive in the append-only archive");
 assert.equal(JSON.stringify(original),bytes);
 assert.equal(rebuilt.record.snapshot.board.gameForecast?.homeId,58);
 assert.equal(rebuilt.record.snapshot.board.gameForecast?.awayId,50);
 assert.equal(rebuilt.record.memberGame.projected.home,82,"Fresh forecast, not swapped legacy points");
 assert.equal(rebuilt.record.memberGame.projected.away,69);
 assert.equal(rebuilt.record.memberGame.homeTeamDisplayName,"George Washington");
 assert.equal(rebuilt.record.memberGame.markets.moneyline.priceAmerican,-450,"Fresh quoted price, not the old opposing price");
 assert.equal(rebuilt.record.fixtureOrientationRebuild?.archivedSnapshotKey,archive.key);
 const writesBefore=archiveWrites;
 const repeated=await writeCbbMemberGame({game:flipped,candidate:rebuiltBoard,homeLogo:null,awayLogo:null,now:at},db);
 assert.equal(archiveWrites,writesBefore,"Normal refresh does not duplicate the archive");
 assert.deepEqual(repeated.record.fixtureOrientationRebuild,rebuilt.record.fixtureOrientationRebuild);
 const locked=await writeCbbMemberGame({game:flipped,candidate:null,homeLogo:null,awayLogo:null,now:"2026-11-20T18:00:00Z"},db);
 const lockedBytes=JSON.stringify(locked.record);
 const preserved=await writeCbbMemberGame({game,candidate:oldBoard,homeLogo:null,awayLogo:null,now:"2026-11-20T18:01:00Z"},db);
 assert.equal(preserved.written,false);assert.equal(JSON.stringify(stored.get(key)),lockedBytes);
 assert.equal(JSON.stringify(preserved.record),lockedBytes,"A locked reversal preserves the exact writer payload");
 const rendered=cbbMemberGameForReader(preserved.record,flipped);
 assert.deepEqual(rendered.projected,locked.record.memberGame.projected,"Locked reader keeps the exact original projection");
 assert.deepEqual(rendered.markets,locked.record.memberGame.markets,"Locked reader keeps prices, picks and grades");
 console.log("CBB unlocked orientation: exact pair/identity/cutoff gates, fresh forecast/quote, durable original, archive failure, repeat refresh, locked writer and reader precedence passed.");
}
void main();
