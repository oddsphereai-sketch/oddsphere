import type { DailyEdgeGameDto, MarketEdgeDto } from "./labTypes";
import type { PredictionMarketPoint, PredictionMarketRow } from "@/lib/providers/owls/owlsPredictionMarkets";

/** Actual receipt timestamp, odds-implied percentage, original American price. */
export type PredictionMarketBookTrail = {sportsbook:string;points:Array<[number,number,number]>;locked:boolean;line?:number|null;label?:string;historyScope?:"provider_history"|"prelock_archive"|"observed_quotes";opening?:{point:[number,number,number];line:number|null};marketHistory?:Array<[number,number,number|null]>;sourceChange?:{from:string;at:number}};

/** Full same-book point-line history is independent of the Kalshi overlap.
 * Conflicting thresholds at one timestamp may be alternates, not a main-line
 * move: omit that ambiguous instant rather than picking an arbitrary number. */
export function predictionMarketBookLineHistory(book:PredictionMarketBookTrail,ceiling=Infinity):Array<[number,number,number]>{
 if(ceiling!==Infinity&&!Number.isFinite(ceiling))return [];
 const quotes:Array<[number,number,number|null]>=[...(book.marketHistory??[])];
 if(book.opening)quotes.push([book.opening.point[0],book.opening.point[2],book.opening.line]);
 const latest=book.points.at(-1);if(latest&&book.line!==undefined)quotes.push([latest[0],latest[2],book.line]);
 const groups=new Map<number,Map<number,[number,number,number]>>();
 for(const [at,price,line] of quotes){
  if(!Number.isFinite(at)||at>ceiling||!Number.isFinite(price)||Math.abs(price)<100||line===null||!Number.isFinite(line))continue;
  const group=groups.get(at)??new Map();group.set(line,[at,price,line]);groups.set(at,group);
 }
 return [...groups.values()].filter(g=>g.size===1).map(g=>[...g.values()][0]).sort((a,b)=>a[0]-b[0]);
}
/** Only an actual pre-lock capture may supplement a FUTURE locked display.
 * Stored book, line, every stored quote and its endpoint retain precedence.
 * No stored book means no reconstruction; other books never replace it. */
export function predictionMarketArchivedBook(stored:PredictionMarketBookTrail|null,archive:PredictionMarketBookTrail|null,capturedAt:number|undefined,boundary:number|undefined,line:number|null):PredictionMarketBookTrail|null{
 if(!stored||!archive||capturedAt===undefined||boundary===undefined||!Number.isFinite(boundary)||capturedAt>boundary||stored.sportsbook!==archive.sportsbook||(stored.line??line)!==(archive.line??line))return stored;
 const last=stored.points.at(-1)?.[0];if(last===undefined)return stored;
 const points=[...new Map([...archive.points.filter(p=>p[0]<=Math.min(boundary,last)),...stored.points].map(p=>[p[0],p])).values()].sort((a,b)=>a[0]-b[0]);
 return {...stored,points,historyScope:"prelock_archive",...(stored.opening?{opening:stored.opening}:archive.opening&&archive.opening.point[0]<=Math.min(boundary,last)?{opening:archive.opening}:{}),marketHistory:stored.marketHistory??archive.marketHistory?.filter(p=>p[0]<=Math.min(boundary,last))};
}
export function predictionMarketComparisonBook(locked:boolean,stored:PredictionMarketBookTrail|null,live:PredictionMarketBookTrail|null,sourcePinned=false):PredictionMarketBookTrail|null {
  if(locked||stored?.locked)return stored;
  if(!live)return stored;
  if(sourcePinned){
    if(stored?.sportsbook===live.sportsbook&&stored.line===live.line)return {...live,points:[...new Map([...stored.points,...live.points].map(p=>[p[0],p])).values()].sort((a,b)=>a[0]-b[0])};
    return live;
  }
  if(stored&&stored.points.at(-1)![0]>live.points.at(-1)![0])return stored;
  return live;
}
export function formatPredictionMarketOdds(value:number):string {return value>0?`+${value}`:`−${Math.abs(value)}`;}
export function predictionMarketBookPricePath(points:ReadonlyArray<readonly [number,number,number]>,maxPrices=3):string {
  const prices=points.map(p=>p[2]).filter((price,i)=>i===0||price!==points[i-1][2]);
  if(maxPrices>=4&&prices.length>maxPrices)return `${formatPredictionMarketOdds(prices[0])} → … → ${formatPredictionMarketOdds(prices.at(-1)!)}`;
  const shown=prices.length<=maxPrices?prices:[prices[0],prices.at(-1)!];
  return shown.map(formatPredictionMarketOdds).join(" → ");
}
/** A few real extrema anchors keep a sparse dip/return visible without dot clutter. */
export function predictionMarketAnchorIndices(points:ReadonlyArray<readonly [number,number,...unknown[]]>):Set<number>{
  if(!points.length)return new Set();
  let low=0,high=0;
  for(let i=1;i<points.length;i++){if(points[i][1]<points[low][1])low=i;if(points[i][1]>points[high][1])high=i;}
  const lastRunStart=(value:number)=>{
    let index=points.length-1;while(points[index][1]!==value)index--;
    while(index>0&&points[index-1][1]===value)index--;
    return index;
  };
  return new Set([0,low,high,lastRunStart(points[low][1]),lastRunStart(points[high][1]),points.length-1]);
}
const pickLabel=(value:string|null|undefined)=>value?.replace(/\s+ML$/i,"").trim().toUpperCase().replace(/^TIE$/,"DRAW");

