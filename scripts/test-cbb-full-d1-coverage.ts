import assert from "node:assert/strict";
import fs from "node:fs";
import {gunzipSync} from "node:zlib";
import {computeSlateDate} from "../lib/dates/slateDate";
import {cbbDivisionOneFixture,isCbbDivisionOneTeam,cbbDivisionOneTeamIds} from "../lib/cbb/divisionOneMembership";
import {cbbCrossDivisionContext,cbbOfficialD1FixtureContext} from "../lib/cbb/crossDivisionIdentity";
import {forecastCbbFullDivisionOneBatch} from "../lib/cbb/fullDivisionOneForecast";
import {forecastCbbCurrentBatch} from "../lib/cbb/currentScoreRuntime";
import {forecastCbbCrossDivision,type CbbCrossDivisionPrior} from "../lib/cbb/crossDivisionPrior";
import {CBB_D1_NEWCOMERS} from "../lib/cbb/fullDivisionOneScoreRuntime";
import {buildCbbGameForecastBoard} from "../lib/cbb/gameForecastBoard";
import {advanceCbbProvisionalSnapshot} from "../lib/cbb/provisionalLifecycle";
import {adaptCbbProvisionalGame} from "../lib/services/cbb/adaptCbbProvisionalToDailyEdge";
import {cbbOfficialGameResult} from "../lib/services/cbb/adaptCbbProvisionalToDailyEdge";
import {cbbIndependentInputKey} from "../lib/services/cbb/cbbMarketBehaviorInputs";
import {readCbbMarketBehavior} from "../lib/cbb/marketBehaviorCandidate";
import {buildCbbProvisionalBoard} from "../lib/cbb/provisionalBoard";
import membership from "../lib/cbb/artifacts/division-one-membership-2026-r1.json";
import frozenPrior from "../lib/cbb/artifacts/cross-division-prior-r1.json";
import source from "../lib/cbb/artifacts/newcomer-strength-2026-r1.json";
import {readFullD1Fixture,rebuildCrossDivisionInputs,sourceSha256,type ForwardSource} from "./lib/cbbFullD1OfflineInputs";

const folder="scripts/fixtures/cbb-cross-division-20261105";
const manifest=JSON.parse(fs.readFileSync(`${folder}/manifest.json`,"utf8"));
for(const [name,sha] of [["historical-source",manifest.historicalSourceSha256],["forward-source",manifest.forwardSourceSha256]]){
  assert.equal(sourceSha256(gunzipSync(fs.readFileSync(`${folder}/${name}.json.gz`)).toString()),sha);
}
const census=readFullD1Fixture<{rows:Array<{orgId:number;nameOfficial:string;division:number;academicYear:number;deactive:string}>;sha256:string}>("ncaa-membership-source");
assert.equal(census.rows.length,365);assert.equal(membership.members.length,365);
assert.equal(membership.sourceHash,census.sha256);
for(const field of ["ncaa","bdl"] as const)assert.equal(new Set(membership.members.map(m=>m[field])).size,365);
for(const m of membership.members){const raw=census.rows.find(r=>r.orgId===m.ncaa)!;
  assert.equal(raw.nameOfficial,m.ncaaName);assert.equal(raw.division,1);assert.equal(raw.academicYear,2027);assert.equal(raw.deactive,"N");}
assert.equal(isCbbDivisionOneTeam({id:732,full_name:"Argonauts"},2026),true);
assert.equal(isCbbDivisionOneTeam({id:369,full_name:"Centenary (LA) Gentlemen"},2026),false);
assert.throws(()=>isCbbDivisionOneTeam({id:732,full_name:"Other Argonauts"},2026),/identity changed/);
assert.throws(()=>cbbDivisionOneTeamIds(2027),/renewal/);
const published=readFullD1Fixture<{sourceHash:string;rawBody:string}>("published-strength-source");
assert.equal(sourceSha256(published.rawBody),source.sourceHash);
const programRows=JSON.parse(published.rawBody) as Array<Array<string|number>>;
assert.equal(programRows.length,365);
for(const row of source.rows){const raw=programRows.find(p=>p[1]===row.sourceName)!;
  assert.ok(raw);assert.equal(raw[4],row.adjustedOffense);assert.equal(raw[6],row.adjustedDefense);assert.equal(raw[44],row.adjustedTempo);}

