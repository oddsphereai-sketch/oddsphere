import fs from "node:fs";
import path from "node:path";
import {gunzipSync,createGzip} from "node:zlib";
import {once} from "node:events";
import {createHash} from "node:crypto";
import {verifyNbaOriginalRoster,NBA_ORIGINAL_TWO_WAY_IMPACT_RELEASE,type verifyNbaOriginalTwoWayImpact} from "../../../lib/research/nba/nbaOriginalPlayerImpact";
import {qualifyNbaArchivedRotation,type NbaArchivedRotationSnapshot,type NbaArchivedRotationGame} from "../../../lib/research/nba/nbaArchivedRotationLedger";
import {buildNbaTwoWayRotation,qualifyNbaTwoWayRotation} from "../../../lib/research/nba/nbaTwoWayRotation";
const sha=(b:Uint8Array)=>createHash("sha256").update(b).digest("hex");
async function main(){
 const[root,basePath,baseProofPath,impactPath,destination]=process.argv.slice(2);if(!root||!basePath||!baseProofPath||!impactPath||!destination||fs.existsSync(destination)||fs.existsSync(destination+".proof.json"))throw Error("usage: build-two-way-rotation-ledger ARCHIVE BASE_LEDGER BASE_PROOF TWO_WAY_IMPACTS NEW_LEDGER.json.gz");
 const baseProof=JSON.parse(fs.readFileSync(baseProofPath,"utf8")),baseBytes=fs.readFileSync(basePath);if(sha(baseBytes)!==baseProof.ledgerFileSha256)throw Error("two_way_base_file_changed");
 const base=JSON.parse(gunzipSync(baseBytes).toString()) as {rows:NbaArchivedRotationSnapshot[]},baseQ=qualifyNbaArchivedRotation(base.rows,baseProof);if(!baseQ.mayFit)throw Error("two_way_base_gate_closed");
 const references=new Set(base.rows.flatMap(r=>r.receipts.map(p=>p.sha256))),summary=JSON.parse(fs.readFileSync(impactPath+".summary.json","utf8"));if(sha(fs.readFileSync(impactPath))!==summary.outputSha256)throw Error("two_way_metric_file_changed");
 const impacts=new Map<string,ReturnType<typeof verifyNbaOriginalTwoWayImpact>>();for(const line of gunzipSync(fs.readFileSync(impactPath)).toString().trim().split("\n")){const p=JSON.parse(line);if(p.players?.length){if(p.release!==NBA_ORIGINAL_TWO_WAY_IMPACT_RELEASE)throw Error("two_way_metric_release");impacts.set(p.gameId,p);}}
 const manifest=JSON.parse(fs.readFileSync(path.join(root,"native-job-manifest.json"),"utf8")) as {games:{id:string;season:number}[]};
 if(sha(fs.readFileSync(path.join(root,"native-job-manifest.json")))!==summary.manifestSha256)throw Error("two_way_manifest_changed");
 const games:NbaArchivedRotationGame[]=[];for(const job of manifest.games){try{const stem=path.join(root,"native",job.id+"-boxscore"),roster=verifyNbaOriginalRoster({gameId:job.id,bytes:gunzipSync(fs.readFileSync(stem+".json.gz")),receipt:JSON.parse(fs.readFileSync(stem+".receipt.json","utf8"))});games.push({...roster,season:job.season,impact:impacts.get(job.id)??null});}catch{}}
 const rows=[];let mutationCases=0;const reasons:Record<string,number>={};
 for(const b of base.rows){const row=buildNbaTwoWayRotation(b,games);for(const t of row.teams)if(t.reason)reasons[t.reason]=(reasons[t.reason]??0)+1;
  for(const t of row.teams)for(const p of t.profiles)for(const o of p.observed)if(o.sourceHashes.some(h=>!references.has(h)))throw Error("two_way_source_not_in_verified_original_corpus");
  if(rows.length%100===0){const source=games[0]!,poison=(g:NbaArchivedRotationGame)=>Object.defineProperties({...g},{teams:{get():never{throw Error("two_way_target_future_roster_read");}},impact:{get():never{throw Error("two_way_target_future_metric_read");}}});
   const target=poison({...source,gameId:b.target.gameId}),future=poison({...source,gameId:"0029900001",startAt:"2099-01-01T00:00:00Z",sourceAvailableAt:"2099-01-01T04:00:00Z"}),late=poison({...source,gameId:"0029900002",sourceAvailableAt:"2099-01-01T04:00:00Z"});
   if(buildNbaTwoWayRotation(b,[...games.filter(g=>g.gameId!==b.target.gameId),target,future,late]).hash!==row.hash)throw Error("two_way_real_mutation_changed_snapshot");mutationCases++;
  }
  rows.push(row);if(rows.length%500===0)console.log(JSON.stringify({completed:rows.length,complete:rows.filter(r=>r.status==="complete").length}));
 }
 const q=qualifyNbaTwoWayRotation(rows),suiteFiles=["lib/research/nba/nbaTwoWayRotation.ts","scripts/operator/nba/build-two-way-rotation-ledger.ts","scripts/test-nba-archived-rotation-ledger.ts","scripts/test-nba-original-player-impact.ts"],suiteHashes=Object.fromEntries(suiteFiles.map(f=>[f,sha(fs.readFileSync(f))]));
 const proof={ledgerHash:q.ledgerHash,schemaHash:q.schemaHash,baseLedgerHash:baseQ.ledgerHash,sourcesVerified:true,mutationCases,mutationSuiteSha256:sha(Buffer.from(JSON.stringify(suiteHashes))),suiteHashes,baseProofSha256:sha(fs.readFileSync(baseProofPath)),metricFileSha256:summary.outputSha256};
 const qualified=qualifyNbaTwoWayRotation(rows,proof);if(!qualified.mayFit)throw Error("two_way_gate_closed:"+qualified.issues.join(","));
 const report={createdAt:new Date().toISOString(),qualification:qualified,reasons,proof,rows,productionWrites:0,providerRequests:0,fittingPerformed:false};
 const gzip=createGzip(),file=fs.createWriteStream(destination,{flags:"wx",mode:0o600});gzip.pipe(file);
 if(!gzip.write(JSON.stringify({...report,rows:undefined,encoding:"nba_two_way_ledger_jsonl_r1"})+"\n"))await once(gzip,"drain");
 for(const row of rows)if(!gzip.write(JSON.stringify(row)+"\n"))await once(gzip,"drain");
 gzip.end();await once(file,"finish");
 fs.writeFileSync(destination+".proof.json",JSON.stringify({...proof,ledgerFileSha256:sha(fs.readFileSync(destination))},null,2),{flag:"wx",mode:0o600});console.log(JSON.stringify({...report,rows:undefined}));
}
main().catch(e=>{console.error(e);process.exitCode=1;});