export type PredictionMarketBookStart={kind:"provider_opening"|"first_recorded";point:[number,number,number]};
/** Opening provenance is not implied by the left edge of a rolling chart.
 * Only an explicit same-book, same-side, same-line provider opening may carry
 * that label. Earlier stored evidence can be described without inserting it
 * into the shared recent-window chart or changing a locked member payload. */
export function predictionMarketBookStart(market:MarketEdgeDto,label:string,book:PredictionMarketBookTrail,targetLine:number|null,ceiling:number):PredictionMarketBookStart|null {
  const selected=pickLabel(label),stops=selected===pickLabel(market.pick)?market.oddsTrail:selected===pickLabel(market.opposingOddsTrail?.label)?market.opposingOddsTrail?.stops:[];
  const line=book.line===undefined?targetLine:book.line;
  if(!book.locked&&book.historyScope!=="prelock_archive"&&book.opening?.line===line&&book.opening.point[0]<=ceiling)return {kind:"provider_opening",point:book.opening.point};
  const eligible=(stops??[]).filter(stop=>stop.sportsbook?.trim().toLowerCase()===book.sportsbook&&stop.line===line&&implied(stop.american)!==null&&Number.isFinite(Date.parse(stop.observedAt??""))&&Date.parse(stop.observedAt!)<=ceiling);
  const openings=eligible.filter(stop=>stop.source==="provider_opening").sort((a,b)=>Date.parse(a.observedAt!)-Date.parse(b.observedAt!));
  if(openings.length){const first=openings[0];return {kind:"provider_opening",point:[Date.parse(first.observedAt!),implied(first.american)!,first.american]};}
  if(book.historyScope==="prelock_archive"&&book.opening?.line===line&&book.opening.point[0]<=ceiling)return {kind:"provider_opening",point:book.opening.point};
  const recorded:Array<[number,number,number]>=[...eligible.map(stop=>[Date.parse(stop.observedAt!),implied(stop.american)!,stop.american] as [number,number,number]),...book.points.filter(p=>p[0]<=ceiling)].sort((a,b)=>a[0]-b[0]);
  return recorded.length?{kind:"first_recorded",point:recorded[0]}:null;
}

