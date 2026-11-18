/** Same frozen source/target, one law, existing grades. No publisher or DB IO. */
import {readFileSync,writeFileSync} from "node:fs";
import {gunzipSync} from "node:zlib";
import {createHash} from "node:crypto";
import {predict} from "./regression";
import {decodeResearchSource} from "./source";
import {applyCbbJointCovarianceCalibration} from "../../../lib/cbb/contextualScoreCalibrationResearch";
import {createCbbContextualScoreLaw} from "../../../lib/cbb/contextualScoreLawResearch";
import {buildCbbInterpretedDecision} from "../../../lib/cbb/contextualInterpretedDecision";
import {stableDownside,DOWNSIDE_METHOD} from "./downside";

const [dataPath,modelPath,mode,outputPath]=process.argv.slice(2);
if (!dataPath || !modelPath || !["diagnostic","prospective"].includes(mode) || !outputPath)
  throw Error("Usage: replay <coordinates> <model> <diagnostic|prospective> <new-output>");
const numericalSupplement=process.argv[6];
if (numericalSupplement && numericalSupplement!=="stable-downside") throw Error("Unknown numerical supplement");
const bytes=readFileSync(modelPath), fit=JSON.parse(bytes.toString()), data=JSON.parse(readFileSync(dataPath,"utf8"));
if (fit.calibration.status!=="converged" || data.failures.length) throw Error("Unresolved model/source extraction");
const sha=(v: Buffer) => createHash("sha256").update(v).digest("hex"), rows=[],failures=[];
const cohort=mode==="diagnostic" ? data.rows.filter((r:{gameId:number}) => fit.cohorts.evaluation.includes(r.gameId)) : data.rows;
for (const [index,r] of cohort.entries()) {
  try {
    if (mode==="prospective" && (Date.now()>=Date.parse(r.startsAt) || r.actualHome!==null || r.actualAway!==null))
      throw Error("Prospective prediction must precede start and exclude outcomes");
    const source=readFileSync(r.sourceFile);
    if (sha(source)!==r.sourceSha256) throw Error("Frozen source hash differs");
    const snapshot=JSON.parse(gunzipSync(source).toString()).payload.snapshot, board=snapshot.board;
    const e=decodeResearchSource(board),d=e.decision;
    const margin=predict(fit.models.margin,r.margin), total=predict(fit.models.total,r.total), parameters=fit.calibration.parameters;
    const latent=applyCbbJointCovarianceCalibration({marginMean:margin.mean,marginSd:margin.sd,totalMean:total.mean,totalSd:total.sd},parameters);
    const targets=d.marketDecisions.flatMap(row => row.target ? [row.target] : []);
    const oldRisk=d.marketDecisions.find(row => row.recommendationRisk)?.recommendationRisk?.context ?? {
      calibrationGames:182,
      marginLocationSd:Math.sqrt(d.workingForecast.margin.varianceComponents.sourceLocation+d.workingForecast.margin.varianceComponents.functionPosterior)*Math.exp(d.calibration.parameters.logMarginScale),
      totalLocationSd:Math.sqrt(d.workingForecast.total.varianceComponents.trendPosterior+d.workingForecast.total.varianceComponents.functionPosterior)*Math.exp(d.calibration.parameters.logTotalScale)};
    const baseline=buildCbbInterpretedDecision({input:e.input,interpretation:d.interpretation,
      latent:d.numericalTrace.finalLatentDistribution,targets,recommendationRisk:oldRisk});
    const candidate=buildCbbInterpretedDecision({input:e.input,interpretation:d.interpretation,latent,targets,
      workingDownside:numericalSupplement ? stableDownside : undefined,
      recommendationRisk:{calibrationGames:fit.calibration.gameIds.length,
        marginLocationSd:Math.sqrt(margin.locationVariance)*Math.exp(parameters.logMarginScale),
        totalLocationSd:Math.sqrt(total.locationVariance)*Math.exp(parameters.logTotalScale)}});
    const result={gameId:r.gameId,date:r.date,asOf:r.asOf,startsAt:r.startsAt,fixture:d.fixtureIdentity,
      originalGradeRelease:board.gradeRelease,sourceSha256:r.sourceSha256,
      ...(mode==="diagnostic" ? {actualHome:r.actualHome,actualAway:r.actualAway} : {}),
      latent,workingPredictions:{margin,total},scores:{published:d.finalScore,baseline:baseline.finalScore,candidate:candidate.finalScore},
      markets:Object.fromEntries((["published","baseline","candidate"] as const).map(name => {
        const decision=name==="published" ? d : name==="baseline" ? baseline : candidate;
        return [name,decision.marketDecisions.map(row => {
          const target=row.target;
          const delta=mode!=="diagnostic" || !target ? null : row.market==="moneyline" ? r.actualHome-r.actualAway :
            row.market==="spread" ? r.actualHome-r.actualAway+target.line! : r.actualHome+r.actualAway-target.line!;
          const settled=delta===null || row.selection===null ? null : delta===0 ? "push" :
            (delta>0)===(row.selection==="first") ? "win" : "loss";
          return {market:row.market,selection:row.selection,grade:row.grade,p:row.probability,lose:row.loseProbability,
            push:row.pushProbability,price:row.price,line:target?.line??null,book:target?.sportsbook??null,
            expectedValue:row.expectedValue,reason:row.reason,result:settled};
        })];
      })),
      ...(mode==="diagnostic" ? {jointNll:{baseline:createCbbContextualScoreLaw(d.numericalTrace.finalLatentDistribution).cellNll(r.actualHome,r.actualAway),
        candidate:createCbbContextualScoreLaw(latent).cellNll(r.actualHome,r.actualAway)}} : {})};
    rows.push(result);
  } catch(error) {failures.push({gameId:r.gameId,error:String(error),stack:error instanceof Error?error.stack:null});}
  if ((index+1)%10===0) console.log(JSON.stringify({mode,processed:index+1,total:cohort.length,failures:failures.length}));
}
writeFileSync(outputPath,JSON.stringify({at:new Date().toISOString(),release:fit.release,authority:"private_offline_no_member_wagers",
  mode,workingDownsideMethod:numericalSupplement ? DOWNSIDE_METHOD : "unchanged_legacy",
  modelSha256:sha(bytes),dataSha256:sha(readFileSync(dataPath)),expectedGames:cohort.length,rows,failures,
  paidCalls:0,dbWrites:0,liveGradeChanges:0},null,2),{flag:"wx",mode:0o600});
console.log(JSON.stringify({mode,games:rows.length,failures}));
if (failures.length) throw Error("Replay failures retained; cannot qualify incomplete predictions");
