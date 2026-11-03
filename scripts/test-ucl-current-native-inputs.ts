import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import {deriveUclCoherentMarketOutcome} from "../lib/services/ucl/uclCoherentMarketOutcome";
import {eplCurrentBookVectors} from "../lib/services/epl/eplForwardEvidenceCapture";
import {__TEST__,soccerFixtureEventIdentities} from "../lib/providers/real_api/CurrentSoccerMarketProvider";
import type {RawOwlsOddsResponse,RawOwlsOddsEvent} from "../lib/providers/owls/owlsSharpBookOdds";
const fixture=JSON.parse(readFileSync(new URL("./fixtures/ucl-current-native-inputs-20261103.json",import.meta.url),"utf8")) as {
 capturedAt:string;games:Array<{id:number;home:string;away:string;kickoff:string}>;response:RawOwlsOddsResponse;
};
const at=Date.parse(fixture.capturedAt),events=fixture.response.data as RawOwlsOddsEvent[];
const gala=fixture.games.find(g=>g.id===4243833)!;
const normalize=(response:RawOwlsOddsResponse)=>__TEST__.normalizeOwlsFixture(response,"ucl",gala,at);
const dk=events.find(e=>e.eventId==="soccer:Stuttgart@Galatasaray-20261103"&&e.bookmakers?.[0]?.key==="draftkings")!;
const witness=events.find(e=>e.eventId===dk.eventId&&e.bookmakers?.[0]?.key==="pinnacle")!;
assert.ok(dk&&witness&&dk.league==null);
const received=normalize({success:true,data:[witness,dk]});
const retail=received.rows.filter(r=>r.sportsbook==="draftkings");
assert.equal(retail.length,10,"received DK quote families now reach the exact UCL fixture");
assert.deepEqual(new Set(retail.map(r=>r.market)),new Set(["match_result","double_chance","total","btts"]));
assert.ok(retail.every(r=>r.provider_event_id===dk.eventId&&r.provider==="owls"&&r.fetched_at===dk.bookmakers![0].last_update));
assert.equal(retail.filter(r=>r.market==="btts").length,2);
assert.equal(retail.find(r=>r.market==="total")?.line,3.5,"main-line evidence cannot be relabeled as product2.5");
assert.equal(normalize({success:true,data:[dk]}).rows.length,0,"participants alone do not attest competition");
for(const change of [
 (e:RawOwlsOddsEvent)=>{e.eventId="wrong-native-id";},
 (e:RawOwlsOddsEvent)=>{e.league="England - Premier League";},
 (e:RawOwlsOddsEvent)=>{e.sport="ncaab";},
 (e:RawOwlsOddsEvent)=>{e.home_team="Manchester City";},
 (e:RawOwlsOddsEvent)=>{e.commence_time="2026-11-04T17:45:00Z";},
 (e:RawOwlsOddsEvent)=>{e.bookmakers![0].key="fanduel";},
 (e:RawOwlsOddsEvent)=>{e.bookmakers![0].last_update="2026-11-03T15:00:00Z";},
 (e:RawOwlsOddsEvent)=>{e.bookmakers![0].last_update="2026-11-02T15:00:00Z";},
]) {const bad=structuredClone(dk);change(bad);assert.equal(normalize({success:true,data:[witness,bad]}).rows.filter(r=>r.sportsbook==="draftkings").length,0);}
const wrongCompetition={...witness,league:"UEFA - Europa League"};
assert.equal(normalize({success:true,data:[wrongCompetition,dk]}).rows.length,0);
assert.equal(__TEST__.normalizeOwlsFixture({success:true,data:[witness,dk]},"epl",gala,at).rows.length,0,"UCL missing-league exception has no EPL authority");
for(const game of fixture.games) {
 const rows=__TEST__.normalizeOwlsFixture(fixture.response,"ucl",game,at).rows;
 assert.ok(rows.length>0,`source receipt covers ${game.id}`);
 assert.ok(rows.every(r=>Date.parse(r.fetched_at)<=at&&Date.parse(r.fetched_at)<Date.parse(game.kickoff)));
}
console.log("PASS UCL exact native competition:18 received fixtures, four DK quote families, both sides/source clocks, no participant-only/wrong-league/time/sport/native trust, no target-line relabeling or EPL widening.");

for(const id of [4243843,4438978]) {
 const game=fixture.games.find(g=>g.id===id)!;const normalized=__TEST__.normalizeOwlsFixture(fixture.response,"ucl",game,at);
 assert.equal(normalized.eventId,null,"complementary real native catalogs cannot be collapsed into one guessed ID");
 const own=soccerFixtureEventIdentities(normalized.rows);
 const market={eventId:normalized.eventId,odds:normalized.rows,splits:[],splitsState:"unavailable" as const};
 const vectors=eplCurrentBookVectors(market,"match_result",fixture.capturedAt);
 const input={matchId:id,independentLambdaHome:1.4,independentLambdaAway:1.3,matchResultVectors:vectors,totalVectors:[],bttsVectors:[],
  evaluatedMatchResultCanonicalBook:"pinnacle",evaluatedTotalCanonicalBook:"pinnacle",evaluatedBttsCanonicalBook:"pinnacle",providerEventId:null,
  decisionAt:fixture.capturedAt,kickoff:game.kickoff};
 assert.equal(deriveUclCoherentMarketOutcome(input).audit.eligibleAlternativeBooks.length,0);
 const accepted=deriveUclCoherentMarketOutcome({...input,fixtureEventIdentities:own});
 assert.ok(accepted.audit.eligibleAlternativeBooks.length>=2,"exact per-book source identity restores genuine alternatives without guessed fixture pooling");
 assert.ok(Math.abs(accepted.markets.match_result.home+accepted.markets.match_result.draw+accepted.markets.match_result.away-1)<1e-8);
 assert.equal(deriveUclCoherentMarketOutcome({...input,fixtureEventIdentities:own.map(r=>({...r,provider:"wrong_provider"}))}).audit.eligibleAlternativeBooks.length,0,
  "native IDs cannot cross provider namespaces");
 const named=normalized.rows.find(r=>r.provider==="owls"&&r.sportsbook==="pinnacle")!;
 const collision=soccerFixtureEventIdentities([...normalized.rows,{...named,provider_event_id:"another-owned-event"}]);
 assert.ok(!collision.some(r=>r.provider==="owls"&&r.sportsbook==="pinnacle"&&r.market===named.market),"duplicate book/market ownership is quarantined");
}
console.log("PASS UCL complementary native catalogs: actual LASK/Como sources restored per provider/book/market, duplicate ownership quarantined and no guessed global event ID.");
