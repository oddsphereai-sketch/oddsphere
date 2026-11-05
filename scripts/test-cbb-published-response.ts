import assert from "node:assert/strict";
import fs from "node:fs";
import {gunzipSync} from "node:zlib";
import {cbbPublishedResponse} from "../lib/services/cbb/cbbPublishedResponse";
import type {DailyEdgeResponse} from "../app/lab/lib/labTypes";
async function main(){
 const record=JSON.parse(gunzipSync(fs.readFileSync(new URL("./fixtures/cbb-r19-member-20261105.json.gz",import.meta.url))).toString());
 const payload={sport:"cbb",date:"2026-11-05",games:Array.from({length:500},()=>structuredClone(record.memberGame))} as DailyEdgeResponse;
 const json=JSON.stringify(payload);assert.ok(Buffer.byteLength(json)>4_500_000);
 const headers={"Cache-Control":"private, max-age=30, stale-while-revalidate=300","X-Oddsphere-Response-Source":"fresh"};
 const compressed=cbbPublishedResponse(payload,headers,"br, gzip, deflate");
 assert.equal(compressed.headers.get("content-encoding"),"gzip");assert.equal(compressed.headers.get("cache-control"),headers["Cache-Control"]);
 assert.match(compressed.headers.get("vary")!,/Accept-Encoding/);
 const compressedBytes=Buffer.from(await compressed.arrayBuffer());assert.ok(compressedBytes.length<4_500_000);
 assert.equal(gunzipSync(compressedBytes).toString(),json,"every score, quote, history, receipt and legacy field survives byte-exact serialization");
 for(const accept of [null,"identity","gzip;q=0, br"]){
  const response=cbbPublishedResponse(payload,headers,accept);assert.equal(response.headers.get("content-encoding"),null);
  assert.equal(await response.text(),json,"identity streaming never drops evidence or cards");
 }
 console.log("PASS complete CBB transport: 500 actual-payload copies, gzip/identity negotiation, exact full evidence and private cache headers.");
}void main();