const rebuilt=rebuildCrossDivisionInputs();
assert.equal(rebuilt.historical.games.length,237);assert.equal(rebuilt.historical.boxes.length,474);
assert.equal(rebuilt.games.length,229);assert.equal(Object.keys(rebuilt.prior.teams).length,59);
assert.deepEqual(rebuilt.prior,frozenPrior,"fitted prior is reproducible from actual receipts and season-matched D1 states");
assert.equal(rebuilt.games.every(g=>g.homeId===g.divisionOneId&&!g.neutral&&g.homeScore>g.awayScore),true,
  "document sample support honestly; this is not a calibrated cross-domain upset evaluation");

const forward=readFullD1Fixture<ForwardSource>("forward-source"),day="2026-11-05",asOf="2026-11-05T05:00:00.000Z";
const events=new Map(forward.officialDays.map(d=>[d.day,{events:d.events,fetchedAt:d.fetchedAt}]));
const games=forward.games.filter(g=>computeSlateDate("cbb",g.date)===day&&cbbDivisionOneFixture(g).eligible)
  .sort((a,b)=>a.date.localeCompare(b.date)||a.id-b.id);
assert.equal(games.length,65);assert.equal(games.filter(g=>cbbDivisionOneFixture(g).crossDivision).length,22);
const rows=forecastCbbFullDivisionOneBatch(games,asOf,[],events);
assert.equal(rows.length,65);assert.equal(rows.every(r=>r.forecast.inputStatus==="complete"),true);
assert.equal(rows.filter(r=>r.coverage?.kind==="cross_division").length,22);
const ordinary=rows.filter(r=>r.coverage===null),old=forecastCbbCurrentBatch(ordinary.map(r=>r.game),asOf,[]);
for(let i=0;i<ordinary.length;i++){
  assert.deepEqual({...ordinary[i].forecast,release:old[i].forecast.release},old[i].forecast,"incumbent D1 numerical parity");
  assert.deepEqual(ordinary[i].features,old[i].features);
}
const nativeQuotes=(["moneyline","spread","total"] as const).flatMap(market=>["fanduel","pinnacle"].map(sportsbook=>({
  gameId:ordinary[0].game.id,market,sportsbook,line:market==="moneyline"?null:market==="spread"?-6.5:145.5,
  firstPrice:-110,secondPrice:-110,providerObservedAt:asOf,fetchedAt:asOf,phase:"current" as const})));
const marketArgs={independentInputKey:"same-incumbent-statistics",startsAt:ordinary[0].game.date,
  targets:nativeQuotes.filter(q=>q.sportsbook==="fanduel"),currentQuotes:nativeQuotes,anchors:null,flows:[]};
const mr4=readCbbMarketBehavior({...marketArgs,independent:old[0].forecast});
const mr5=readCbbMarketBehavior({...marketArgs,independent:ordinary[0].forecast});
assert.deepEqual({...mr5.forecast,release:mr4.forecast.release},mr4.forecast);
assert.deepEqual(buildCbbProvisionalBoard(mr5.forecast,nativeQuotes,{marketBehavior:mr5.receipt}).rows,
  buildCbbProvisionalBoard(mr4.forecast,nativeQuotes,{marketBehavior:mr4.receipt}).rows,
  "a versioned incumbent input preserves the existing reader and exact-price grade mathematics");
const current=readFullD1Fixture<{payload:{games:import("../lib/cbb/types").CbbTrainingGame[]}}>("existing-current-training").payload.games;
assert.equal(current.length,139);
const currentRows=forecastCbbFullDivisionOneBatch(games,asOf,current,events);
const currentOrdinary=currentRows.filter(r=>r.coverage===null),oldCurrent=forecastCbbCurrentBatch(currentOrdinary.map(r=>r.game),asOf,current);
for(let i=0;i<currentOrdinary.length;i++)assert.deepEqual({...currentOrdinary[i].forecast,release:oldCurrent[i].forecast.release},oldCurrent[i].forecast,
  "same 139 real current-season rows preserve incumbent numerical forecasts before newcomer D1 results exist");
const publication=readFullD1Fixture<{asOf:string;games:import("../lib/cbb/types").CbbGame[];
  history:import("../lib/cbb/types").CbbTrainingGame[];official:{day:string;fetchedAt:string;events:import("../lib/cbb/dataset").EspnCbbEvent[]};
  bundles:Array<Parameters<typeof readCbbMarketBehavior>[0]&{game:typeof ordinary[number]["game"]}>}>("prepublication-inputs");
