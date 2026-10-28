import type { MarketEdgeDto } from "./labTypes";
import type { PredictionMarketMatch, PredictionMarketPoint, PredictionMarketRow } from "@/lib/providers/owls/owlsPredictionMarkets";

export type PredictionMarketBookTrail = {sportsbook:string;points:Array<[number,number]>};
const pickLabel=(value:string|null|undefined)=>value?.replace(/\s+ML$/i,"").trim().toUpperCase().replace(/^TIE$/,"DRAW");

/** Use the exact selected outcome's real single-book moneyline observations. */
export function predictionMarketBookTrail(moneyline:MarketEdgeDto, outcomeLabel:string, now:number):PredictionMarketBookTrail|null {
  const selected=pickLabel(outcomeLabel);
  const stops=selected===pickLabel(moneyline.pick)?moneyline.oddsTrail:selected===pickLabel(moneyline.opposingOddsTrail?.label)?moneyline.opposingOddsTrail?.stops:null;
  const groups=new Map<string,NonNullable<MarketEdgeDto["oddsTrail"]>>();
  for(const stop of stops??[]){
    const book=stop.sportsbook?.trim().toLowerCase(), at=Date.parse(stop.observedAt??"");
    if(!book || ["recommendation_snapshot","locked_snapshot"].includes(book) || stop.line!==null || implied(stop.american)===null || !Number.isFinite(at) || at>now || at<now-8*60*60_000)continue;
    const group=groups.get(book)??[];group.push(stop);groups.set(book,group);
  }
  const preferred=moneyline.movementReferenceSportsbook?.trim().toLowerCase();
  const rank=(book:string)=>book===preferred?0:book==="circa"?1:book==="pinnacle"?2:3;
  const group=[...groups.entries()].filter(([,rows])=>rows.some(row=>row.label==="current"||row.label==="locked"))
    .sort((a,b)=>Number(b[1].length>=2)-Number(a[1].length>=2)||rank(a[0])-rank(b[0])||b[1].length-a[1].length)[0];
  if(!group)return null;
  const points=new Map<number,number>();for(const row of group[1])points.set(Date.parse(row.observedAt!),implied(row.american)!);
  return {sportsbook:group[0],points:[...points].sort((a,b)=>a[0]-b[0]).slice(-100)};
}

/** Historical interval volume and live cumulative deltas are never conflated. */
export function predictionMarketChartSeries(row:PredictionMarketRow):{points:PredictionMarketPoint[];activity:Array<number|null>} {
  const live=row.history.filter(point=>point[0]<=Date.parse(row.asOf));
  const firstLive=live[0]?.[0]??Date.parse(row.asOf);
  const historical=(row.historicalCandles??[]).filter(point=>point[0]<firstLive && point[0]>=Date.parse(row.asOf)-8*60*60_000);
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

export function selectedPredictionMarketOutcome(match: PredictionMarketMatch, pick: string | null) {
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
