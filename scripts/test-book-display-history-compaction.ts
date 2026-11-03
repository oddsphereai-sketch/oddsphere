import assert from 'node:assert/strict';
import {BOOK_DISPLAY_HISTORY_RELEASE,BOOK_DISPLAY_COMPACTION_RELEASE,parseOwlsBookDisplayHistory,bookDisplayTrail,isBookDisplayFeed,
  accumulateCbbPublishedQuotes,type BookDisplayEntry} from '../lib/providers/owls/owlsBookDisplayHistory';
import {predictionMarketBookLineHistory} from '../app/lab/lib/predictionMarketDisplay';
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
console.log(`PASS book compaction: 2000→128, late extrema/returns, balanced quarters ${quarters}, original values only, mirror/order/idempotence, exact book contract and r1 schema preserved. More than128 turns remain a sampled history.`);
