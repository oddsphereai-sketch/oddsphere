import {mock} from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import {fitUclStrengthScoreRate} from "../lib/services/ucl/uclStrengthScoreFit";
import {parseUclOfficialStrength,loadUclOfficialStrength,validUclOfficialStrength,UCL_OFFICIAL_STRENGTH_SOURCE_RELEASE,UCL_OFFICIAL_STRENGTH_URL} from "../lib/services/ucl/uclOfficialStrengthSource";
import {buildUclCurrentStrengthPrior,UCL_CURRENT_STRENGTH_PRIOR_RELEASE,UCL_STRENGTH_SCORE_COEFFICIENT} from "../lib/services/ucl/uclCurrentStrengthPrior";
import {fitUclOpponentModel,fitAndPredictUcl,UCL_MODEL_RELEASE} from "../lib/services/ucl/uclModel";
import {uclScoreDistribution} from "../lib/services/ucl/uclScoreDistribution";
import type {EplTrainingMatch} from "../lib/services/epl/eplShadowModel";
import type {BdlUclMatch} from "../lib/providers/real_api/BallDontLieUclProvider";
import type {UclCompetitionContext} from "../lib/services/ucl/uclCompetitionContext";
const read=(p:string)=>JSON.parse(readFileSync(p,"utf8"));
const fitArtifact=read("docs/model-audits/2026-11-04-ucl-strength-prior-fit.json");
assert.equal(fitArtifact.rows.length,147);
assert(fitArtifact.rows.every((r:{homeRatingDay:string;awayRatingDay:string;kickoff:string})=>r.homeRatingDay<=fitArtifact.authenticSourceCutoff&&r.awayRatingDay<=fitArtifact.authenticSourceCutoff&&r.kickoff<fitArtifact.trainingCutoff));
assert(Math.abs(fitUclStrengthScoreRate(fitArtifact.rows).coefficientPer400-UCL_STRENGTH_SCORE_COEFFICIENT)<1e-12);
assert.throws(()=>fitUclStrengthScoreRate([{...fitArtifact.rows[0],homeRatingDay:"2026-11-04"},...fitArtifact.rows.slice(1)]),/post-match/);
const actualSource=read("docs/model-audits/2026-11-04-ucl-official-strength-source.json");
const actualNames=new Map<number,string>(actualSource.teams.map((t:{id:number;name:string})=>[t.id,t.name]));
assert.equal(actualNames.size,36);
assert.equal(buildUclCurrentStrengthPrior(actualSource,actualNames,[...actualNames.keys()]).ratings.size,36,"all actual current clubs resolve exact official-source identity");
const known=[{name:"Arsenal",slug:"Arsenal",elo:2045},{name:"Liverpool",slug:"Liverpool",elo:2000},{name:"Liverpool",slug:"LiverpoolUY",elo:1400},
 {name:"Bayern München",slug:"Bayern",elo:1980},{name:"Atlético",slug:"atletico",elo:1900},{name:"Sporting",slug:"Sporting",elo:1800},
 {name:"Brugge",slug:"Brugge",elo:1800},{name:"Bodø/Glimt",slug:"BodoeGlimt",elo:1700},{name:"Slovan",slug:"SlovanBratislava",elo:1500},
 {name:"Slovan Liberec",slug:"SlovanLiberec",elo:1550}];
