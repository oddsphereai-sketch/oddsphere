import assert from "node:assert/strict";
import { fetchCbbKalshiMarkets } from "../lib/providers/kalshi/cbbMarkets";
import { matchPredictionMarketGame, parseOwlsPredictionMarkets } from "../lib/providers/owls/owlsPredictionMarkets";
import { parseContractFeed, resolveReaderContract } from "../lib/providers/owls/predictionMarketContracts";

const now=Date.parse("2026-10-29T18:00:00Z");
const event="KXNCAAMBGAME-26NOV01NDVILL";
const winner=(side:string,team:string,bid:string,ask:string)=>({ticker:`${event}-${side}`,event_ticker:event,
  status:"active",market_type:"binary",yes_sub_title:team,yes_bid_dollars:bid,yes_ask_dollars:ask,volume_fp:"50",volume_24h_fp:"5"});
async function main(){
const pages=[{markets:[winner("ND","Notre Dame","0.24","0.25")],cursor:"next"},
  {markets:[winner("VILL","Villanova","0.75","0.76")],cursor:""}];
let calls=0;
const fetcher=(async(input:RequestInfo|URL)=>{const url=new URL(String(input));
  assert.equal(url.hostname,"api.elections.kalshi.com");
  assert.equal(url.searchParams.get("series_ticker"),"KXNCAAMBGAME");
  assert.equal(url.searchParams.get("cursor"),calls===0?null:"next");
  return Response.json(pages[calls++]);}) as typeof fetch;
const receipt=await fetchCbbKalshiMarkets("KXNCAAMBGAME",{now,fetcher});
assert.equal(receipt.requests,2);assert.equal(Object.keys(receipt.data).length,2);
const feed=parseOwlsPredictionMarkets(receipt,"cbb",now)!;
const game={sport:"cbb" as const,awayTeam:"ND",homeTeam:"VILL",awayName:"Notre Dame Fighting Irish",
  homeName:"Villanova Wildcats",awayCollege:"Notre Dame",homeCollege:"Villanova",gameStartAt:"2026-11-01T19:00:00Z"};
const match=matchPredictionMarketGame(feed,game,now)!;
assert.equal(match.source,"Kalshi direct");assert.equal(match.outcomes[0].team,"Notre Dame");
assert.equal(matchPredictionMarketGame(feed,{...game,awayCollege:"North Dakota",awayName:"North Dakota Fighting Hawks"},now),null,
  "ambiguous ND code cannot cross institutions");
const spreadEvent="KXNCAAMBSPREAD-26NOV01NDVILL";
const spread={ticker:`${spreadEvent}-VILL8`,event_ticker:spreadEvent,status:"active",market_type:"binary",
  yes_sub_title:"Villanova wins by over 7.5 points",yes_bid_dollars:"0.41",yes_ask_dollars:"0.43",
  volume_fp:"25",volume_24h_fp:"4",strike_type:"greater",floor_strike:7.5};
const contractReceipt=await fetchCbbKalshiMarkets("KXNCAAMBSPREAD",{now,eventTickers:[spreadEvent],fetcher:(async(input:RequestInfo|URL)=>{
  const url=new URL(String(input));assert.equal(url.searchParams.get("event_ticker"),spreadEvent);
  return Response.json({markets:[spread],cursor:""});}) as typeof fetch});
const contract=parseContractFeed(contractReceipt,"cbb","spread",now)!;
const selected=resolveReaderContract(contract,match,{kind:"spread",line:-7.5,side:"home",label:"VILL -7.5"},now)!;
assert.equal(selected.source,"Kalshi direct");assert.equal(selected.context?.method,"exact");
await assert.rejects(fetchCbbKalshiMarkets("KXNCAAMBGAME",{now,maxPages:1,fetcher:(async()=>Response.json(pages[0])) as typeof fetch}),/bounded pagination/,
  "partial winner pages must never be published as complete");
console.log("CBB Kalshi: direct source, complete pagination, exact institution and selected spread identity passed.");
}
void main();
