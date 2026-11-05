/* eslint-disable @typescript-eslint/no-explicit-any */
/** Local same-evidence/price current-cohort comparison. No fitting, providers,
 * database, candidate persistence or stored-record reinterpretation. */
import {createHash} from "node:crypto";
import {execFileSync} from "node:child_process";
import {readFileSync,writeFileSync,existsSync} from "node:fs";
import {resolve,relative} from "node:path";
import {pathToFileURL} from "node:url";
import {buildCbbContextualOutcomeBoard} from "../../lib/cbb/contextualOutcomeBoard";
import {cbbOutcomeIndependentInputSha256} from "../../lib/cbb/contextualOutcomeDecision";
import {createCbbContextualScoreLaw} from "../../lib/cbb/contextualScoreLawResearch";
import type {CbbOutcomeArtifact} from "../../lib/cbb/contextualOutcomeForecast";
import {createCbbContextualOutcomeRuntime,readCbbContextualOutcomeEvidence,CBB_CONTEXTUAL_OUTCOME_MANIFEST} from "../../lib/services/cbb/cbbContextualOutcomeRuntime";
import {decodeCbbPrivateOutcomeArtifact} from "../../lib/services/cbb/cbbOutcomeArtifactEnvelope";
import type {CbbContextualAssembledInput} from "../../lib/services/cbb/cbbContextualReaderInput";
import {cbbReleaseSourceClosure} from "./build-cbb-contextual-release";
import type {CbbContextualFeatureInput} from "../../lib/cbb/contextualForecastFeatures";
import type {CbbQuote,CbbForecast} from "../../lib/cbb/types";
type Obj=Record<string,any>;
type Row={gameId:number;outcome:null;input:CbbContextualFeatureInput;provenance:{snapshotPayloadSHA256:string};auditOnly:{executableTargets:(CbbQuote&{orientationVerified?:boolean})[];teams?:unknown}};
export const CBB_CURRENT_R20_PIN="fb905d957c02d5b09e5bc4fc79d8d3d6af35dcdf";
export const CBB_CURRENT_INPUT_SHA256="abca3f4ae5983dbb3c644fc3fa5cc36c42e7261bbc6c3bde054fcab8eae12763";
const hash=(v:string|Uint8Array)=>createHash("sha256").update(v).digest("hex");
const objectHash=(v:unknown)=>hash(JSON.stringify(v));
const read=(p:string)=>JSON.parse(readFileSync(p,"utf8"));
function need(v:unknown,m:string):asserts v{if(!v)throw Error("Current CBB audit: "+m);}
function freeze<T>(v:T):T{if(v&&typeof v==="object"&&!Object.isFrozen(v)){Object.values(v).forEach(freeze);Object.freeze(v);}return v;}
const canonical=(v:any):any=>Array.isArray(v)?v.map(canonical):v&&typeof v==="object"?Object.fromEntries(Object.keys(v).sort().map(k=>[k,canonical(v[k])])):v;
const same=(a:unknown,b:unknown)=>objectHash(canonical(a))===objectHash(canonical(b));
const actionable=(g:string)=>g==="Lean"||g==="Best Angle";
const tier=(g:string)=>g==="Best Angle"?2:g==="Lean"?1:0;
export function verifyCurrentCbbExposure(dataset:Obj,raw:Obj,baseline:Obj,inputSha256:string,rawSha256:string){
 const rows=dataset.predictRows as Row[];need(inputSha256===CBB_CURRENT_INPUT_SHA256&&baseline.sourceInputFileSha256===inputSha256,"input file SHA differs");
 need(dataset.sourceSnapshotFileSha256===rawSha256&&rows.length===43&&raw.rows.length===65&&new Set(rows.map(r=>r.gameId)).size===43&&rows.every(r=>r.outcome===null),"Exact43 label-free/65-source cohort required");
 need(baseline.baseline.commit===CBB_CURRENT_R20_PIN&&baseline.baseline.model==="cbb_candidate_2026_11_05_r20_complete_source_admission"&&baseline.results.length===43&&baseline.storedOutputComparisonIncluded===false,"Exact controlled R20 baseline required");
 need(objectHash(baseline.baseline.sourceFiles)===baseline.baseline.sourceManifestSha256&&baseline.immutability.sourceManifestBefore===baseline.immutability.sourceManifestAfter&&baseline.immutability.sourceManifestBefore===baseline.baseline.sourceManifestSha256,"Baseline source manifest differs");
 const exposures=rows.map(row=>({row,storedSnapshot:raw.rows.find((x:Obj)=>x.payload.snapshot.gameId===row.gameId)}));
 need(exposures.every(x=>x.storedSnapshot&&objectHash(x.storedSnapshot.payload)===x.row.provenance.snapshotPayloadSHA256),"Original snapshot payload proof differs");
 need(objectHash(exposures)===baseline.immutability.rawSlateBefore&&baseline.immutability.rawSlateBefore===baseline.immutability.rawSlateAfter,"Controlled raw slate exposure differs");
 for(const exposure of exposures){const old=baseline.results.find((r:Obj)=>r.gameId===exposure.row.gameId);need(old?.status==="replayed"&&old.scope.startsWith("controlled_R20_engine_same_frozen_raw_evidence_and_exact_targets")&&old.markets.length===3&&old.immutability.rawEvidenceBefore===objectHash(exposure)&&old.immutability.rawEvidenceAfter===objectHash(exposure)&&old.immutability.constructedArgsBefore===old.immutability.constructedArgsAfter&&old.immutability.storedSnapshotUntouched===true,"Individual immutable replay differs");
  for(const target of exposure.row.auditOnly.executableTargets)need(same(target,old.markets.find((m:Obj)=>m.market===target.market)?.target),"Frozen execution target differs");
 }
 return{exposures,rawSlateSha256:objectHash(exposures),sourceManifestSha256:baseline.baseline.sourceManifestSha256};
}
export function verifyCurrentCbbBaselinePin(pin:Obj){
 need(pin.commit===CBB_CURRENT_R20_PIN,"Baseline commit changed");const head=execFileSync("git",["-C",pin.worktree,"rev-parse","HEAD"],{encoding:"utf8"}).trim();need(head===pin.commit,"Baseline worktree HEAD changed");
 for(const f of pin.sourceFiles){const path=resolve(pin.worktree,f.path);need(!relative(pin.worktree,path).startsWith(".."),"Source escaped worktree");const committed=execFileSync("git",["-C",pin.worktree,"show",pin.commit+":"+f.path],{maxBuffer:32*1024*1024});need(hash(readFileSync(path))===f.sha256&&hash(committed)===f.committedSha256&&f.sha256===f.committedSha256,"Baseline committed/current bytes differ:"+f.path);}
 return{commit:head,sourceFiles:pin.sourceFiles.length,manifestSha256:objectHash(pin.sourceFiles),committedAndCurrentSourceBytesExact:true};
}
export function reconstructCurrentCbbIndependent(row:Row,storedSnapshot:Obj):CbbForecast{
 const v=storedSnapshot.payload.snapshot.board.marketContext.verifiedMarketRead,identity=v?.forecastIdentity,score=v?.independentScore,u=v?.originalIndependentUncertainty;
 need(identity&&score&&u&&identity.gameId===row.gameId&&Number.isSafeInteger(identity.homeId)&&Number.isSafeInteger(identity.awayId)&&identity.homeId>0&&identity.awayId>0&&identity.homeId!==identity.awayId&&typeof v.independentRelease==="string","Original stored independent fixture identity unavailable");
 const independent:CbbForecast={...structuredClone(identity),release:v.independentRelease,homeScore:score.home,awayScore:score.away,margin:score.margin,total:score.total,homeWinProbability:score.homeWinProbability,uncertainty:structuredClone(u)};
 need([independent.homeScore,independent.awayScore,independent.margin,independent.total,independent.homeWinProbability,independent.uncertainty.marginSd,independent.uncertainty.totalSd].every(Number.isFinite)&&independent.uncertainty.marginSd>0&&independent.uncertainty.totalSd>0,"Original independent score/uncertainty incomplete");
 need(cbbOutcomeIndependentInputSha256(independent)===cbbOutcomeIndependentInputSha256(row.input.independent),"Stored original independent differs from frozen model input");return independent;
}
function close(a:number,b:number,tolerance:number,reason:string){need(Number.isFinite(a)&&Number.isFinite(b)&&Math.abs(a-b)<=tolerance,reason);}
export function auditCbbCurrentOutcomeDecisions(args:{inputPath:string;rawPath:string;baselinePath:string;modelPath:string;calibrationPath:string;bundleManifestPath:string;bundlePath:string;outputPath:string}){
 const began=performance.now(),out=resolve(args.outputPath);need((out.startsWith("/private/tmp/")||out.startsWith("/tmp/"))&&!existsSync(out),"Use a new private output file");
 const runtimeSources=cbbReleaseSourceClosure(["scripts/operator/audit-cbb-current-outcome-decisions.ts"]);
 const paths=[args.inputPath,args.rawPath,args.baselinePath,args.modelPath,args.calibrationPath,args.bundleManifestPath,args.bundlePath],fileHashes=Object.fromEntries(paths.map(p=>[p,hash(readFileSync(p))]));
 const dataset=freeze(read(args.inputPath)),raw=freeze(read(args.rawPath)),baseline=freeze(read(args.baselinePath)),model=freeze(read(args.modelPath)) as CbbOutcomeArtifact,cal=freeze(read(args.calibrationPath));
 const exposure=verifyCurrentCbbExposure(dataset,raw,baseline,fileHashes[args.inputPath],fileHashes[args.rawPath]),pinBefore=verifyCurrentCbbBaselinePin(baseline.baseline),rawBefore=objectHash(raw),inputBefore=objectHash(dataset);
 need(cal.binding&&cal.calibration.status==="converged"&&cal.fullModel.fileSha256===fileHashes[args.modelPath],"Actual bound V5 calibration required");
 const manifest=freeze(read(args.bundleManifestPath));need(same(manifest,CBB_CONTEXTUAL_OUTCOME_MANIFEST),"Runtime public/private manifests differ");
 const loaded=decodeCbbPrivateOutcomeArtifact(readFileSync(args.bundlePath),manifest);need(loaded.modelObjectSha256===objectHash(model)&&loaded.calibrationJSONSha256===fileHashes[args.calibrationPath],"Private bundle differs from exact model/calibration files");
 const runtime=createCbbContextualOutcomeRuntime({manifest,loaded,mode:"retrospective_development"});
 const counts={games:43,markets:0,promotions:0,demotions:0,tierPromotions:0,tierDemotions:0,sideChanges:0,directionFlips:0,mappedGames:0,before:{} as Record<string,number>,after:{} as Record<string,number>,byMarket:{} as Record<string,Obj>},errors:Obj[]=[];
 const decisions=(dataset.predictRows as Row[]).map(row=>{
  const beforeInput=objectHash(row.input),targetsBefore=objectHash(row.auditOnly.executableTargets),old=baseline.results.find((r:Obj)=>r.gameId===row.gameId);
  try{
   const stored=exposure.exposures.find(x=>x.row.gameId===row.gameId)!.storedSnapshot,independent=reconstructCurrentCbbIndependent(row,stored),independentBefore=objectHash(independent),fixtureIdentity={homeId:independent.homeId,awayId:independent.awayId};
   const released=runtime.evaluate({input:row.input as CbbContextualAssembledInput,independent,targets:row.auditOnly.executableTargets}),decoded=readCbbContextualOutcomeEvidence(released)!;
   const reordered=JSON.parse(JSON.stringify(canonical(released))),restored=readCbbContextualOutcomeEvidence(reordered)!;need(same(decoded,restored),"JSONB reordered codec roundtrip changed exact input/decision/independent");
   const decision=decoded.decision,board=buildCbbContextualOutcomeBoard({decision,independent}),law=createCbbContextualScoreLaw(decision.numericalTrace.finalLatentDistribution),summary=law.summary();
   need(same(board.score,released.score)&&same(board.rows,released.rows)&&same(board.gameForecast,released.gameForecast)&&same(decoded.input,row.input),"Authoritative runtime changed original input or copy-only board fields");
   need(same(board.score,decision.finalScore)&&board.gameForecast.homeId===independent.homeId&&board.gameForecast.awayId===independent.awayId&&board.gameForecast.selection===decision.gameOutcome.selection&&board.gameForecast.probability===decision.gameOutcome.probability&&same(board.marketContext.originalIndependent,independent)&&objectHash(independent)===independentBefore,"Board changed scores, fixture or original independent");
   for(const m of decision.marketDecisions){const mapped=board.rows.find(x=>x.market===m.market)!;for(const key of ["selection","probability","loseProbability","pushProbability","price","expectedValue","grade","reason","stake"] as const)need(mapped[key]===m[key],"Board reforecasted or regraded:"+key);need(same(mapped.target,m.target),"Board changed execution pair");}
   counts.mappedGames++;
   close(decision.finalScore.home-decision.finalScore.away,decision.finalScore.margin,1e-9,"Score margin identity");close(decision.finalScore.home+decision.finalScore.away,decision.finalScore.total,1e-9,"Score total identity");
   for(const [field,value]of [["home",summary.homeMean],["away",summary.awayMean],["margin",summary.marginMean],["total",summary.totalMean],["homeWinProbability",summary.homeWinProbability]]as const)close(decision.finalScore[field],value,1e-9,"Final score not from same conditioned law");
   const changes=decision.marketDecisions.map(m=>{
    const prior=old.markets.find((x:Obj)=>x.market===m.market),target=row.auditOnly.executableTargets.find(q=>q.market===m.market);need(target&&prior&&m.target&&same(prior.target,target)&&same(m.target,target),"Execution pair or receipt changed");
    counts.markets++;counts.before[prior.grade]=(counts.before[prior.grade]??0)+1;counts.after[m.grade]=(counts.after[m.grade]??0)+1;
    const promotion=actionable(m.grade)&&!actionable(prior.grade),demotion=!actionable(m.grade)&&actionable(prior.grade),tierPromotion=tier(m.grade)>tier(prior.grade),tierDemotion=tier(m.grade)<tier(prior.grade),sideChanged=m.selection!==prior.selection,directionFlip=sideChanged&&m.selection!==null&&prior.selection!==null;
    const by=counts.byMarket[m.market]??={markets:0,before:0,after:0,promotions:0,demotions:0,tierPromotions:0,tierDemotions:0,sideChanges:0,directionFlips:0};by.markets++;by.before+=Number(actionable(prior.grade));by.after+=Number(actionable(m.grade));
    for(const [key,value]of Object.entries({promotions:promotion,demotions:demotion,tierPromotions:tierPromotion,tierDemotions:tierDemotion,sideChanges:sideChanged,directionFlips:directionFlip})){(counts as Obj)[key]+=Number(value);by[key]+=Number(value);}
    if(m.grade!=="Held"){
     need(m.selection!==null&&m.probability!==null&&m.loseProbability!==null&&m.pushProbability!==null&&m.price!==null&&m.expectedValue!==null,"Complete economics missing");const p=law.probabilitiesFast(m.market,target.line),first=m.selection==="first";
     close(m.probability,first?p.first:p.second,1e-10,"Selected p not from same law");close(m.loseProbability,first?p.second:p.first,1e-10,"Loss p not from same law");close(m.pushProbability,p.push,1e-10,"Push not from same law");close(m.probability+m.loseProbability+m.pushProbability,1,1e-10,"Probability mass identity");
     need(m.price===(first?target.firstPrice:target.secondPrice),"Selected payout changed");close(m.expectedValue,m.probability*(m.price>0?m.price/100:100/-m.price)-m.loseProbability,1e-12,"Payout EV mismatch");
     const policy=decision.gradePolicy,error=p.omittedMassUpperBound+p.quadratureErrorEstimate+p.normalizerErrorEstimate+p.summationRoundoffUpperBound;
     const profit=m.price>0?m.price/100:100/-m.price,valueError=(profit+1)*error+8*Number.EPSILON*(Math.abs(m.probability*profit)+Math.abs(m.loseProbability)+1),positive=m.expectedValue>valueError;
     const best=positive&&m.probability-error>=policy.bestMinimumWinProbability&&m.price>=policy.bestMinimumAmericanPrice,grade=!positive?"Watchlist":best?"Best Angle":"Lean";need(m.grade===grade,"Published confidence/price tier inconsistent");
     close(m.gradingNumerics.valueErrorEstimate,valueError,1e-14,"Numerical value error differs");need(m.gradingNumerics.valueSignResolvedPositive===positive,"Numerical value sign differs");
     need(!m.positiveProfessionalValue||m.sourceEconomics.some(x=>x.reference.targetExpectedValue!==null&&x.reference.targetExpectedValue>0),"Attributed positive professional reference absent");need(!m.observedProfessionalBookPriceConfirmation||m.bookPriceActions.length>0,"Native action support absent");
    }else need(m.selection===null&&m.probability===null&&m.expectedValue===null&&m.stake===0,"Held receipt invented prediction/economics");
    return{market:m.market,before:{selection:prior.selection,grade:prior.grade,probability:prior.probability,pushProbability:prior.pushProbability,expectedValue:prior.expectedValue},promotion,demotion,tierPromotion,tierDemotion,sideChanged,directionFlip};
   });
   need(beforeInput===objectHash(row.input)&&targetsBefore===objectHash(row.auditOnly.executableTargets),"Input or target mutated");return{status:"audited",gameId:row.gameId,teams:row.auditOnly.teams,asOf:row.input.asOf,inputSha256:beforeInput,targetsSha256:targetsBefore,baselineScore:{home:old.forecast.homeScore,away:old.forecast.awayScore},changes,decision,mapping:{verified:true,runtimeRelease:released.modelRelease,privateCodecRoundtripExact:true,jsonbReorderedRoundtripExact:true,evidenceBytes:released.marketContext.contextualOutcomeSummary.evidenceBytes,fixtureIdentity,originalIndependentSha256:independentBefore,scoresAndAllMarketFieldsExact:true,board:{release:board.release,modelRelease:board.modelRelease,gradeRelease:board.gradeRelease,score:board.score,gameForecast:{homeId:board.gameForecast.homeId,awayId:board.gameForecast.awayId,selection:board.gameForecast.selection,probability:board.gameForecast.probability},rows:board.rows.map(r=>({market:r.market,selection:r.selection,probability:r.probability,loseProbability:r.loseProbability,pushProbability:r.pushProbability,grade:r.grade,price:r.price,expectedValue:r.expectedValue,informationalNonActionablePrice:r.informationalNonActionablePrice,recommendationConfidenceProbability:r.recommendationConfidenceProbability}))}}};
  }catch(error){const problem={status:"error",gameId:row.gameId,error:String(error)};errors.push(problem);return problem;}
 });
 need(objectHash(raw)===rawBefore&&objectHash(dataset)===inputBefore&&objectHash(exposure.exposures)===exposure.rawSlateSha256,"Slate or stored snapshots mutated");for(const p of paths)need(hash(readFileSync(p))===fileHashes[p],"Frozen file changed:"+p);for(const source of runtimeSources)need(hash(readFileSync(source.path))===source.sha256,"Consumer runtime changed during audit:"+source.path);const pinAfter=verifyCurrentCbbBaselinePin(baseline.baseline);need(same(pinBefore,pinAfter),"Baseline pin changed during audit");
 const report={schema:"cbb_current43_v5_released_runtime_codec_audit_v1",createdAt:new Date().toISOString(),authority:"offline_only",status:errors.length?"unresolved_errors":"completed_arithmetic_audit_only",livePublication:false,counts,errors,decisions,sourceFiles:fileHashes,runtimeSources,baselinePin:baseline.baseline,baselineProof:{...pinBefore,rawSlateBefore:exposure.rawSlateSha256,rawSlateAfter:objectHash(exposure.exposures),inputAndStoredSnapshotsUnchanged:true,allTargetsUnchanged:errors.length===0},excludedSourceSnapshots:raw.rows.filter((r:Obj)=>!dataset.predictRows.some((x:Row)=>x.gameId===r.payload.snapshot.gameId)).map((r:Obj)=>({gameId:r.payload.snapshot.gameId,snapshotKey:r.snapshot_key,disposition:"not_in_configured43_input;preserved_without_relabeling"})),elapsedMs:performance.now()-began,meaning:"Same immutable raw source exposure and exact execution pairs versus pinned actual R20 replay. Probability/EV/reserve checks prove internal consequences, not semantic correctness, accuracy, publication or stored-lock regrading. Raw-first market interpretation review is separate.",providerRequests:0,databaseQueries:0,databaseWrites:0};
 writeFileSync(out,JSON.stringify(report,null,2)+"\n",{flag:"wx",mode:0o600});return{out,status:report.status,counts,errors,elapsedMs:report.elapsedMs};
}
if(process.argv[1]&&import.meta.url===pathToFileURL(resolve(process.argv[1])).href){const arg=(k:string,f:string)=>process.argv.find(v=>v.startsWith(`--${k}=`))?.slice(k.length+3)??f;console.log(JSON.stringify(auditCbbCurrentOutcomeDecisions({inputPath:arg("input","/private/tmp/cbb-current-day-contextual-inputs-20261105-r37.json"),rawPath:arg("raw","/private/tmp/cbb-current-day-configured-db-raw-20261105-r37.json"),baselinePath:arg("baseline","/private/tmp/cbb-current-day-r20-controlled-replay-20261105.json"),modelPath:arg("model","/private/tmp/cbb-contextual-release-v5-development_build/full/artifact.json"),calibrationPath:arg("calibration","/private/tmp/cbb-contextual-release-v5-development_build/calibration.json"),bundleManifestPath:arg("bundle-manifest","/private/tmp/cbb-contextual-release-v5-development_build/private-bundle/manifest.json"),bundlePath:arg("bundle","/private/tmp/cbb-contextual-release-v5-development_build/private-bundle/8b4be6bbe5ea9616bcff002e6a851d3eb86f7da0b6b6e1a5f2166f6a4b816e84.json.gz"),outputPath:arg("out","/private/tmp/cbb-current-day-v5-final-runtime-decision-audit-20261105.json")}),null,2));}
