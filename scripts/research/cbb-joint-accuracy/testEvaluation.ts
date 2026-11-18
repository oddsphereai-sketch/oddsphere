import assert from "node:assert/strict";
import {joinFinals,summarize,type Game} from "./evaluate";
const game:Game={gameId:11,date:"2026-11-18",startsAt:"2026-11-18T20:00:00Z",fixture:{homeId:1,awayId:2},markets:{
  published:[{market:"spread",selection:"second",grade:"Watchlist",p:.52,lose:.48,push:0,price:-110,line:-3.5,result:null}],
  baseline:[{market:"spread",selection:"second",grade:"Watchlist",p:.52,lose:.48,push:0,price:-110,line:-3.5,result:null}],
  candidate:[{market:"spread",selection:"first",grade:"Lean",p:.57,lose:.43,push:0,price:-110,line:-3.5,result:null}]}};
// Populate all three markets with distinct exact settlements and prices.
for(const rows of Object.values(game.markets))rows.push(
  {...rows[0],market:"moneyline",line:null,price:150},
  {...rows[0],market:"total",line:150});
const before=structuredClone(game), final={gameId:11,homeId:1,awayId:2,homeScore:80,awayScore:70,status:"Final" as const,
  source:"independent_test_provider",sourceObservedAt:"2026-11-18T22:00:00Z",availableAt:"2026-11-18T22:01:00Z"};
const joined=joinFinals([game],[final],"2026-11-18T19:00:00Z");
assert.equal(joined.errors.length,0);assert.equal(joined.settled.length,1);assert.deepEqual(game,before);
assert.deepEqual(joined.settled[0].markets.candidate.map(p=>p.result),["win","win","push"]);
assert.deepEqual(joined.settled[0].markets.baseline.map(p=>p.result),["loss","loss","push"]);
const summary=summarize(joined.settled);
assert.equal(summary.spread.promotions.wins,1);assert.equal(summary.spread.netAction,1);
assert.equal(summary.moneyline.byMode.candidate.actionable.units,1.5);
assert.equal(summary.total.byMode.candidate.actionable.pushes,1);
assert.deepEqual(joinFinals([game],[],"2026-11-18T19:00:00Z").pending,[11]);
assert.equal(joinFinals([game],[{...final,homeId:2,awayId:1}],"2026-11-18T19:00:00Z").errors.length,1);
assert.equal(joinFinals([game],[final,final],"2026-11-18T19:00:00Z").errors.length,1);
assert.equal(joinFinals([game],[final],"2026-11-18T20:00:00Z").errors.length,1);
assert.equal(joinFinals([game],[{...final,homeScore:70}],"2026-11-18T19:00:00Z").errors.length,1);
console.log(JSON.stringify({status:"PASS",checks:14}));
