import assert from "node:assert/strict";
import {packReaderSource,unpackReaderSource,verifiedReaderSource} from "../lib/playerPropsAi/sourceCodec";
import {digest} from "../lib/playerPropsAi/evidence";
import type {Json} from "../lib/playerPropsAi/evidenceContract";
const repeated="A source availability timestamp does not establish a fresh provider confirmation.";
const data:Json={format:"test",sharedContext:{a:{sampleSize:5,sourceLabel:repeated,statName:"points",rawValue:2.123456},collision:{$s:1},second:{$r:[1,2]},list:[{longFieldNameOne:1,longFieldNameTwo:2,longFieldNameThree:repeated}]},
  historicalGames:[{gameId:"a",scheduledStart:"2026-11-06T23:00:00.000Z",homeTeam:"A",awayTeam:"B"}],
  players:[{id:"p",markets:["points","rebounds"],evidence:[["e0","market",-100,0,{book:"test",line:10.123456789,americanPrice:-110,explanation:repeated}]],readerAreas:{market:{status:"partial",facts:[{id:"f0",label:"price",value:{market:"points",sourceMeaning:repeated}}]}}}],quoteTraces:[[0,0,0,10.123456789,"over",false,[[0,0,0,-110,1]]]]};
const before=digest(data),packed=verifiedReaderSource(data);
assert.deepEqual(unpackReaderSource(packed),data);assert.equal(digest(data),before);
assert.ok(packed.strings.includes(repeated));assert.ok(packed.recordSchemas.length>0);
const corrupt=structuredClone(packed);(corrupt.document as Record<string,Json>).sharedContext={$r:[0]};
assert.throws(()=>unpackReaderSource(corrupt),/width/);
const bad=packReaderSource(data);(bad.document as Record<string,Json>).sharedContext={$s:99999};
assert.throws(()=>unpackReaderSource(bad),/string reference/);
const cyclic=packReaderSource(data);cyclic.arrays=[{$a:0}];(cyclic.document as Record<string,Json>).sharedContext={$a:0};
assert.throws(()=>unpackReaderSource(cyclic),/cyclic source array/);
const repeatedArrays=structuredClone(data) as Record<string,Json>;
repeatedArrays.sharedContext={a:[repeated,1,2],b:[repeated,1,2],c:[repeated,1,2],literalTag:{$a:0}};
const packedArrays=verifiedReaderSource(repeatedArrays);assert.ok(packedArrays.arrays!.length>0);
assert.deepEqual(unpackReaderSource(packedArrays),repeatedArrays);
console.log("Reader source codec: lossless stats, all markets, precise prices/clocks, reserved-key escaping and corrupt-reference rejection passed.");
