/** Source-grounded navigation and required coverage for the player-level AI reader. */
import type {Evidence,GamePacket,Json,Player} from "./evidenceContract";
import {digest,invariant,instant,stable} from "./evidence";
import {readerLogWindows} from "./readerLogs";
import {independentPriorEvents} from "./priorEvents";
export const READER_AREAS=["recent_form","opportunity_role","matchup","head_to_head","availability","game_environment","market","independent_model"] as const;
export type ReaderArea=typeof READER_AREAS[number];
export type SourceCoverage="available"|"partial"|"missing";
export type ReaderFact={id:string;hash:string;label:string;value:Json;sourceIds:string[];availableAt:string};
export type ReaderAreaEvidence={status:SourceCoverage;facts:ReaderFact[];limitations:string[];/** Future NBA catalog only; absent on legacy/non-NBA evidence. */eligibleContextFactIds?:string[]};
export type ReaderCoverage=Record<ReaderArea,{status:SourceCoverage;factIds:string[];effect:"upward"|"downward"|"mixed"|"neutral"|"uncertain"|"unavailable";observation:string}>;
const negatedBefore=(text:string,index:number)=>/(?:\bnot|\bno|\bnever|\bwithout)\s+(?:(?!but\b|however\b|yet\b|although\b)[\p{L}'-]+\s+){0,2}$/iu.test(text.slice(0,index));
export function hasUnsupportedCertainty(observation:string){
  return [...observation.matchAll(/\b(?:guaranteed|smart money|insider money|confirmed healthy|fully healthy)\b/gi)].some(match=>{
    // “Not confirmed healthy” is the required distinction, not a positive claim.
    // A contrast word ends negation scope: “not listed but confirmed healthy” fails.
    return !negatedBefore(observation,match.index!);
  });
}
const obj=(v:unknown):Record<string,Json>=>v&&typeof v==="object"&&!Array.isArray(v)?v as Record<string,Json>:{};
const clean=(v:unknown):Json=>JSON.parse(JSON.stringify(v));
const normalized=(s:string)=>s.toLowerCase().normalize("NFKD").replace(/[\u0300-\u036f]/g,"").replace(/\b(jr|sr|ii|iii|iv)\b/g,"").replace(/[^a-z]/g,"");
const nonempty=(v:unknown)=>Array.isArray(v)?v.length>0:v!==null&&v!==undefined&&typeof v==="object"?Object.keys(v).length>0:typeof v==="number"?Number.isFinite(v):Boolean(v);
// Coverage flags and actor IDs describe source availability/identity, not an
// opponent profile. Keep their exact payloads visible without promoting them.
const contextMetadata=new Set(["status","coverageStatus","available","known","isAvailable","isKnown","hasData","gameId","playerId","teamId","opponentId","opponentTeamId","opponent","team","source","availableAt","asOf","asOfTimestamp","capturedAt","generatedAt","meaning","interpretation","label","format","provenance","key","unit"]);
const missingContextStrings=new Set(["unknown","unavailable","missing","not available","not provided","not supplied","n/a","na","null","undefined","pending","unverified"]);
const hasContextValue=(value:unknown):boolean=>Array.isArray(value)?value.some(hasContextValue):value!==null&&typeof value==="object"
  ?Object.entries(value).some(([key,v])=>!contextMetadata.has(key)&&hasContextValue(v))
  :typeof value==="number"?Number.isFinite(value):typeof value==="string"?value.trim().length>0&&!missingContextStrings.has(value.trim().toLowerCase().replace(/[_-]+/g," ")):typeof value==="boolean";

export function playerReaderEvidence(packet:GamePacket,player:Player,allocate:(n:number)=>string) {
  const result=Object.fromEntries(READER_AREAS.map(a=>[a,{status:"missing",facts:[],limitations:[],...(packet.sport==="nba"&&(a==="matchup"||a==="game_environment")?{eligibleContextFactIds:[]}:{} )} as ReaderAreaEvidence])) as Record<ReaderArea,ReaderAreaEvidence>;
  const seen=new Map<ReaderArea,Set<string>>(READER_AREAS.map(a=>[a,new Set()]));
  const comparisonAreas=new Set<ReaderArea>();
  const contextStatus=(usable:boolean):SourceCoverage=>packet.sport!=="nba"||usable?"available":"partial";
  const add=(area:ReaderArea,label:string,value:unknown,sources:Evidence[],status:SourceCoverage="available",eligibleContext=false)=>{
    if(!sources.length||!nonempty(value))return;
    const v=clean(value),signature=stable({label,value:v});if(seen.get(area)!.has(signature))return;seen.get(area)!.add(signature);
    const fact={id:allocate(1),hash:digest({player:player.id,area,label,value:v,sources:sources.map(s=>({id:s.id,source:s.source,availableAt:s.availableAt}))}),label,value:v,sourceIds:sources.map(s=>s.id),availableAt:new Date(Math.max(...sources.map(s=>instant(s.availableAt)))).toISOString()};
    result[area].facts.push(fact);
    if(eligibleContext&&status==="available")result[area].eligibleContextFactIds?.push(fact.id);
    if(status==="available"||status==="partial"&&result[area].status==="missing")result[area].status=status;
  };
  const recent=player.evidence.filter(e=>e.kind==="recent_games"),h2h=player.evidence.filter(e=>e.kind==="matchup_history"),heads=player.evidence.filter(e=>e.kind==="independent_model");
  const logs=recent.filter(e=>nonempty(obj(e.value).box));
  if(logs.length){
    const summary=readerLogWindows(packet.sport,logs,packet.cutoff),status=summary.conflicts.length?"partial":"available";
    add("recent_form","Reconciled recent recorded stat windows",summary,logs,status);
    const opportunities=packet.sport==="nba"?["minutes","fga","fg3a","fta"]:["passing_attempts","rushing_attempts","receiving_targets"];
    add("opportunity_role","Recent volume/opportunity windows",Object.fromEntries(Object.entries(summary.windows).map(([key,value])=>[key,{records:value.records,statistics:Object.fromEntries(Object.entries(value.statistics).filter(([k])=>opportunities.includes(k)))}])),logs,status);
  }
  for(const e of recent){
    const v=obj(e.value);if(v.samples||v.logs){
      const samples=obj(v.samples),rows=Array.isArray(v.logs)?v.logs.map(obj):[];
      const dates=rows.map(r=>String(r.date??"")).filter(s=>Number.isFinite(Date.parse(s))).sort();
      add("recent_form",String(v.statLabel??"Recorded production samples"),{stat:v.statLabel??null,sampleUnit:v.sampleLabel??null,coverage:v.coverage??null,
        newestRecordedGameDate:dates.at(-1)??null,newestGameAgeDays:dates.length?(instant(packet.cutoff)-Date.parse(dates.at(-1)!))/86400000:null,
        last5:samples.last5??null,last10:samples.last10??null,season:nonempty(samples.season)?{count:obj(samples.season).count??null,average:obj(samples.season).average??null}:null},[e]);
      if(rows.length)add("opportunity_role","Recorded game opportunity/workload labels",{stat:v.statLabel??null,sampleUnit:v.sampleLabel??null,
        rows:rows.map(r=>({gameId:r.gameId??null,date:r.date??null,plateAppearances:r.plateAppearances??null,suppliedWorkloadLabel:r.secondaryLabel??null}))},[e],"partial");
    }
  }
  const metricRows=(key:string)=>[...new Map(heads.flatMap(e=>Array.isArray(obj(e.value)[key])?(obj(e.value)[key] as Json[]).map(v=>({e,value:v})):[]).map(row=>[stable(row.value),row])).values()];
  const role=metricRows("role"),production=metricRows("production"),matchup=metricRows("matchup");
  if(role.length)add("opportunity_role","Timestamped workload/usage inputs",role.map(x=>x.value),[...new Map(role.map(x=>[x.e.id,x.e])).values()]);
  if(production.length)add("recent_form","Timestamped production/efficiency inputs",production.map(x=>x.value),[...new Map(production.map(x=>[x.e.id,x.e])).values()]);
  if(matchup.length){
    const environment=matchup.filter(x=>/pace|total|spread|environment/i.test(String(obj(x.value).key??"")+String(obj(x.value).label??"")));
    const defense=matchup.filter(x=>!environment.includes(x));
    if(defense.length){const usable=defense.some(x=>/^(?:opponent_|opp_)/.test(String(obj(x.value).key??""))&&typeof obj(x.value).value==="number"&&Number.isFinite(obj(x.value).value));add("matchup","Opponent and matchup inputs",defense.map(x=>x.value),[...new Map(defense.map(x=>[x.e.id,x.e])).values()],contextStatus(usable),usable);}
    if(environment.length){const usable=environment.some(x=>/pace|total|spread|environment/i.test(String(obj(x.value).key??""))&&typeof obj(x.value).value==="number"&&Number.isFinite(obj(x.value).value));add("game_environment","Game pace/scoring environment inputs",environment.map(x=>x.value),[...new Map(environment.map(x=>[x.e.id,x.e])).values()],contextStatus(usable),usable);}
  }
  for(const e of heads){const v=obj(e.value),c=obj(v.context);
    if(c.recentProduction)add("recent_form","Model-input recent production (not independent evidence twice)",c.recentProduction,[e]);
    if(c.modelInputTrends)add("recent_form","Timestamped recent production/role/opponent trends",c.modelInputTrends,[e]);
    if(c.roleOpportunity)add("opportunity_role","Usage, snaps and role inputs",{role:c.roleOpportunity,expectedQuarterback:c.expectedQuarterback??null,position:c.position??null},[e]);
    if(c.opponentAllowance){const usable=hasContextValue(c.opponentAllowance)&&obj(c.opponentAllowance).status!=="unavailable"&&obj(c.opponentAllowance).coverageStatus!=="unavailable";add("matchup","Opponent allowance input",c.opponentAllowance,[e],contextStatus(usable),usable);}
    if(c.teamImpliedPoints!==undefined){const usable=typeof c.teamImpliedPoints==="number"&&Number.isFinite(c.teamImpliedPoints);add("game_environment","Supplied team scoring environment",{teamImpliedPoints:c.teamImpliedPoints,teamImpliedTouchdowns:c.teamImpliedTouchdowns??null},[e],contextStatus(usable),usable);}
    if(c.availability){const a=obj(c.availability);add("availability","Supplied player availability report",{...a,meaning:a.listed===false?"Not listed is not confirmed healthy or confirmed starter":"Reported source status; not a medical guarantee"},[e],a.status?"available":"partial");}
  }
  const h2hLogs=h2h.filter(e=>nonempty(obj(e.value).box));
  if(h2hLogs.length)add("head_to_head","Reconciled direct-opponent game samples",readerLogWindows(packet.sport,h2hLogs,packet.cutoff),h2hLogs);
  for(const e of h2h.filter(e=>!nonempty(obj(e.value).box))){const v=obj(e.value);const empty=v.status==="no_history"||v.gamesPlayed===0||v.plateAppearances===0;
    add("head_to_head",empty?"No usable direct historical sample in this source":"Retained direct opponent history",v,[e],empty?"missing":"available");}
  for(const e of player.evidence.filter(e=>e.kind==="matchup")){
    const reference=obj(obj(e.value).reference);
    if(obj(e.value).readerBenchmarks===true){
      const common={asOf:obj(e.value).asOf??null,meaning:obj(e.value).meaning??null,currentTeamGames:reference.league_current_season_team_games??null,priorTeamGames:reference.league_prior_season_team_games??null};
      if(packet.sport==="nba"){comparisonAreas.add("matchup");comparisonAreas.add("game_environment");}
      add("matchup","Observed league scoring-rating reference for defensive context",{...common,currentOffRating:reference.league_current_season_off_rating??null,priorOffRating:reference.league_prior_season_off_rating??null},[e],packet.sport==="nba"?"partial":"available");
      add("game_environment","Observed league pace reference using matching units",{...common,currentPace:reference.league_current_season_pace??null,priorPace:reference.league_prior_season_pace??null},[e],packet.sport==="nba"?"partial":"available");continue;
    }
    if(/exact-game depth/.test(e.source)){add("opportunity_role","Exact-game team and opponent depth; projected roles are not confirmations",e.value,[e],"partial");continue;}
    const v=obj(e.value),environment=/environment|weather|park/i.test(e.source)||v.weather!==undefined||v.park!==undefined;
    const value=environment?v:{...Object.fromEntries(Object.entries(v).filter(([k])=>!["pitches","logs","samples"].includes(k))),...(Array.isArray(v.pitches)?{pitchTypes:v.pitches}:{} )};
    const usable=v.coverageStatus!=="unavailable"&&v.status!=="unavailable"&&hasContextValue(value);
    add(environment?"game_environment":"matchup",environment?"Venue, park and weather context":"Detailed opponent/pitch/defense context",value,[e],v.coverageStatus==="unavailable"||v.status==="unavailable"?"missing":contextStatus(usable),usable);
  }
  for(const e of player.evidence.filter(e=>e.kind==="availability")){
    const v=obj(e.value),context=obj(v.context),away=obj(context.away),home=obj(context.home);
    if(away.team||home.team){
      const own=[away,home].find(t=>normalized(String(t.team??""))===normalized(player.team));
      const players=Array.isArray(own?.players)?own!.players as Json[]:[];
      const ownPlayer=players.map(obj).find(p=>normalized(String(p.name??""))===normalized(player.name));
      const report=obj(v.originalReport),clearances=Array.isArray(report.playerClearances)?report.playerClearances.map(obj):[];
      const ownClearance=clearances.find(c=>normalized(String(c.teamAbbreviation??""))===normalized(player.team)&&normalized(String(c.name??""))===normalized(player.name));
      add("availability","Exact-game team reports and own player status",{ownStatus:ownPlayer?.status??"not_listed_or_unverified",ownReport:ownPlayer??null,
        ownTeamKnown:own?.known??false,awayTeam:away,homeTeam:home,ownExplicitClearance:ownClearance??null,sourceReport:nonempty(report)?report:null,
        meaning:"An unlisted player is not confirmed healthy or a confirmed starter; explicit source clearances and old report designations must be read in order; teammate/opponent absences are distinct facts"},[e],ownPlayer?.status||ownClearance?"available":"partial");
    }else {
      add("availability","Supplied lineup/availability status",v,[e],v.status==="unknown"?"missing":"partial");
      if(v.battingOrder!==undefined)add("opportunity_role","Posted batting position and expected opportunity",{status:v.status??null,battingOrder:v.battingOrder,position:v.position??null},[e],v.status==="posted"?"available":"partial");
    }
  }
  for(const e of player.evidence.filter(e=>e.kind==="market")){
    const v=obj(e.value);
    if(v.sourceEventQualification)add("market","Exact provider event declaration and unresolved-contract boundary",v,[e],"partial");
    if(Array.isArray(v.books)&&v.books.length){
      add("market","Retained book/line/price evidence",{market:v.market??null,anchorLine:v.anchorLine??null,anchorSource:v.anchorSource??null,
        books:v.books.map(raw=>{const b=obj(raw);return {book:b.book,provider:b.provider,openingPairs:b.openingPairs??null,
          firstPair:b.anchorEarliestRetainedPair??null,lastPair:b.anchorLatestRetainedPair??null,retainedStates:b.retainedStates,distinctLines:b.distinctLines,
          limitations:"Retained source states; alternate lines and a different time are not automatically a main-line move"};})},[e],"partial");
    }else if(v.movement)add("market","Stored same-book movement (derived; not a second independent price source)",v,[e],"partial");
    else if(Array.isArray(v.verifiedBookSplits)&&v.verifiedBookSplits.length)add("market","Actually supplied split records; no money inferred from odds",v,[e],"partial");
  }
  const baselines=independentPriorEvents(player);
  if(baselines.length){const usable=baselines.some(b=>b.independentMean!==null||b.probabilityOfReferenceSide!==null||b.overProbability!==null);
    add("independent_model","Independent event probabilities; a retained side is not a directional endorsement",baselines,heads,usable?baselines.every(b=>b.independentMean!==null)?"available":"partial":"missing");}
  for(const area of READER_AREAS)if(result[area].status==="missing")result[area].limitations.push(`No usable ${area.replaceAll("_"," ")} source was supplied; never invent it`);
  for(const area of ["matchup","game_environment"] as const){
    const eligible=result[area].eligibleContextFactIds;if(!eligible)continue;
    if(comparisonAreas.has(area)&&!eligible.length)result[area].limitations.push(area==="matchup"?"comparison_only_matchup: League comparison retained; an actual opponent/player matchup profile is missing or unavailable.":"comparison_only_environment: League comparison retained; actual game pace/environment input is missing or unavailable.");
    if(result[area].status==="available")result[area].limitations.push(`Available ${area} coverage must cite an actual context fact: ${eligible.join(", ")}. A league comparison or unavailable profile alone is insufficient.`);
  }
  const ages=result.recent_form.facts.flatMap(f=>{const v=obj(f.value),age=v.newestQualifyingGameAgeDays??v.newestGameAgeDays;return typeof age==="number"?[age]:[];});
  if(ages.length&&Math.min(...ages)>(packet.sport==="nfl"?30:14))result.recent_form.limitations.push("old_game_history: Last qualifying recorded performance is old; explicitly say this history is dated and cannot establish current form or workload. Do not invent an injury/absence explanation.");
  result.availability.limitations.push("Injury status, participation, and confirmed starting role are separate");
  result.head_to_head.limitations.push("Report the actual sample size; no-history or a tiny sample cannot be treated as strong evidence");
  result.market.limitations.push("No inference of money, informed bettors or verified provider freshness from price motion or archive timestamps");
  return result;
}
export function readerEvidence(packet:GamePacket){
  let counter=0;return Object.fromEntries(packet.players.map(p=>[p.id,playerReaderEvidence(packet,p,()=>`f${counter++}`)]));
}
export function coverageSchema(evidence:Record<ReaderArea,ReaderAreaEvidence>){
  const fields=Object.fromEntries(READER_AREAS.map(area=>{const e=evidence[area],ids=e.facts.map(f=>f.id);return [area,{type:"object",additionalProperties:false,required:["status","factIds","effect","observation"],properties:{
    status:{type:"string",enum:[e.status]},factIds:{type:"array",items:ids.length?{type:"string",enum:ids}:{type:"string"},minItems:ids.length?1:0,maxItems:Math.min(4,ids.length)},
    effect:{type:"string",enum:e.status==="missing"?["uncertain","unavailable"]:["upward","downward","mixed","neutral","uncertain","unavailable"]},
    observation:{type:"string",minLength:1,maxLength:300,pattern:"^[^0-9]*[.!?]$",description:"One short complete qualitative sentence, target under 100 characters; finish with punctuation and no digits."}}}];}));
  return {type:"object",additionalProperties:false,required:[...READER_AREAS],properties:fields};
}
export function validateCoverage(evidence:Record<ReaderArea,ReaderAreaEvidence>,coverage:ReaderCoverage,verifiedClaimRendering=false){
  invariant(coverage&&Object.keys(coverage).sort().join("|")===READER_AREAS.slice().sort().join("|"),"Reader omitted a required area");
  return Object.fromEntries(READER_AREAS.map(area=>{
    const row=coverage[area],source=evidence[area];
    invariant(row.status===source.status,`Reader misrepresented ${area} source coverage`);
    invariant(row.factIds.length>=(source.facts.length?1:0)&&row.factIds.length<=(verifiedClaimRendering?source.facts.length:Math.min(4,source.facts.length))&&new Set(row.factIds).size===row.factIds.length&&row.factIds.every(id=>source.facts.some(f=>f.id===id)),`Reader omitted/fabricated ${area} facts`);
    invariant(typeof row.observation==="string"&&row.observation.trim().length>0&&row.observation.length<=(verifiedClaimRendering?1400:300),"Invalid reader interpretation");
    invariant(/[.!?]$/.test(row.observation.trim()),"Reader interpretation must end as a complete sentence");
    invariant(["upward","downward","mixed","neutral","uncertain","unavailable"].includes(row.effect),"Invalid reader effect");
    invariant(verifiedClaimRendering||!/\d/.test(row.observation),"Reader must cite exact backend facts, not restate figures in prose");
    invariant(!hasUnsupportedCertainty(row.observation),"Unsupported reader factual certainty");
    invariant(source.status!=="missing"||["uncertain","unavailable"].includes(row.effect),"Missing history/context cannot create a directional signal");
    // New NBA catalogs bind this requirement at trusted source-construction
    // branches. Existing accepted/locked coverage and non-NBA catalogs have no
    // such metadata and retain their original interpretation.
    if(source.status==="available"&&source.eligibleContextFactIds!==undefined)invariant(row.factIds.some(id=>source.eligibleContextFactIds!.includes(id)),`Available ${area} coverage requires an actual context citation; league comparison/unavailable profile alone is insufficient`);
    if(source.limitations.some(s=>s.startsWith("old_game_history:")))invariant(/\bold\b|\bdated\b|\bstale\b|long gap|not recent/i.test(row.observation),"Reader omitted dated-history caution");
    return [area,{...row,facts:row.factIds.map(id=>source.facts.find(f=>f.id===id)!)}];
  }));
}
export function validatePlayerCoverage(player:Pick<Player,"markets">,evidence:Record<ReaderArea,ReaderAreaEvidence>,coverage:ReaderCoverage,verifiedClaimRendering=false){
  const result=validateCoverage(evidence,coverage,verifiedClaimRendering);
  if(player.markets.some(m=>m.startsWith("pitcher_"))){
    const text=coverage.matchup.observation;
    invariant(![...text.matchAll(/against\s+(?:left|right)[ -]handed\s+(?:hitters|batters)/gi)].some(m=>!negatedBefore(text,m.index!)),"Aggregate pitcher arsenal cannot establish an opponent-handedness split");
  }
  return result;
}
