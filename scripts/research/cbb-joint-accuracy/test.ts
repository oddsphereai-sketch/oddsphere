import assert from "node:assert/strict";
import {fit,predict,type TrainingRow} from "./regression";
import type {Coordinates} from "./coordinates";

const rows: TrainingRow[]=Array.from({length:150},(_,i) => {
  const x=Math.sin(i*.73), z=Math.cos(i*1.17), noise=.4*Math.sin(i*2.4);
  return {gameId:i+1,axis:"margin",origin:0,names:["signal","other"],groups:["level","path"],
    values:[x,z],known:[true,true],target:4*x+noise};
});
const saved=structuredClone(rows), model=fit(rows);
assert.equal(model.status,"converged");
assert.ok(model.objective<model.initialObjective);
assert.deepEqual(rows,saved);
const test: Coordinates={...rows[0],gameId:900,origin:6,values:[.6,.2]};
const p=predict(model,test), mirrored=predict(model,{...test,origin:-6,values:[-.6,-.2]});
assert.ok(Math.abs(p.mean-8.4)<.12,"Recovers a known numerical effect");
assert.ok(Math.abs(p.mean+mirrored.mean)<1e-12,"Margin reflection");
assert.equal(p.sd,mirrored.sd);
assert.ok(p.locationVariance>0 && p.sd*p.sd>model.noiseVariance,"Posterior uncertainty retained");
assert.throws(() => predict(model,rows[0]),/own-game/);
assert.throws(() => predict(model,{...test,names:["wrong","other"]}),/binding/);
assert.throws(() => predict(model,{...test,known:[false,true]}),/missing/);
assert.throws(() => fit([...rows.slice(0,149),rows[0]]),/duplicate/);
assert.throws(() => fit(rows.slice(0,50)),/Insufficient/);
const totalRows: TrainingRow[]=rows.map(r => ({...r,axis:"total",origin:140,target:143+2*r.values[0]+.4*Math.sin(r.gameId*2.4),
  names:["constant","signal","other"],groups:["constant","level","path"],values:[1,...r.values],known:[true,true,true]}));
const total=fit(totalRows);
assert.equal(total.status,"converged");
const totalTest={...totalRows[0],gameId:901,values:[1,.6,.2]};
const q=predict(total,totalTest), translated=predict(total,{...totalTest,origin:160});
assert.ok(Math.abs(q.mean-144.2)<.15,"Learns residual Total intercept and effect");
assert.ok(Math.abs(translated.mean-q.mean-20)<1e-12,"Total coordinate translation");
assert.equal(q.sd,translated.sd);
console.log(JSON.stringify({status:"PASS",checks:14,marginIterations:model.iterations,totalIterations:total.iterations}));