export function predictionMarketWindowDuration(start:number,end:number):string {
  const minutes=Math.max(0,Math.round((end-start)/60_000));
  if(!minutes)return "single quote";
  const days=Math.floor(minutes/1440),hours=Math.floor(minutes%1440/60),remaining=minutes%60;
  return [days?days+"d":null,hours?hours+"h":null,remaining?remaining+"m":null].filter(Boolean).join(" ");
}

/** Use the exact selected outcome's real single-book moneyline observations. */
export function predictionMarketBookTrail(moneyline:MarketEdgeDto, outcomeLabel:string, now:number, targetLine:number|null=null):PredictionMarketBookTrail|null {
  const selected=pickLabel(outcomeLabel);
  const stops=selected===pickLabel(moneyline.pick)?moneyline.oddsTrail:selected===pickLabel(moneyline.opposingOddsTrail?.label)?moneyline.opposingOddsTrail?.stops:null;
  const groups=new Map<string,NonNullable<MarketEdgeDto["oddsTrail"]>>();
  for(const stop of stops??[]){
    const book=stop.sportsbook?.trim().toLowerCase(), at=Date.parse(stop.observedAt??"");
    if(!book || ["recommendation_snapshot","locked_snapshot"].includes(book) || stop.line!==targetLine || implied(stop.american)===null || !Number.isFinite(at) || at>now || at<now-24*60*60_000)continue;
    const group=groups.get(book)??[];group.push(stop);groups.set(book,group);
  }
  const preferred=moneyline.movementReferenceSportsbook?.trim().toLowerCase();
  const rank=(book:string)=>book===preferred?0:book==="circa"?1:book==="pinnacle"?2:3;
  const group=[...groups.entries()].filter(([,rows])=>rows.some(row=>row.label==="current"||row.label==="locked"))
    .sort((a,b)=>Number(b[1].length>=2)-Number(a[1].length>=2)||rank(a[0])-rank(b[0])||b[1].length-a[1].length)[0];
  if(!group)return null;
  const points=new Map<number,[number,number,number]>();for(const row of group[1]){const at=Date.parse(row.observedAt!);points.set(at,[at,implied(row.american)!,row.american]);}
  const ordered=[...points.values()].sort((a,b)=>a[0]-b[0]);
  // Keep the real earliest anchor even on a densely sampled book.
  const bounded=ordered.length>100?[ordered[0],...ordered.slice(-99)]:ordered;
  const last=bounded.at(-1)!;
  return {sportsbook:group[0],points:bounded,locked:group[1].some(row=>Date.parse(row.observedAt!)===last[0]&&row.label==="locked")};
}

/** Prefer the selected threshold. If its stored trail is absent, preserve an
 * actual stored same-side endpoint at its OWN line rather than hiding it.
 * This is especially important for frozen snapshots; it is not a live repair
 * or a reconstruction of the locked pick's price. */
export function predictionMarketReaderBookTrail(market:MarketEdgeDto,label:string,now:number,line:number|null){
  const exact=predictionMarketBookTrail(market,label,now,line);if(exact)return exact;
  if(line===null)return null;
  const selected=pickLabel(label),stops=selected===pickLabel(market.pick)?market.oddsTrail:selected===pickLabel(market.opposingOddsTrail?.label)?market.opposingOddsTrail?.stops:[];
  const endpoints=(stops??[]).filter(s=>(s.label==="current"||s.label==="locked")&&s.line!==null&&Number.isFinite(s.line))
    .sort((a,b)=>Date.parse(b.observedAt??"")-Date.parse(a.observedAt??""));
  for(const endpoint of endpoints){const trail=predictionMarketBookTrail(market,label,now,endpoint.line);if(trail)return {...trail,line:endpoint.line};}
  return null;
}

