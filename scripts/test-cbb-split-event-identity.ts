import assert from "node:assert/strict";
import { cbbCurrentSplitEvidence } from "../lib/cbb/owlsSplitEvidence";
import type { CbbGame } from "../lib/cbb/types";

const at="2026-11-02T14:00:00Z",date="2026-11-03T00:00:00Z";
const game={id:1,date,home_team:{id:2,full_name:"Michigan State Spartans",college:"Michigan State"},visitor_team:{id:3,full_name:"Quinnipiac Bobcats",college:"Quinnipiac"}} as CbbGame;
const event={id:"book-native-id",sport:"ncaab",home_team:"Michigan St",away_team:"Quinnipiac",commence_time:date};
const row={event_id:"ncaab:Quinnipiac@Michigan St-20261103",home_team:"Michigan St",away_team:"Quinnipiac",splits:[{book:"circa",as_of:"2026-11-02T12:11:00Z",moneyline:{home_bets_pct:60,away_bets_pct:40,home_handle_pct:70,away_handle_pct:30}}]};
const odds={success:true,data:[event,{...event,id:"another-book-id"}]},splits={sport:"ncaab",data:[row]};
const read=(source=splits,prices=odds)=>cbbCurrentSplitEvidence(game,prices,source,at,at);
assert.equal(read().rows.length,2,"book-native odds IDs differ from the split feed's exact paired institution/date ID");
assert.equal(read().eventId,row.event_id);assert.equal(read().rows[0].observedAt,"2026-11-02T12:11:00.000Z");
assert.equal(read({...splits,data:[{...row,event_id:row.event_id.replace("20261103","20261104")}]}).rows.length,0);
assert.equal(read({...splits,sport:"ncaaw"}).rows.length,0);
assert.equal(read({...splits,data:[{...row,home_team:"Michigan"}]}).rows.length,0);
assert.equal(read({...splits,data:[row,{...row,event_id:"ncaab:Quinnipiac@Michigan State-20261103"}]}).rows.length,0,"ambiguous source fixtures cannot become one game");
assert.equal(read(splits,{...odds,data:[{...event,commence_time:"2026-11-03T01:00:00Z"}]}).rows.length,0);
assert.equal(read({...splits,data:[{...row,splits:[{...row.splits[0],as_of:"2026-11-02T10:59:00Z"}]}]}).rows.length,0);
console.log("CBB source splits: cross-endpoint IDs, verified institutions/dates, real source age, competition, time and ambiguity guards passed.");
