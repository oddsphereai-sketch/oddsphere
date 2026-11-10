/** Synthetic source/citation controls only. No provider, model or database I/O. */
import assert from "node:assert/strict";
import {PRODUCT_RELEASE,type Evidence,type GamePacket,type Json} from "../lib/playerPropsAi/evidenceContract";
import {digest,validatePacket} from "../lib/playerPropsAi/evidence";
import {readerEvidence,validateCoverage,READER_AREAS,type ReaderArea,type ReaderAreaEvidence,type ReaderCoverage} from "../lib/playerPropsAi/readerCoverage";

globalThis.fetch=async()=>{throw Error("Network forbidden in source coverage regression");};
const at="2026-11-09T20:00:00Z";
const evidence=(id:string,value:Json,source="synthetic exact opponent profile",kind:Evidence["kind"]="matchup"):Evidence=>({id,kind,value,source,availableAt:at});
const comparison=evidence("league",{readerBenchmarks:true,asOf:at,meaning:"Synthetic observed league comparison.",reference:{league_current_season_team_games:292,league_prior_season_team_games:300,league_current_season_off_rating:110,league_prior_season_off_rating:115,league_current_season_pace:100,league_prior_season_pace:99}},"synthetic league comparison");
const packet:GamePacket={release:PRODUCT_RELEASE,sport:"nba",gameId:"synthetic",start:"2026-11-09T23:00:00Z",lock:"2026-11-09T22:00:00Z",cutoff:at,stage:"final",quotes:[],executionQuotes:[],sourceLimitations:[],players:[{id:"p",name:"Synthetic Actor",team:"A",opponent:"B",markets:["points","rebounds"],missing:[],evidence:[comparison]}]};
const append=(source:GamePacket,...entries:Evidence[]):GamePacket=>({...source,players:source.players.map(p=>({...p,evidence:[...p.evidence,...entries]}))});
const catalog=(source:GamePacket)=>readerEvidence(source).p;
const coverage=(source:Record<ReaderArea,ReaderAreaEvidence>):ReaderCoverage=>Object.fromEntries(READER_AREAS.map(area=>[area,{status:source[area].status,factIds:source[area].eligibleContextFactIds?.length?[source[area].eligibleContextFactIds[0]]:source[area].facts.slice(0,1).map(f=>f.id),effect:"uncertain",observation:"The supplied context requires caution."}])) as ReaderCoverage;
const before=digest(packet),baseline=catalog(packet);
assert.deepEqual(Object.keys(baseline),[...READER_AREAS]);
for(const area of ["matchup","game_environment"] as const){
  assert.equal(baseline[area].status,"partial");assert.deepEqual(baseline[area].eligibleContextFactIds,[]);
  assert.equal(baseline[area].facts.length,1,"Comparison facts must remain visible");
  assert(baseline[area].limitations.some(s=>s.startsWith("comparison_only_")));
}
assert.doesNotThrow(()=>validateCoverage(baseline,coverage(baseline)));
const absent=catalog({...packet,players:packet.players.map(p=>({...p,evidence:[]}))});
assert.equal(absent.matchup.status,"missing");assert.equal(absent.game_environment.status,"missing");

const opponent=evidence("opponent",{opponent:"B",adjustedDefensiveRating:112,coverageStatus:"available"});
const environment=evidence("game",{gameId:packet.gameId,pace:101,coverageStatus:"available"},"synthetic exact-game environment");
const realPacket=append(packet,opponent,environment),real=catalog(realPacket);
for(const area of ["matchup","game_environment"] as const){
  assert.equal(real[area].status,"available");assert.equal(real[area].eligibleContextFactIds?.length,1);
  assert.deepEqual(real[area].facts[0],baseline[area].facts[0],"Adding actual context cannot rewrite the comparison fact/hash");
}
assert.doesNotThrow(()=>validateCoverage(real,coverage(real)),"Actual eligible citations restore available coverage");
for(const area of ["matchup","game_environment"] as const){
  const onlyComparison=coverage(real);onlyComparison[area].factIds=[real[area].facts[0].id];
  assert.throws(()=>validateCoverage(real,onlyComparison),/actual context citation/,"Available source elsewhere does not make a comparison-only citation sufficient");
}
const unavailableOpponent=evidence("unavailable-opponent",{status:"unavailable",adjustedDefensiveRating:112});
const unavailableEnvironment=evidence("unavailable-game",{coverageStatus:"unavailable",pace:101},"synthetic exact-game environment");
const unavailable=catalog(append(packet,unavailableOpponent,unavailableEnvironment));
assert.equal(unavailable.matchup.status,"partial");assert.equal(unavailable.game_environment.status,"partial");
assert.deepEqual(unavailable.matchup.eligibleContextFactIds,[]);assert.deepEqual(unavailable.game_environment.eligibleContextFactIds,[]);
const mixed=catalog(append(realPacket,unavailableOpponent,unavailableEnvironment));
for(const area of ["matchup","game_environment"] as const){
  const onlyUnavailable=coverage(mixed);const fact=mixed[area].facts.find(f=>f.sourceIds.some(id=>id.startsWith("unavailable-")))!;
  assert(!mixed[area].eligibleContextFactIds?.includes(fact.id));onlyUnavailable[area].factIds=[fact.id];
  assert.throws(()=>validateCoverage(mixed,onlyUnavailable),/actual context citation/);
}
const metadataOnly=catalog(append(packet,evidence("metadata",{coverageStatus:"available",opponent:"B"}),evidence("empty-game",{status:"available",gameId:packet.gameId},"synthetic exact-game environment")));
assert.equal(metadataOnly.matchup.status,"partial");assert.equal(metadataOnly.game_environment.status,"partial","Identity/availability labels alone are not an actual profile");

