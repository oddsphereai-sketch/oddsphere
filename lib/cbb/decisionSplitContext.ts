import {cbbSplitOrientation,cbbSplitTeamMatches} from "./exactSplitIdentity";
import type {CbbGame,CbbMarket} from "./types";
import type {cbbCurrentSplitEvidence} from "./owlsSplitEvidence";
import type {CbbCanonicalSplitPair} from "../services/cbb/cbbCanonicalMarketEvidence";
import {cbbQualifiedPublicSplitPair,type CbbCapturedPublicSplitRow} from "../services/cbb/cbbReaderMarketEvidence";
import type {DraftKingsNetworkSplitFeed} from "../providers/draftkings/draftKingsNetworkSplits";

export type CbbDecisionSplitContext={
  gameId:number;market:CbbMarket;sourceBook:string;physicalFamily:string;
  sourceClass:"professional_adjacent_named_book"|"retail_named_book"|"retail_ticket_share"|"retail_network"|"multi_book_consensus";
  provider:"owls"|"draftkings_network"|"playbook";
  sourceEventId:string|null;line:number|null;firstMoney:number|null;secondMoney:number|null;
  firstTickets:number|null;secondTickets:number|null;observedAt:string|null;availableBy:string;
  clockBasis:"verified_provider_observation"|"db_inserted_upper_bound"|"capture_upper_bound";
  observationIds:readonly (number|string)[];
  receiptEarliest?:string;
};
export type CbbDecisionSplitRead={sourceBook:string;sourceClass:CbbDecisionSplitContext["sourceClass"];
  contract:"exact"|"off_contract"|"line_unavailable";money:"supports"|"opposes"|"balanced"|"unavailable";
  tickets:"supports"|"opposes"|"balanced"|"unavailable";observedAt:string|null;availableBy:string};

/** Source-class-aware pressure classification, never a numeric score input.
 * A network/public percentage without an own line is not exact-target action. */
export function readCbbDecisionSplits(rows:readonly CbbDecisionSplitContext[],market:CbbMarket,line:number|null,selection:"first"|"second"){
  const sign=selection==="first"?1:-1;
  const direction=(first:number|null,second:number|null):CbbDecisionSplitRead["money"]=>
    first===null||second===null?"unavailable":Math.abs(first-second)<1e-9?"balanced":
      (first-second)*sign>0?"supports":"opposes";
  return rows.filter(row=>row.market===market).map(row=>({sourceBook:row.sourceBook,sourceClass:row.sourceClass,
    contract:market==="moneyline"?"exact" as const:row.line===null?"line_unavailable" as const:
      row.line===line?"exact" as const:"off_contract" as const,
    money:direction(row.firstMoney,row.secondMoney),tickets:direction(row.firstTickets,row.secondTickets),
    observedAt:row.observedAt,availableBy:row.availableBy}));
}

const valid=(n:number|null)=>n===null||Number.isFinite(n)&&n>=0&&n<=1;
const coherent=(a:number|null,b:number|null)=>a===null&&b===null||a!==null&&b!==null&&Math.abs(a+b-1)<=.03;
const qualified=(r:CbbDecisionSplitContext,at:number)=>{
  const received=Date.parse(r.availableBy),observed=r.observedAt===null?received:Date.parse(r.observedAt);
  return Number.isFinite(received)&&Number.isFinite(observed)&&observed<=received&&received<=at&&at-observed<=3*3600_000&&
    [r.firstMoney,r.secondMoney,r.firstTickets,r.secondTickets].every(valid)&&
    coherent(r.firstMoney,r.secondMoney)&&coherent(r.firstTickets,r.secondTickets)&&
    (r.firstMoney!==null||r.firstTickets!==null)&&
    (r.market==="moneyline"||r.line===null||Number.isInteger(r.line*2));
};
const names=(game:CbbGame)=>({homeTeamDisplayName:game.home_team.full_name,awayTeamDisplayName:game.visitor_team.full_name,
  cbbHomeCollege:game.home_team.college,cbbAwayCollege:game.visitor_team.college});