/** Shared percent axis; padding adapts to actual movement instead of hiding it. */
export function predictionMarketChartDomain(points:ReadonlyArray<readonly [number,number,...unknown[]]>):[number,number] {
  if(!points.length)return [0,100];
  const values=points.map(point=>point[1]*100);
  const low=Math.min(...values), high=Math.max(...values);
  const padding=Math.max(.35,(high-low)*.15);
  return [Math.max(0,Math.floor((low-padding)*2)/2),Math.min(100,Math.ceil((high+padding)*2)/2)];
}

/** Display-only curves through exact observations. Controls stay inside each pair's
 * price/time bounds: no overshoot, invented extrema, or additional quote samples.
 * Monotone Hermite tangents are shared by both sources. Unlike independent
 * horizontal controls at every sample, adjacent connectors share a tangent. */
function predictionMarketCurveGeometry(
  points:ReadonlyArray<readonly [number,number,...unknown[]]>,
  x:(at:number)=>number,y:(probability:number)=>number,
  maxGap=Infinity,baseline?:number,
) {
  const segments:Array<Array<readonly [number,number]>>=[];
  for(const point of points){
    const segment=segments.at(-1),previous=segment?.at(-1);
    if(!previous||point[0]-previous[0]>maxGap)segments.push([[point[0],point[1]]]);
    else segment!.push([point[0],point[1]]);
  }
  const paths=segments.map(segment=>{
    const xs=segment.map(p=>x(p[0])),ys=segment.map(p=>y(p[1]));
    const slopes=xs.slice(1).map((v,i)=>(ys[i+1]-ys[i])/(v-xs[i]));
    const tangents=xs.map((_,i)=>{
      if(i===0)return slopes[0]??0;
      if(i===xs.length-1)return slopes.at(-1)??0;
      const a=slopes[i-1],b=slopes[i];
      if(!a||!b||a*b<=0)return 0;
      const before=xs[i]-xs[i-1],after=xs[i+1]-xs[i],w1=2*after+before,w2=after+2*before;
      return (w1+w2)/(w1/a+w2/b);
    });
    let line=`M${x(segment[0][0])},${y(segment[0][1])}`;
    const connections:Array<{from:number;to:number;command:string;path:string}>=[];
    for(let index=1;index<segment.length;index++){
      const a=segment[index-1],b=segment[index],dx=(x(b[0])-x(a[0]))/3;
      const low=Math.min(y(a[1]),y(b[1])),high=Math.max(y(a[1]),y(b[1]));
      const clamp=(v:number)=>Math.max(low,Math.min(high,v));
      const command=` C${x(a[0])+dx},${clamp(y(a[1])+dx*tangents[index-1])} ${x(b[0])-dx},${clamp(y(b[1])-dx*tangents[index])} ${x(b[0])},${y(b[1])}`;
      connections.push({from:a[0],to:b[0],command,path:`M${x(a[0])},${y(a[1])}${command}`});
      line+=command;
    }
    const area=baseline===undefined||segment.length<2?"":`${line} L${x(segment.at(-1)![0])},${baseline} L${x(segment[0][0])},${baseline} Z`;
    return {line,area,connections};
  });
  return paths;
}

export function predictionMarketCurve(
  points:ReadonlyArray<readonly [number,number,...unknown[]]>,
  x:(at:number)=>number,y:(probability:number)=>number,
  maxGap=Infinity,baseline?:number,
):{line:string;area:string} {
  const paths=predictionMarketCurveGeometry(points,x,y,maxGap,baseline);
  return {line:paths.map(path=>path.line).join(" "),area:paths.map(path=>path.area).filter(Boolean).join(" ")};
}

export const PREDICTION_MARKET_OBSERVATION_GAP_MS=15*60_000;
/** Same exact curve geometry for both sources, but distinguish sparse connectors
 * from sampled history. A five-hour gap is never a solid observed price trend.
 * These visual paths add no quote, time, volume or inspection observations. */