// Trusted native-head branches use actual numeric source keys, never their prose labels.
const native=evidence("native",{market:"points",line:10.5,matchup:[{key:"opponent_adjusted_defense",label:"Opponent defense",value:112},{key:"game_pace_mean_5",label:"Game pace",value:101}]},"synthetic native","independent_model");
const withNative=catalog(append(packet,native));
assert.equal(withNative.matchup.status,"available");assert.equal(withNative.game_environment.status,"available");
assert.doesNotThrow(()=>validateCoverage(withNative,coverage(withNative)));
const spoof=evidence("spoof",{market:"points",line:10.5,matchup:[{key:"team_assist_percentage_5",label:"Opponent defense",value:.2},{key:"unrelated",label:"Game pace",value:101}]},"synthetic native","independent_model");
const labelOnly=catalog(append(packet,spoof));assert.equal(labelOnly.matchup.status,"partial");assert.equal(labelOnly.game_environment.status,"partial");
const nullMetrics=evidence("null-metrics",{market:"points",line:10.5,matchup:[{key:"opponent_adjusted_defense",label:"Opponent defense",value:null},{key:"game_pace_mean_5",label:"Game pace",value:null}],context:{opponentAllowance:{label:"Opponent allowance",value:null,format:"count"},teamImpliedPoints:null}},"synthetic native","independent_model");
const nullSource=catalog(append(packet,nullMetrics));assert.equal(nullSource.matchup.status,"partial");assert.equal(nullSource.game_environment.status,"partial");
const nativeContext=evidence("native-context",{market:"points",line:10.5,context:{opponentAllowance:{label:"Opponent allowance",value:12,format:"count"},teamImpliedPoints:25}},"synthetic native","independent_model");
const withContext=catalog(append(packet,nativeContext));assert.equal(withContext.matchup.status,"available");assert.equal(withContext.game_environment.status,"available");assert.doesNotThrow(()=>validateCoverage(withContext,coverage(withContext)));

