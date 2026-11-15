/* eslint-disable @typescript-eslint/no-explicit-any -- Controlled hooks, hostile legacy payloads and mocked module boundaries exercise the actual client component. */
/** Actual component memo/effect/merge controls. No renderer implementation is mirrored. */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import vm from "node:vm";
import ts from "typescript";
import * as price from "../lib/mlb/props/pricePolicy";
import * as integrity from "../lib/mlb/props/projectionSideIntegrity";
import * as grades from "../lib/mlb/props/propGrades";
import * as american from "../app/lab/lib/americanOddsFilter";
import * as publicationPolicy from "../lib/mlb/props/aiPublicationPolicy";
import type { PlayerPropPreviewRow, PlayerPropsDashboardData } from "../app/mlb/props/components/PlayerPropsDashboard";

globalThis.fetch = async () => { throw new Error("Client authority proof forbids real HTTP"); };
const sourceFile = "app/mlb/props/components/PlayerPropsDashboard.tsx";
const source = process.argv.includes("--negative-baseline")
  ? execFileSync("git", ["show", `6295ecdaaaff12059a877acf19548281f661e3b1:${sourceFile}`], { encoding: "utf8" })
  : readFileSync(sourceFile, "utf8");
const clone = <T,>(value:T):T => structuredClone(value);
const equivalent = (a:unknown,b:unknown,message?:string) => assert.equal(JSON.stringify(a),JSON.stringify(b),message);
const at = "2030-06-01T19:58:00.000Z", lock = "2030-06-01T20:00:00.000Z";
const row = (patch:Record<string,unknown>={}):PlayerPropPreviewRow => ({
  id:"original",researchKey:"game|2|hits",player:"Synthetic Player",headshotUrl:null,team:"NYY",opponent:"BOS",homeAway:"home",
  gameStartTime:"2030-06-01T21:00:00.000Z",market:"batter_hits",marketLabel:"Hits",marketFamily:"batter",marketGroup:"Hits/Bases",
  offerContract:"two_way",side:"over",line:1.5,odds:-110,book:"draftkings",modelProbability:.65,independentProbability:.61,
  marketProbability:.53,finalProbability:.65,shrinkageWeight:.1,modelEdge:.12,expectedValue:.24,fairOdds:-185,units:.5,
  confidence:.8,confidenceBucket:"high",playGrade:"LEAN",source:"original",lastUpdated:at,projection:2,projectionSource:"model",
  overProbability:.65,underProbability:.35,keyFeatures:[],missingFeatures:[],reasonCodes:[],oddsSanity:[],settlementStatus:"pending",clvStatus:"pending",
  providerIds:{gameId:"game",bdlGameId:"1",bdlPlayerId:2,mlbStatsPlayerId:"stats-2"},...patch,
} as PlayerPropPreviewRow);
const locked = (patch:Record<string,unknown>={}) => row({lockStatus:{status:"locked",lockedAt:lock},...patch});
const board = (props:PlayerPropPreviewRow[],research:unknown={},date="2030-06-01"):PlayerPropsDashboardData => ({
  date,lastUpdated:at,providerStatus:{selectedOddsSource:"synthetic",sharpApi:"off",bdl:"synthetic",publicDisplayEnabled:true,paperPersistenceEnabled:false,writesToSupabase:false},
  summary:{gamesWithProps:1,scoredProps:props.length,recommendations:0,leans:props.length,watchlist:0,noPlay:0,pendingData:0,researchOnly:0,booksCovered:1,marketsAvailable:1,averageDataConfidence:.8},
  props,research,
} as PlayerPropsDashboardData);
const modules = {recentForm:{logs:[{value:2}]},opponentProfile:{label:"original opponent"},pitchArsenal:{label:"original arsenal"},
  pitchMatchup:{label:"original matchup"},matchupHistory:{label:"original history"},environment:{label:"original environment"}};
const moduleKeys = Object.keys(modules);

