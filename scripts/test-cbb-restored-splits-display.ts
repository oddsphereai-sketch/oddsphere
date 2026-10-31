import assert from "node:assert/strict";
import type { DailyEdgeResponse } from "../app/lab/lib/labTypes";
import { CBB_READER_EVIDENCE_RELEASE, mergeCbbReaderEvidence } from "../lib/services/cbb/cbbReaderMarketEvidence";

const now=Date.parse("2026-10-31T14:00:00Z");
const observed="2026-10-31T13:55:00Z";
const market={pick:"HOME ML",line:null,priceAmerican:-110,currentPriceAmerican:-110,modelProb:.55,
  verdict:{key:"lean",label:"Lean"},sportsbookSplits:null,sharpBookAvailability:{status:"pending"}};
const board={sport:"cbb",games:[{id:"cbb-123",external_id:123,homeTeam:"HOME",awayTeam:"AWAY",
  lockState:"open",lockedAt:null,gameStartAt:"2026-11-01T19:00:00Z",projected:{home:73,away:70},
  markets:{moneyline:structuredClone(market),total:{...market,pick:"Over 140.5",line:140.5},first_inning:{...market,pick:"HOME -3.5",line:-3.5}}}]} as unknown as DailyEdgeResponse;
const pair=(book="draftkings",at=observed)=>["away","home"].map((side,index)=>({canonical_event_id:"123",market_type:"moneyline",
  selection_key:`123:moneyline:${side}`,bets_pct:index?.53:.47,money_pct:index?.67:.33,provider:"owls",source_book:book,
  source_type:book==="circa"?"sharp_adjacent_book":"retail_book",source_observed_at:at,fetched_at:"2026-10-31T13:59:00Z"}));
const render=(rows:Parameters<typeof mergeCbbReaderEvidence>[2],input=board)=>mergeCbbReaderEvidence(input,null,rows,now);
const inputBytes=JSON.stringify(board);
const restored=render(pair());
const section=restored.games[0].markets.moneyline.sportsbookSplits!;
assert.equal(section.sourceBook,"draftkings");
assert.equal(section.sourceObservedAt,observed);
assert.deepEqual(section.rows.map(row=>[row.side,row.betsPct,row.moneyPct]),[["away",47,33],["home",53,67]]);
assert.equal(restored.games[0].markets.moneyline.sharpBookAvailability?.status,"complete");
assert.equal(JSON.stringify(board),inputBytes,"reader cannot mutate its stored input");
const primary=(input:DailyEdgeResponse)=>JSON.stringify({...input,games:input.games.map(game=>({...game,markets:Object.fromEntries(
  Object.entries(game.markets).map(([key,value])=>{const {sportsbookSplits,sharpBookAvailability,...unchanged}=value;void sportsbookSplits;void sharpBookAvailability;return[key,unchanged];}))}))});
assert.equal(primary(restored),primary(board),"forecast, exact price, grade, stake and model evidence must remain unchanged");

assert.equal(render([...pair("circa","2026-10-31T13:00:00Z"),...pair()]).games[0].markets.moneyline.sportsbookSplits?.sourceBook,"circa");
assert.equal(render([...pair("circa","2026-10-31T09:00:00Z"),...pair()]).games[0].markets.moneyline.sportsbookSplits?.sourceBook,"draftkings");
const preferred=structuredClone(restored);preferred.games[0].markets.moneyline.sportsbookSplits={...section,sourceBook:"circa"};
assert.equal(render(pair(),preferred).games[0].markets.moneyline.sportsbookSplits?.sourceBook,"circa","fresh stored Circa retains priority");
for(const rows of [
  pair().slice(0,1),
  pair().map(row=>({...row,money_pct:null})),
  pair().map(row=>({...row,provider:"playbook"})),
  pair().map(row=>({...row,source_type:"multi_book_consensus"})),
  pair().map(row=>({...row,canonical_event_id:"456"})),
  pair().map((row,index)=>({...row,source_observed_at:index?"2026-10-31T13:56:00Z":observed})),
  pair("draftkings","2026-10-31T14:01:00Z"),
  pair("draftkings","2026-10-31T09:00:00Z"),
  pair().map(row=>({...row,bets_pct:.8})),
  [...pair(),{...pair()[0],money_pct:.5}],
]) assert.equal(render(rows).games[0].markets.moneyline.sportsbookSplits,null,"invalid/partial/mismatched source pairs must not display");
assert.equal(render([...pair(),...pair()]).games[0].markets.moneyline.sportsbookSplits?.sourceBook,"draftkings","identical repeated polls retain one pair");
for(const game of [
  {...board.games[0],lockState:"locked" as const,lockedAt:"2026-10-31T12:00:00Z"},
  {...board.games[0],lockedAt:"2026-10-31T12:00:00Z"},
  {...board.games[0],gameStartAt:"2026-10-31T13:00:00Z"},
]){
  const input={...board,games:[game]},bytes=JSON.stringify(input);
  const result=render(pair(),input);
  assert.strictEqual(result.games[0],game,"locked/started public cards retain exact object precedence");
  assert.equal(JSON.stringify(input),bytes);
  assert.equal(JSON.stringify(result),bytes);
}
assert.equal(CBB_READER_EVIDENCE_RELEASE,"cbb_reader_evidence_2026_10_31_r2_restored_named_book_display");
console.log("CBB restored named-book display: source identity, percentages, chronology, priority, immutable locks and decision neutrality passed.");
