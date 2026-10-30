import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import {parseOwlsPredictionMarkets,matchPredictionMarketGame,mergePredictionMarketFeeds,isPredictionMarketFeed} from "../lib/providers/owls/owlsPredictionMarkets";
import {parseContractFeed,contractsForPublishedReaders,resolveReaderContract} from "../lib/providers/owls/predictionMarketContracts";
import {capturePredictionMarketPrelock,readPredictionMarketPrelock} from "../lib/providers/owls/predictionMarketPrelock";
import {kalshiRescheduleWindow} from "../lib/providers/owls/predictionMarketEventDate";
import type {DailyEdgeGameDto} from "../app/lab/lib/labTypes";

const now=Date.parse("2026-10-30T21:35:00Z"),iso=(n:number)=>new Date(n).toISOString();
// Real Illinois contract shape: winner keeps Oct 30; spread/total use Oct 31.
const policy="If the game is postponed but begins within 48 hours of its originally scheduled start time, the market will remain open and resolve based on the official final result.";
const raw=(kind:"GAME"|"SPREAD"|"TOTAL",code:string,day=kind==="GAME"?30:31,p=.5)=>({
 status:"active",market_type:"binary",event_ticker:`KXNCAAF${kind}-26OCT${day}ILLMD`,ticker:`KXNCAAF${kind}-26OCT${day}ILLMD-${code}`,
 yes_sub_title:code==="ILL"?"Illinois":code==="MD"?"Maryland":code==="ILL3"?"Illinois wins by over 2.5 points":"Over 54.5 points",
 yes_bid_dollars:String(p-.005),yes_ask_dollars:String(p+.005),volume_fp:"1000",volume_24h_fp:"20",
 floor_strike:kind==="SPREAD"?2.5:kind==="TOTAL"?54.5:undefined,strike_type:kind==="GAME"?"structured":"greater",
 rules_primary:`This is the Illinois vs Maryland college football game originally scheduled for Oct ${day}, 2026.`,rules_secondary:policy,
});
const envelope=(data:ReturnType<typeof raw>[])=>({success:true,meta:{cacheTimestamp:iso(now)},data:Object.fromEntries(data.map(r=>[r.ticker,r]))});
const winnerRaw=[raw("GAME","ILL",30,.55),raw("GAME","MD",30,.45)];
const feed=parseOwlsPredictionMarkets(envelope(winnerRaw),"cfb",now)!;
const game={id:"cfb-457751",external_id:457751,sport:"cfb",awayTeam:"ILL",homeTeam:"MD",awayTeamDisplayName:"Illinois Fighting Illini",homeTeamDisplayName:"Maryland Terrapins",gameStartAt:"2026-10-31T16:00:00Z",lockState:"open",lockedAt:null,markets:{moneyline:{pick:"ILL",line:null},total:{pick:"Over 54.5",line:54.5},first_inning:{pick:"ILL -2.5",line:-2.5}}}as DailyEdgeGameDto;
const identity={...game,sport:"cfb"as const,gameStartAt:game.gameStartAt!};
const before=JSON.stringify({game,feed}),match=matchPredictionMarketGame(feed,identity,now)!;
assert.ok(match);assert.equal(match.eventTicker,"KXNCAAFGAME-26OCT30ILLMD");assert.equal(match.rescheduledGameDate,"2026-10-31");
assert.equal(match.outcomes[0].side,"away");assert.equal(match.outcomes[0].label,"ILL");
assert.ok(feed.rows.every(r=>r.gameDate==="2026-10-30"&&r.rescheduleWindowHours===48),"original provider identity remains intact");
assert.ok(isPredictionMarketFeed(feed,"cfb"));
const unknown=parseOwlsPredictionMarkets(envelope(winnerRaw.map(r=>({...r,rules_secondary:""}))),"cfb",now)!;
assert.equal(matchPredictionMarketGame(unknown,identity,now),null,"an unproven policy cannot widen dates");
for(const changes of[{lockState:undefined},{lockState:"locked"},{lockState:"locking"},{lockState:"missed"},{lockedAt:iso(now-1)},{lockedAt:"invalid"},{gameStartAt:"2026-11-01T16:00:00Z"},{gameStartAt:"2026-10-29T16:00:00Z"},{awayTeam:"Iowa",awayTeamDisplayName:"Iowa Hawkeyes"}]){
 assert.equal(matchPredictionMarketGame(feed,{...identity,...changes},now),null,JSON.stringify(changes));
}
assert.equal(matchPredictionMarketGame(feed,identity,Date.parse(game.gameStartAt!)+1),null,"a started next-day game cannot acquire a new match");
assert.equal(kalshiRescheduleWindow({...winnerRaw[0],rules_secondary:policy.replace("48 hours","24 hours")},"cfb","2026-10-30"),undefined);
assert.equal(kalshiRescheduleWindow(winnerRaw[0],"nba","2026-10-30"),undefined);
assert.equal(kalshiRescheduleWindow(winnerRaw[0],"cfb","2026-10-31"),undefined,"the stated original date must agree with the ticker");
const partial={...feed,rows:feed.rows.map((r,i)=>i?{...r,rescheduleWindowHours:undefined}:r)};
assert.equal(matchPredictionMarketGame(partial,identity,now),null,"both opponent contracts need the policy");
const ambiguous=parseOwlsPredictionMarkets(envelope([...winnerRaw,raw("GAME","ILL",31,.55),raw("GAME","MD",31,.45)]),"cfb",now)!;
assert.equal(matchPredictionMarketGame(ambiguous,identity,now),null,"two plausible dated events must not be guessed between");
assert.equal(matchPredictionMarketGame(feed,identity,now+25*3600_000),null,"stale quotes remain invalid");
const exactOld={...identity,gameStartAt:"2026-10-30T23:00:00Z",lockState:"locked",lockedAt:iso(now-1)};
assert.ok(matchPredictionMarketGame(unknown,exactOld,now),"existing exact-date legacy behavior is unchanged");