const monthDay=(start:string)=>new Intl.DateTimeFormat("en-US",{timeZone:"America/New_York",month:"numeric",day:"numeric"}).format(new Date(start));
const family=(book:string)=>book==="draftkings_network"?"draftkings":book;

/** Predecision source evidence. Each physical family remains distinct from a
 * displayed priority slot; no percentage is promoted to a price or sharp bet. */
export function cbbDecisionSplitContext(args:{game:CbbGame;allGames:readonly CbbGame[];asOf:string;
  direct:ReturnType<typeof cbbCurrentSplitEvidence>;canonical:readonly CbbCanonicalSplitPair[];
  publicRows:readonly CbbCapturedPublicSplitRow[];draftKings:DraftKingsNetworkSplitFeed|null}):CbbDecisionSplitContext[]{
  const at=Date.parse(args.asOf);if(!Number.isFinite(at))throw new Error("CBB split decision clock invalid");
  const out:CbbDecisionSplitContext[]=[];
  const directGroups=new Map<string,typeof args.direct.rows>();
  for(const row of args.direct.rows){if(!["circa","draftkings","betmgm"].includes(row.sourceBook))continue;
    const key=JSON.stringify([row.sourceBook,row.market,row.observedAt,row.sourceLine]);
    directGroups.set(key,[...(directGroups.get(key)??[]),row]);}
  for(const group of directGroups.values()){
    const first=group.filter(row=>row.selection==="first"),second=group.filter(row=>row.selection==="second");
    if(first.length!==1||second.length!==1||!first[0].orientationVerified||!second[0].orientationVerified)continue;
    const a=first[0],b=second[0];
    if(a.sourceLine!==b.sourceLine||a.sourceEventId!==b.sourceEventId||a.fetchedAt!==b.fetchedAt)continue;
    out.push({gameId:args.game.id,market:a.market,sourceBook:a.sourceBook,physicalFamily:family(a.sourceBook),
      sourceClass:a.sourceBook==="circa"?"professional_adjacent_named_book":"retail_named_book",provider:"owls",
      sourceEventId:a.sourceEventId,line:a.sourceLine,firstMoney:a.moneyPct,secondMoney:b.moneyPct,
      firstTickets:a.ticketsPct,secondTickets:b.ticketsPct,observedAt:a.observedAt,availableBy:a.fetchedAt,
      clockBasis:"verified_provider_observation",observationIds:[],receiptEarliest:a.fetchedAt});
  }
  for(const pair of args.canonical){
    if(pair.gameId!==args.game.id)continue;
    out.push({gameId:args.game.id,market:pair.market,sourceBook:pair.book,physicalFamily:family(pair.book),
      sourceClass:pair.sourceClass,provider:"owls",sourceEventId:pair.providerEventId,line:pair.first.ownLine,
      firstMoney:pair.first.money,secondMoney:pair.second.money,firstTickets:pair.first.tickets,secondTickets:pair.second.tickets,
      observedAt:pair.sourceAt,availableBy:pair.availability.availableBy,clockBasis:"db_inserted_upper_bound",
      observationIds:[pair.first.observationId,pair.second.observationId],receiptEarliest:pair.recordedFetchedAt});
  }
  for(const market of ["moneyline","spread","total"] as const){
    const pair=cbbQualifiedPublicSplitPair([...args.publicRows],args.game.id,market,at);
    if(!pair)continue;
    const side=(name:string)=>pair.find(row=>row.selection_key.split(":").at(-1)===name)!;
    const a=side(market==="total"?"over":"home"),b=side(market==="total"?"under":"away");
    if(a.source_observed_at!==b.source_observed_at)continue;
    out.push({gameId:args.game.id,market,sourceBook:"consensus",physicalFamily:"playbook_consensus",
      sourceClass:"multi_book_consensus",provider:"playbook",sourceEventId:String(args.game.id),line:null,
      firstMoney:a.money_pct,secondMoney:b.money_pct,firstTickets:a.bets_pct,secondTickets:b.bets_pct,
      observedAt:a.source_observed_at,
      availableBy:[a.inserted_at??a.fetched_at,b.inserted_at??b.fetched_at].sort((a,b)=>Date.parse(b)-Date.parse(a))[0],
      receiptEarliest:a.fetched_at,clockBasis:a.inserted_at&&b.inserted_at?"db_inserted_upper_bound":"capture_upper_bound",observationIds:[]});
  }
  const feed=args.draftKings;
  if(feed?.source==="draftkings_network"&&feed.sport==="NCAA Basketball"&&Date.parse(feed.fetchedAt)<=at){
    const matched=feed.games.filter(candidate=>candidate.monthDay===monthDay(args.game.date)&&
      cbbSplitOrientation(candidate.awayName,candidate.homeName,names(args.game))!==null&&
      args.allGames.filter(other=>candidate.monthDay===monthDay(other.date)&&
        cbbSplitOrientation(candidate.awayName,candidate.homeName,names(other))!==null).length===1);
    if(matched.length===1)for(const market of ["moneyline","spread","total"] as const){
      const source=matched[0].markets[market];if(!source)continue;
      // The network collector stores each page's HTTP Date in observedAt.
      // That is a page-capture clock, not the sportsbook's update time. Keep
      // its own freshness bound: a fresh final page cannot renew an old page.
      const pageCapturedAt=Date.parse(source.observedAt??feed.fetchedAt);
      if(!Number.isFinite(pageCapturedAt)||pageCapturedAt>Date.parse(feed.fetchedAt)||at-pageCapturedAt>3*3600_000)continue;
      const picked=source.sides.map(side=>{
        const label=side.label.replace(/\s+[+-]\d+(?:\.\d+)?\s*$/g,"");
        const first=market==="total"?/^over\b/i.test(label):cbbSplitTeamMatches(label,names(args.game),"home");
        const second=market==="total"?/^under\b/i.test(label):cbbSplitTeamMatches(label,names(args.game),"away");
        return first===second?null:{side:first?"first":"second",money:side.moneyPct/100,tickets:side.betsPct/100};
      });
      const a=picked.find(row=>row?.side==="first"),b=picked.find(row=>row?.side==="second");
      if(!a||!b||picked.filter(Boolean).length!==2)continue;
      // The durable network timestamp is a capture upper bound. Its table has
      // no own-contract line and cannot establish a same-book price response.
      out.push({gameId:args.game.id,market,sourceBook:"draftkings_network",physicalFamily:"draftkings",
        sourceClass:"retail_network",provider:"draftkings_network",sourceEventId:matched[0].providerEventId,line:null,
        firstMoney:a.money,secondMoney:b.money,firstTickets:a.tickets,secondTickets:b.tickets,
        observedAt:null,availableBy:feed.fetchedAt,receiptEarliest:new Date(pageCapturedAt).toISOString(),
        clockBasis:"capture_upper_bound",observationIds:[]});
    }
  }
  // One latest state per physical family and market; the network and Owls
  // DraftKings observations never become independent votes.
  const families=new Map<string,CbbDecisionSplitContext[]>();
  for(const row of out.filter(row=>qualified(row,at))){const key=`${row.physicalFamily}:${row.market}`;
    families.set(key,[...(families.get(key)??[]),row]);}
  const latest:CbbDecisionSplitContext[]=[];
  for(const rows of families.values()){
    // Availability admits evidence into the decision. It does not make an old
    // provider observation newer than a previously captured provider state.
    const known=rows.filter(row=>row.observedAt!==null);
    const candidates=known.length?known:rows;
    const sourceTime=(row:CbbDecisionSplitContext)=>Date.parse(row.observedAt??row.availableBy);
    const newest=Math.max(...candidates.map(sourceTime));
    const contemporaries=candidates.filter(row=>sourceTime(row)===newest);
    const economic=(row:CbbDecisionSplitContext)=>JSON.stringify([row.line,row.firstMoney,row.secondMoney,row.firstTickets,row.secondTickets]);
    if(new Set(contemporaries.map(economic)).size!==1)continue;
    latest.push(contemporaries.sort((a,b)=>Date.parse(a.availableBy)-Date.parse(b.availableBy))[0]);
  }
  return latest.sort((a,b)=>a.market.localeCompare(b.market)||a.physicalFamily.localeCompare(b.physicalFamily));
}
