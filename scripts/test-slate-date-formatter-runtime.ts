import assert from "node:assert/strict";
import {computeSlateDate,currentDailyEdgeBoardDate,currentSoccerBoardDate,slateTimezone} from "../lib/dates/slateDate";
import {__TEST__ as draftKingsDates} from "../lib/providers/draftkings/draftKingsNetworkSplits";
import type {DailyEdgeGameDto} from "../app/lab/lib/labTypes";
import type {Sport} from "../lib/types/domain/Sport";
const sports:Sport[]=["mlb","nba","nfl","cbb","cfb","nhl","wnba","ucl","soccer"];
// UTC/ET/London midnight, leap day, and both timezone DST changes.
const instants=["2024-02-29T23:59:59Z","2024-03-01T00:00:00Z","2026-03-08T06:59:59Z","2026-03-08T07:00:00Z",
  "2026-03-29T00:59:59Z","2026-03-29T01:00:00Z","2026-10-25T00:59:59Z","2026-10-25T01:00:00Z",
  "2026-11-01T05:59:59Z","2026-11-01T06:00:00Z","2026-11-05T04:59:59Z","2026-11-05T05:00:00Z",
  "2026-12-31T23:59:59Z","2027-01-01T00:00:00Z"];
const RealFormatter=Intl.DateTimeFormat;
const expected=new Map<string,string>();
for(const sport of sports)for(const at of instants){const parts=new RealFormatter("en-CA",{timeZone:slateTimezone(sport),year:"numeric",month:"2-digit",day:"2-digit"}).formatToParts(new Date(at));
  expected.set(`${sport}:${at}`,["year","month","day"].map(type=>parts.find(p=>p.type===type)!.value).join("-"));}
const expectedMonthDay=new Map(instants.map(at=>[at,new RealFormatter("en-US",{timeZone:"America/New_York",month:"numeric",day:"numeric"}).format(new Date(at))]));
let constructions=0;
Intl.DateTimeFormat=new Proxy(RealFormatter,{construct(target,args){constructions++;return Reflect.construct(target,args);}});
try{
  for(let round=0;round<50;round++)for(const sport of sports)for(const at of instants){
    assert.equal(computeSlateDate(sport,at),expected.get(`${sport}:${at}`));
    assert.equal(computeSlateDate(sport,new Date(at)),expected.get(`${sport}:${at}`));
  }
  for(let round=0;round<50;round++)for(const at of instants){
    assert.equal(draftKingsDates.gameMonthDay({gameStartAt:at} as DailyEdgeGameDto,"2026-11-05"),expectedMonthDay.get(at));
  }
  assert.equal(draftKingsDates.gameMonthDay({gameStartAt:null} as DailyEdgeGameDto,"2026-11-05"),"11/5");
  assert.equal(draftKingsDates.gameMonthDay({gameStartAt:"invalid"} as DailyEdgeGameDto,"2026-11-05"),"");
  // Existing overnight board-roll contracts remain exact, including DST day.
  assert.equal(currentDailyEdgeBoardDate("cbb",new Date("2026-11-01T07:59:59Z")),"2026-10-31");
  assert.equal(currentDailyEdgeBoardDate("cbb",new Date("2026-11-01T08:00:00Z")),"2026-11-01");
  assert.equal(currentSoccerBoardDate(new Date("2026-11-01T06:59:59Z")),"2026-10-31");
  assert.equal(currentSoccerBoardDate(new Date("2026-11-01T07:00:00Z")),"2026-11-01");
  assert.throws(()=>computeSlateDate("cbb","invalid"),/invalid date input/);
  assert.ok(constructions<=4,`shared slate/date helpers constructed ${constructions} native formatters`);
  console.log(JSON.stringify({dateCases:expected.size,repeatedFormats:expected.size*100,formatterConstructions:constructions,
    allSportsTimezoneParity:true,overnightRollAndDstUnchanged:true,networkRequests:0,productionWrites:0}));
}finally{Intl.DateTimeFormat=RealFormatter;}
