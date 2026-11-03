import fs from "node:fs";
import {cbbExactMarketCenter} from "../../lib/cbb/marketReaderResearch";
import {cbbImpliedProbability} from "../../lib/cbb/marketEvidence";
import {interpretCbbRelativeMarketMove} from "../../lib/cbb/marketInterpretationResearch";
import {cbbThresholdProbabilities,normalCdf} from "../../lib/cbb/model";
import {reviewCbbQuote} from "../../lib/cbb/marketEvidence";
import {gradeCbbMarketBehavior} from "../../lib/cbb/marketBehaviorCandidate";
import type {CbbForecast,CbbQuote} from "../../lib/cbb/types";

const path=process.argv[2];
if(!path)throw new Error("pass the read-only stored-board artifact path");
const artifact=JSON.parse(fs.readFileSync(path,"utf8"));
const fair=(q:CbbQuote)=>cbbImpliedProbability(q.firstPrice)/(cbbImpliedProbability(q.firstPrice)+cbbImpliedProbability(q.secondPrice));
const rows=[];
for(const stored of artifact.rows){
  const game=stored.payload.memberGame,board=stored.payload.snapshot.board;
  const retained=board.marketContext?.retainedLevelInput,receipt=board.marketContext?.verifiedMarketRead;
  if(!retained?.independent||!receipt)continue;
  const independent={...retained.independent,...receipt.forecastIdentity,...receipt.independentScore,
    homeScore:receipt.independentScore.home,awayScore:receipt.independentScore.away,
    uncertainty:receipt.frozenUncertainty} as CbbForecast;
  const axes=(["margin","total"] as const).map(axis=>{
    const authority=receipt[axis];
    if(authority.status!=="applied"||!authority.sourceBook||!authority.sourceMarket)return {axis,kind:"no_qualified_move",oldDelta:authority.delta,newDelta:authority.delta};
    const episode=receipt.episodes.find((e:{book:string;market:string})=>e.book===authority.sourceBook&&e.market===authority.sourceMarket);
    if(!episode||episode.market==="moneyline")return {axis,kind:"moneyline_or_missing_episode",oldDelta:authority.delta,newDelta:authority.delta};
    const center=(q:CbbQuote)=>cbbExactMarketCenter(independent,q,fair(q));
    const result=interpretCbbRelativeMarketMove(independent[axis],center(episode.anchor),center(episode.current));
    return {axis,kind:result.kind,oldDelta:authority.delta,newDelta:result.scoreDelta,book:authority.sourceBook,market:authority.sourceMarket};
  });
  const margin=independent.margin+(axes.find(x=>x.axis==="margin")?.newDelta??0);
  const total=independent.total+(axes.find(x=>x.axis==="total")?.newDelta??0);
  const sd=independent.uncertainty.marginSd;
  const tie=normalCdf((.5-margin)/sd)-normalCdf((-.5-margin)/sd);
  const forecast:CbbForecast={...independent,asOf:receipt.evaluatedAt,release:receipt.modelRelease,
    margin,total,homeScore:(total+margin)/2,awayScore:(total-margin)/2,
    homeWinProbability:(1-normalCdf((.5-margin)/sd))/(1-tie)};
  const counterfactualReceipt=structuredClone(receipt);
  counterfactualReceipt.finalScore={home:forecast.homeScore,away:forecast.awayScore,margin,total,homeWinProbability:forecast.homeWinProbability};
  for(const axis of axes){const entry=counterfactualReceipt[axis.axis];entry.delta=axis.newDelta;
    if(axis.kind==="confirms_independent"){
      entry.status="confirming";
      entry.reason="observed_move_confirms_independent_without_score_shift";
    }else if(axis.kind==="corrects_independent")entry.reason="observed_move_corrects_independent";
    else if(axis.kind==="crosses_independent")entry.reason="observed_move_crosses_independent";
  }
  const markets=receipt.evaluatedTargets.map((target:CbbQuote)=>{
    const baseline=board.rows.find((row:{market:string})=>row.market===target.market);
    let grade;
    try{grade=gradeCbbMarketBehavior({forecast,target,references:[],asOf:forecast.asOf},counterfactualReceipt);}
    catch(error){throw new Error(`game ${board.gameId} ${target.market}: ${String(error)} forecast=${JSON.stringify(forecast)} receipt=${JSON.stringify(counterfactualReceipt.finalScore)} identity=${JSON.stringify(counterfactualReceipt.forecastIdentity)}`);}
    const probabilities=cbbThresholdProbabilities(forecast,target.market,target.line);
    const selection=reviewCbbQuote(forecast,target).selection;
    return {market:target.market,oldGrade:baseline?.grade,newGrade:grade.grade,oldSelection:baseline?.selection,newSelection:selection,
      oldProbability:baseline?.probability,newProbability:selection==="first"?probabilities.first:probabilities.second};
  });
  rows.push({gameId:board.gameId,away:game.awayTeamDisplayName,home:game.homeTeamDisplayName,axes,markets});
}
const changed=rows.flatMap(row=>row.axes.filter(axis=>Math.abs(axis.oldDelta-axis.newDelta)>1e-8).map(axis=>({gameId:row.gameId,away:row.away,home:row.home,...axis})));
const decisions=rows.flatMap(row=>row.markets.filter((m:{oldGrade:string;newGrade:string;oldSelection:string;newSelection:string})=>m.oldGrade!==m.newGrade||m.oldSelection!==m.newSelection).map((m:object)=>({gameId:row.gameId,away:row.away,home:row.home,...m})));
const report={source:path,scope:"offline_full_board_counterfactual_not_live_model_or_grade",games:rows.length,axisChanges:changed.length,changed,decisionChanges:decisions.length,decisions};
console.log(JSON.stringify(report,null,2));
