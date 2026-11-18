/** Verify a numerical supplement without selecting by later outcomes. */
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
const [originalPath,supplementPath]=process.argv.slice(2);
if(!originalPath||!supplementPath)throw Error("Usage: verifySupplement <original-replay> <supplement-replay>");
const original=JSON.parse(readFileSync(originalPath,"utf8")),next=JSON.parse(readFileSync(supplementPath,"utf8"));
assert.equal(next.modelSha256,original.modelSha256,"No refit or artifact substitution");
assert.equal(next.dataSha256,original.dataSha256,"No source substitution");
assert.equal(next.mode,original.mode);assert.equal(next.expectedGames,original.expectedGames);
assert.equal(next.rows.length,next.expectedGames);assert.equal(next.failures.length,0);
for(const row of original.rows) {
  const found=next.rows.find((r:{gameId:number})=>r.gameId===row.gameId);
  assert.ok(found,"Previously successful game remains in the census");
  for(const key of ["scores","latent","sourceSha256","fixture","workingPredictions","markets"])
    assert.deepEqual(found[key],row[key],`Numerical supplement changed ${key} for ${row.gameId}`);
}
for(const failure of original.failures)assert.ok(next.rows.some((r:{gameId:number})=>r.gameId===failure.gameId),"Original failure is evaluated");
if(next.mode==="prospective")for(const row of next.rows) {
  assert.ok(Date.parse(next.at)<Date.parse(row.startsAt),"Supplement frozen before start");
  assert.ok(!("actualHome" in row)&&!("actualAway" in row),"No prospective outcomes");
  for(const picks of Object.values(row.markets) as {result:unknown}[][])assert.ok(picks.every(p=>p.result===null));
}
console.log(JSON.stringify({status:"PASS",mode:next.mode,previousSuccessful:original.rows.length,
  restoredFailures:original.failures.length,games:next.rows.length,forecastOrGradeDifferences:0}));
