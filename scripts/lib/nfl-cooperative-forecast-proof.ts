import assert from 'node:assert/strict';
import {collectNflForecastRows} from '../../lib/services/football/nflCooperativeForecastRows';
import {propsAiTwoPhaseCompletionWindowMs} from '../../lib/playerPropsAi/completionWindow';

/** Real event-loop scheduling, virtual forecast CPU cost, no external calls. */
export async function proveNflCooperativeForecastRows() {
  const plans = [0, 1, 2, 3, 4, 5];
  const locked = {lockedAt:'2030-11-26T17:00:00Z',projection:4.5123,
    probability:.612345,price:-117,grade:'original',evidence:{opaque:null}};
  const original = JSON.stringify(locked);
  const build = (plan:number) => plan===2 ? [] : [{plan,locked,values:[.1,.2,.7]}];
  const expected=JSON.stringify(plans.flatMap(build));
  const actual=await collectNflForecastRows(plans,build);
  assert.equal(JSON.stringify(actual),expected,'Whole payloads, order, skips and duplicates remain exact');
  assert.equal(JSON.stringify(locked),original,'Never reinterpret a stored locked row');
  assert.deepEqual(await collectNflForecastRows([],build),[]);
  let calls=0;
  await assert.rejects(collectNflForecastRows(plans,plan=>{
    calls++;if(plan===3)throw Error('injected build failure');return build(plan);
  }),/injected build failure/);
  assert.equal(calls,4,'An unexpected build failure cannot publish a partial replacement');
  async function competingWork(cooperative:boolean) {
    let virtualMs=0,admitted=false;
    const events:string[]=[];
    // A queued callback represents an already launched count/receipt. The old
    // synchronous slate blocks it; a real event-loop turn lets it settle.
    const response=new Promise<void>(resolve=>setImmediate(()=>{
      events.push('existing-props-response');resolve();
    }));
    const props=response.then(()=>{
      admitted=480000-virtualMs>=propsAiTwoPhaseCompletionWindowMs(1);
      events.push(admitted?'complete-two-phase-window':'insufficient-window');
    });
    const forecast=(plan:number)=>{
      if(plan===0)setImmediate(()=>events.push('later-ready-props-response'));
      virtualMs+=60000;events.push('forecast-'+plan);return build(plan);
    };
    const rows=cooperative?await collectNflForecastRows(plans,forecast):plans.flatMap(forecast);
    await props;return{admitted,events,rows};
  }
  const blocked=await competingWork(false),yielded=await competingWork(true);
  assert.equal(blocked.admitted,false,'A synchronous slate can consume the existing two-phase reserve');
  assert.equal(yielded.admitted,true,'Existing props callbacks run between game calculations');
  assert(yielded.events.indexOf('existing-props-response')<yielded.events.indexOf('forecast-5'));
  assert(yielded.events.indexOf('later-ready-props-response')>yielded.events.indexOf('forecast-0'));
  assert(yielded.events.indexOf('later-ready-props-response')<yielded.events.indexOf('forecast-1'),'Yield between every game, not only at slate entry');
  assert.equal(JSON.stringify(blocked.rows),JSON.stringify(yielded.rows));
  assert.equal(JSON.stringify(locked),original);
  console.log('NFL cooperative forecasts passed: actual event-loop progress, unchanged whole ordered payloads/skips, strict two-phase reserve, failure atomicity and opaque legacy locks. Virtual CPU cost; no provider/model/storage calls or live latency guarantee.');
}