// Flags, identity metadata and exact missing placeholders are not actual
// opponent/environment facts. Preserve them visibly, with paired real-value
// recovery; booleans and categorical context are not rejected wholesale.
for(const [key,value]of [["available",false],["available",true],["known",false],["known",true],["isAvailable",true],["isKnown",false],["hasData",true],["playerId",123],["teamId",456],["opponentId",789],["opponentTeamId",789]] as const){
  const flag=evidence(`flag-${key}-${value}`,{opponent:"B",profile:{[key]:value}});
  const flagEnvironment=evidence(`flag-environment-${key}-${value}`,{gameId:packet.gameId,profile:{[key]:value}},"synthetic exact-game environment");
  const flaggedPacket=append(packet,flag,flagEnvironment),flaggedBefore=digest(flaggedPacket),flagged=catalog(flaggedPacket);
  for(const area of ["matchup","game_environment"] as const){assert.equal(flagged[area].status,"partial");assert.deepEqual(flagged[area].eligibleContextFactIds,[]);assert(flagged[area].facts.some(f=>f.sourceIds.includes(area==="matchup"?flag.id:flagEnvironment.id)),"Metadata remains visible with its exact source binding");}
  assert.equal(digest(flaggedPacket),flaggedBefore);
}
for(const missing of ["unknown"," UNKNOWN ","unavailable","not_available","not-provided","missing","n/a","pending","unverified"]){
  const nativeMissing=evidence(`native-missing-${missing}`,{market:"points",line:10.5,context:{opponentAllowance:{label:"Opponent allowance",value:missing}}},"synthetic native","independent_model");
  const profileMissing=evidence(`profile-missing-${missing}`,{opponent:"B",defenseScheme:missing});
  const missingCatalog=catalog(append(packet,nativeMissing,profileMissing));assert.equal(missingCatalog.matchup.status,"partial");assert.deepEqual(missingCatalog.matchup.eligibleContextFactIds,[]);
}
const flagOnlyNative=evidence("flag-only-native",{market:"points",line:10.5,context:{opponentAllowance:{known:false,available:false}}},"synthetic native","independent_model");
const flagNative=catalog(append(packet,flagOnlyNative));assert.equal(flagNative.matchup.status,"partial");assert.deepEqual(flagNative.matchup.eligibleContextFactIds,[]);
const realCategorical=evidence("categorical-opponent",{opponent:"B",defenseScheme:"switch-heavy"});
const realZero=evidence("zero-opponent",{opponent:"B",defenseAdjustment:0});
const realBoolean=evidence("boolean-environment",{gameId:packet.gameId,roofClosed:false},"synthetic exact-game environment");
const realNegativeBoolean=evidence("boolean-environment-true",{gameId:packet.gameId,roofClosed:true},"synthetic exact-game environment");
for(const actualOpponent of [realCategorical,realZero]){
  const recoveredPacket=append(packet,flagOnlyNative,actualOpponent,realBoolean),recoveredBefore=digest(recoveredPacket),recovered=catalog(recoveredPacket);
  assert.equal(recovered.matchup.status,"available");assert.equal(recovered.game_environment.status,"available");assert(recovered.matchup.eligibleContextFactIds!.length>0);assert(recovered.game_environment.eligibleContextFactIds!.length>0);assert.doesNotThrow(()=>validateCoverage(recovered,coverage(recovered)));assert.equal(digest(recoveredPacket),recoveredBefore);
  const placeholderOnly=coverage(recovered);placeholderOnly.matchup.factIds=[recovered.matchup.facts.find(f=>f.sourceIds.includes(flagOnlyNative.id))!.id];assert.throws(()=>validateCoverage(recovered,placeholderOnly),/actual context citation/);
}
assert.equal(catalog(append(packet,realNegativeBoolean)).game_environment.status,"available","A meaningful boolean context fact remains usable in either state");
assert.equal(catalog(append(packet,evidence("unknown-substring",{defenseScheme:"Unknown individual assignment within a switching-heavy scheme"}))).matchup.status,"available","Only exact placeholder strings are excluded, never substantive descriptions containing a caveat");

// Non-NBA semantics, values, hashes and validation remain unchanged.
for(const sport of ["nfl","mlb"] as const){
  const prior=catalog({...packet,sport});
  for(const area of ["matchup","game_environment"] as const){assert.equal(prior[area].status,"available");assert.equal(prior[area].eligibleContextFactIds,undefined);assert.deepEqual(prior[area].facts,baseline[area].facts);}
  assert.doesNotThrow(()=>validateCoverage(prior,coverage(prior)));
  const legacyFlags=catalog({...append(packet,flagOnlyNative),sport});assert.equal(legacyFlags.matchup.status,"available");assert.equal(legacyFlags.matchup.eligibleContextFactIds,undefined);
}
// Existing accepted/locked coverage is retained as stored; new requirements are
// catalog metadata for future parsing, not a reconstruction of old evidence.
const legacy=structuredClone(baseline);for(const area of ["matchup","game_environment"] as const){delete legacy[area].eligibleContextFactIds;legacy[area].status="available";}
const stored={coverage:coverage(legacy),projection:777,probability:.123,grade:"No Play",lockedAt:packet.lock},storedBytes=JSON.stringify(stored);
assert.doesNotThrow(()=>validateCoverage(legacy,stored.coverage));assert.equal(JSON.stringify(stored),storedBytes);
const several={...packet,players:[packet.players[0],{...packet.players[0],id:"p2",name:"Other Synthetic Actor",evidence:[{...comparison,id:"other-league"}]}]};
const all=readerEvidence(several);assert.equal(Object.keys(all).length,2);assert.deepEqual(several.players.map(p=>p.markets),[["points","rebounds"],["points","rebounds"]]);assert.equal(digest(packet),before);validatePacket(packet);
console.log("NBA context coverage passed: comparisons retained as partial, actual source/citation recovery, absent/unavailable/null/label-only refusal, all areas/actors/scopes preserved, unchanged fact hashes/non-NBA/legacy records. No network.");
