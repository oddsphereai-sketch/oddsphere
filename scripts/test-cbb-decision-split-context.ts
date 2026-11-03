import assert from "node:assert/strict";
import {cbbDecisionSplitContext,readCbbDecisionSplits} from "../lib/cbb/decisionSplitContext";
import type {CbbGame} from "../lib/cbb/types";
import type {cbbCurrentSplitEvidence} from "../lib/cbb/owlsSplitEvidence";
import type {DraftKingsNetworkSplitFeed} from "../lib/providers/draftkings/draftKingsNetworkSplits";
import type {CbbCapturedPublicSplitRow} from "../lib/services/cbb/cbbReaderMarketEvidence";

const at="2026-11-03T19:32:37Z",observed="2026-11-03T19:30:25Z";
const team=(id:number,college:string)=>({id,college,name:college,full_name:college,abbreviation:college.slice(0,3),conference_id:1});
const game:CbbGame={id:10882598,date:"2026-11-04T01:00:00Z",season:2026,status:"pre",period:0,
  home_team:team(287,"Texas A&M"),visitor_team:team(291,"Alabama State"),home_score:0,away_score:0};
const direct={rows:[{market:"spread",sourceBook:"draftkings",observedAt:"2026-11-03T19:30:00Z",selection:"first",gameId:game.id,
  sourceLine:-32.5,sourceEventId:"named:alst-tam",fetchedAt:"2026-11-03T19:30:03Z",orientationVerified:true,ticketsPct:.55,moneyPct:.69},
  {market:"spread",sourceBook:"draftkings",observedAt:"2026-11-03T19:30:00Z",selection:"second",gameId:game.id,
  sourceLine:-32.5,sourceEventId:"named:alst-tam",fetchedAt:"2026-11-03T19:30:03Z",orientationVerified:true,ticketsPct:.45,moneyPct:.31}]} as ReturnType<typeof cbbCurrentSplitEvidence>;
const publicRows=(side:"home"|"away",money:number,tickets:number):CbbCapturedPublicSplitRow=>({canonical_event_id:String(game.id),market_type:"spread",
  selection_key:`${game.id}:spread:${side}`,bets_pct:tickets,money_pct:money,provider:"playbook",source_book:"consensus",
  source_type:"multi_book_consensus",source_observed_at:observed,fetched_at:"2026-11-03T19:31:00Z"});
const feed:DraftKingsNetworkSplitFeed={source:"draftkings_network",sport:"NCAA Basketball",fetchedAt:"2026-11-03T19:29:00Z",games:[{
  providerEventId:"123",awayName:"Alabama State",homeName:"Texas A&M",monthDay:"11/3",markets:{spread:{market:"spread",sides:[
    {label:"Texas A&M -32.5",moneyPct:69,betsPct:55},{label:"Alabama State +32.5",moneyPct:31,betsPct:45}]}}}]};
const rows=cbbDecisionSplitContext({game,allGames:[game],asOf:at,direct,canonical:[],
  publicRows:[publicRows("home",.73,.70),publicRows("away",.27,.30)],draftKings:feed});
assert.equal(rows.length,2,"Owls and network DraftKings are one physical family, alongside public consensus");
const dk=rows.find(row=>row.physicalFamily==="draftkings")!;
assert.equal(dk.provider,"owls","newer native named observation wins over older network capture");
assert.equal(dk.line,-32.5);assert.equal(dk.firstMoney,.69);
const publicRead=readCbbDecisionSplits(rows,"spread",-32.5,"second");
assert.deepEqual(publicRead.map(row=>[row.sourceClass,row.money,row.tickets,row.contract]),[
  ["retail_named_book","opposes","opposes","exact"],
  ["multi_book_consensus","opposes","opposes","line_unavailable"]]);
const stale=cbbDecisionSplitContext({game,allGames:[game],asOf:"2026-11-04T00:00:00Z",direct,canonical:[],publicRows:[],draftKings:null});
assert.equal(stale.length,0,"old retail split context cannot revive at a later decision");
const duplicate={...game,id:9};
const ambiguous=cbbDecisionSplitContext({game,allGames:[game,duplicate],asOf:at,direct:{...direct,rows:[]},canonical:[],publicRows:[],draftKings:feed});
assert.equal(ambiguous.length,0,"month/day network identity cannot choose among same-day duplicate fixtures");
console.log("PASS CBB predecision split context: source class, own line, physical-family deduplication, clocks and ambiguous fixture rejection");
