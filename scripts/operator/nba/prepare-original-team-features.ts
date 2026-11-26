import fs from "node:fs";
import path from "node:path";
import { gunzipSync,gzipSync } from "node:zlib";
import { createHash } from "node:crypto";
import { verifyNbaOriginalTeamGame } from "../../../lib/research/nba/nbaOriginalTeamFeatures";
import { buildNbaOriginalT60Features } from "../../../lib/services/nba/nbaPointInTimeFeatures";
async function main(){
 const [root,destination]=process.argv.slice(2);if(!root||!destination||fs.existsSync(destination))throw Error("usage: prepare-original-team-features ARCHIVE NEW_OUTPUT.json.gz");
 const bytes=fs.readFileSync(path.join(root,"native-job-manifest.json")), manifest=JSON.parse(bytes.toString()) as {games:{id:string;season:number}[]};
 const inputs=[], failures:Record<string,number>={};
 for(const job of manifest.games){try{const stem=path.join(root,"native",job.id+"-boxscore");inputs.push(verifyNbaOriginalTeamGame({gameId:job.id,season:job.season,bytes:gunzipSync(fs.readFileSync(stem+".json.gz")),receipt:JSON.parse(fs.readFileSync(stem+".receipt.json","utf8"))}));}catch(e){const reason=e instanceof Error?e.message:String(e);failures[reason]=(failures[reason]??0)+1;}}
 const finalAvailableAt=new Map(inputs.map(g=>[g.game.gameId,g.sourceAvailableAt])), features=buildNbaOriginalT60Features({games:inputs.map(r=>r.game),boxes:inputs.flatMap(r=>r.boxes),finalAvailableAt});
 const result={createdAt:new Date().toISOString(),manifestSha256:createHash("sha256").update(bytes).digest("hex"),failures,originalGames:inputs.length,features,finals:inputs.map(r=>({gameId:r.game.gameId,sourceAvailableAt:r.sourceAvailableAt,receipt:r.receipt})),productionWrites:0,providerRequests:0,fittingPerformed:false};
 fs.writeFileSync(destination,gzipSync(JSON.stringify(result)),{flag:"wx",mode:0o600});console.log(JSON.stringify({originalGames:inputs.length,features:features.length,failures,productionWrites:0,fittingPerformed:false}));
}
main().catch(e=>{console.error(e);process.exitCode=1;});