assert.equal(publication.history.length,149);assert.equal(publication.bundles.length,43);
const pubForecasts=forecastCbbFullDivisionOneBatch(publication.games,publication.asOf,publication.history,
  new Map([[publication.official.day,publication.official]]));
let pricedAxes=0;
for(const bundle of publication.bundles){
  const bytes=JSON.stringify(bundle),f=pubForecasts.find(r=>r.game.id===bundle.game.id)!;
  assert.equal(cbbIndependentInputKey(bundle.game,publication.history),bundle.independentInputKey);
  assert.deepEqual({...f.forecast,release:bundle.independent.release},bundle.independent);
  const a=readCbbMarketBehavior(bundle),b=readCbbMarketBehavior({...bundle,independent:f.forecast});
  const qa=buildCbbProvisionalBoard(a.forecast,bundle.currentQuotes,{marketBehavior:a.receipt});
  const qb=buildCbbProvisionalBoard(b.forecast,bundle.currentQuotes,{marketBehavior:b.receipt});
  assert.deepEqual(qb.score,qa.score);assert.deepEqual(qb.rows,qa.rows);pricedAxes+=qa.rows.length;
  assert.equal(JSON.stringify(bundle),bytes,"paired comparison cannot mutate its genuine frozen source bundle");
}
assert.equal(pricedAxes,129,"all 43 actual priced games retain exact predictions and grades under the candidate");
assert.deepEqual(CBB_D1_NEWCOMERS.map(r=>r.id),[732]);
assert.throws(()=>forecastCbbFullDivisionOneBatch([games[0]],"2026-11-05T03:00:00Z",[],events),/not yet observed/);
assert.throws(()=>forecastCbbFullDivisionOneBatch([{...games[0],date:"2026-11-05T01:00:00Z"}],asOf,[],events),/November 4/);

for(let i=0;i<rows.length;i++){
  const r=rows[i],f=r.forecast,g=games[i];
  assert.ok([f.homeScore,f.awayScore,f.margin,f.total,f.homeWinProbability,f.uncertainty.marginSd,f.uncertainty.totalSd].every(Number.isFinite));
  assert.ok(Math.abs(f.homeScore+f.awayScore-f.total)<1e-8);assert.ok(Math.abs(f.homeScore-f.awayScore-f.margin)<1e-8);
  assert.ok(f.homeWinProbability>0&&f.homeWinProbability<1);
  const board=buildCbbGameForecastBoard(f,r.coverage),initial=advanceCbbProvisionalSnapshot({existing:null,candidate:board,startsAt:g.date,now:asOf});
  const dto=adaptCbbProvisionalGame({game:g,snapshot:initial,now:asOf,homeLogo:null,awayLogo:null});
  assert.equal(dto.markets.moneyline.marketPrediction?.source,"model_outcome");
  assert.equal(dto.markets.moneyline.marketPrediction?.label,`${f.homeWinProbability>=.5?g.home_team.abbreviation:g.visitor_team.abbreviation} ML`);
  for(const m of Object.values(dto.markets)){
    if(!m)continue;assert.equal(m.priceAmerican,null);assert.equal(m.line,null);assert.equal(m.verdict.key,"no_play");
  }
  const locked=advanceCbbProvisionalSnapshot({existing:initial,candidate:null,startsAt:g.date,now:new Date(Date.parse(g.date)-3600_000).toISOString()});
  const bytes=JSON.stringify(locked);
  const changed={...board,score:{...board.score,home:999}};
  const again=advanceCbbProvisionalSnapshot({existing:locked,candidate:changed,startsAt:g.date,now:g.date});
  assert.equal(JSON.stringify(again),bytes,"future candidate cannot rewrite the frozen game forecast");
}
const cross=games.find(g=>cbbDivisionOneFixture(g).crossDivision)!,official=events.get(day)!;
assert.ok(cbbCrossDivisionContext(cross,official.events,official.fetchedAt));
assert.equal(cbbCrossDivisionContext({...cross,visitor_team:{...cross.visitor_team,full_name:"Foreign College",college:"Foreign College"}},official.events,official.fetchedAt),null);
assert.equal(cbbCrossDivisionContext({...cross,date:new Date(Date.parse(cross.date)+60_000).toISOString()},official.events,official.fetchedAt),null);
const context=cbbCrossDivisionContext(cross,official.events,official.fetchedAt)!;
const cr=rows.find(r=>r.game.id===cross.id)!;
const quoted=buildCbbGameForecastBoard(cr.forecast,cr.coverage,(["moneyline","spread","total"] as const).map(market=>({
  gameId:cross.id,market,sportsbook:"fanduel",line:market==="moneyline"?null:market==="spread"?-20.5:150.5,
  firstPrice:-110,secondPrice:-110,providerObservedAt:asOf,fetchedAt:asOf,phase:"current" as const})));