const clubs=[...known,...Array.from({length:100},(_,i)=>({name:`Test club ${i}`,slug:`TestClub${i}`,elo:1500+i}))];
const html=(rows=clubs)=>`<h1><a href="/2026-11-04/">2026-11-04</a></h1><script>throw Error('not executed');</script><table><tr><td>Malformed heading`+rows.map(c=>`<tr><td><a href="/${c.slug}"><span class="Ast">${c.name}</span></a><td>${c.elo}</tr>`).join("")+"</table>";
const source=parseUclOfficialStrength(html(),"2026-11-04T14:00:00Z");
assert(validUclOfficialStrength(source,new Date("2026-11-04T14:10:00Z")));
assert(!validUclOfficialStrength({...source,capturedAt:"2026-11-05T00:00:00Z"},new Date("2026-11-04T14:10:00Z")));
assert.equal(source.clubs.length,clubs.length);assert.equal(source.clubs[0]!.name,"Arsenal");
assert.equal(source.release,UCL_OFFICIAL_STRENGTH_SOURCE_RELEASE);assert.equal(source.sourceUrl,UCL_OFFICIAL_STRENGTH_URL);
assert.throws(()=>parseUclOfficialStrength(html(),"2026-11-03T14:00:00Z"),/future or stale/);
assert.throws(()=>parseUclOfficialStrength(html(),"2026-11-08T14:00:00Z"),/future or stale/);
assert.throws(()=>parseUclOfficialStrength(html([...clubs,{...clubs[0]!,elo:1000}]),"2026-11-04T14:00:00Z"),/Conflicting/);
assert.throws(()=>parseUclOfficialStrength("x".repeat(2_000_001),"2026-11-04T14:00:00Z"),/bound/);
const names=new Map([[1,"Arsenal"],[2,"Liverpool"],[3,"Bayern Munich"],[4,"Atlético Madrid"],[5,"Sporting CP"],[6,"Club Brugge"],[7,"Bodo/Glimt"],[8,"Slovan Bratislava"]]);
const prior=buildUclCurrentStrengthPrior(source,names,[...names.keys()]);
assert.equal(prior.ratings.get(2),2000,"Uruguay namesake cannot overwrite England's Liverpool");
assert.equal(prior.ratings.get(8),1500,"Slovan Liberec cannot be Bratislava");
assert.throws(()=>buildUclCurrentStrengthPrior(source,new Map([[99,"Missing FC"]]),[99]),/missing exact club/);
const shifted={...prior,ratings:new Map([...prior.ratings].map(([id,r])=>[id,r+999]))};
const noHistory=fitUclOpponentModel([],"2026-11-05T20:00:00Z",prior), shiftedFit=fitUclOpponentModel([],"2026-11-05T20:00:00Z",shifted);
const rate=(f:typeof noHistory,h:number,a:number)=>f.leagueHomeRate*f.strengths.get(h)!.homeAttack*f.strengths.get(a)!.awayDefense;
assert(rate(noHistory,1,8)>rate(noHistory,8,1)*3,"zero-history strong and weak clubs cannot share the same goal prior");
assert(Math.abs(rate(noHistory,1,8)-rate(shiftedFit,1,8))<1e-10,"Elo reference shift changes no scoring rate");
assert.throws(()=>fitUclOpponentModel([],source.capturedAt,prior),/unavailable before fixture/);
const rows=Array.from({length:80},(_,i)=>({id:i,date:new Date(Date.parse("2026-08-01")+i*86400000).toISOString(),status_state:"final",home_team_id:1,away_team_id:8,home_score:1,away_score:3,home_xg:null,away_xg:null} as EplTrainingMatch));
const observed=fitUclOpponentModel(rows,"2026-11-05T20:00:00Z",prior);
assert(rate(observed,1,8)<rate(noHistory,1,8),"actual goal history can contradict a strong prior");
assert(observed.strengths.get(1)!.effectiveMatches>60);
const match={id:999,date:"2026-11-05T20:00:00Z",home_team_id:1,away_team_id:8} as BdlUclMatch;
const context={neutralVenue:true} as UclCompetitionContext;
const prediction=fitAndPredictUcl({training:[],match,history:[],context,strengthPrior:prior});
const swapped=fitAndPredictUcl({training:[],match:{...match,home_team_id:8,away_team_id:1},history:[],context,strengthPrior:prior});
assert.equal(prediction.release,UCL_MODEL_RELEASE);assert.equal(prior.release,UCL_CURRENT_STRENGTH_PRIOR_RELEASE);
assert(Math.abs(prediction.lambdaHome-swapped.lambdaAway)<1e-10);assert(Math.abs(prediction.lambdaAway-swapped.lambdaHome)<1e-10,"neutral designations cannot retain a home advantage");
assert.deepEqual(prediction.adjustment.effectiveMatches,{home:0,away:0});
assert.equal(prediction.adjustment.strengthPrior,"dated_current_strength_residual_prior");
const joint=uclScoreDistribution(5.5,.3,-.1);
assert(joint.length>9);assert(Math.abs(joint.flat().reduce((s,p)=>s+p,0)-1)<1e-12);
const homeMean=joint.reduce((s,r,i)=>s+i*r.reduce((v,p)=>v+p,0),0);
assert(Math.abs(homeMean-5.5)<1e-9,"high goal rates keep their real upper tail");
assert.throws(()=>uclScoreDistribution(11,.5,-.1),/valid rate domain/);
console.log("UCL dated strength prior: authentic fit, source/identity, sparse-history separation, reference invariance, learned residuals, neutral symmetry, adaptive tail passed");

async function completionClockTest(){
  mock.timers.enable({apis:["Date"],now:Date.parse("2026-11-04T12:59:55Z")});
  const originalFetch=globalThis.fetch;
  globalThis.fetch=async(input)=>{
    const url=String(input);
    if(url.startsWith("http://127.0.0.1"))return new Response("[]",{status:200,headers:{"content-type":"application/json"}});
    assert.equal(url,UCL_OFFICIAL_STRENGTH_URL);
    return new Response(new ReadableStream({start(controller){controller.enqueue(new TextEncoder().encode(html()));mock.timers.tick(20_000);controller.close();}}),{status:200});
  };
  try{const completed=await loadUclOfficialStrength(false);assert.equal(completed.capturedAt,"2026-11-04T13:00:15.000Z");
    const late=buildUclCurrentStrengthPrior(completed,names,[...names.keys()]);
    assert.throws(()=>fitUclOpponentModel([],"2026-11-04T13:00:00Z",late),/unavailable before fixture/,"source crossing kickoff cannot invent pregame availability");
  }finally{globalThis.fetch=originalFetch;mock.timers.reset();}
}
completionClockTest().catch(error=>{console.error(error);process.exitCode=1;});