type Hook = {value?:any;deps?:unknown[];cleanup?:()=>void};
function componentHarness(text=source) {
  const hooks:Hook[]=[],effects:Array<{index:number;body:()=>void|(()=>void);deps?:unknown[]}>=[],requests:any[]=[];
  let cursor=0,dirty=false,instance:any,props:any;
  const sameDeps=(a?:unknown[],b?:unknown[])=>Boolean(a&&b&&a.length===b.length&&a.every((x,i)=>Object.is(x,b[i])));
  const react={
    useState(initial:any){const i=cursor++,h=hooks[i]??(hooks[i]={value:typeof initial==="function"?initial():initial});return[h.value,(next:any)=>{const value=typeof next==="function"?next(h.value):next;if(!Object.is(value,h.value)){h.value=value;dirty=true;}}];},
    useRef(initial:any){const i=cursor++,h=hooks[i]??(hooks[i]={value:{current:initial}});return h.value;},
    useMemo(make:()=>unknown,deps:unknown[]){const i=cursor++,h=hooks[i]??(hooks[i]={});if(!sameDeps(h.deps,deps)){h.value=make();h.deps=deps;}return h.value;},
    useEffect(body:()=>void|(()=>void),deps?:unknown[]){const i=cursor++;if(!sameDeps(hooks[i]?.deps,deps))effects.push({index:i,body,deps});},
  };
  const fakeFetch=(url:string,options:any)=>new Promise((resolve,reject)=>requests.push({url,options,resolve:(payload:unknown,ok=true)=>resolve({ok,status:ok?200:503,json:async()=>payload}),reject}));
  const stub = new Proxy(()=>null,{get:()=>()=>null});
  const actual:Record<string,unknown>={react,"propGrades":grades,"pricePolicy":price,"projectionSideIntegrity":integrity,
    "americanOddsFilter":american,"aiPublicationPolicy":publicationPolicy,"UserTimeZone":{useUserTimeZone:()=>"UTC",LocalTime:stub,formatZonedDateTime:()=>""},
    "jsx-runtime":{jsx:stub,jsxs:stub,Fragment:stub},"publicationContract":{needsLegacyLockedAiReader:()=>false},"teamColors":{teamPrimaryColor:()=>"#000"}};
  const uiImports=new Set(["AiPropReader","PropsAiEvidence","ProductTeamBadge","PlayerPropReaderDialog","PlayerPropsProductUi"]);
  const ast=ts.createSourceFile(sourceFile,text,ts.ScriptTarget.ES2022,true,ts.ScriptKind.TSX);
  const exposed=["enforcePreviewIntegrity","hydrateResearchEvidence","availableClientResearch","cachePlayerResearch","hasClientResearch","clientResearchRequestKey","lockedClientRowBinding","boundLockedPlayerPayload","mergeScopedBoardData","mergePlayerResponseData","mergeInitialLockedBoardData","mergeClientPropRows","mergeClientBoardResearch"];
  const present=new Set<string>();ts.forEachChild(ast,function visit(n){if(ts.isFunctionDeclaration(n)&&n.name)present.add(n.name.text);ts.forEachChild(n,visit);});
  const boundary="  if (displayProps.length === 0) {";assert(text.includes(boundary),"Actual render-state boundary must be present");
  const modified=text.replace(boundary,"  return {data,availableResearch,hydratedProps,displayProps,displayData,selected,selectedResearchPending,loadedResearch,controls:{setFullData,setSelectedGame,setMarketFilter,setMarketFamilyFilter,setSelectedId,setLoadedResearch},requestedResearchPlayers,requestedBoardScopes};\n"+boundary)
    +`\nexport const __clientAuthorityProof={${exposed.filter(n=>present.has(n)).join(",")}};`;
  const output=ts.transpileModule(modified,{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022,jsx:ts.JsxEmit.ReactJSX,esModuleInterop:true}}).outputText;
  const vmModule={exports:{} as any};vm.runInNewContext(output,{module:vmModule,exports:vmModule.exports,require:(name:string)=>{const key=name.split("/").at(-1)!;if(Object.hasOwn(actual,key))return actual[key];assert(uiImports.has(key),`Unmocked client dependency ${name}`);return new Proxy({},{get:()=>stub});},
    console,Date,Map,Set,Object,JSON,Reflect,Number,String,Array,URL,URLSearchParams,AbortController,fetch:fakeFetch,window:{location:{href:"https://example.invalid/mlb/props"},history:{replaceState:()=>{},state:null}}},{filename:"actual-player-props-client-proof.cjs"});
  const api=vmModule.exports.__clientAuthorityProof;
  const render=(next?:any)=>{if(next)props=next;cursor=0;dirty=false;effects.length=0;instance=vmModule.exports.PlayerPropsDashboard(props);for(const effect of effects){const h=hooks[effect.index]??(hooks[effect.index]={});h.cleanup?.();h.deps=effect.deps;const cleanup=effect.body();h.cleanup=typeof cleanup==="function"?cleanup:undefined;}return instance;};
  const settle=async()=>{for(let i=0;i<24;i++)await Promise.resolve();let count=0;while(dirty&&count++<12){render();for(let i=0;i<12;i++)await Promise.resolve();}assert(count<12,"Actual hook lifecycle must settle without an effect loop");return instance;};
  const unmount=()=>hooks.forEach(h=>h.cleanup?.());
  return{api,render,settle,requests,unmount,get value(){return instance;}};
}