assert.ok(quoted.rows.every(row=>row.grade==="Held"&&row.selection===null&&row.price===null&&row.line===null&&
  row.expectedValue===null&&row.observedQuote!==null),"real observations are display evidence, not unqualified wager decisions");
const quotedInitial=advanceCbbProvisionalSnapshot({existing:null,candidate:quoted,startsAt:cross.date,now:asOf});
const quotedLock=advanceCbbProvisionalSnapshot({existing:quotedInitial,candidate:null,startsAt:cross.date,now:new Date(Date.parse(cross.date)-3600_000).toISOString()});
const result=cbbOfficialGameResult({...cross,status:"post",status_state:"final",home_score:90,away_score:50},quotedLock)!;
assert.equal(result.markets.first_inning.pickResult,null);assert.equal(result.markets.total.pickResult,null);
assert.equal(result.markets.moneyline.gradeUnits,null);
const exact=official.events.find(e=>e.id===context.espnEventId)!;
assert.equal(cbbCrossDivisionContext(cross,[exact,exact],official.fetchedAt),null);
const missingId=structuredClone(exact);delete missingId.competitions[0].competitors[0].team.id;
assert.equal(cbbCrossDivisionContext(cross,[missingId],official.fetchedAt),null);
const west=forward.games.find(g=>g.home_team.id===732&&g.visitor_team.id===1370)!;
const wd=events.get(computeSlateDate("cbb",west.date))!;
const wc=cbbOfficialD1FixtureContext(west,wd.events,wd.fetchedAt)!;
assert.ok(wc);assert.equal(wc.awayAbbreviation,"BAP");
const westForecast=forecastCbbFullDivisionOneBatch([west],asOf,[],events)[0];
assert.equal(westForecast.coverage?.kind,"cross_division");assert.equal(westForecast.forecast.inputStatus,"complete");
assert.ok(westForecast.state.teams[732]);assert.ok(Date.parse(source.capturedAt)<=Date.parse(asOf));
const r=rows.find(r=>r.coverage?.kind==="cross_division")!;
assert.notEqual(cbbIndependentInputKey(r.game,[]),cbbIndependentInputKey(r.game,[],r.coverage));
const seed=rebuilt.games.find(g=>g.opponentId===context.opponentId)??rebuilt.games[0];
const observed={...seed,id:123456,season:2026,date:"2026-11-03T00:00:00Z",homeId:context.divisionOneId,awayId:context.opponentId,
  divisionOneId:context.divisionOneId,opponentId:context.opponentId};
const cf=(history:typeof observed[])=>forecastCbbCrossDivision({prior:frozenPrior as unknown as CbbCrossDivisionPrior,
  state:r.state,game:r.game,divisionOneId:context.divisionOneId,opponentId:context.opponentId,history});
const one=cf([observed]),changed=cf([{...observed,awayScore:observed.awayScore+2,awayRegulation:observed.awayRegulation+2}]);
assert.notEqual(cbbIndependentInputKey(r.game,[],one.inputs),cbbIndependentInputKey(r.game,[],changed.inputs));
assert.notEqual(one.forecast.awayScore,changed.forecast.awayScore);
assert.deepEqual(one,cf([observed,{...observed,id:123457,opponentId:999998,awayId:999998}]),"unconsumed opponent rows cannot change a forecast input key");
const invalid=structuredClone(frozenPrior) as unknown as CbbCrossDivisionPrior;invalid.population.variance[0]=-1;
assert.throws(()=>forecastCbbCrossDivision({prior:invalid,state:r.state,game:r.game,
  divisionOneId:context.divisionOneId,opponentId:context.opponentId}),/variance/);
console.log(JSON.stringify({scope:day,sourceGames:65,forecasts:65,crossDivision:22,incumbentD1Parity:ordinary.length,
  sourcePriorReproduced:true,lockedForecastsImmutable:65,providerCalls:0,productionWrites:0}));