export function predictionMarketObservedCurve(
  points:ReadonlyArray<readonly [number,number,...unknown[]]>,
  x:(at:number)=>number,y:(probability:number)=>number,baseline?:number,
  maxGap=PREDICTION_MARKET_OBSERVATION_GAP_MS,
):{line:string;gapLine:string;area:string;hasGaps:boolean}{
  const paths=predictionMarketCurveGeometry(points,x,y,Infinity,baseline);
  let line="",gapLine="",previous:number|null=null;
  for(const path of paths){
    if(!path.connections.length)line+=path.line;
    for(const connection of path.connections){
      if(connection.to-connection.from>maxGap){gapLine+=(gapLine?" ":"")+connection.path;previous=null;}
      else{line+=previous===connection.from?connection.command:(line?" ":"")+connection.path;previous=connection.to;}
    }
  }
  const observed=predictionMarketCurveGeometry(points,x,y,maxGap,baseline);
  return {line,gapLine,area:observed.map(path=>path.area).filter(Boolean).join(" "),hasGaps:gapLine.length>0};
}

/** undefined: unlocked; finite: immutable reader boundary; NaN: locked but
 * unprovable boundary, so no post-lock context may be presented as pre-lock. */
export function predictionMarketLockBoundary(game:Pick<DailyEdgeGameDto,"lockState"|"lockedAt"|"gameStartAt">,now:number):number|undefined {
  const locked=Date.parse(game.lockedAt??""),start=Date.parse(game.gameStartAt??"");
  if(Number.isFinite(locked)&&locked<=now)return Math.min(locked,Number.isFinite(start)?start:locked);
  if(Number.isFinite(start)&&start<=now)return start;
  return game.lockState==="locked"?NaN:undefined;
}

/** Compare a shared, genuinely covered time window. Full source observations
 * remain available for original-price inspection and the book's full move
 * summary. Boundary guides are separate and never become quote receipts. */
export function predictionMarketComparison(row:Pick<PredictionMarketRow,"history"|"historicalCandles"|"asOf"|"historyFrom"|"openingQuote">,book:PredictionMarketBookTrail|null,lockedAt?:number){
  const raw=predictionMarketChartSeries(row),ceiling=lockedAt===undefined?Infinity:Number.isFinite(lockedAt)?lockedAt:-Infinity;
  const series={points:raw.points.filter(p=>p[0]<=ceiling),activity:raw.activity.filter((_,i)=>raw.points[i][0]<=ceiling)};
  const eligibleBook=book?.points.filter(p=>p[0]<=ceiling)??[];
  const cutoff=eligibleBook.length&&series.points.length?Math.min(series.points.at(-1)![0],eligibleBook.at(-1)![0]):null;
  const indices=series.points.flatMap((p,i)=>cutoff===null||p[0]<=cutoff?[i]:[]);
  const points=indices.map(i=>series.points[i]),activity=indices.map(i=>series.activity[i]);
  const bookPoints=eligibleBook.filter(p=>cutoff===null||p[0]<=cutoff);
  const overlap=points.length>0&&bookPoints.length>0&&Math.max(points[0][0],bookPoints[0][0])<=cutoff!;
  return {points:cutoff!==null&&!overlap?series.points:points,activity:cutoff!==null&&!overlap?series.activity:activity,
    bookPoints:overlap?bookPoints:[],cutoff:overlap?cutoff:null,pending:!!book&&!overlap,
    // Opening evidence remains in the source arrays/cards, but the plotted
    // comparison starts only when BOTH sources have an actual prior quote.
    // A union start leaves one trace stranded at the right of a multi-day axis.
    start:overlap?Math.max(points[0][0],bookPoints[0][0]):series.points[0]?.[0]??Date.parse(row.asOf),
    latestKalshi:series.points.at(-1)?.[0]??null,latestBook:book?.points.at(-1)?.[0]??null};
}

/** A new/missing Kalshi contract must not suppress real sportsbook history.
 * This is explicitly ONE source, not a synthetic Kalshi comparison. */
