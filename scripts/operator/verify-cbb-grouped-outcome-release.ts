/** Exact pinned local artifact and frozen native-source integration. No IO to providers/DB. */
import assert from "node:assert/strict";
import {readFileSync,writeFileSync} from "node:fs";
import {gunzipSync} from "node:zlib";
import {decodeCbbPrivateOutcomeArtifact} from "../../lib/services/cbb/cbbOutcomeArtifactEnvelope";
import {CBB_CONTEXTUAL_OUTCOME_MANIFEST,createCbbContextualOutcomeRuntime,readCbbContextualOutcomeEvidence} from "../../lib/services/cbb/cbbContextualOutcomeRuntime";
import {decodeResearchSource} from "../research/cbb-joint-accuracy/source";
import type {CbbContextualAssembledInput} from "../../lib/services/cbb/cbbContextualReaderInput";
const [directory,manifestPath,trialPath,output]=process.argv.slice(2);
if(!directory||!manifestPath||!trialPath||!output)throw Error("Usage: verify-cbb-grouped-outcome-release <package> <frozen-source-manifest> <frozen-trial> <new-report>");
const m=CBB_CONTEXTUAL_OUTCOME_MANIFEST,loaded=decodeCbbPrivateOutcomeArtifact(readFileSync(directory+"/"+m.compressedSha256+".json.gz"),m);
const runtime=createCbbContextualOutcomeRuntime({manifest:m,loaded,mode:"retrospective_development"});
const manifest=JSON.parse(readFileSync(manifestPath,"utf8")),trial=JSON.parse(readFileSync(trialPath,"utf8"));
const rows=[],counts:Record<string,Record<string,number>>={},differences=[];
for(const [j,entry]of manifest.rows.entries()){
  const original=JSON.parse(gunzipSync(readFileSync(entry.file)).toString()).payload.snapshot.board;
  const source=decodeResearchSource(original),frozen=trial.rows.find((r:{gameId:number})=>r.gameId===entry.id);
  assert(frozen);const independent=original.marketContext.originalIndependent;
  const assembled=source.input as CbbContextualAssembledInput;
  assert.equal(assembled.sourceStateEvidence.gameId,entry.id);
  const board=runtime.evaluate({input:assembled,independent,targets:source.decision.marketDecisions.flatMap(r=>r.target?[r.target]:[])});
  const decoded=readCbbContextualOutcomeEvidence(board);assert(decoded);
  for(const key of ["home","away","margin","total","homeWinProbability"]as const)
    assert.ok(Math.abs(board.score[key]-frozen.scores.candidate[key])<1e-10,`Frozen candidate score changed: ${entry.id}.${key}`);
  for(const r of board.rows){
    const before=frozen.markets.candidate.find((x:{market:string})=>x.market===r.market);
    for(const [a,b]of [["probability","p"],["loseProbability","lose"],["pushProbability","push"]]as const)
      if(r[a]!==null&&before[b]!==null)assert.ok(Math.abs(r[a]!-before[b])<1e-10,`Frozen probability changed: ${entry.id}.${r.market}`);
    if(r.grade!==before.grade||r.selection!==before.selection||r.price!==before.price)
      differences.push({gameId:entry.id,market:r.market,oldGrade:before.grade,newGrade:r.grade,oldPrice:before.price,newPrice:r.price});
    (counts[r.market]??={})[r.grade]=((counts[r.market]??={})[r.grade]??0)+1;
  }
  rows.push({gameId:entry.id,model:board.modelRelease,gradeRelease:board.gradeRelease,score:board.score});
  if((j+1)%10===0)console.log(JSON.stringify({processed:j+1,total:manifest.rows.length}));
}
const report={at:new Date().toISOString(),status:"PASS",scope:"same frozen sources before artifact availability; retrospective integration only",games:rows.length,
  artifactObjectSha256:m.modelObjectSha256,counts,executionOrGradeDifferences:differences,rows,paidCalls:0,dbWrites:0};
writeFileSync(output,JSON.stringify(report,null,2),{flag:"wx",mode:0o600});console.log(JSON.stringify({...report,rows:undefined}));
