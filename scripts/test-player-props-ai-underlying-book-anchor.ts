/** Independent-source metamorphic checks. Every input is synthetic; no I/O. */
import assert from 'node:assert/strict';
import {compileMarketReport} from '../lib/playerPropsAi/marketReport';
import {PRODUCT_RELEASE,type GamePacket,type Quote,type Json} from '../lib/playerPropsAi/evidenceContract';
import {digest} from '../lib/playerPropsAi/evidence';
globalThis.fetch=async()=>{throw Error('Anchor proof forbids network');};
const at='2026-11-10T16:00:00Z';
const pair=(provider:string,book:string,line:number,american=-110):Quote[]=>['over','under'].map(side=>({id:JSON.stringify([provider,book,line,side,american]),playerId:'p',market:'rebounds',provider,book,line,side:side as 'over'|'under',american,observedAt:at,receivedAt:at,receivedAtProvenance:'provider_response',opening:false,live:false}));
const base:GamePacket={release:PRODUCT_RELEASE,sport:'nba',gameId:'synthetic',start:'2026-11-11T00:30:00Z',lock:'2026-11-10T23:30:00Z',cutoff:at,stage:'early',players:[{id:'p',name:'Synthetic',team:'BOS',opponent:'NYK',markets:['rebounds'],missing:['Independent head absent'],evidence:[]}],sourceLimitations:[],quotes:[...pair('one','Book-A',4.5),...pair('one','book-b',8.5),...pair('one','book-c',8.5)]};
function report(packet:GamePacket){return compileMarketReport(packet).players[0].evidence.find(e=>e.id==='market-report:p:rebounds')!.value as {anchorLine:number;anchorSource:string;rawTraceDigest:string;rawTraceStates:number;books:Json[];limitations:string[]};}
const before=digest(base);assert.equal(report(base).anchorLine,8.5);
const duplicates={...base,quotes:[...base.quotes,...Array.from({length:30},(_,i)=>pair(`duplicate${i}`,i%2?'BOOK A':'book-a',4.5)).flat()]};
assert.equal(report(duplicates).anchorLine,8.5,'Repeated feeds and spelling aliases of the same book never become extra votes');
assert.equal(report({...duplicates,quotes:[...duplicates.quotes].reverse()}).anchorLine,8.5,'Source order cannot change the independent anchor');
assert.equal(report(duplicates).rawTraceStates,duplicates.quotes.length);assert.equal(report(duplicates).rawTraceDigest,digest(duplicates.quotes));
assert.equal(report(duplicates).books.length,33,'All provider/book source groups remain available for inspection');
assert.equal(report({...base,quotes:[...base.quotes,...pair('one','book-d',4.5),...pair('one','book-e',4.5)]}).anchorLine,4.5,'Genuinely new books can change the inferred reference');
const conflict:GamePacket={...base,quotes:[...pair('one','book-a',4.5),...pair('two','book-a',4.5,-105),...pair('one','book-b',8.5)]};
assert.equal(report(conflict).anchorLine,8.5,'Equal-clock conflicting feeds cannot establish the underlying-book vote');
assert.equal(report({...base,quotes:[...pair('one','book-a',4.5),...pair('one','book-a',4.5,-105),...pair('one','book-b',8.5)]}).anchorLine,8.5,'Equal-clock contradictory rows within one feed cannot be arbitrarily selected as a book vote');
const native=structuredClone(duplicates);native.players[0].evidence=[{id:'native',kind:'independent_model',source:'synthetic declared native event',availableAt:at,value:{market:'rebounds',line:7.5}}];
assert.equal(report(native).anchorLine,7.5);assert.equal(report(native).anchorSource,'timestamped_independent_model');
assert.equal(digest(base),before,'Source and any previously archived/locked input are never mutated');
console.log('Underlying-book anchor passed: duplicate-feed/alias/permutation invariance, independent-book sensitivity, exact conflict exclusion, native-event precedence, all raw source groups retained and immutable inputs. No HTTP.');
