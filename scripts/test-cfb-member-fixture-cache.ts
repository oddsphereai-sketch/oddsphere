import assert from "node:assert/strict";
import { encodeCfbMemberFixtureCache, decodeCfbMemberFixtureCache } from "../lib/services/football/cfbMemberFixtureCache";
import type { CfbMemberFixture } from "../lib/services/football/cfbMemberFixture";

// A weekly reader exceeds the framework's 2 MB expanded-cache limit. Exercise
// the actual cache transport with all locked values and nested evidence intact.
const locked = {id:"cfb-locked",lockedAt:"2026-10-31T22:00:00Z",markets:{moneyline:{pick:"OKST",modelProb:.939,priceAmerican:-105,verdict:"lean",evidence:{provider:"betmgm",at:"2026-10-31T21:14:00Z"}}}};
const fixture = {snapshot:{games:Array.from({length:100},(_,i)=>({...locked,id:`cfb-${i}`,evidence:Array.from({length:250},(_,j)=>({source:"recorded sports-market quote",at:1793481240000+j,price:-105,line:-10,book:"betmgm"}))}))}} as unknown as CfbMemberFixture;
const before=JSON.stringify(fixture);
assert(Buffer.byteLength(before)>2*1024*1024);
const encoded=encodeCfbMemberFixtureCache(fixture);
assert(Buffer.byteLength(JSON.stringify(encoded))<2*1024*1024,"the value actually handed to Next fits the cache");
const decoded=decodeCfbMemberFixtureCache(encoded);
assert.equal(JSON.stringify(decoded),before,"every stored locked projection, probability, price, grade and evidence field retains exact JSON precedence");
assert.equal(JSON.stringify(fixture),before,"cache transport never mutates the writer-owned snapshot");
assert.equal(decodeCfbMemberFixtureCache(encodeCfbMemberFixtureCache(null)),null);
assert.throws(()=>decodeCfbMemberFixtureCache("corrupt"),"invalid cache transport must fall back to the authoritative snapshot, never reconstruct it");
console.log(`CFB fixture cache: ${Buffer.byteLength(before)} expanded bytes -> ${Buffer.byteLength(JSON.stringify(encoded))} cache bytes; exact locked snapshot roundtrip passed.`);
