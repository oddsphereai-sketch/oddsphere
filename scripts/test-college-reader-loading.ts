import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import type { DailyEdgeResponse } from "../app/lab/lib/labTypes";
import { overlayCbbReaderMarketEvidence } from "../lib/services/cbb/cbbReaderMarketEvidence";
import { marketDisplayGameIdentity } from "../lib/cbb/marketDisplayIdentity";
import { matchPredictionMarketGame, PREDICTION_MARKET_RELEASE, type PredictionMarketFeed } from "../lib/providers/owls/owlsPredictionMarkets";
import { applySharpApiCurrentSplitOverlay } from "../lib/providers/real_api/sharpApiCurrentSplits";

const now=Date.parse("2026-11-01T16:00:00Z");
const game={id:"cbb-1",external_id:1,sport:"cbb",gameStartAt:"2026-11-02T04:59:00Z",lockState:"open",lockedAt:null,
  awayTeam:"LIB",homeTeam:"HPU",awayTeamDisplayName:"Liberty Flames",homeTeamDisplayName:"High Point Panthers",cbbAwayCollege:"Liberty",cbbHomeCollege:"High Point",
  markets:Object.fromEntries(["moneyline","total","first_inning"].map(k=>[k,{pick:"HPU",modelProb:.7,line:null,publicSplits:[],sportsbookSplits:null}]))} as unknown as DailyEdgeResponse["games"][number];
function feed(away:string,home:string,date="2026-11-02"):PredictionMarketFeed {
  return {release:PREDICTION_MARKET_RELEASE,sport:"cbb",fetchedAt:new Date(now).toISOString(),rows:[away,home].map((team,i)=>({
    ticker:`event-${i}`,eventTicker:"KXNCAAMBGAME-26NOV02LIBHP",sideCode:String(i),team,gameDate:date,bid:.5,ask:.5,probability:.5,
    asOf:new Date(now).toISOString(),history:[[now,.5,1]],volume24h:1,totalVolume:1}))};
}
const event={eventId:"ncaab:High Point@Liberty-20261102",away_team:"High Point",home_team:"Liberty",commence_time:game.gameStartAt!};
const before=JSON.stringify({game,event});
assert.equal(matchPredictionMarketGame(feed("Liberty","High Point"),marketDisplayGameIdentity(game,"cbb",[],now),now),null);
assert.ok(matchPredictionMarketGame(feed("Liberty","High Point"),marketDisplayGameIdentity(game,"cbb",[event],now),now),"exact odds event date proves the 23:59 placeholder's adjacent midnight date");
for(const events of [[{...event,eventId:"ncaab:High Point@Liberty-20261103"}],[{...event,eventId:"unknown"}],[{...event,away_team:"Other College"}],[event,{...event,eventId:"duplicate"}]])
  assert.equal(matchPredictionMarketGame(feed("Liberty","High Point"),marketDisplayGameIdentity(game,"cbb",events,now),now),null,"missing, wrong or ambiguous independent identity cannot shift dates");
const earlier={...game,gameStartAt:"2026-11-02T04:58:00Z"};
assert.equal(matchPredictionMarketGame(feed("Liberty","High Point"),marketDisplayGameIdentity(earlier,"cbb",[{...event,commence_time:earlier.gameStartAt}],now),now),null,"the proof cannot widen beyond the midnight minute");
const locked={...game,lockState:"locked" as const,lockedAt:new Date(now-1000).toISOString()};
assert.equal(matchPredictionMarketGame(feed("Liberty","High Point"),marketDisplayGameIdentity(locked,"cbb",[event],now),now),null,"legacy locks retain the original date semantic");
for(const [source,name,college] of [
  ["Appalachian St.","App State Mountaineers","App State"],["San Jose St.","San José State Spartans","San José State"],
  ["USC Upstate","South Carolina Upstate Spartans","South Carolina Upstate"],["NC St.","NC State Wolfpack","NC State"],
  ["Penn St.","Penn State Nittany Lions","Penn State"],["Kent St.","Kent State Golden Flashes","Kent State"],
  ["Tennessee-Martin","UT Martin Skyhawks","UT Martin"],["Seattle","Seattle U Redhawks","Seattle U"],
]) {
  const named={...game,gameStartAt:"2026-11-02T20:00:00Z",awayTeamDisplayName:name,cbbAwayCollege:college};
  const sourceFeed=feed(source,"High Point");
  assert.ok(matchPredictionMarketGame(sourceFeed,marketDisplayGameIdentity(named,"cbb",[],now),now),source);
  assert.equal(matchPredictionMarketGame(sourceFeed,marketDisplayGameIdentity({...named,awayTeamDisplayName:"Other School",cbbAwayCollege:"Other School"},"cbb",[],now),now),null,"same ticker code cannot authorize another institution");
  assert.equal(matchPredictionMarketGame(sourceFeed,marketDisplayGameIdentity({...named,lockState:"locked",lockedAt:new Date(now).toISOString()},"cbb",[],now),now),null,"new school mappings cannot reinterpret a stored legacy lock");
}
const board={sport:"cbb",date:"2026-11-01",games:[game]} as DailyEdgeResponse;
const splitFeed={source:"owls_current_splits",release:"owls_current_splits_2026_10_27_r1_complete_named_book",fetchedAt:new Date(now).toISOString(),sport:"cbb",rows:[{league:"ncaab",event_start_time:game.gameStartAt,away_team:"Liberty",home_team:"High Point",sportsbook:"circa",fetched_at:new Date(now).toISOString(),moneyline:{bets_pct:{away:40,home:60},handle_pct:{away:40,home:60}}}]} as NonNullable<Parameters<typeof applySharpApiCurrentSplitOverlay>[1]>;
const duplicated={...game,id:"cbb-2",external_id:2};
const scoped=structuredClone(board);
assert.equal(applySharpApiCurrentSplitOverlay(scoped,splitFeed,now,{identityGames:[game,duplicated]}).matchedGames,0,"a single selected game must still reject an ambiguous full-board join");
assert.equal(applySharpApiCurrentSplitOverlay(scoped,splitFeed,now,{identityGames:[game]}).matchedGames,1);
assert.equal(JSON.stringify({game,event}),before,"all source and locked values stay immutable");
async function main(){
  assert.strictEqual(await overlayCbbReaderMarketEvidence(board,{gameIds:[]}),board,"the initial board performs no evidence DB or provider work");
  const lockedBoard={...board,games:[locked]};
  assert.strictEqual(await overlayCbbReaderMarketEvidence(lockedBoard),lockedBoard,"hydration cannot alter the locked record");
  const page=readFileSync("app/lab/daily-edge/CandidateDailyEdgePage.tsx","utf8"),reader=readFileSync("app/dev/experience-preview/ActualDailyEdgePreview.tsx","utf8"),route=readFileSync("app/api/lab/cbb-game-detail/route.ts","utf8");
  assert.match(page,/gameIds: requestedGame \? \[requestedGame\] : \[\]/);
  assert.match(reader,/deferredCbbGameIds/);assert.match(reader,/\/api\/lab\/cbb-game-detail/);
  assert.match(reader,/loaded\?\.asOf === displaySnapshot.as_of/,"new publications cannot reuse stale reader evidence");
  assert.match(route,/verifyWhopSession/);assert.match(route,/isValidBetaSession/);
  assert.match(route,/overlayCbbLockedMemberGames[\s\S]*overlayCbbReaderMarketEvidence\(context/);
  console.log("College reader: lazy authenticated evidence, fresh publication cache, full-board split ambiguity, exact exchange school identities, bounded provider-date proof and immutable locks passed.");
}
void main();
