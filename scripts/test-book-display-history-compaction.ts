import assert from 'node:assert/strict';
import {BOOK_DISPLAY_HISTORY_RELEASE,BOOK_DISPLAY_COMPACTION_RELEASE,parseOwlsBookDisplayHistory,bookDisplayTrail,isBookDisplayFeed,
  accumulateCbbPublishedQuotes,type BookDisplayEntry} from '../lib/providers/owls/owlsBookDisplayHistory';
import {predictionMarketBookLineHistory} from '../app/lab/lib/predictionMarketDisplay';
import {publicMarketDisplayHistory} from '../app/lab/lib/publicMarketDisplayTrail';
import type {DailyEdgeGameDto} from '../app/lab/lib/labTypes';
import {performance} from 'node:perf_hooks';
const base=Date.parse('2026-11-02T00:00:00Z'),now=Date.parse('2026-11-03T13:14:46Z');
type Q=[number,number,number|null];
const target={event:10882593,start:'2026-11-04T00:00:00Z',away:'PFW',home:'DUQ',kind:'total',side:'under',book:'draftkings',providerEventId:'fixture'};
function parse(points:Q[],override:Partial<typeof target>={},at=now):BookDisplayEntry{
 const t={...target,...override},market=t.kind==='moneyline'?'h2h':t.kind==='spread'?'spreads':'totals';
 const history=points.map(([time,price,line])=>({timestampUtc:new Date(time).toISOString(),price,point:line}));
 const result=parseOwlsBookDisplayHistory({success:true,data:{eventId:t.providerEventId,book:t.book,market,side:t.side,timeRange:{mode:'opening'},history,openingLine:history[0]}},t,at,true);
 assert.ok(result);return result;
}
const raw:Q[]=Array.from({length:2000},(_,i)=>[base+i*60000,-110,i===1700?160:i<70&&i%2?150.5:150]);
const original=JSON.stringify(raw),entry=parse(raw);
assert.equal(entry.quotes.length,128);assert.equal(JSON.stringify(raw),original);
assert.deepEqual(entry.quotes[0],raw[0]);assert.deepEqual(entry.quotes.at(-1),raw.at(-1));
for(const i of [1699,1700,1701])assert.ok(entry.quotes.some(q=>q[0]===raw[i][0]),'late extreme and actual immediate buyback retained');
assert.equal(Math.max(...entry.quotes.map(q=>q[2]!)),160);
const rawSet=new Set(raw.map(q=>JSON.stringify(q)));assert.ok(entry.quotes.every(q=>rawSet.has(JSON.stringify(q))),'never invent quote/time/price/line');
const quarters=Array.from({length:4},(_,j)=>entry.quotes.filter(q=>q[0]>=base+j*500*60000&&q[0]<base+(j+1)*500*60000).length);
assert.ok(quarters.every(n=>n>=8),`balanced temporal coverage includes late quarters: ${quarters}`);
const trail=bookDisplayTrail(entry,150)!;assert.equal(Math.max(...predictionMarketBookLineHistory(trail).map(q=>q[2])),160,'retained late peak reaches the actual line-history reader');
assert.deepEqual(parse([...raw].reverse()).quotes,entry.quotes,'unique coherent observations do not depend on provider ordering');
assert.deepEqual(parse(entry.quotes).quotes,entry.quotes,'compacting a retained tape is idempotent');
// Reflection of own-side spread lines preserves exact selected source instants.
const reflected=parse(raw.map(([at,price,line])=>[at,price,-line!] as Q),{kind:'spread',side:'home'});
assert.deepEqual(reflected.quotes.map(q=>q[0]),entry.quotes.map(q=>q[0]));
assert.deepEqual(reflected.quotes.map(q=>q[2]),entry.quotes.map(q=>-q[2]!));
const priceRaw:Q[]=Array.from({length:2000},(_,i)=>[base+i*60000,i===1650?-250:i===1750?180:-110,null]);
const price=parse(priceRaw,{kind:'moneyline',side:'home'});
for(const i of [1649,1650,1651,1749,1750,1751])assert.ok(price.quotes.some(q=>q[0]===priceRaw[i][0]),'price extremes and immediate returns retained');
assert.equal(Math.min(...price.quotes.map(q=>q[1])),-250);assert.equal(Math.max(...price.quotes.map(q=>q[1])),180);
// All transitions fit: exact before/after evidence survives, including a
// nonextreme late price/line buyback. Unchanged receipts fill remaining slots.
const sparse:Q[]=Array.from({length:2000},(_,i)=>[base+i*60000,i>=1600&&i<1602?-115:-110,i>=1700&&i<1702?151:i>=1800&&i<1802?150.5:150]);
const sparseEntry=parse(sparse);for(const i of [1599,1600,1601,1602,1699,1700,1701,1702,1799,1800,1801,1802])assert.ok(sparseEntry.quotes.some(q=>q[0]===sparse[i][0]));
const short=raw.slice(0,100);assert.deepEqual(parse(short).quotes,short,'short actual histories do not change');
const one=parse([raw[0]]);assert.deepEqual(one.quotes,[raw[0]]);
const feed={release:BOOK_DISPLAY_HISTORY_RELEASE,sport:'cbb' as const,fetchedAt:new Date(now).toISOString(),eventsAt:new Date(now).toISOString(),events:[],rows:[entry]};
assert.equal(BOOK_DISPLAY_HISTORY_RELEASE,'owls_book_display_history_2026_10_29_r1');assert.ok(isBookDisplayFeed(feed,'cbb'));
assert.equal(BOOK_DISPLAY_COMPACTION_RELEASE,'book_display_compaction_2026_11_03_r2_balanced_extrema');
const retained=JSON.stringify(feed);assert.deepEqual(accumulateCbbPublishedQuotes(feed,[],null,now).rows,[entry]);assert.equal(JSON.stringify(feed),retained,'existing stored feed/quotes stay untouched');
// Parser's exact native event/book/side contract is unchanged.
const wrong=parseOwlsBookDisplayHistory({success:true,data:{eventId:'different',book:'draftkings',market:'totals',side:'under',timeRange:{mode:'opening'},history:[]}},target,now);
assert.equal(wrong,null);
// Sampling individual alternates must not erase the timestamp's ambiguity and
// invent a uniquely identified main-line point. Check the actual downstream
// reader as well as the retained raw groups: the separately retained opening
// quote must not resurrect a dropped ambiguous opening timestamp.
function noPartialAlternateGroup(points:Q[],result:BookDisplayEntry){
 const groups=new Map<number,Set<number|null>>();
 for(const [at,,line] of points){const group=groups.get(at)??new Set();group.add(line);groups.set(at,group);}
 const actual=bookDisplayTrail(result,150);
 assert.ok(actual,'fixture retains coherent exact-line observations');
 const plotted=predictionMarketBookLineHistory(actual);
 for(const [at,lines] of groups)if(lines.size>1){
  const retainedLines=new Set(result.quotes.filter(q=>q[0]===at).map(q=>q[2]));
  assert.ok(retainedLines.size===0||retainedLines.size===lines.size,`alternate timestamp ${at} must be retained whole or omitted, never sampled to one line`);
  assert.equal(plotted.some(q=>q[0]===at),false,`ambiguous timestamp ${at} cannot become one main-line point through compaction or opening metadata`);
 }
}
const alternates:Q[]=Array.from({length:2000},(_,i)=>[base+i*60000,i%2?-105:-115,150+(i%7)/2]);
alternates.splice(1093,0,[alternates[1093][0],-110,151]);
noPartialAlternateGroup(alternates,parse(alternates));
const coherent:Q[]=Array.from({length:2000},(_,i)=>[base+i*60000,-110,150]);
const hugeGroup=[...coherent];hugeGroup.splice(500,0,...Array.from({length:160},(_,i)=>[coherent[500][0],-110,100+i/2] as Q));
const hugeEntry=parse(hugeGroup);noPartialAlternateGroup(hugeGroup,hugeEntry);assert.ok(hugeEntry.quotes.length<=128,'a >128 alternate group cannot expand the quote budget');
const hugeOpen=[coherent[0],...Array.from({length:160},(_,i)=>[base,-110,100+i/2] as Q),...coherent.slice(1)];
noPartialAlternateGroup(hugeOpen,parse(hugeOpen));
const ambiguousOpen=[coherent[0],[coherent[0][0],-105,150.5] as Q,...coherent.slice(1)];
const openEntry=parse(ambiguousOpen);noPartialAlternateGroup(ambiguousOpen,openEntry);
const ambiguousEnd=[...coherent,[coherent.at(-1)![0],-105,150.5] as Q];
noPartialAlternateGroup(ambiguousEnd,parse(ambiguousEnd));
// A later board receipt must not resurrect an ambiguous native timestamp that
// had to be omitted from the 128-point provider tape.
const interiorAt=coherent[1000][0],interiorRaw=[...coherent];interiorRaw.splice(1000,0,[interiorAt,-105,151]);
const interiorEntry=parse(interiorRaw),interiorFeed={...feed,rows:[interiorEntry]};
assert.ok(interiorEntry.ambiguousTimes?.includes(interiorAt));
const boardGame={sport:'cbb',external_id:target.event,gameStartAt:target.start,awayTeam:target.away,homeTeam:target.home,lockState:'open',lockedAt:null,
  markets:{moneyline:{pick:null,oddsTrail:[]},total:{pick:'Under',line:150,oddsTrail:[{sportsbook:target.book,observedAt:new Date(interiorAt).toISOString(),american:-110,line:150}]},first_inning:{pick:null,oddsTrail:[]}}};
