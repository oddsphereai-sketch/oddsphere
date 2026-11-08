/** Pure full-slate transport proof. Never calls a database, provider or model. */
import assert from "node:assert/strict";
import {gzipSync} from "node:zlib";
import {createHash} from "node:crypto";
import {stringifyPropsAiCoverage,parsePropsAiCoverage} from "../lib/playerPropsAi/coverageCodec";
import {encodeNflPlayerPropsMemberTransport} from "../lib/services/football/nflPlayerPropsMemberTransport.server";
import {decodeNflPlayerPropsMemberTransport} from "../lib/services/football/nflPlayerPropsMemberTransport";
import type {NflPlayerPropsMemberSnapshot} from "../lib/services/football/nflPlayerPropsProductionContract";
globalThis.fetch=async()=>{throw Error("Offline transport proof forbids network");};
async function main(){
 const at="2026-11-08T19:00:00.123Z",rows=[];
 for(let game=0;game<16;game++)for(let player=0;player<32;player++){
  const actor=`${game}:${player}`,assessment=("Supplied recent games, role, injury context and exact market evidence were reviewed. ".repeat(24))+actor;
  const coverage={recent_form:{status:"available",facts:[{id:actor,hash:actor,label:"Synthetic exact facts",availableAt:at,sourceIds:["synthetic"]}]}};
  for(let market=0;market<6;market++)for(let book=0;book<2;book++)for(const side of ["over","under"]){
   rows.push({gameId:String(game),providerPlayerId:actor,playerName:`Synthetic ${actor}`,market:`market${market}`,line:market+12.5,side,sportsbook:`book${book}`,provider:"synthetic",scheduledStart:"2026-11-08T23:00:00Z",lockAt:"2026-11-08T22:00:00Z",state:game%2?"locked":"unlocked",projection:17.284134,finalProbability:.57831842,expectedValue:.103845,grade:"Lean",americanPrice:-113,observedAt:at,
    forecastContext:{featureAsOf:at,position:"WR",role:[actor],recentGames:[{yards:73.123456,opponent:"SYN"}]},bookEvidence:[{sportsbook:`book${book}`,provider:"synthetic",americanPrice:-113,observedAt:at}],
    aiReview:{release:"retained-r15",selectionRelease:"retained-selection",lawRelease:"retained-law",gradeRelease:"retained-grade",publicationRelease:"retained-reader",reviewId:`game${game}|final|${at}`,lawHash:actor,inputHash:`game${game}`,reviewedAt:at,stage:"final",model:"synthetic",confidenceMeaning:"Estimated source strength",assessment,coverage,quoteConfirmedAt:book?"2026-11-08T19:00:00.124Z":at,selectedSide:side,confidence:market%3,exception:market%3===0?"Synthetic missing source":null}});
  }
 }
 const snapshot={lifecycleRelease:"synthetic",season:2026,week:9,generatedAt:at,board:{evaluatedAt:at,counts:{Lean:rows.length},diagnostics:{}},memberDecisions:rows} as unknown as NflPlayerPropsMemberSnapshot;
 const before=JSON.stringify(snapshot),old=stringifyPropsAiCoverage(snapshot),wire=encodeNflPlayerPropsMemberTransport(snapshot);
 assert.ok(Buffer.byteLength(old)>16_000_000,"full-slate fixture reproduces the prior metadata repetition failure");
 assert.ok(wire.uncompressedBytes<16_000_000&&wire.compressedBytes<2_000_000,"unchanged independent wire ceilings admit the complete slate");
 assert.equal(JSON.stringify(await decodeNflPlayerPropsMemberTransport(wire)),before,"every locked/unlocked field and original property order round-trips exactly");
 assert.equal(JSON.stringify(snapshot),before,"encoding never edits a supplied member record");
 const small={...snapshot,memberDecisions:rows.slice(0,2)},legacyJson=stringifyPropsAiCoverage(small),compressed=gzipSync(legacyJson);
 for(const release of ["nfl_player_props_member_transport_2026_11_08_r2_interned_ai_coverage","nfl_player_props_member_transport_2026_09_17_r1_gzip"] as const){
  const legacy={kind:"nfl_player_props_member_transport_v1" as const,release,encoding:"gzip-base64" as const,checksum:createHash("sha256").update(legacyJson).digest("hex"),uncompressedBytes:Buffer.byteLength(legacyJson),compressedBytes:compressed.length,payload:compressed.toString("base64")};
  assert.deepEqual(await decodeNflPlayerPropsMemberTransport(legacy),small,"old transport values retain exact precedence");
 }
 const literal={memberDecisions:[{aiReview:{$propsAiReview:0,values:[]}}]},literalWire=stringifyPropsAiCoverage(literal,{internReviewMetadata:true});
 assert.deepEqual(parsePropsAiCoverage(literalWire),literal,"literal reference-shaped source fields remain literal");
 const packed=JSON.parse(stringifyPropsAiCoverage(small,{internReviewMetadata:true}));
 const badIndex=structuredClone(packed);badIndex.payload.memberDecisions[0].$propsAiRow[0]=999;assert.throws(()=>parsePropsAiCoverage(JSON.stringify(badIndex)),/Invalid AI row reference/);
 const badWidth=structuredClone(packed);badWidth.payload.memberDecisions[0].$propsAiRow.pop();assert.throws(()=>parsePropsAiCoverage(JSON.stringify(badWidth)),/Invalid AI row reference/);
 const badReview=structuredClone(packed);badReview.reviews[0].fields.push("wrong");assert.throws(()=>parsePropsAiCoverage(JSON.stringify(badReview)),/Invalid AI review metadata table/);
 const badCoverage=structuredClone(packed);badCoverage.reviews[0].coverageIndex=999;assert.throws(()=>parsePropsAiCoverage(JSON.stringify(badCoverage)),/Invalid AI review metadata table/);
 console.log(JSON.stringify({offlineTransportProof:"passed",games:16,actors:512,rows:rows.length,oldWireBytes:Buffer.byteLength(old),newWireBytes:wire.uncompressedBytes,gzipBytes:wire.compressedBytes,networkCalls:0}));
}
void main();