export function predictionMarketHasSharedHistory(comparison:ReturnType<typeof predictionMarketComparison>):boolean{
  return !comparison.pending&&comparison.points.length>=2&&comparison.cutoff!==null&&comparison.start<comparison.cutoff;
}
/** Do not let a one-instant intersection erase a genuine standalone curve.
 * Callers opt in only for the supported auxiliary CBB/CFB display scope. */
export function predictionMarketVisibleComparison(row:Parameters<typeof predictionMarketComparison>[0],book:PredictionMarketBookTrail|null,lockedAt:number|undefined,allowStandalone:boolean){
 const paired=predictionMarketComparison(row,book,lockedAt),shared=predictionMarketHasSharedHistory(paired);
 const full=allowStandalone&&!shared?predictionMarketComparison(row,null,lockedAt):null;
 const standalone=!!full&&full.points.length>=2;
 return {comparison:standalone?full!:paired,book:standalone?null:book,shared,standalone};
}
export function predictionMarketBookOnlyComparison(book:PredictionMarketBookTrail|null,lockedAt?:number){
  const ceiling=lockedAt===undefined?Infinity:Number.isFinite(lockedAt)?lockedAt:-Infinity;
  const bookPoints=book?.points.filter(p=>Number.isFinite(p[0])&&p[0]<=ceiling)??[];
  return {points:[] as PredictionMarketPoint[],activity:[] as Array<number|null>,bookPoints,
    cutoff:bookPoints.at(-1)?.[0]??null,start:bookPoints[0]?.[0]??0};
}

/** Plot-only guide: carry an already observed price to the shared edges, never
 * backfill before the first receipt. Quote arrays and their timestamps are not
 * changed. Inspection uses predictionMarketObservationAt on the originals. */
export function predictionMarketGuidePoints(points:ReadonlyArray<readonly [number,number,...unknown[]]>,start:number,end:number):Array<[number,number]>{
  if(!points.length||end<start)return [];
  const previous=predictionMarketObservationAt(points,start);
  const result:Array<[number,number]>=previous?[[start,previous[1]]]:[];
  for(const p of points)if(p[0]>start&&p[0]<=end)result.push([p[0],p[1]]);
  const last=result.at(-1);if(last&&last[0]<end)result.push([end,last[1]]);
  // Keep the start/end of flat runs, not hundreds of artificial flat tangents.
  return result.filter((p,i)=>i===0||i===result.length-1||p[1]!==result[i-1][1]||p[1]!==result[i+1][1]);
}

/** Keep one real preceding anchor for normal chart clipping at the common start. */
export function predictionMarketWindowPoints<T extends readonly [number,...unknown[]]>(points:ReadonlyArray<T>,start:number):T[]{
  const first=points.findIndex(p=>p[0]>=start);
  if(first===-1)return points.length?[points.at(-1)!]:[];
  return points.slice(Math.max(0,first-1));
}

/** Return a recorded observation, never a new interpolated sportsbook quote. */
export function predictionMarketObservationAt<T extends readonly [number,...unknown[]]>(points:ReadonlyArray<T>,at:number):T|null {
  for(let index=points.length-1;index>=0;index--)if(points[index][0]<=at)return points[index];
  return null;
}

/** Historical interval volume and live cumulative deltas are never conflated. */
export function predictionMarketChartSeries(row:Pick<PredictionMarketRow,"history"|"historicalCandles"|"asOf"|"historyFrom"|"openingQuote">):{points:PredictionMarketPoint[];activity:Array<number|null>} {
  const live=row.history.filter(point=>point[0]<=Date.parse(row.asOf));
  if(row.historyFrom){
    const all=new Map<number,{point:PredictionMarketPoint;activity:number|null}>();
    for(const point of [...(row.historicalCandles??[]),...(row.openingQuote?[row.openingQuote.point]:[])])if(point[0]<=Date.parse(row.asOf))all.set(point[0],{point,activity:point[2]});
    const activity=predictionMarketActivity(live);live.forEach((point,i)=>all.set(point[0],{point,activity:activity[i]}));
    const ordered=[...all.values()].sort((a,b)=>a.point[0]-b.point[0]);
    return {points:ordered.map(p=>p.point),activity:ordered.map(p=>p.activity)};
  }
  const firstLive=live[0]?.[0]??Date.parse(row.asOf);
  const historical=(row.historicalCandles??[]).filter(point=>point[0]<firstLive && point[0]>=Date.parse(row.asOf)-24*60*60_000);
  return {points:[...historical,...live],activity:[...historical.map(point=>point[2]),...predictionMarketActivity(live)]};
}

