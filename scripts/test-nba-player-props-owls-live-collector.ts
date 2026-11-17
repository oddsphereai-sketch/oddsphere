import assert from "node:assert/strict";
import {liveNbaPacket} from "../lib/playerPropsAi/liveSources";

import { collectNbaPlayerPropsLiveMarket } from "../lib/services/nba/nbaPlayerPropsLiveCollector";

const start = new Date(Date.now() + 6 * 60 * 60_000).toISOString();
const observedAt = new Date().toISOString();
const urls: string[] = [];
const fetchImpl: typeof fetch = async (input) => {
  const url = String(input);
  urls.push(url);
  if (url.includes("api.balldontlie.io/v1/games")) {
    const regular = url.includes("season_type=regular");
    return json({ data: regular ? [{
      id: 99,
      datetime: start,
      home_team: { id: 1, abbreviation: "NYK" },
      visitor_team: { id: 2, abbreviation: "BOS" },
    }] : [] });
  }
  if (url.includes("api.balldontlie.io/v2/odds/player_props")) {
    return json({ data: [{
      id: "bdl-prop",
      game_id: 99,
      player_id: 10,
      team_id: 2,
      player: { id: 10, first_name: "Test", last_name: "Player", team_id: 2 },
      vendor: "fanduel",
      prop_type: "points",
      line_value: 20.5,
      updated_at: observedAt,
      market: { type: "over_under", over_odds: -108, under_odds: -112 },
    }] });
  }
  if (url.includes("api.owlsinsight.com/api/v1/nba/props")) {
    return json({ data: [{
      gameId: "owls-game",
      commenceTime: start,
      homeTeam: "NYK",
      awayTeam: "BOS",
      isLive: false,
      books: [{
        key: "pinnacle",
        lastUpdate: observedAt,
        props: [{
          propId: "owls-prop",
          category: "points",
          playerName: "Test Player",
          team: "BOS",
          line: 20.5,
          overPrice: -105,
          underPrice: -115,
          lastUpdate: observedAt,
        }],
      }],
    }] });
  }
  throw new Error(`Unexpected provider request ${url}`);
};

