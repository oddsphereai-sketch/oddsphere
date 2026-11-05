import type {CbbGame} from "../lib/cbb/types";
import type {RawOwlsOddsEvent} from "../lib/providers/owls/owlsSharpBookOdds";
import assert from 'node:assert/strict';import fs from 'node:fs';import {gunzipSync} from 'node:zlib';
import {normalizeCbbTheOddsApiCurrent,fetchCbbTheOddsApiCurrent} from '../lib/services/cbb/cbbTheOddsApiCurrent';
import {mergeCbbCurrentSourceQuotes} from '../lib/cbb/currentSourceQuotes';
async function main(){
 const f=JSON.parse(gunzipSync(fs.readFileSync(new URL('./fixtures/cbb-source-admission-20261105.json.gz',import.meta.url))).toString()) as {capturedAt:string;games:CbbGame[];events:RawOwlsOddsEvent[]};
 const game=f.games[0],event=f.events.find((e)=>e.away_team==='Jax State'&&e.bookmakers?.some(b=>b.key==='pinnacle'||b.key==='draftkings'||b.key==='bovada'));assert.ok(event);
 // Contract-format test based on an actual captured fixture/quote. This is not
 // an actual The Odds API capture or evidence of additional live coverage.
 const source={...event,id:'contract-event',sport_key:'basketball_ncaab'};
 const result=normalizeCbbTheOddsApiCurrent([game],[source],f.capturedAt,f.capturedAt);assert.ok(result.quotes.length);
 assert.ok(result.quotes.every(q=>q.provider==='the_odds_api'&&q.providerEventId==='contract-event'&&q.firstPrice&&q.secondPrice));
 assert.equal(normalizeCbbTheOddsApiCurrent([game],[source,{...source,id:'duplicate'}],f.capturedAt,f.capturedAt).quotes.length,0);
 assert.equal(normalizeCbbTheOddsApiCurrent([game],[{...source,away_team:'Jackson State'}],f.capturedAt,f.capturedAt).quotes.length,0);
 assert.equal(normalizeCbbTheOddsApiCurrent([game],[{...source,commence_time:'2026-12-05T23:00:00Z'}],f.capturedAt,f.capturedAt).quotes.length,0);
 const q=result.quotes[0],duplicates=mergeCbbCurrentSourceQuotes([q,{...q,provider:'owls'}],game.id,f.capturedAt);
 assert.equal(duplicates.quotes.length,1);assert.equal(duplicates.duplicates,1);
 const owls={...q,provider:'owls' as const},bdl={...q,provider:'balldontlie' as const,firstPrice:q.firstPrice-10};
 const allThree=mergeCbbCurrentSourceQuotes([owls,bdl,q],game.id,f.capturedAt);
 assert.equal(allThree.quotes.length,0,"third transport cannot resurrect a conflicting native frontier");
 assert.equal(allThree.quarantined.length,1);
 const newer={...q,providerObservedAt:new Date(Date.parse(q.providerObservedAt)+1000).toISOString()};
 assert.deepEqual(mergeCbbCurrentSourceQuotes([owls,bdl,newer],game.id,f.capturedAt).quotes,[newer],"a genuinely later coherent native state can resolve an older conflict");
 assert.equal(mergeCbbCurrentSourceQuotes([q,{...q,firstPrice:q.firstPrice-10}],game.id,f.capturedAt).quotes.length,0);
 const stale={...q,providerObservedAt:new Date(Date.parse(q.providerObservedAt)-3600001).toISOString()};
 assert.deepEqual(mergeCbbCurrentSourceQuotes([stale,q],game.id,f.capturedAt).quotes,[q]);
 let calls=0;const fetcher=async(input:Parameters<typeof fetch>[0])=>{calls++;const u=new URL(String(input));if(u.pathname==='/v4/sports')return new Response('[]',{headers:{'x-requests-remaining':'10000'}});assert.equal(u.pathname,'/v4/sports/basketball_ncaab/odds');assert.equal(u.searchParams.get('markets'),'h2h,spreads,totals');return new Response(JSON.stringify([source]),{headers:{'x-requests-remaining':'9997','x-requests-last':'3'}});};
 const read=await fetchCbbTheOddsApiCurrent({apiKey:'dummy',games:[game],fetcher,now:()=>f.capturedAt});assert.equal(read.quotes.length,result.quotes.length);assert.equal(calls,2);assert.equal(read.creditsUsed,3);
 calls=0;const reserve=await fetchCbbTheOddsApiCurrent({apiKey:'dummy',games:[game],now:()=>f.capturedAt,fetcher:async()=>{calls++;return new Response('[]',{headers:{'x-requests-remaining':'1002'}});}});assert.equal(reserve.status,'credit_reserve');assert.equal(calls,1);assert.equal(reserve.paidRequests,0);
 console.log('PASS CBB coordinated provider contracts: exact fixture/clock/pairs, source origins, duplicates, conflicts, fresh native states, one-board/quota bounds; no network or writes.');
}void main();