const merged=accumulateCbbPublishedQuotes(interiorFeed,[boardGame as unknown as DailyEdgeGameDto],null,now).rows[0];
assert.ok(merged.quotes.some(q=>q[0]===interiorAt),'later published quote exercises ambiguity-preserving merge');
assert.equal(predictionMarketBookLineHistory(bookDisplayTrail(merged,150)!).some(q=>q[0]===interiorAt),false,'published receipt cannot resurrect dropped ambiguous native line');
const storedBook={sportsbook:target.book,line:150,locked:false,points:[[interiorAt,.5238,-110],[coherent.at(-1)![0],.5238,-110]] as Array<[number,number,number]>,marketHistory:[[interiorAt,-110,150],[coherent.at(-1)![0],-110,150]] as Q[]};
const publicMerged=publicMarketDisplayHistory(storedBook,bookDisplayTrail(merged,150)!);
assert.ok(publicMerged?.ambiguousLineTimes?.includes(interiorAt));
assert.equal(predictionMarketBookLineHistory(publicMerged!).some(q=>q[0]===interiorAt),false,'public tracker merge retains native ambiguity');
const storedLock={...storedBook,locked:true};assert.strictEqual(publicMarketDisplayHistory(storedLock,bookDisplayTrail(merged,150)!),storedLock,'locked public tracker remains exactly stored');
// The provider can report an openingLine that differs from the history's
// sole quote at that instant. Include openingLine in the ambiguity test.
const separateHistory=coherent.map(([time,price,line],i)=>({timestampUtc:new Date(time).toISOString(),price,point:i===0?150.5:line}));
const separateOpening=parseOwlsBookDisplayHistory({success:true,data:{eventId:target.providerEventId,book:target.book,market:'totals',side:'under',timeRange:{mode:'opening'},history:separateHistory,openingLine:{timestampUtc:new Date(base).toISOString(),price:-110,point:150}}},target,now,true);
assert.ok(separateOpening?.ambiguousOpening);
assert.equal(predictionMarketBookLineHistory(bookDisplayTrail(separateOpening,150)??bookDisplayTrail(separateOpening,150.5)!).some(q=>q[0]===base),false,'separate contradictory openingLine never becomes a main-line graph point');
const shortAlternates=ambiguousOpen.slice(0,100),shortEntry=parse(shortAlternates);
assert.deepEqual(shortEntry.quotes,shortAlternates,'legacy short histories retain their existing complete timestamp groups');
noPartialAlternateGroup(shortAlternates,shortEntry);
const maximum:Q[]=Array.from({length:20000},(_,i)=>[base+i*60000,i%2?-105:-115,150+(i%7)/2]);
const performanceStart=performance.now(),maximumEntry=parse(maximum,{},base+20001*60000),elapsed=performance.now()-performanceStart;
assert.equal(maximumEntry.quotes.length,128);
const tooMany=maximum.concat([maximum[0]]).map(([at,price,line])=>({timestampUtc:new Date(at).toISOString(),price,point:line}));
assert.equal(parseOwlsBookDisplayHistory({success:true,data:{eventId:target.providerEventId,book:target.book,market:'totals',side:'under',timeRange:{mode:'opening'},history:tooMany}},target,base+20001*60000),null,'native >20k cap remains unchanged');
console.log(`PASS book compaction: 2000→128, late extrema/returns, balanced quarters ${quarters}, actual values only, alternate timestamp integrity including opening/endpoints/>128 groups, 20k→128 in ${elapsed.toFixed(1)}ms, exact contract and r1 schema preserved. More than128 turns remain a sampled history.`);
