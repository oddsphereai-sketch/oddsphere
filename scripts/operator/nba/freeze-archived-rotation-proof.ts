import fs from "node:fs";
import path from "node:path";
import { gunzipSync } from "node:zlib";
import { createHash } from "node:crypto";
import { qualifyNbaArchivedRotation,type NbaArchivedRotationSnapshot } from "../../../lib/research/nba/nbaArchivedRotationLedger";
const sha=(b:Uint8Array)=>createHash("sha256").update(b).digest("hex");
async function main(){
 const [root,legacyRoot,ledgerPath,destination]=process.argv.slice(2);if(!root||!legacyRoot||!ledgerPath||!destination||fs.existsSync(destination))throw Error("usage: freeze-archived-rotation-proof ARCHIVE LEGACY_ARCHIVE LEDGER NEW_PROOF.json");
 const bytes=fs.readFileSync(ledgerPath), ledger=JSON.parse(gunzipSync(bytes).toString()) as {summary:{inputs:Record<string,string>;mutationProof:{cases:number;passed:boolean;sourceSha256:string}};rows:NbaArchivedRotationSnapshot[]};
 if(!ledger.summary.mutationProof?.passed||ledger.summary.mutationProof.cases<50)throw Error("missing_real_source_mutation_proof");
 const refs=new Set(ledger.rows.flatMap(r=>r.receipts.map(s=>s.sha256))), verified=new Set<string>();let rawDocuments=0;
 for(const dir of [path.join(root,"native"),path.join(root,"medical"),path.join(root,"medical-recovery-r2"),path.join(legacyRoot,"official")]){
  for(const file of fs.readdirSync(dir).filter(f=>f.endsWith(".receipt.json"))){const receipt=JSON.parse(fs.readFileSync(path.join(dir,file),"utf8"));if(!refs.has(receipt.sha256)||receipt.status!==200)continue;
   const stem=file.slice(0,-".receipt.json".length),json=path.join(dir,stem+".json.gz"),pdf=path.join(dir,stem+".pdf"),body=fs.existsSync(json)?gunzipSync(fs.readFileSync(json)):fs.readFileSync(pdf);
   if(sha(body)!==receipt.sha256)throw Error("raw_receipt_mismatch:"+file);verified.add(receipt.sha256);rawDocuments++;
  }
 }
 if([...refs].some(h=>!verified.has(h)))throw Error("unverified_referenced_raw_document");
 for(const [file,hash] of Object.entries(ledger.summary.inputs)){const p=file==="transactions-feed.json.gz"?path.join(legacyRoot,file):path.join(root,file);if(sha(fs.readFileSync(p))!==hash)throw Error("normalized_input_changed:"+file);}
 const suite=["scripts/test-nba-archived-rotation-ledger.ts","scripts/test-nba-original-player-impact.ts","scripts/test-nba-asof-native-names.ts","scripts/test-nba-historical-player-state-sources.ts","scripts/test-nba-point-in-time-features.ts","scripts/operator/nba/build-archived-rotation-ledger.ts"],suiteHashes=Object.fromEntries(suite.map(f=>[f,sha(fs.readFileSync(f))]));
 // A later formatting/type-only edit may change the current file hash; retain
 // the exact executed mutation operator hash separately, never substitute it.
 const q=qualifyNbaArchivedRotation(ledger.rows),proof={schemaHash:q.schemaHash,ledgerHash:q.ledgerHash,mutationSuiteSha256:sha(Buffer.from(JSON.stringify(suiteHashes))),receiptsVerified:true,ledgerFileSha256:sha(bytes),rawDocuments,referencedRawHashes:refs.size,realMutationProof:ledger.summary.mutationProof,suiteHashes,normalizedInputHashes:ledger.summary.inputs,createdAt:new Date().toISOString(),productionWrites:0,providerRequests:0};
 const final=qualifyNbaArchivedRotation(ledger.rows,proof);if(!final.mayFit)throw Error("archival_gate_closed:"+final.issues.join(","));
 fs.writeFileSync(destination,JSON.stringify({...proof,qualification:final},null,2),{flag:"wx",mode:0o600});console.log(JSON.stringify({qualification:final,rawDocuments,referencedRawHashes:refs.size,realMutationCases:ledger.summary.mutationProof.cases}));
}
main().catch(e=>{console.error(e);process.exitCode=1;});
