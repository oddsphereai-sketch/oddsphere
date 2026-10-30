import type { DailyEdgeGameDto, DailyEdgeResponse, MarketEdgeDto, PickResult } from "@/app/lab/lib/labTypes";
import type { Grade } from "@/lib/types/domain/Grade";
import type { Verdict } from "@/lib/services/verdictDerivation";
import { SHARP_READ_SENTENCES } from "@/lib/services/sharpReadSelector";
import { computeSlateDate } from "@/lib/dates/slateDate";
import { settleLockedCbbProvisionalBoard, type CbbProvisionalSnapshot } from "@/lib/cbb/provisionalLifecycle";
import { cbbImpliedProbability } from "@/lib/cbb/marketEvidence";
import type { CbbGame, CbbMarket } from "@/lib/cbb/types";
import type { cbbCurrentSplitEvidence } from "@/lib/cbb/owlsSplitEvidence";
import { buildDailyEdgeMemberPresentation } from "@/app/lab/lib/dailyEdgeResponseCoherence";

export const CBB_MEMBER_ADAPTER_RELEASE="cbb_member_adapter_2026_10_29_r2_exact_quote_reader" as const;
type GradeLabel="Best Angle"|"Lean"|"Watchlist"|"No Play"|"Held";
type BoardRow=CbbProvisionalSnapshot["board"]["rows"][number];
type SplitEvidence=ReturnType<typeof cbbCurrentSplitEvidence>;
const verdict=(grade:GradeLabel):Verdict=>grade==="Best Angle"?"best_angle":grade==="Lean"?"lean":grade==="Watchlist"?"watchlist":"no_play";
const gradeCode=(grade:GradeLabel,reference:BoardRow["referenceState"]):Grade|null=>grade==="Best Angle"?"best_signal":grade==="Lean"?reference==="agrees"?"sharp_confirmed":"model_only":grade==="Watchlist"?"market_watch":null;
const etTime=(date:string)=>new Intl.DateTimeFormat("en-US",{timeZone:"America/New_York",hour:"numeric",minute:"2-digit"}).format(new Date(date));
const etMinutes=(date:string)=>{const parts=new Intl.DateTimeFormat("en-US",{timeZone:"America/New_York",hour:"2-digit",minute:"2-digit",hourCycle:"h23"}).formatToParts(new Date(date));
  return Number(parts.find(p=>p.type==="hour")?.value??0)*60+Number(parts.find(p=>p.type==="minute")?.value??0);};
