import assert from "node:assert/strict";
import fs from "node:fs";
import {gunzipSync} from "node:zlib";
import {createHash} from "node:crypto";
import {cbbDecisionSplitContext} from "../lib/cbb/decisionSplitContext";
import type {CbbGame} from "../lib/cbb/types";
import type {DraftKingsNetworkSplitFeed} from "../lib/providers/draftkings/draftKingsNetworkSplits";

const fixture=JSON.parse(gunzipSync(fs.readFileSync(new URL("./fixtures/cbb-split-matcher-runtime-20261105.json.gz",import.meta.url))).toString()) as {
  sourceGames:CbbGame[];asOf:string;feed:DraftKingsNetworkSplitFeed;expectedHash:string;games:number;matchedGames:number;rows:number;
};
const games=fixture.sourceGames;
assert.equal(games.length,fixture.games);
const RealFormatter=Intl.DateTimeFormat;
let constructions=0;
// Native ICU allocations are invisible to V8 heap pressure. Count the scarce
// resource directly rather than relying on platform-dependent RSS/timing gates.
Intl.DateTimeFormat=new Proxy(RealFormatter,{construct(target,args){constructions++;return Reflect.construct(target,args);}});
try{
  const contexts=games.map(game=>cbbDecisionSplitContext({game,allGames:games,asOf:fixture.asOf,
    direct:{rows:[]} as unknown as Parameters<typeof cbbDecisionSplitContext>[0]["direct"],canonical:[],publicRows:[],draftKings:fixture.feed}));
  assert.equal(createHash("sha256").update(JSON.stringify(contexts)).digest("hex"),fixture.expectedHash,
    "all exact source/date/orientation/ambiguity decisions must match the pre-repair output");
  assert.equal(contexts.filter(rows=>rows.length).length,fixture.matchedGames);
  assert.equal(contexts.flat().length,fixture.rows);
  assert.ok(constructions<=1,`full-slate matching created ${constructions} ICU formatters`);
  console.log(JSON.stringify({games:games.length,sourceGames:fixture.feed.games.length,matchedGames:fixture.matchedGames,
    splitRows:fixture.rows,exactPreRepairOutput:true,formatterConstructions:constructions,
    maxRssKb:process.resourceUsage().maxRSS,networkRequests:0,productionWrites:0}));
}finally{Intl.DateTimeFormat=RealFormatter;}
