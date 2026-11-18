/** Bounded frozen-file input only; no database or network client. */
import {readFileSync,writeFileSync} from "node:fs";
import {gunzipSync} from "node:zlib";
import {createHash} from "node:crypto";
import {decodeResearchSource} from "./source";
import {coordinates} from "./coordinates";

const manifestPath=process.argv[2], outputPath=process.argv[3], tracesPath=process.argv[4];
if (!manifestPath || !outputPath) throw Error("Usage: extract <frozen-manifest> <new-output> [independent-outcome-traces]");
const manifest=JSON.parse(readFileSync(manifestPath,"utf8"));
const traces=tracesPath ? JSON.parse(readFileSync(tracesPath,"utf8")).rows : [];
const rows=[], failures=[];
for (const entry of manifest.rows) {
  try {
    const bytes=readFileSync(entry.file);
    if (createHash("sha256").update(bytes).digest("hex")!==entry.sha256) throw Error("Source hash differs");
    const board=JSON.parse(gunzipSync(bytes).toString()).payload.snapshot.board;
    const decoded=decodeResearchSource(board);
    const c=coordinates(decoded.input), prior=traces.find((r: {id:number}) => r.id===entry.id);
    const date=new Intl.DateTimeFormat("en-CA",{timeZone:"America/New_York",year:"numeric",month:"2-digit",day:"2-digit"})
      .format(new Date(decoded.input.startsAt));
    rows.push({gameId:entry.id,asOf:decoded.input.asOf,startsAt:decoded.input.startsAt,date:prior?.date??date,
      actualHome:prior?.actual?.[0]??null,actualAway:prior?.actual?.[1]??null,
      sourceSha256:entry.sha256,sourceFile:entry.file,...c});
  } catch(error) {failures.push({gameId:entry.id,error:String(error)});}
}
writeFileSync(outputPath,JSON.stringify({at:new Date().toISOString(),manifestPath,
  manifestSha256:createHash("sha256").update(readFileSync(manifestPath)).digest("hex"),rows,failures}),{flag:"wx",mode:0o600});
console.log(JSON.stringify({games:rows.length,failures,features:rows[0]?{margin:rows[0].margin.names.length,total:rows[0].total.names.length}:null}));
if (failures.length) throw Error("Source failures retained; incomplete extraction cannot qualify");