const selectionLabel=(game:CbbGame,row:BoardRow):string|null=>{
  if(row.selection===null)return null;
  if(row.market==="total")return `${row.selection==="first"?"Over":"Under"} ${row.line}`;
  const code=row.selection==="first"?game.home_team.abbreviation:game.visitor_team.abbreviation;
  if(row.market==="moneyline")return `${code} ML`;
  const line=row.selection==="first"?row.line:row.line===null?null:-row.line;
  return line===null?null:`${code} ${line>0?"+":""}${line}`;
};
function marketEdge(game:CbbGame,row:BoardRow,projectedTotal:number,homeWinProbability:number):MarketEdgeDto{
  const held=row.grade==="Held",label=selectionLabel(game,row),code=gradeCode(row.grade,row.referenceState);
  const v=verdict(row.grade),probability=row.probability,price=row.price;
  const priceImplied=price===null?null:cbbImpliedProbability(price);
  const fair=row.marketFairProbability;
  const sharpStatus=row.referenceState==="agrees"?"confirm":row.referenceState==="opposes"?"caution":"mixed";
  const directionalLabel=label??(row.market==="moneyline"?`${homeWinProbability>=.5?game.home_team.abbreviation:game.visitor_team.abbreviation} ML`:null);
  const directionalProbability=probability??(row.market==="moneyline"?Math.max(homeWinProbability,1-homeWinProbability):null);
  return {pick:label,confidence:probability,grade:code,signalType:row.referenceState==="agrees"?"balanced":"model_only",
    marketSignal:row.referenceState==="agrees"?"market_confirmed":row.referenceState==="opposes"?"market_resistance":"market_neutral",
    sharpStatus,held,verdict:{key:v,label:row.grade==="Held"?"No Play":row.grade},
    marketPrediction:{status:directionalLabel?"available":"market_data_unavailable",label:directionalLabel,line:row.line,probability:directionalProbability,
      source:label?"model_at_exact_book_line":directionalLabel?"model_outcome":null,sportsbook:row.targetBook,observedAt:row.quoteObservedAt,freshnessCheckedAt:null,
      reason:directionalLabel?null:"No complete executable quote for this market"},
    guidedGuide:label?`Model projects ${label}.`:"Model has not published an exact-line pick.",
    guidedWatchOut:row.referenceState==="opposes"?"Professional books disagree with this side.":
      row.referenceState==="unavailable"?"Professional reference is not yet available.":"Price and lineup context can change before lock.",
    whyLine:row.reason.replaceAll("_"," "),riskLine:"This is an early-season provisional grade; the quoted line may change.",
    modelProb:probability,marketFairProb:fair,pinnacleEvPct:null,moneyPct:null,betsPct:null,publicSplits:[],
    priceAmerican:price,currentPriceAmerican:price,currentPriceSportsbook:row.targetBook,currentPriceObservedAt:row.quoteObservedAt,
    lineOpenAmerican:null,modelTotal:row.market==="total"?projectedTotal:null,marketTotal:row.market==="total"?row.line:null,
    line:row.market==="moneyline"?null:row.market==="spread"&&row.selection==="second"&&row.line!==null?-row.line:row.line,
    keyStats:[],modelTrustPct:probability===null?null:probability*100,marketImpliedPct:priceImplied===null?null:priceImplied*100,
    modelMarketGapPct:probability===null||fair===null?null:(probability-fair)*100,recommendationConfidence:held?null:probability===null?null:probability*100,
    marketSource:row.targetBook,marketDataQuality:price===null?"unavailable":"two_sided_consensus",
    reviewFlags:[],reviewActionSummary:"keep",oddsTrail:price===null?[]:[{american:price,line:row.line,
      observedAt:row.quoteObservedAt,sportsbook:row.targetBook,source:"current_line",label:"current"}],
    lineTrail:[],opposingOddsTrail:null};
}
const settled=(value:"win"|"loss"|"push"|null):PickResult|null=>value;
export function cbbOfficialGameResult(game:CbbGame,snapshot:CbbProvisionalSnapshot):DailyEdgeGameDto["result"]{
  return cbbOfficialGameResultFromScores(snapshot,{status:game.status,statusState:game.status_state??null,
    homeScore:game.home_score,awayScore:game.away_score});
}
export function cbbOfficialGameResultFromScores(snapshot:CbbProvisionalSnapshot,game:{status:string|null;statusState:string|null;
  homeScore:number|null;awayScore:number|null}):DailyEdgeGameDto["result"]{
  if(snapshot.lockedAt===null||game.status!=="post"&&game.status!=="STATUS_FINAL"||
    game.status==="post"&&game.statusState!=="final"||game.homeScore===null||game.awayScore===null)return null;
  const rows=settleLockedCbbProvisionalBoard(snapshot,{home:game.homeScore,away:game.awayScore});
  const result=(market:CbbMarket)=>{const row=rows.find(r=>r.market===market)!;const outcome=settled(row.outcome);
    const gradeUnits=outcome===null||row.price===null?null:outcome==="push"?0:outcome==="loss"?-1:row.price>0?row.price/100:100/-row.price;
    return {pickResult:outcome,gradeUnits};};
  return {finalScore:{home:game.homeScore,away:game.awayScore},markets:{moneyline:result("moneyline"),total:result("total"),first_inning:result("spread")}};
}