function implied(american: number): number | null {
  return Number.isFinite(american) && Math.abs(american) >= 100 ? american > 0 ? 100 / (american + 100) : -american / (-american + 100) : null;
}
/** A comparison is optional. Never rename a Circa trail or a published probability Pinnacle. */
export function predictionMarketPinnacleComparison(moneyline: MarketEdgeDto, selectedSide: "home" | "away" | "draw", now: number, threeWay = false): number | null {
  const board = moneyline.soccerPriceBoard;
  if (board?.sportsbook?.trim().toLowerCase() === "pinnacle" && board.rows.length === 3 && board.rows.every(row => ["home","away","draw"].includes(row.side)) && now - Date.parse(board.observed_at ?? "") <= 10 * 60_000 && now >= Date.parse(board.observed_at ?? "")) {
    const probabilities = board.rows.map(row => ({side:row.side,p:implied(row.price_american)}));
    const sum = probabilities.reduce((total,row) => total + (row.p ?? 0),0);
    const p = probabilities.find(row => row.side === selectedSide)?.p;
    return probabilities.every(row => row.p !== null) && p !== null && p !== undefined && sum >= 1 && sum <= 1.15 ? p / sum : null;
  }
  if (threeWay || board || selectedSide === "draw") return null;
  const opposite = moneyline.opposingOddsTrail;
  if (!opposite || (opposite.side !== "home" && opposite.side !== "away")) return null;
  const latest = (rows: NonNullable<MarketEdgeDto["oddsTrail"]>) => rows.filter(row => row.sportsbook?.trim().toLowerCase() === "pinnacle" && row.line === null && Number.isFinite(Date.parse(row.observedAt ?? ""))).sort((a,b) => Date.parse(b.observedAt!) - Date.parse(a.observedAt!))[0];
  const picked = latest(moneyline.oddsTrail ?? []);
  const opposing = latest(opposite.stops);
  if (!picked || !opposing) return null;
  const stamps = [picked,opposing].map(row => Date.parse(row.observedAt!));
  if (stamps.some(at => now-at < 0 || now-at > 10*60_000) || Math.abs(stamps[0]-stamps[1]) > 90_000) return null;
  const a = implied(picked.american), b = implied(opposing.american);
  if (a === null || b === null || a+b < 1 || a+b > 1.15) return null;
  return (selectedSide === opposite.side ? b : a) / (a+b);
}

export function selectedPredictionMarketOutcome<T extends {label:string;probability:number}>(match: {outcomes:T[]}, pick: string | null):T|undefined {
  const normalized = pick?.replace(/\s+ML$/i, "").trim().toUpperCase();
  return match.outcomes.find(row => row.label.toUpperCase() === normalized) ?? [...match.outcomes].sort((a,b) => b.probability-a.probability)[0];
}

/** Activity is actual contract-count change, not 24h rolling volume subtraction. */
export function predictionMarketActivity(history: PredictionMarketPoint[]): Array<number | null> {
  return history.map((point,index) => {
    const previous = history[index-1];
    if (!previous || point[2] === null || previous[2] === null || point[0]-previous[0] > 15*60_000 || point[2] < previous[2]) return null;
    return point[2]-previous[2];
  });
}
