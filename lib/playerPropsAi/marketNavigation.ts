/** NBA-only named price navigation; exact chronology remains in the original source. */
import type {GamePacket,Json} from './evidenceContract';
import {evidenceAliases} from './input';
import {invariant} from './evidence';

const object=(value:Json|undefined):Record<string,Json>|null=>value!==null&&typeof value==='object'&&!Array.isArray(value)?value:null;
const exact=(value:Record<string,Json>,key:string):Json=>structuredClone(value[key]??null);
export const NBA_MARKET_NAVIGATION_MEANING='Copied price navigation only. source is the exact evidence alias; index is its zero-based AI-facing bookRows record (schema.bookRow). Each book row line/over/under copies anchorLatestRetainedPair; pair:null means absent. openings copies source openingPairs; omitted means none supplied. These are American prices, not probabilities. Latest retained is not necessarily current or opening. Resolve source codecs, schema.pair, receiptClocks and schema.time for retained observed/receive clock offsets, resolution, provenance and opening flags. Consult the full supplied source for freshness, event qualification, alternate lines and chronology. Same book across feeds is correlated; no main-line move, money or informed-bettor identity is inferred.';
export type NavigatedPrices={line:Json;over:Json;under:Json};
export type NavigatedBook={index:number;book:Json;provider:Json;openings?:NavigatedPrices[]}&(NavigatedPrices|{pair:null});
export type MarketNavigation={actor:string;markets:{market:Json;source:string;books:NavigatedBook[]}[];missingReportMarkets?:string[]};
function prices(value:Json|undefined):NavigatedPrices|null{
  if(value===null||value===undefined)return null;
  const row=object(value);invariant(row,'Malformed compiled market pair cannot become navigation');
  return{line:exact(row,'line'),over:exact(row,'over'),under:exact(row,'under')};
}
/** Every compiled actor/report/book row stays in source order. No quote pairing,
 * feed merging, price rounding, source-clock refresh, or probability inference. */
export function nbaMarketNavigation(packet:GamePacket):MarketNavigation[]{
  if(packet.sport!=='nba')return [];
  const aliases=new Map([...evidenceAliases(packet)].map(([alias,id])=>[id,alias]));
  return packet.players.map((player,index)=>{
    const markets=player.evidence.flatMap(e=>{
      const value=e.kind==='market'?object(e.value):null;if(!value||!Array.isArray(value.books))return [];
      const source=aliases.get(e.id);invariant(source,'Market navigation requires an original evidence alias');
      const books=value.books.map((raw,bookIndex)=>{
        const b=object(raw);invariant(b,'Malformed compiled book cannot be omitted from navigation');
        invariant(b.openingPairs===undefined||Array.isArray(b.openingPairs),'Malformed compiled openings cannot be omitted from navigation');
        const openings=(b.openingPairs as Json[]|undefined)?.map(p=>{const copied=prices(p);invariant(copied,'Null compiled opening cannot be omitted from navigation');return copied;})??[];
        return{index:bookIndex,book:exact(b,'book'),provider:exact(b,'provider'),...(prices(b.anchorLatestRetainedPair)??{pair:null}),...(openings.length?{openings}:{})};
      });
      return[{market:exact(value,'market'),source,books}];
    });
    const missing=player.markets.filter(m=>!markets.some(report=>report.market===m));
    return{actor:`P${index}`,markets,...(missing.length?{missingReportMarkets:missing}:{})};
  });
}
