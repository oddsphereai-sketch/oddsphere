/** Synthetic navigation proof; no model, provider, database or token-count I/O. */
import assert from 'node:assert/strict';
import {nbaMarketNavigation,NBA_MARKET_NAVIGATION_MEANING,type NavigatedPrices} from '../lib/playerPropsAi/marketNavigation';
import {PRODUCT_RELEASE,type GamePacket,type Json,type Evidence} from '../lib/playerPropsAi/evidenceContract';
import {digest} from '../lib/playerPropsAi/evidence';
import {evidenceAliases,readableInput} from '../lib/playerPropsAi/input';
import {verifiedReaderSource,unpackReaderSource} from '../lib/playerPropsAi/sourceCodec';
import {sourceInput} from '../lib/playerPropsAi/request';
globalThis.fetch=async()=>{throw Error('Offline market-navigation proof forbids network');};
const at='2026-11-09T18:00:00.000Z',old='2026-11-09T14:00:00.000Z',future='2026-11-09T18:00:00.001Z';
const pair=(line:number,over:number,under:number,opening:Json):Record<string,Json>=>({line,over,under,opening,overObservedAt:old,underObservedAt:old,overReceivedAt:at,underReceivedAt:at,receivedAtProvenance:'provider_response',evidence:[`over:${line}`,`under:${line}`],fairOver:.50123456789});
const opening=pair(10.5,-107,101,true),earliest=pair(11.5,-110,-110,false),latest=pair(11.5,102,-123,false);
const book=(provider:string,latestPair:Json=latest):Json=>({book:'Same Sportsbook',provider,retainedStates:16,distinctLines:3,earliestObservedAt:old,latestObservedAt:old,latestReceivedAt:at,
  anchorEarliestRetainedPair:earliest,anchorLatestRetainedPair:latestPair,openingPairs:[opening,pair(12.5,-118,106,true)],representativeLadderPoints:[pair(9.5,-200,150,false),pair(13.5,150,-200,false)],nonMonotonePairs:0,oneSidedYes:[]});
const report:Evidence={id:'exact-report',kind:'market',availableAt:at,source:'synthetic exact report',value:{market:'points',anchorLine:11.5,anchorSource:'timestamped_independent_model',rawTraceStates:32,fullAnchorTraceStates:16,books:[book('A'),book('B')],limitations:['Original source limitation retained.']}};
const packet:GamePacket={release:PRODUCT_RELEASE,sport:'nba',gameId:'synthetic',start:'2026-11-09T23:00:00.000Z',lock:'2026-11-09T22:00:00.000Z',cutoff:at,stage:'early',quotes:[],sourceLimitations:[],players:[{id:'a',name:'Synthetic',team:'BOS',opponent:'NYK',markets:['points','rebounds'],missing:[],evidence:[report]},{id:'b',name:'Missing report',team:'NYK',opponent:'BOS',markets:['assists'],missing:[],evidence:[{id:'missing',kind:'availability',availableAt:at,source:'synthetic',value:{status:'unknown'}}]}]};
const before=digest(packet),nav=nbaMarketNavigation(packet),market=nav[0].markets[0],aliases=evidenceAliases(packet),source=packet.players[0].evidence.find(e=>e.id===aliases.get(market.source))!.value as Record<string,Json>;
assert.equal(nav.length,packet.players.length);assert.deepEqual(nav.map(p=>p.actor),['P0','P1']);assert.equal(market.market,'points');assert.equal(aliases.get(market.source),report.id);assert.deepEqual(nav[0].missingReportMarkets,['rebounds']);assert.deepEqual(nav[1].markets,[]);assert.deepEqual(nav[1].missingReportMarkets,['assists']);
const sourceBooks=source.books as Record<string,Json>[];assert.equal(market.books.length,sourceBooks.length);
for(const [i,row]of market.books.entries()){
  assert.equal(row.index,i);const original=sourceBooks[row.index];assert.equal(row.book,original.book);assert.equal(row.provider,original.provider);
  const originalPair=original.anchorLatestRetainedPair as Record<string,Json>;assert.deepEqual({line:(row as NavigatedPrices).line,over:(row as NavigatedPrices).over,under:(row as NavigatedPrices).under},{line:originalPair.line,over:originalPair.over,under:originalPair.under});
  assert.deepEqual(row.openings,(original.openingPairs as Record<string,Json>[]).map(p=>({line:p.line,over:p.over,under:p.under})));
}
assert.deepEqual(market.books.map(b=>[b.book,b.provider]),[['Same Sportsbook','A'],['Same Sportsbook','B']],'Duplicate book feeds retain both original rows and source indices; they are not merged or counted here');
assert.equal((market.books[0] as NavigatedPrices).over,102);assert.equal((market.books[0] as NavigatedPrices).under,-123);assert.equal(market.books[0].openings![0].line,10.5);assert.notEqual(market.books[0].openings![0].line,earliest.line,'Earliest retained is not silently substituted for an opening');
for(const prohibited of ['current','fresh','fairOver','probability','movement','mainLineMove','money','overReceivedAt'])assert(!JSON.stringify(nav).includes(`"${prohibited}"`));
assert(NBA_MARKET_NAVIGATION_MEANING.includes('Latest retained is not necessarily current or opening'));assert(NBA_MARKET_NAVIGATION_MEANING.includes('zero-based AI-facing bookRows record'));assert(NBA_MARKET_NAVIGATION_MEANING.includes('Same book across feeds is correlated'));
assert.equal(digest(packet),before);

