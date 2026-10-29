import type {PredictionMarketBookTrail} from "./predictionMarketDisplay";

type Pin={book:string;change?:{from:string;at:number}};
type PinStorage={getItem(key:string):string|null;setItem(key:string,value:string):void};
const storageKey="oddsphere_prediction_chart_sources_v1";
/** A line change must not choose a different book. Identity still includes the
 * exact event/start, market and selected side; opposing sides never share pins. */
export function predictionMarketSourceKey(request:string):string {
 const q=new URL(request,"https://oddsphere.invalid").searchParams;
 return JSON.stringify(["sport","event","away","home","start","market","side"].map(k=>k==="start"?Date.parse(q.get(k)??""):q.get(k)));
}
/** Display preference only. No quotes, credentials or locked records are stored.
 * Session storage preserves a source through reader navigation and reloads. */
export class PredictionMarketSourcePins {
 private pins=new Map<string,Pin>();
 private loaded=false;
 constructor(private storage?:()=>PinStorage|undefined){}
 private read(){
  if(this.loaded)return;this.loaded=true;
  try{const raw=JSON.parse(this.storage?.()?.getItem(storageKey)??"[]");
   if(Array.isArray(raw))for(const pair of raw.slice(-100))if(Array.isArray(pair)&&typeof pair[0]==="string"&&pair[0].length<500&&pair[1]&&typeof pair[1].book==="string"&&/^[a-z0-9_ -]{1,40}$/.test(pair[1].book)){
    const p=pair[1],c=p.change;this.pins.set(pair[0],{book:p.book,...(c&&typeof c.from==="string"&&Number.isFinite(c.at)?{change:{from:c.from,at:c.at}}:{})});
   }
  }catch{/* Storage is optional, including private browsing. */}
 }
 request(key:string):string {
  this.read();const pin=this.pins.get(predictionMarketSourceKey(key));if(!pin)return key;
  const q=new URLSearchParams(key.split("?")[1]);q.set("book",pin.book);return key.split("?")[0]+"?"+q;
 }
 accept(key:string,book:PredictionMarketBookTrail|null,at:number):PredictionMarketBookTrail|null {
  if(!book||book.locked)return book;
  this.read();const identity=predictionMarketSourceKey(key),previous=this.pins.get(identity);
  const change=previous&&previous.book!==book.sportsbook?{from:previous.book,at}:previous?.change;
  this.pins.set(identity,{book:book.sportsbook,...(change?{change}:{})});
  if(this.pins.size>100)this.pins.delete(this.pins.keys().next().value!);
  try{this.storage?.()?.setItem(storageKey,JSON.stringify([...this.pins]));}catch{/* In-memory continuity still works. */}
  return change?{...book,sourceChange:change}:book;
 }
}