const spreads=parseContractFeed(envelope([raw("SPREAD","ILL3")]),"cfb","spread",now)!;
const totals=parseContractFeed(envelope([raw("TOTAL","55")]),"cfb","total",now)!;
const spreadSelection={kind:"spread"as const,side:"away"as const,line:-2.5,label:"ILL −2.5"};
const spread=resolveReaderContract(spreads,match,spreadSelection,now)!;
assert.equal(spread.eventTicker,"KXNCAAFSPREAD-26OCT31ILLMD");assert.equal(spread.context?.method,"exact");
const total=resolveReaderContract(totals,match,{kind:"total",side:"over",line:54.5,label:"Over 54.5"},now)!;
assert.equal(total.eventTicker,"KXNCAAFTOTAL-26OCT31ILLMD");
assert.equal(contractsForPublishedReaders(spreads,feed,[game],now).rows.length,1,"sole collector retains actual-date spread");
assert.equal(contractsForPublishedReaders(totals,feed,[game],now).rows.length,1,"sole collector retains actual-date total");
const oldSpread=parseContractFeed(envelope([raw("SPREAD","ILL3",30)]),"cfb","spread",now)!;
assert.equal(resolveReaderContract(oldSpread,match,spreadSelection,now)?.eventTicker,"KXNCAAFSPREAD-26OCT30ILLMD","an old-date spread needs its own explicit policy");
assert.equal(resolveReaderContract({...oldSpread,rows:oldSpread.rows.map(r=>({...r,rescheduleWindowHours:undefined}))},match,spreadSelection,now),null);
assert.equal(resolveReaderContract({...spreads,rows:[...oldSpread.rows,...spreads.rows]},match,spreadSelection,now)?.eventTicker,"KXNCAAFSPREAD-26OCT31ILLMD","actual dated contract wins without mixing thresholds or histories");
const merged=mergePredictionMarketFeeds(feed,parseOwlsPredictionMarkets(envelope(winnerRaw),"cfb",now)!,now);
assert.equal(merged.rows[0].rescheduleWindowHours,48);
const archive=capturePredictionMarketPrelock(null,[game],"cfb",feed,[spreads,totals],null,now);
assert.equal(archive.rows.filter(r=>r.market).length,3,"all three market-specific pre-lock receipts are captured");
const lock=now+3600_000,locked={...game,lockState:"locked",lockedAt:iso(lock)}as DailyEdgeGameDto;
const preserved=capturePredictionMarketPrelock(archive,[locked],"cfb",{...feed,rows:[]},[],null,lock+1);
for(const receipt of archive.rows)assert.strictEqual(preserved.rows.find(r=>r.key===receipt.key),receipt,"writer never replaces a locked receipt");
assert.equal(readPredictionMarketPrelock(archive,locked,"spread","away",-2.5,lock+1)?.market?.eventTicker,"KXNCAAFSPREAD-26OCT31ILLMD");
assert.equal(capturePredictionMarketPrelock(null,[locked],"cfb",feed,[spreads,totals],null,lock+1).rows.length,0,"legacy locks never acquire new evidence");
assert.equal(JSON.stringify({game,feed}),before,"scheduled time, prediction tuple and provider evidence are untouched");
for(const path of["app/api/lab/prediction-market/route.ts","lib/providers/owls/predictionMarketPrelock.ts","lib/providers/owls/predictionMarketContracts.ts","lib/services/dailyEdge/predictionMarketDisplayFeed.ts"]){
 const source=readFileSync(path,"utf8");assert.match(source,/lockState:game\??\.lockState/ ,path+": published lock state is passed to matching");
}
console.log("PASS CFB event-date matching: verified 48h policy, exact teams, next-day-only future-open guard, all three actual-date markets, no ambiguous/stale/cross-sport joins, pre-lock capture and immutable legacy locks.");