const unusual=structuredClone(packet),value=unusual.players[0].evidence[0].value as Record<string,Json>,zero=pair(0,-100.125,100.5,null);zero.overObservedAt=future;delete zero.overReceivedAt;delete zero.underReceivedAt;zero.receivedAtProvenance='snapshot_availability';
value.books=[book('fraction/zero',zero),{book:'Absent pair',provider:'one-side',openingPairs:[],anchorLatestRetainedPair:null},{book:'Unknown',provider:'snapshot',anchorLatestRetainedPair:pair(.25,-101,100,false)}];
const ubefore=digest(unusual),un=nbaMarketNavigation(unusual)[0].markets[0];assert.equal(un.books.length,3);assert.deepEqual(un.books.map(b=>b.index),[0,1,2]);assert.deepEqual({line:(un.books[0] as NavigatedPrices).line,over:(un.books[0] as NavigatedPrices).over,under:(un.books[0] as NavigatedPrices).under},{line:0,over:-100.125,under:100.5});assert.deepEqual(un.books[1],{index:1,book:'Absent pair',provider:'one-side',pair:null});assert(!('openings'in un.books[2]));assert.equal((un.books[2] as NavigatedPrices).line,.25);assert.equal(digest(unusual),ubefore);
// A malformed or legacy string price is copied as source data, never coerced
// into a qualified integer-American execution quote by this usability view.
const stringPrice=structuredClone(packet);const stringValue=stringPrice.players[0].evidence[0].value as Record<string,Json>;const stringBooks=stringValue.books as Record<string,Json>[];(stringBooks[0].anchorLatestRetainedPair as Record<string,Json>).over='-00110';const stringBefore=digest(stringPrice);assert.equal((nbaMarketNavigation(stringPrice)[0].markets[0].books[0] as NavigatedPrices).over,'-00110');assert.equal(digest(stringPrice),stringBefore);
const boundSource=(value.books as Record<string,Json>[])[un.books[0].index].anchorLatestRetainedPair as Record<string,Json>;assert.equal(boundSource.overObservedAt,future);assert(!('overReceivedAt'in boundSource));assert.equal(boundSource.receivedAtProvenance,'snapshot_availability','Navigation never manufactures or refreshes the original clock/provenance');
// No requirement that the source latest pair have the anchor line: copy its
// declared line exactly and leave interpretation to the full bound source.
const changed=structuredClone(packet),cv=changed.players[0].evidence[0].value as Record<string,Json>;cv.books=[book('changed',pair(12.5,-120,110,false))];assert.equal((nbaMarketNavigation(changed)[0].markets[0].books[0] as NavigatedPrices).line,12.5);assert.equal(cv.anchorLine,11.5);
const duplicate=structuredClone(packet);duplicate.players[0].evidence.push({...structuredClone(report),id:'second-report'});const duplicateNav=nbaMarketNavigation(duplicate)[0].markets;assert.equal(duplicateNav.length,2);assert.notEqual(duplicateNav[0].source,duplicateNav[1].source);assert.equal(duplicateNav.reduce((n,r)=>n+r.books.length,0),4,'Duplicate report rows remain separately source-bound rather than overwritten');
const copied=nbaMarketNavigation(packet);copied[0].markets[0].books[0].openings![0].line=999;copied[0].markets[0].books.push({index:4,book:'copy',provider:'copy',pair:null});assert.equal(digest(packet),before);
const malformed=structuredClone(packet);(malformed.players[0].evidence[0].value as Record<string,Json>).books=[null];assert.throws(()=>nbaMarketNavigation(malformed),/cannot be omitted/,'Malformed source records are refused rather than silently dropped');
const full=readableInput(packet,{compactClocks:true,readerCoverage:true}),packed=verifiedReaderSource(full as unknown as Json),packedBefore=digest(packed);assert.deepEqual(unpackReaderSource(Object.assign({},packed,{namedMarketNavigation:nav})),full);assert.equal(digest(packed),packedBefore);assert.equal(digest(packet),before,'Full named source, alternate-line tables and chronology remain unchanged by optional navigation');
// Exercise the actual integrated request, not only a separately assembled source.
const integrated=JSON.parse(sourceInput(packet));
const decoded=unpackReaderSource(integrated) as {players:{id:string;evidence:Json[][]}[];schema:{bookRow:string;pair:string;receiptClock:string;time:string};receiptClocks:Json[][]};
assert.deepEqual(integrated.namedMarketNavigation.players,nav);assert.equal(integrated.namedMarketNavigation.meaning,NBA_MARKET_NAVIGATION_MEANING);
assert(decoded.schema.bookRow.includes('anchorLatestPair'));assert(decoded.schema.pair.includes('overReceiptId'));assert(decoded.schema.receiptClock.includes('receiptClocks[index]'));assert(decoded.schema.time.includes('0.1 minute'));
for(const [actorIndex,actor]of (integrated.namedMarketNavigation.players as typeof nav).entries()){
  const originalPlayer=decoded.players[actorIndex];assert.equal(originalPlayer.id,packet.players[actorIndex].id);
  for(const report of actor.markets){
    const evidence=originalPlayer.evidence.find(e=>e[0]===report.source);assert(evidence,'Alias must resolve in the same actor transmitted source');
    const value=evidence[4] as {bookRows:Json[][]};assert.equal(value.bookRows.length,report.books.length);
    for(const row of report.books){
      const original=value.bookRows[row.index];assert.equal(original[0],row.book);assert.equal(original[1],row.provider);
      const latestPair=(original[6]==='same_as_earliest'?original[5]:original[6]) as Json[]|null;
      if(latestPair){assert.deepEqual([(row as NavigatedPrices).line,(row as NavigatedPrices).over,(row as NavigatedPrices).under],latestPair.slice(0,3));
        for(const clockIndex of [5,6]){const clock:Json=decoded.receiptClocks[latestPair[clockIndex] as number];assert.deepEqual(clock,[0,'provider_response']);}
        assert.equal(latestPair[3],-240);assert.equal(latestPair[4],-240);assert.equal(latestPair[7],false,'Opening flags remain in the exact mapped source pair');
      }else assert('pair'in row&&row.pair===null);
      assert.deepEqual(row.openings??[],(original[11] as Json[][]).map(p=>({line:p[0],over:p[1],under:p[2]})));
    }
  }
}
const same=structuredClone(packet);const sameValue=same.players[0].evidence[0].value as Record<string,Json>;const sameBooks=sameValue.books as Record<string,Json>[];sameBooks[0].anchorLatestRetainedPair=structuredClone(earliest);
const sameInput=JSON.parse(sourceInput(same));const sameDecoded=unpackReaderSource(sameInput) as typeof decoded;const sameEvidence=sameDecoded.players[0].evidence.find(e=>e[0]===sameInput.namedMarketNavigation.players[0].markets[0].source)!;const sameRows=(sameEvidence[4] as {bookRows:Json[][]}).bookRows;
assert.equal(sameRows[0][6],'same_as_earliest');assert.deepEqual([sameInput.namedMarketNavigation.players[0].markets[0].books[0].line,sameInput.namedMarketNavigation.players[0].markets[0].books[0].over,sameInput.namedMarketNavigation.players[0].markets[0].books[0].under],(sameRows[0][5] as Json[]).slice(0,3));
assert.equal(digest(packet),before,'Integrated navigation never changes exact original archived packet fields');
for(const sport of ['nfl','mlb'] as const)assert.deepEqual(nbaMarketNavigation({...packet,sport}),[]);
console.log('NBA lean market navigation passed: every actor/report/book/feed row and original index, exact latest retained/opening prices, missing/zero/fraction preservation, no inferred freshness/mainline/money, exact source reference and decoder/immutability controls. No I/O or paid calls.');