async function main(): Promise<void> {
  const result = await collectNbaPlayerPropsLiveMarket({
    slateDate: start.slice(0, 10),
    ballDontLieApiKey: "bdl-test",
    theOddsApiKey: "odds-test",
    owlsInsightApiKey: "owls-test",
    includeOpenings: false,
    canonicalPlayersByName: { testplayer: "nba-bdl-player:10" },
    fetchImpl,
  });

  assert.deepEqual(result.providerRequests, { balldontlie: 3, theOddsApi: 0, owls: 1 });
  assert.equal(result.theOddsApiCreditsUsed, 0);
  assert.equal(urls.filter((url) => url.includes("api.owlsinsight.com/api/v1/nba/props")).length, 1,
    "one bounded Owl league request is permitted per collection cycle");
  assert.equal(urls.some((url) => url.includes("api.the-odds-api.com")), false,
    "the paid Odds API gap lane must stay idle when BDL plus Owl corroborate the scope");
  assert.equal(result.observations.filter((row) => row.provider === "balldontlie").length, 2);
  assert.equal(result.observations.filter((row) => row.provider === "owls").length, 2);
  assert(result.observations.every((row) => row.canonicalGameId === "nba-bdl:99"));
  assert(result.observations.filter((row) => row.provider === "owls")
    .every((row) => row.canonicalPlayerId === "nba-bdl-player:10"));
  assert.equal(result.findings.some((finding) => finding.includes("failed") || finding.includes("unmatched")), false);

  // A played-team cache must not masquerade as current roster evidence or
  // suppress the already supported ordinary bounded identity lookup.
  for(const mode of ['current','failed','continued','conflicting','incomplete','unexpected','malformed_null','malformed_boolean','malformed_string','malformed_number','malformed_array','malformed_nested'] as const){
    const calls:string[]=[];
    const source:typeof fetch=async(input,init)=>{
      const url=String(input);calls.push(url);
      if(url.includes('/v1/players?')){
        const parsed=new URL(url);assert.equal(parsed.searchParams.get('per_page'),'100');assert.deepEqual(parsed.searchParams.getAll('player_ids[]'),['10']);
        if(mode==='failed')return new Response('{}',{status:500});
        const player={id:10,first_name:'Test',last_name:'Player',team_id:2};
        const malformed:Record<string,unknown>={malformed_null:null,malformed_boolean:false,malformed_string:'bad',malformed_number:42,malformed_array:[],malformed_nested:['nested']};
        if(Object.hasOwn(malformed,mode))return json({data:[player,malformed[mode]]});
        return json({data:mode==='conflicting'?[player,{...player,team_id:1}]:mode==='incomplete'?[]:mode==='unexpected'?[{...player,id:999}]:[player],...(mode==='continued'?{meta:{next_cursor:20}}:{})});
      }
      const response=await fetchImpl(input,init);
      if(url.includes('/v2/odds/player_props')){const body=await response.json();for(const row of body.data){delete row.team_id;delete row.player.team_id;}return json(body);}
      return response;
    };
    const current=await collectNbaPlayerPropsLiveMarket({slateDate:start.slice(0,10),ballDontLieApiKey:'synthetic',includeOpenings:false,knownPlayerIdentitiesById:{'10':{playerName:'Test Player',playerTeam:'1'}},fetchImpl:source});
    assert.equal(calls.filter(url=>url.includes('/v1/players?')).length,1);assert.equal(current.providerRequests.balldontlie,4,'Failed identity request attempts count too');
    assert(current.observations.every(row=>row.playerTeam===(mode==='current'?'2':null)),'Only explicit consistent current identity can fill quote team; cache team is never donated');
    if(mode==='current')assert(current.observations.every(row=>row.playerIdentityAvailableAt&&Date.parse(row.playerIdentityAvailableAt)>=Date.parse(row.receivedAt!)),'Lookup has its own availability clock, never a price receipt rewrite');

    const cutoff=new Date().toISOString(),game={id:'nba-bdl:99',start,home:'NYK',away:'BOS'},state={updatedAt:cutoff,games:[{gameId:1,homeTeamId:1,awayTeamId:2,homeTeam:'NYK',awayTeam:'BOS',startTime:'2026-11-01T00:00:00Z'}],boxes:[],advanced:[],players:[]};
    const packetArgs={game,window:{gameId:game.id,stage:'early',cutoff,lock:new Date(Date.parse(start)-3600000).toISOString()},snapshot:{generatedAt:cutoff,slateDate:start.slice(0,10),games:[{gameId:game.id,scheduledStart:start,homeTeam:'NYK',awayTeam:'BOS'}],decisions:[]},market:{updatedAt:cutoff,observations:current.observations},prior:state,current:state,currentObservations:current.observations} as unknown as Parameters<typeof liveNbaPacket>[0];
    if(mode==='current'){const packet=liveNbaPacket(packetArgs);assert.equal(packet.players[0].team,'BOS');assert.equal(packet.executionQuotes?.length,2);}
    else{assert(current.findings.includes('balldontlie_player_identity_lookup_failed:1'));assert(current.observations.every(row=>row.playerIdentityAvailableAt===undefined),'Rejected whole batch cannot donate metadata availability or a team');assert.throws(()=>liveNbaPacket(packetArgs),/NBA player\/team matchup identity incomplete/,'Malformed/incomplete metadata cannot admit an otherwise unresolved current actor');}
    assert.equal(calls.some(url=>url.includes('the-odds-api.com')||url.includes('openai.com')),false);
  }
  process.stdout.write("NBA player-props Owl live collector contract and current-versus-played team authority passed.\n");
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});

function json(body: unknown): Response {
  return new Response(JSON.stringify(body), { status: 200, headers: { "content-type": "application/json" } });
}
