import fs from "node:fs";
import path from "node:path";
import {gunzipSync} from "node:zlib";
import {createHash} from "node:crypto";
import assert from "node:assert/strict";
import {buildCbbTrainingGames,type EspnCbbEvent} from "../../lib/cbb/dataset";
import {fitCbbScoreResearchState} from "../../lib/cbb/scoreResearch";
import {fitCbbCrossDivisionPrior,type CrossDivisionGame} from "../../lib/cbb/crossDivisionPrior";
import type {CbbBox,CbbGame,CbbTrainingGame,CbbVenue,CbbRatingState} from "../../lib/cbb/types";
import artifact from "../../lib/cbb/artifacts/candidate-r4.json";
import prior from "../../lib/cbb/artifacts/cross-division-prior-r1.json";

const root=path.resolve(import.meta.dirname,"../..");
const folder=path.join(root,"scripts/fixtures/cbb-cross-division-20261105");
export const sourceSha256=(value:string)=>createHash("sha256").update(value).digest("hex");
/** V8/libm can differ by a few ULPs across Node/CPU versions. Identity, keys,
 * strings and source hashes stay exact; only finite arithmetic gets a tightly
 * bounded machine-precision comparison. Runtime artifacts are never rounded. */
export function assertCbbNumericReconstruction(actual:unknown,expected:unknown,label="reconstruction"):void{
  if(typeof actual==="number"&&typeof expected==="number"){
    assert.ok(Number.isFinite(actual)&&Number.isFinite(expected)&&
      Math.abs(actual-expected)<=32*Number.EPSILON*Math.max(1,Math.abs(actual),Math.abs(expected)),
      `${label}: ${actual} differs from ${expected}`);return;
  }
  if(Array.isArray(actual)&&Array.isArray(expected)){
    assert.equal(actual.length,expected.length,label);actual.forEach((x,i)=>assertCbbNumericReconstruction(x,expected[i],`${label}[${i}]`));return;
  }
  if(actual!==null&&expected!==null&&typeof actual==="object"&&typeof expected==="object"){
    const a=actual as Record<string,unknown>,b=expected as Record<string,unknown>;
    assert.deepEqual(Object.keys(a).sort(),Object.keys(b).sort(),label);
    for(const key of Object.keys(a))assertCbbNumericReconstruction(a[key],b[key],`${label}.${key}`);return;
  }
  assert.deepEqual(actual,expected,label);
}
export function readFullD1Fixture<T>(name:string):T{
  return JSON.parse(gunzipSync(fs.readFileSync(path.join(folder,`${name}.json.gz`))).toString());
}
export type ForwardSource={games:CbbGame[];officialDays:Array<{day:string;fetchedAt:string;events:EspnCbbEvent[]}>};
export type HistoricalSource={capturedAt:string;games:CbbGame[];boxes:CbbBox[];officialVenues:CbbVenue[];
  officialIdentityReceipts:Array<{url:string;day:string;fetchedAt:string;sha256:string;events:EspnCbbEvent[]}>};

/** Offline reconstruction only. No credentials, provider calls or DB writes. */
export function rebuildCrossDivisionInputs(){
  const historical=readFullD1Fixture<HistoricalSource>("historical-source");
  const normalized=buildCbbTrainingGames(historical.games,historical.boxes,historical.officialVenues,{includeLowerDivisionOpponents:true});
  const games:CrossDivisionGame[]=normalized.games.filter(g=>g.neutral!==null).map(game=>{
    const raw=historical.games.find(r=>r.id===game.id)!;
    assert.notEqual(!!raw.home_team.conference_id,!!raw.visitor_team.conference_id);
    return {...game,divisionOneId:raw.home_team.conference_id?game.homeId:game.awayId,
      opponentId:raw.home_team.conference_id?game.awayId:game.homeId};
  });
  const old: CbbTrainingGame[]=JSON.parse(gunzipSync(fs.readFileSync(path.join(root,
    "scripts/fixtures/cbb-stthomas-prior-recovery-20261102/original-normalized-history.json.gz"))).toString());
  const st=JSON.parse(fs.readFileSync(path.join(root,"scripts/fixtures/cbb-stthomas-prior-recovery-20261102/stthomas-venue-patch.json"),"utf8")).rows;
  const no=JSON.parse(fs.readFileSync(path.join(root,"scripts/fixtures/cbb-new-orleans-prior-recovery-20261103/new-orleans-venue-patch.json"),"utf8")).rows;
  const patches=new Map<number,boolean>([...st.map((p:{gameId:number;to:boolean})=>[p.gameId,p.to]),
    ...no.map((p:{gameId:number;neutral:boolean})=>[p.gameId,p.neutral])]);
  const history=old.map(g=>patches.has(g.id)?{...g,neutral:patches.get(g.id)!}:g);
  let previous:CbbRatingState|undefined;
  const states:Record<number,CbbRatingState>={};
  for(const season of [2022,2023,2024,2025]){
    previous=fitCbbScoreResearchState(history,{season,asOf:`${season+1}-07-01T00:00:00.000Z`,config:artifact.config,prior:previous});
    if(season>=2024)states[season]=previous;
  }
  const reproduced={...previous!,release:artifact.prior.release,
    teams:Object.fromEntries(Object.entries(previous!.teams).map(([id,t])=>[id,{...t,factors:null,opponentFactors:null}]))};
  assertCbbNumericReconstruction(reproduced,artifact.prior,"existing R4 prior must reproduce before fitting a new domain");
  const frozenStates=readFullD1Fixture<Record<number,CbbRatingState>>("d1-endseason-states");
  assertCbbNumericReconstruction(states,frozenStates,"both season-specific anchor states reproduce from source receipts");
  const sourceHash=sourceSha256(JSON.stringify({games,states:frozenStates}));
  const fitted=fitCbbCrossDivisionPrior({games,states:frozenStates,fitThroughSeason:2025,availableAt:prior.availableAt,sourceHash});
  return {historical,games,states:frozenStates,prior:fitted,rejected:normalized.rejected};
}