/** One coherent projection and three exact market rows; no read-time re-grade. */
export function adaptCbbProvisionalGame(args:{game:CbbGame;snapshot:CbbProvisionalSnapshot;homeLogo:string|null;awayLogo:string|null;now:string;
  splitEvidence?:SplitEvidence|null}):DailyEdgeGameDto{
  const {game,snapshot,now}=args;
  if(snapshot.gameId!==game.id||snapshot.startsAt!==game.date||snapshot.board.gameId!==game.id)throw new Error("CBB member identity mismatch");
  const rows=new Map(snapshot.board.rows.map(row=>[row.market,row]));
  if(rows.size!==3||!rows.has("moneyline")||!rows.has("spread")||!rows.has("total"))throw new Error("CBB member three-market board incomplete");
  const ml=marketEdge(game,rows.get("moneyline")!,snapshot.board.score.total,snapshot.board.score.homeWinProbability),
    spread=marketEdge(game,rows.get("spread")!,snapshot.board.score.total,snapshot.board.score.homeWinProbability),
    total=marketEdge(game,rows.get("total")!,snapshot.board.score.total,snapshot.board.score.homeWinProbability);
  for(const [kind,market] of [["moneyline",ml],["spread",spread],["total",total]] as const){
    const sourceRows=(args.splitEvidence?.rows??[]).filter(row=>row.market===kind);
    const preferred=["circa","draftkings","betmgm"].find(book=>sourceRows.filter(row=>row.sourceBook===book).length===2);
    const selected=preferred?sourceRows.filter(row=>row.sourceBook===preferred):[];
    market.sportsbookSplits=selected.length===2?{
      label:preferred==="circa"?"Sharp Book Splits":preferred==="draftkings"?"DraftKings Splits":"BetMGM Splits",
      sourceBook:preferred as "circa"|"draftkings"|"betmgm",sourceObservedAt:selected[0].observedAt,
      rows:selected.map(row=>({side:kind==="total"?(row.selection==="first"?"over":"under"):(row.selection==="first"?"home":"away"),
        label:kind==="total"?(row.selection==="first"?"Over":"Under"):(row.selection==="first"?game.home_team.abbreviation:game.visitor_team.abbreviation),
        moneyPct:row.moneyPct,betsPct:row.ticketsPct,observedAt:row.observedAt})),signal:null,lastUpdated:selected[0].observedAt,
    }:null;
    market.sharpBookAvailability={status:selected.length===2?"complete":args.splitEvidence?.feedStatus==="partial"?"provider_limited":"pending",
      message:selected.length===2?"Verified two-sided named-book split data is available.":"Verified two-sided named-book split data is not available for this game and market.",
      lastUpdated:selected[0]?.observedAt??null};
  }
  const cutoff=Date.parse(game.date)-60*60_000,locked=snapshot.lockedAt!==null;
  if(locked)for(const market of [ml,spread,total]){
    market.lockedLineAmerican=market.priceAmerican;
    market.lockedLineAt=snapshot.lockedAt;
    market.oddsTrail=(market.oddsTrail??[]).map(stop=>({...stop,label:"locked" as const,source:"locked_snapshot" as const}));
  }
  const top=[ml,total,spread].find(m=>m.verdict.key==="best_angle")??[ml,total,spread].find(m=>m.verdict.key==="lean")??[ml,total,spread].find(m=>m.verdict.key==="watchlist");
  const topVerdict=top?.verdict??{key:"no_play" as const,label:"No Play"};
  const prediction=(market:MarketEdgeDto)=>({pick:market.pick,confidence:market.confidence,sharpStatus:market.sharpStatus,
    grade:market.grade,signalType:market.signalType,marketSignal:market.marketSignal});
  return {id:`cbb-${game.id}`,sport:"cbb",external_id:game.id,
    awayTeam:game.visitor_team.abbreviation,awayTeamDisplayName:game.visitor_team.full_name,cbbAwayCollege:game.visitor_team.college,
    awayTeamLogo:args.awayLogo,homeTeam:game.home_team.abbreviation,homeTeamDisplayName:game.home_team.full_name,cbbHomeCollege:game.home_team.college,
    homeTeamLogo:args.homeLogo,gameTime:etTime(game.date),gameStartAt:game.date,gameStartMinutes:etMinutes(game.date),
    scheduledLockAt:new Date(cutoff).toISOString(),lockState:locked?"locked":Date.parse(now)>=cutoff?"locking":"open",
    lockedAt:snapshot.lockedAt,updatedAt:snapshot.capturedAt,generatedAt:snapshot.capturedAt,holdReason:null,
    homeStarter:null,awayStarter:null,predictions:{ml:prediction(ml),total:{...prediction(total),line:total.line},nrfi:prediction(spread)},
    markets:{moneyline:ml,total,first_inning:spread},decisionLine:`${game.visitor_team.abbreviation} ${snapshot.board.score.away.toFixed(1)} · ${game.home_team.abbreviation} ${snapshot.board.score.home.toFixed(1)}; ${topVerdict.label}.`,
    projected:{away:snapshot.board.score.away,home:snapshot.board.score.home},sharpSignals:[],
    status:{lineupConfirmed:null,linesLocked:[ml,total,spread].some(m=>m.priceAmerican!==null),sharpSignalPending:rows.get("moneyline")!.professionalReferences===0,
      marketDataLimited:[ml,total,spread].every(m=>m.priceAmerican===null)},result:cbbOfficialGameResult(game,snapshot),
    breakdown:{verdict:topVerdict,sharpRead:{key:"no_data",sentence:SHARP_READ_SENTENCES.no_data},
      modelBreakdown:`Independent projection: ${snapshot.board.score.away.toFixed(1)}–${snapshot.board.score.home.toFixed(1)}. Exact sportsbook prices determine the provisional play grades; professional references are shown only where verified.`}};
}

export function cbbDailyEdgeResponse(date:string,games:DailyEdgeGameDto[],asOf:string):DailyEdgeResponse{
  const end=Date.parse(date)+7*86_400_000;
  if(games.some(g=>g.sport!=="cbb"||!g.gameStartAt||
    Date.parse(computeSlateDate("cbb",g.gameStartAt))<Date.parse(date)||Date.parse(computeSlateDate("cbb",g.gameStartAt))>=end))throw new Error("CBB member seven-day window mismatch");
  return {as_of:asOf,sport:"cbb",date,requested_date:date,fallback_used:false,slateState:games.length?"today_published":"no_data",
    slate_status:games.length?"published":null,last_slate_update_at:games.length?asOf:null,games,
    memberPresentation:buildDailyEdgeMemberPresentation({games})};
}
