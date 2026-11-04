import assert from "node:assert/strict";
import {matchCbbProviderVenue} from "../lib/cbb/providerVenueIdentity";
import type{CbbGame}from"../lib/cbb/types";
const g={id:1,date:"2026-11-03T00:00:00Z",home_team:{id:108,college:"Presbyterian",full_name:"Presbyterian Blue Hose"},visitor_team:{id:332,college:"St. Thomas-Minnesota",full_name:"St. Thomas-Minnesota Tommies"}}as CbbGame;
const event={id:"401920842",date:g.date,competitions:[{neutralSite:false,timeValid:true,competitors:[{homeAway:"home",team:{id:"2506",location:"Presbyterian",displayName:"Presbyterian Blue Hose"}},{homeAway:"away",team:{id:"2900",location:"St. Thomas",displayName:"St. Thomas Tommies"}}]}]};
assert.equal(matchCbbProviderVenue(g,[event],"2026-11-02T12:00:00Z")?.timeConfirmed,true);
for(const id of["2901",undefined])assert.equal(matchCbbProviderVenue(g,[{...event,competitions:event.competitions.map(c=>({...c,competitors:c.competitors.map(t=>t.homeAway==="away"?{...t,team:{...t.team,id}}:t)}))}],"2026-11-02T12:00:00Z"),null,"short ambiguous school text needs the verified external ID");
assert.equal(matchCbbProviderVenue(g,[event,event],"2026-11-02T12:00:00Z"),null);
assert.equal(matchCbbProviderVenue(g,[{...event,date:"2026-11-04T00:00:00Z"}],"2026-11-02T12:00:00Z"),null);
const uno={id:10882595,date:"2026-11-04T01:00:00Z",home_team:{id:280,college:"LSU",full_name:"LSU Tigers"},
  visitor_team:{id:317,college:"New Orleans",full_name:"New Orleans Privateers"}}as CbbGame;
const lsuEvent={id:"401921808",date:uno.date,competitions:[{neutralSite:false,timeValid:true,competitors:[
  {homeAway:"home",team:{id:"99",location:"LSU",displayName:"LSU Tigers"}},
  {homeAway:"away",team:{id:"2443",location:"LSU New Orleans",displayName:"LSU New Orleans Privateers"}}]}]};
assert.equal(matchCbbProviderVenue(uno,[lsuEvent],"2026-11-03T17:00:00Z")?.neutral,false);
for(const id of["2444",undefined])assert.equal(matchCbbProviderVenue(uno,[{...lsuEvent,competitions:lsuEvent.competitions.map(c=>({...c,
  competitors:c.competitors.map(t=>t.homeAway==="away"?{...t,team:{...t.team,id}}:t)}))}],"2026-11-03T17:00:00Z"),null);
assert.equal(matchCbbProviderVenue(uno,[lsuEvent,lsuEvent],"2026-11-03T17:00:00Z"),null);
console.log("CBB official venue identity: verified institution IDs restore the actual model input; wrong IDs, dates and ambiguity fail.");
