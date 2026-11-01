import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import React from "react";
import {renderToStaticMarkup} from "react-dom/server";
import {PredictionMarketChart,RecordedSportsbookHistory} from "../app/lab/components/daily-edge/PredictionMarketPanel";
import {predictionMarketAllowsStandaloneHistory,predictionMarketVisibleComparison,type PredictionMarketBookTrail} from "../app/lab/lib/predictionMarketDisplay";

const at=(minute:number)=>Date.parse(`2026-11-01T16:${minute}:00Z`);
const row={ticker:"KXNFLSPREAD-26NOV01TENCIN-CIN14",eventTicker:"KXNFLSPREAD-26NOV01TENCIN",sideCode:"CIN",team:"Cincinnati",gameDate:"2026-11-01",
 label:"CIN −13.5",side:"home" as const,bid:.48,ask:.50,probability:.49,asOf:new Date(at(55)).toISOString(),volume24h:100,totalVolume:500,
 history:[[at(10),.47,null],[at(30),.48,null],[at(55),.49,null]]as[number,number,number|null][]};
const book:PredictionMarketBookTrail={sportsbook:"fanduel",line:-13.5,locked:false,points:[[at(50),110/210,-110]]};
const before=JSON.stringify({row,book});
const legacy=predictionMarketVisibleComparison(row,book,undefined,false);
assert.equal(legacy.shared,false,"a newly selected sportsbook line has no nonzero comparison window");
const live=predictionMarketVisibleComparison(row,book,undefined,predictionMarketAllowsStandaloneHistory("nfl",false,false));
assert.equal(live.standalone,true,"NFL must not hide real Kalshi history because the sportsbook has only its current quote");
assert.equal(live.book,null,"one quote is not presented as a shared sportsbook timeline");
assert.deepEqual(live.comparison.points,row.history);
const chart=renderToStaticMarkup(<PredictionMarketChart row={row} book={live.book} context={undefined} bookLabel="CIN −13.5"/>);
assert.match(chart,/data-kalshi-line/);
assert.doesNotMatch(chart,/data-sportsbook-line|NaN|Infinity/);
const separate=renderToStaticMarkup(<RecordedSportsbookHistory book={book} label="CIN −13.5"/>);
assert.match(separate,/data-sportsbook-line="fanduel"/);
assert.match(separate,/single quote/);
assert.match(separate,new RegExp(`data-observed-at="${at(50)}"`));

// Frozen fields/endpoint retain precedence; only an existing eligible receipt
// permits this view. Neither later quotes nor legacy missing receipts qualify.
const boundary=at(52),lockedBook={...book,locked:true};
assert.equal(predictionMarketAllowsStandaloneHistory("nfl",true,false),false);
const frozen=predictionMarketVisibleComparison(row,lockedBook,boundary,predictionMarketAllowsStandaloneHistory("nfl",true,true));
assert.equal(frozen.standalone,true);
assert.deepEqual(frozen.comparison.points,row.history.slice(0,2));
const frozenHtml=renderToStaticMarkup(<PredictionMarketChart row={row} book={null} context={undefined} bookLabel="CIN −13.5" lockedAt={boundary}/>);
assert.doesNotMatch(frozenHtml,new RegExp(`data-observed-at="${at(55)}"`));
assert.equal(predictionMarketAllowsStandaloneHistory("nba",false,false),false,"other sport semantics are unchanged");
assert.equal(predictionMarketAllowsStandaloneHistory("cbb",true,true),false,"legacy CBB lock precedence is unchanged");
for(const sport of ["cbb","cfb","nba","nhl","mlb","wnba","soccer"])
 for(const frozen of [false,true])for(const receipt of [false,true])for(const historicalCfb of [false,true])
  assert.equal(predictionMarketAllowsStandaloneHistory(sport,frozen,receipt,historicalCfb),
   sport==="cbb"&&!frozen||sport==="cfb"&&(!frozen||receipt||historicalCfb),"all pre-existing sport/lock policies retain exact precedence");
assert.equal(JSON.stringify({row,book}),before,"no stored source, grade, prediction or lock payload is mutated");
const panel=readFileSync("app/lab/components/daily-edge/PredictionMarketPanel.tsx","utf8");
assert.match(panel,/predictionMarketAllowsStandaloneHistory\(game.sport,frozen,!!current.prelockCapturedAt,historicalCfb\)/,"production panel uses the tested NFL policy");
console.log("NFL charts: single-quote sportsbook cannot erase Kalshi history; source separation, pre-lock ceiling and legacy lock precedence passed");