async function main(){
 const checks:string[]=[];const check=(name:string,fn:()=>void)=>{fn();checks.push(name);};
 const h=componentHarness(),api=h.api,original=locked({projection:1,opaque:{prior:"exact"},lockStatus:{status:"locked",lockedAt:lock,opaque:"old"}});
 h.render({data:board([original]),mode:"preview"});
 if(process.argv.includes("--negative-baseline")){
   const observedGrade=h.value.displayProps[0].playGrade;
   h.value.controls.setLoadedResearch({[original.researchKey!]:{recentForm:{logs:[{value:999}]},opaque:"unbound cache"}});h.render();
   console.log(JSON.stringify({old6295ActualComponent:true,originalGrade:original.playGrade,displayGrade:observedGrade,unboundCachedResearch:h.value.hydratedProps[0].recentForm,realHTTP:0}));
   assert.equal(observedGrade,original.playGrade,"Original locked grade must survive actual display memo");
   assert.equal(h.value.hydratedProps[0].recentForm,undefined,"Unbound old cache must not attach current research to original lock");return;
 }
 check("actual display memo preserves contradictory locked grade/stake/core",()=>equivalent(h.value.displayProps[0],original));
 check("unlocked contradiction still follows existing integrity policy",()=>assert.equal(api.enforcePreviewIntegrity(row({projection:1})).playGrade,"NO_PLAY"));
 check("all six lazy modules hydrate without arbitrary numeric/private keys",()=>{const evidence={...modules,projection:999,playGrade:"NO_PLAY",units:99,privatePayload:"secret"};const r=api.hydrateResearchEvidence(original,{[original.researchKey!]:evidence});for(const key of moduleKeys)equivalent(r[key],(modules as any)[key]);for(const key of ["projection","playGrade","units"])assert.equal(r[key],(original as any)[key]);assert.equal(r.privatePayload,undefined);});
 check("own row research null/false/zero fields retain original authority",()=>{const r=api.hydrateResearchEvidence({...original,recentForm:null,opponentProfile:false,environment:0},{[original.researchKey!]:modules});assert.equal(r.recentForm,null);assert.equal(r.opponentProfile,false);assert.equal(r.environment,0);});
 for(const value of [null,false,0])check(`canonical owned ${String(value)} research blocks cache and fetch`,()=>{const data=board([original],{[original.researchKey!]:value}),loaded=api.cachePlayerResearch({}, {props:[original],research:{[original.researchKey!]:modules}},data.date),a=api.availableClientResearch(data,loaded);assert.equal(a[original.researchKey!],value);assert.equal(api.hasClientResearch(original,a),true);});
 for(const value of [null,false,0]){const c=componentHarness();c.render({data:board([original],{[original.researchKey!]:value}),mode:"member",initialSelectedId:original.id});await c.settle();assert.equal(c.requests.length,0);equivalent(c.value.displayProps[0],original);c.unmount();checks.push(`actual effect respects canonical owned ${String(value)} without a request`);}
 check("inherited research does not qualify or hydrate",()=>{const inherited=Object.create({[original.researchKey!]:modules});assert.equal(api.hasClientResearch(original,inherited),false);equivalent(api.hydrateResearchEvidence(original,inherited),original);});
 const invalids:Array<[string,any[]]>=[
  ["unlocked",[row()]],["foreign game",[locked({providerIds:{...original.providerIds,gameId:"foreign"}})]],
  ["foreign player",[locked({player:"Foreign",providerIds:{...original.providerIds,mlbStatsPlayerId:"other"}})]],
  ["different first lock",[locked({lockStatus:{status:"locked",lockedAt:"2030-06-01T20:01:00Z"}})]],
  ["changed core",[locked({projection:999})]],["malformed",[locked({lockStatus:{status:"locked",lockedAt:"invalid"}})]],
  ["one good plus conflicting",[original,locked({projection:999})]],["one good plus foreign",[original,locked({providerIds:{...original.providerIds,gameId:"foreign"}})]],
 ];
 for(const [name,sources] of invalids)check(`${name} cache cannot bind original lock`,()=>{const d=board([original]),cache=api.cachePlayerResearch({}, {props:sources,research:{[original.researchKey!]:modules}},d.date);assert.equal(api.hasClientResearch(original,api.availableClientResearch(d,cache)),false);});
 check("wrong date and no returned props cannot qualify locked lazy research",()=>{for(const [sources,date]of [[[],"2030-06-01"],[[original],"2030-06-02"]]){const cache=api.cachePlayerResearch({}, {props:sources,research:{[original.researchKey!]:modules}},date);assert.equal(api.hasClientResearch(original,api.availableClientResearch(board([original]),cache)),false);}});
 check("supported bound original response qualifies six modules",()=>{const cache=api.cachePlayerResearch({}, {props:[original],research:{[original.researchKey!]:modules}},"2030-06-01");equivalent(api.availableClientResearch(board([original]),cache)[original.researchKey!],modules);});
 check("unsupported numeric legacy key preserved but not guessed for lazy binding",()=>{const r=locked({researchKey:42});equivalent(api.enforcePreviewIntegrity(r),r);assert.equal(api.lockedClientRowBinding(r),null);assert.equal(api.clientResearchRequestKey("2030-06-01",r),null);equivalent(api.hydrateResearchEvidence(r,{"42":modules}).recentForm,modules.recentForm);});
 // Dictionary identity includes every defined, non-null opaque key, even
 // when the old row is not eligible for a canonical lazy-fetch binding.
 for(const key of [0,false,""]){
  const lookup=String(key),opaque=locked({researchKey:key}),replacement={recentForm:{logs:[{value:999}]}},incoming=board([locked({researchKey:key,projection:999})],{[lookup]:replacement});
  for(const value of [modules,null,false,0])check(`opaque ${JSON.stringify(key)} original owned ${value===modules?"modules":String(value)} dictionary wins incoming and loaded cache`,()=>{
   const current=board([opaque],{[lookup]:value}),loaded=api.cachePlayerResearch({}, {props:[opaque],research:{[lookup]:replacement}},current.date);
   for(const merged of [api.mergeScopedBoardData(current,incoming,{family:null,market:null,gameId:"game"}),api.mergeInitialLockedBoardData(current,incoming),api.mergePlayerResponseData(current,{props:incoming.props,research:incoming.research})]){
    equivalent(merged.props,[opaque]);assert.equal(merged.props[0].researchKey,key);equivalent(merged.research[lookup],value);
    equivalent(api.availableClientResearch(merged,loaded)[lookup],value);
   }
   assert.equal(api.hasClientResearch(opaque,api.availableClientResearch(current,loaded)),true);
   assert.equal(api.lockedClientRowBinding(opaque),null);assert.equal(api.clientResearchRequestKey(current.date,opaque),null);
  });
  check(`opaque ${JSON.stringify(key)} original absent dictionary blocks incoming and loaded modules`,()=>{
   const current=board([opaque]),loaded=api.cachePlayerResearch({}, {props:[opaque],research:{[lookup]:replacement}},current.date);
   for(const merged of [api.mergeScopedBoardData(current,incoming,{family:null,market:null,gameId:"game"}),api.mergeInitialLockedBoardData(current,incoming)]){
    equivalent(merged.props,[opaque]);assert.equal(Object.hasOwn(merged.research,lookup),false);
    const available=api.availableClientResearch(merged,loaded);assert.equal(Object.hasOwn(available,lookup),false);equivalent(api.hydrateResearchEvidence(opaque,available),opaque);
   }
  });
  for(const present of [true,false]){
   const c=componentHarness(),first=board([opaque],present?{[lookup]:modules}:{});
   c.render({data:first,mode:"member",initialSelectedId:opaque.id});await c.settle();
   c.value.controls.setLoadedResearch(api.cachePlayerResearch({}, {props:[opaque],research:{[lookup]:replacement}},first.date));
   c.render({data:incoming,mode:"member",initialSelectedId:opaque.id});await c.settle();
   equivalent(c.value.data.props,[opaque]);assert.equal(c.value.data.props[0].researchKey,key);
   assert.equal(Object.hasOwn(c.value.data.research,lookup),present);assert.equal(Object.hasOwn(c.value.availableResearch,lookup),present);
   if(present)equivalent(c.value.availableResearch[lookup],modules);else equivalent(c.value.hydratedProps[0],opaque);
   assert.equal(c.requests.length,0,"Opaque keys reserve dictionary authority but cannot authorize a guessed lazy fetch");c.unmount();
   checks.push(`actual component opaque ${JSON.stringify(key)} first dictionary ${present?"presence":"absence"} persists without requests`);
  }
 }
 check("canonical locked dictionary absence cannot be filled by matching incoming core",()=>{
  const current=board([original]),incoming=board([original],{[original.researchKey!]:modules});
  for(const merged of [api.mergeScopedBoardData(current,incoming,{family:null,market:null,gameId:"game"}),api.mergeInitialLockedBoardData(current,incoming)])assert.equal(Object.hasOwn(merged.research,original.researchKey!),false);
 });
 for(const key of [null,undefined])check(`${String(key)} is no identity and never reserves a guessed dictionary key`,()=>{
  const missing=locked({researchKey:key}),lookup=String(key),current=board([missing],{[lookup]:modules}),incoming=board([missing],{[lookup]:null});
  assert.equal(api.hasClientResearch(missing,current.research),false);equivalent(api.hydrateResearchEvidence(missing,current.research),missing);
  assert.equal(api.clientResearchRequestKey(current.date,missing),null);assert.equal(api.lockedClientRowBinding(missing),null);
  const merged=api.mergeScopedBoardData(current,incoming,{family:null,market:null,gameId:"game"});equivalent(merged.props,[missing]);assert.equal(merged.props[0].researchKey,key);assert.equal(merged.research[lookup],null,"Unreferenced literal dictionary strings are not falsely reserved");
 });
 check("scoped/player/initial updates preserve exact locked duplicate multiset",()=>{const current=board([original,clone(original)],{[original.researchKey!]:null}),incoming=board([locked({projection:999}),row({id:"late"})],{[original.researchKey!]:modules});for(const result of [api.mergeScopedBoardData(current,incoming,{family:null,market:null,gameId:"game"}),api.mergePlayerResponseData(current,{props:incoming.props,research:incoming.research}),api.mergeInitialLockedBoardData(current,incoming)]){equivalent(result.props,[original,original]);assert.equal(result.research[original.researchKey!],null);}});
 check("new initial lock outranks prelock full-data rows and research",()=>{const c=componentHarness();c.render({data:board([row()]),mode:"preview"});c.value.controls.setFullData(board([row({projection:999})],{[original.researchKey!]:{recentForm:{logs:[{value:999}]}}}));c.render({data:board([original]),mode:"preview"});equivalent(c.value.data.props,[original]);assert.equal(c.value.hydratedProps[0].recentForm,undefined);c.unmount();});
 for(const replacement of [locked({projection:999,playGrade:"NO_PLAY"}),row({projection:999})])check(`first initial lock persists without any lazy full-data state (${replacement.lockStatus?"changed lock":"stale unlocked"})`,()=>{const c=componentHarness(),first=board([original,clone(original)],{[original.researchKey!]:null});c.render({data:first,mode:"preview"});c.render({data:board([replacement],{[original.researchKey!]:modules}),mode:"preview"});equivalent(c.value.data.props,[original,original]);assert.equal(c.value.availableResearch[original.researchKey!],null);c.unmount();});
 check("older scoped and initial lock packet cannot roll back unrelated unlocked research",()=>{const other=row({id:"other",researchKey:"other-key",providerIds:{gameId:"other-game",bdlGameId:"3",bdlPlayerId:4,mlbStatsPlayerId:"stats-4"}}),current={...board([row(),other],{"other-key":modules}),lastUpdated:"2030-06-01T20:02:00Z"},older={...board([original],{[original.researchKey!]:modules,"other-key":{recentForm:{logs:[{value:999}]}}}),lastUpdated:"2030-06-01T19:55:00Z"};for(const merged of [api.mergeScopedBoardData(current,older,{family:null,market:null,gameId:"game"}),api.mergeInitialLockedBoardData(current,older)]){equivalent(merged.research["other-key"],modules);equivalent(merged.props.find((r:any)=>r.id==="other"),other);}});
 check("unlocked valid six-module behavior remains available",()=>{const r=row(),loaded=api.cachePlayerResearch({}, {props:[r],research:{[r.researchKey!]:modules}},"2030-06-01"),available=api.availableClientResearch(board([r]),loaded);for(const key of moduleKeys)equivalent(api.hydrateResearchEvidence(r,available)[key],(modules as any)[key]);});
 // Exercise the actual memo/effect/fetch callback, not only pure helpers.
 const live=componentHarness();live.render({data:board([original]),mode:"member",initialSelectedId:original.id});await live.settle();
 assert.equal(live.requests.length,1);assert.match(live.requests[0].url,/\/api\/mlb\/props\/player\//);checks.push("actual missing locked research effect performs fresh lazy GET");
 live.requests[0].resolve({props:[{...original,...modules}],research:{[original.researchKey!]:{...modules,projection:999,units:99,playGrade:"NO_PLAY"}}});await live.settle();
 for(const key of moduleKeys)equivalent(live.value.hydratedProps[0][key],(modules as any)[key]);for(const key of ["projection","playGrade","units"])assert.equal(live.value.hydratedProps[0][key],(original as any)[key]);assert.equal(live.requests.length,1,"Successful bound lazy research must not trigger another request");checks.push("actual postlock lazy callback binds original row and six modules only");
 const refused=componentHarness();refused.render({data:board([original]),mode:"member",initialSelectedId:original.id});await refused.settle();
 refused.requests[0].resolve({props:[locked({projection:999})],research:{[original.researchKey!]:modules}});await refused.settle();assert.equal(refused.value.hydratedProps[0].recentForm,undefined);
 refused.value.controls.setSelectedId(null);refused.render();await refused.settle();refused.value.controls.setSelectedId(original.id);refused.render();await refused.settle();
 assert.equal(refused.requests.length,2,"Rejected foreign/core research must not poison the request key when the member reopens the original locked player");checks.push("refused response cannot suppress a fresh member-requested locked fetch");
 const reopened=componentHarness();reopened.render({data:board([original]),mode:"member",initialSelectedId:original.id});await reopened.settle();
 reopened.value.controls.setSelectedId(null);reopened.render();await reopened.settle();reopened.value.controls.setSelectedId(original.id);reopened.render();await reopened.settle();assert.equal(reopened.requests.length,2);
 reopened.requests[0].reject(new Error("Controlled delayed abort rejection"));await reopened.settle();
 assert.equal(reopened.value.requestedResearchPlayers.current.get(api.clientResearchRequestKey("2030-06-01",original))?.signal,reopened.requests[1].options.signal);
 assert.equal(reopened.value.requestedResearchPlayers.current.size,1,"Late abort cannot release the replacement request's owned key");
 assert.equal(reopened.value.selectedResearchPending,true,"Late same-key abort cannot clear the replacement request's loading state");
 reopened.requests[1].resolve({props:[original],research:{[original.researchKey!]:modules}});await reopened.settle();equivalent(reopened.value.hydratedProps[0].recentForm,modules.recentForm);checks.push("late same-key abort cannot poison replacement request or loading state");
 const race=componentHarness();race.render({data:board([row()]),mode:"member",initialSelectedId:original.id});await race.settle();assert.equal(race.requests.length,1);
 race.render({data:board([original]),mode:"member",initialSelectedId:original.id});await race.settle();assert.equal(race.requests[0].options.signal.aborted,true);assert.equal(race.requests.length,2);checks.push("prelock in-flight request cannot prevent newly locked request");
 race.requests[0].resolve({props:[row({projection:999})],research:{[original.researchKey!]:{recentForm:{logs:[{value:999}]}}}});await race.settle();assert.equal(race.value.hydratedProps[0].recentForm,undefined);assert.equal(race.value.selectedResearchPending,true);checks.push("aborted prelock response cannot populate new locked cache or clear new loading state");
 race.requests[1].resolve({props:[original],research:{[original.researchKey!]:modules}});await race.settle();equivalent(race.value.hydratedProps[0].recentForm,modules.recentForm);checks.push("fresh locked response survives earlier aborted response race");
 const normal=componentHarness();normal.render({data:board([row()]),mode:"member",initialSelectedId:original.id});await normal.settle();normal.requests[0].resolve({props:[row({projection:3,lastUpdated:"2030-06-01T20:03:00Z"})],research:{[original.researchKey!]:{...modules,projection:999,units:999,privateInput:"untrusted"}}});await normal.settle();assert.equal(normal.value.hydratedProps[0].projection,3);assert.equal(normal.value.hydratedProps[0].units,.5);assert.equal(normal.value.hydratedProps[0].privateInput,undefined);for(const key of moduleKeys)equivalent(normal.value.hydratedProps[0][key],(modules as any)[key]);checks.push("actual unlocked lazy response still updates six modules and only returned core props");
 const stale=componentHarness();stale.render({data:board([row()]),mode:"member",initialSelectedId:original.id});await stale.settle();stale.requests[0].resolve({props:[row()],research:{[original.researchKey!]:{recentForm:{logs:[{value:999}]}}}});await stale.settle();
 stale.render({data:board([original]),mode:"member",initialSelectedId:original.id});await stale.settle();assert.equal(stale.requests.length,2);assert.equal(stale.value.hydratedProps[0].recentForm,undefined);checks.push("resolved prelock cache cannot skip fresh postlock fetch");
 const scoped=componentHarness();scoped.render({data:board([original,clone(original)]),mode:"member"});scoped.value.controls.setMarketFilter("batter_hits");scoped.render();await scoped.settle();const request=scoped.requests.find(r=>r.url.includes("/picks?"));assert(request);request.resolve({board:board([row({projection:999}),locked({projection:888})])});await scoped.settle();equivalent(scoped.value.data.props,[original,original]);checks.push("actual scoped fetch callback preserves original locked duplicates");
 scoped.render({data:board([row()],{},"2030-06-02"),mode:"member"});await scoped.settle();assert.equal(scoped.value.data.date,"2030-06-02");equivalent(scoped.value.data.props,[row()]);checks.push("date switch cannot carry old full-data or locked cache into new slate");
 for(const instance of [h,live,refused,reopened,race,normal,stale,scoped])instance.unmount();
 console.log(JSON.stringify({actualClientLockedAuthority:true,actualMemoEffectFetch:true,cases:checks.length,checks,realHTTP:0,realSQL:0,paidCalls:0}));
}
main().catch(error=>{console.error(error);process.exitCode=1;});
