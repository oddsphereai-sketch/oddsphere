/** Offline only. Frozen forecasts are inputs, never rewritten by evaluation. */
import {readFileSync,writeFileSync} from "node:fs";
import {createHash} from "node:crypto";
type Market="moneyline"|"spread"|"total";
type Mode="published"|"baseline"|"candidate";
type Pick={market:Market;selection:"first"|"second"|null;grade:string;p:number|null;lose:number|null;push:number|null;
  price:number|null;line:number|null;result:"win"|"loss"|"push"|null};
export type Game={gameId:number;date:string;startsAt:string;fixture:{homeId:number;awayId:number};markets:Record<Mode,Pick[]>};
type Final={gameId:number;homeId:number;awayId:number;homeScore:number;awayScore:number;status:"Final";
  source:string;sourceObservedAt:string;availableAt:string};
const action=(p:Pick)=>["Lean","Best Angle"].includes(p.grade);
const units=(p:Pick)=>p.result==="loss"?-1:p.result==="win"&&p.price!==null?(p.price>0?p.price/100:100/-p.price):0;
const conditional=(p:Pick)=>p.p!/(p.p!+p.lose!);
const closed=(p:Pick)=>p.selection!==null&&p.result!==null;
const resolved=(p:Pick)=>closed(p)&&p.result!=="push";
const brier=(p:Pick)=>(conditional(p)-Number(p.result==="win"))**2;
const logloss=(p:Pick)=>-Math.log((p.result==="win"?p.p!:p.lose!)/(p.p!+p.lose!));
const mean=(xs:number[])=>xs.length?xs.reduce((s,v)=>s+v,0)/xs.length:null;
function metrics(rows:Pick[]) {
  const done=rows.filter(closed), wl=done.filter(resolved), values=done.filter(p=>p.price!==null), profit=values.reduce((s,p)=>s+units(p),0);
  if(wl.some(p=>!Number.isFinite(logloss(p))))throw Error("Observed result has zero/unresolved forecast mass; cannot hide infinite log loss in JSON");
  return {rows:rows.length,settled:done.length,wins:wl.filter(p=>p.result==="win").length,losses:wl.filter(p=>p.result==="loss").length,
    pushes:done.length-wl.length,units:profit,roi:values.length?profit/values.length:null,
    conditionalBrier:mean(wl.map(brier)),conditionalLogLoss:mean(wl.map(logloss)),
    threeOutcomeBrier:mean(done.map(p=>(p.p!-Number(p.result==="win"))**2+(p.lose!-Number(p.result==="loss"))**2+(p.push!-Number(p.result==="push"))**2)),
    calibrationGap:wl.length?mean(wl.map(conditional))!-wl.filter(p=>p.result==="win").length/wl.length:null,
    grades:rows.reduce<Record<string,number>>((s,p)=>(s[p.grade]=(s[p.grade]??0)+1,s),{})};
}
function interval(values:number[]) {
  if (!values.length) return null;
  let seed=20261118;
  const random=()=>{seed^=seed<<13;seed^=seed>>>17;seed^=seed<<5;return(seed>>>0)/4294967296;};
  const draws=Array.from({length:4000},()=>values.reduce(s=>s+values[Math.floor(random()*values.length)],0)/values.length).sort((a,b)=>a-b);
  return {delta:mean(values),gameCluster95:[draws[99],draws[3899]],bootstrapDraws:4000};
}
export function summarize(games:Game[]) {
  return Object.fromEntries((["moneyline","spread","total"] as const).map(market=>{
    const pick=(g:Game,mode:Mode)=>g.markets[mode].find(p=>p.market===market)!;
    const pairs=games.map(g=>({baseline:pick(g,"baseline"),candidate:pick(g,"candidate")}));
    const promoted=pairs.filter(p=>action(p.candidate)&&!action(p.baseline));
    const demoted=pairs.filter(p=>!action(p.candidate)&&action(p.baseline));
    const replacements=pairs.filter(p=>action(p.candidate)&&action(p.baseline)&&p.candidate.selection!==p.baseline.selection);
    const comparable=pairs.filter(p=>resolved(p.baseline)&&resolved(p.candidate));
    return [market,{byMode:Object.fromEntries((["published","baseline","candidate"] as const).map(mode=>{
      const rs=games.map(g=>pick(g,mode));return[mode,{all:metrics(rs),actionable:metrics(rs.filter(action))}];
    })),pairedBrier:interval(comparable.map(p=>brier(p.candidate)-brier(p.baseline))),
      pairedLogLoss:interval(comparable.map(p=>logloss(p.candidate)-logloss(p.baseline))),
      pairedActionUnits:interval(pairs.filter(p=>closed(p.baseline)&&closed(p.candidate)).map(p=>(action(p.candidate)?units(p.candidate):0)-(action(p.baseline)?units(p.baseline):0))),
      promotions:metrics(promoted.map(p=>p.candidate)),demotions:metrics(demoted.map(p=>p.baseline)),
      replacementWagers:metrics(replacements.map(p=>p.candidate)),
      sideChanges:pairs.filter(p=>p.candidate.selection!==p.baseline.selection).length,
      netAction:promoted.length-demoted.length}];
  }));
}
export function joinFinals(games:Game[],finals:Final[],frozenAt:string) {
  const errors:{gameId:number;reason:string}[]=[],pending:number[]=[],settled:Game[]=[];
  for(const game of games) {
    const exact=finals.filter(f=>f.gameId===game.gameId);
    if(!exact.length){pending.push(game.gameId);continue;}
    const f=exact[0], start=Date.parse(game.startsAt), observed=Date.parse(f.sourceObservedAt), available=Date.parse(f.availableAt);
    if(exact.length!==1||f.status!=="Final"||f.homeId!==game.fixture.homeId||f.awayId!==game.fixture.awayId||
       ![f.homeScore,f.awayScore].every(s=>Number.isSafeInteger(s)&&s>=0)||f.homeScore===f.awayScore||
       !f.source?.trim()||![start,observed,available,Date.parse(frozenAt)].every(Number.isFinite)||
       Date.parse(frozenAt)>=start||observed<start||available<observed){errors.push({gameId:game.gameId,reason:"Duplicate, mismatched or unproven final/clock"});continue;}
    const markets=Object.fromEntries(Object.entries(game.markets).map(([mode,rows])=>[mode,rows.map(p=>{
      if(p.selection===null)return{...p,result:null};
      if(p.market!=="moneyline"&&p.line===null)throw Error("Frozen selected contract has no line");
      const delta=p.market==="moneyline"?f.homeScore-f.awayScore:p.market==="spread"?f.homeScore-f.awayScore+p.line!:f.homeScore+f.awayScore-p.line!;
      return{...p,result:delta===0?"push":(delta>0)===(p.selection==="first")?"win":"loss"};
    })])) as Record<Mode,Pick[]>;
    settled.push({...game,markets});
  }
  return {settled,pending,errors};
}
if(process.argv[1]?.endsWith("evaluate.ts")) {
  const [predictionPath,outputPath,finalsPath]=process.argv.slice(2);
  if(!predictionPath||!outputPath)throw Error("Usage: evaluate <frozen-replay> <new-report> [independent-finals]");
  const bytes=readFileSync(predictionPath), frozen=JSON.parse(bytes.toString()), games:Game[]=frozen.rows;
  if(new Set(games.map(g=>g.gameId)).size!==games.length)throw Error("Repeated prediction game");
  const joined=frozen.mode==="prospective"?joinFinals(games,finalsPath?JSON.parse(readFileSync(finalsPath,"utf8")).rows:[],frozen.at):
    {settled:games,pending:[],errors:[]};
  const common=joined.settled.filter(g=>g.markets.published.every(p=>p.selection!==null));
  const out={at:new Date().toISOString(),status:frozen.mode==="diagnostic"?"DEVELOPMENT_ONLY_NOT_LIVE_QUALIFICATION":"PROSPECTIVE_RESULTS_NO_AUTOMATIC_RELEASE",
    numericalMethod:frozen.workingDownsideMethod??"unchanged_legacy",expectedGames:frozen.expectedGames,predictionFailures:frozen.failures,
    predictionSha256:createHash("sha256").update(bytes).digest("hex"),modelSha256:frozen.modelSha256,
    finalsSha256:finalsPath?createHash("sha256").update(readFileSync(finalsPath)).digest("hex"):null,
    pending:joined.pending,finalErrors:joined.errors,settledGames:joined.settled.length,commonOriginalWagerEligibleGames:common.length,
    fullSamePolicy:summarize(joined.settled),commonOriginalWagerEligible:summarize(common),
    priceUnitConvention:"one unit per exact saved wager; diagnostic ROI is not original stake-weighted member accounting",
    storedHistoryWrites:0,liveGradeChanges:0};
  writeFileSync(outputPath,JSON.stringify(out,null,2),{flag:"wx",mode:0o600});
  console.log(JSON.stringify({status:out.status,settled:out.settledGames,pending:out.pending.length,failures:out.predictionFailures.length,finalErrors:out.finalErrors.length}));
}
