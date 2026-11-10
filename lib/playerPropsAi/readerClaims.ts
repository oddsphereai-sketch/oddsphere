/** Future source-bound reader vocabulary. Navigation/arithmetic over the SAME
 * supplied facts, never additional evidence, forecasts or recommendation votes. */
import type {GamePacket,Json,Player,Quote} from './evidenceContract';
import {readerEvidence,READER_AREAS,type ReaderArea,type ReaderFact,type SourceCoverage} from './readerCoverage';
import {independentPriorEvents} from './priorEvents';
import {playerParticipationEligibility} from './participationEligibility';
import {executionQuotes,quoteBook,quoteContract} from './executionQuotes';
import {instant} from './evidence';
import {PROPS_AI_READER_CLAIMS_RELEASE} from './releases';
import {evidenceAliases} from './input';
import {NBA_READER_PACE_UNIT,NBA_READER_UNIT_CONTRACT} from './readerUnitContract';
export {NBA_READER_PACE_UNIT,NBA_READER_UNIT_CONTRACT} from './readerUnitContract';

export const PROPS_AI_READER_CLAIM_RELEASE=PROPS_AI_READER_CLAIMS_RELEASE;
export type ReaderClaim={id:string;area:ReaderArea;kind:string;text:string;shortText:string;factIds:string[];factHashes:string[];sourceIds:string[];availableAt:string|null;details?:Json};
export type ReaderClaimCatalog={release:typeof PROPS_AI_READER_CLAIM_RELEASE;areas:Record<ReaderArea,{status:SourceCoverage;claims:ReaderClaim[];requiredClaimIds:string[]}>;claims:ReaderClaim[]};
const obj=(value:unknown):Record<string,unknown>=>value!==null&&typeof value==='object'&&!Array.isArray(value)?value as Record<string,unknown>:{};
const rows=(value:unknown)=>Array.isArray(value)?value.map(obj):[];
const number=(value:unknown):number|null=>typeof value==='number'&&Number.isFinite(value)?value:null;
const display=(value:number)=>String(Number(value.toPrecision(6)));
const json=(value:unknown):Json=>JSON.parse(JSON.stringify(value));
const unique=<T>(values:T[])=>[...new Set(values)];
const direction=(over:number,under:number)=>over>under?'over':under>over?'under':'tie';
const areaName=(area:ReaderArea)=>area.replaceAll('_',' ');
const statusName=(value:unknown)=>typeof value==='string'?({out:'Out',inactive:'Inactive',suspended:'Suspended',suspension:'Suspended',dnp:'DNP','did not play':'Did not play',questionable:'Questionable',doubtful:'Doubtful',probable:'Probable',unknown:'Unknown',available:'Available',active:'Active',cleared:'Cleared','explicit clearance':'Explicit clearance','day to day':'Day to day','game time decision':'Game time decision','injured reserve':'Injured reserve','reserve injured':'Injured reserve',ir:'Injured reserve','out for season':'Out for season','physically unable to perform':'Physically unable to perform',pup:'Physically unable to perform','reserve pup':'Physically unable to perform',retired:'Retired','reserve retired':'Retired'} as Record<string,string>)[value.trim().toLowerCase().replace(/[_-]+/g,' ') ]??null:null;

type Pair={book:string;provider:string;over:Quote;under:Quote;fairOver:number;direction:'over'|'under'|'tie';clock:number;nativeClock:number};
function currentPairs(packet:GamePacket,playerId:string,market:string,line:number){
 const quotes=executionQuotes(packet,packet.cutoff).filter(q=>q.playerId===playerId&&q.market===market&&q.line===line&&quoteContract(q)==='two_way'&&q.side!=='yes');
 const groups=new Map<string,Quote[]>();
 for(const q of quotes){const key=JSON.stringify([q.provider,quoteBook(q.book)]);groups.set(key,[...(groups.get(key)??[]),q]);}
 const pairs:Pair[]=[];
 const implied=(price:number)=>price>0?100/(100+price):-price/(100-price);
 for(const group of groups.values()){
  const over=group.find(q=>q.side==='over'),under=group.find(q=>q.side==='under');
  if(!over||!under||Math.abs(instant(over.receivedAt)-instant(under.receivedAt))>300000)continue;
  const o=implied(over.american),u=implied(under.american),fairOver=o/(o+u);
  pairs.push({book:quoteBook(over.book),provider:over.provider,over,under,fairOver,direction:direction(o,u),clock:Math.max(instant(over.receivedAt),instant(under.receivedAt)),nativeClock:Math.max(instant(over.observedAt),instant(under.observedAt))});
 }
 const books=new Map<string,Pair[]>();for(const pair of pairs)books.set(pair.book,[...(books.get(pair.book)??[]),pair]);
 const independent:Pair[]=[],conflicts:string[]=[];
 for(const [book,feedPairs] of books){
  const sorted=[...feedPairs].sort((a,b)=>b.clock-a.clock||b.nativeClock-a.nativeClock),latest=sorted[0];
  const tied=sorted.filter(p=>p.clock===latest.clock&&p.nativeClock===latest.nativeClock);
  if(tied.some(p=>p.over.american!==latest.over.american||p.under.american!==latest.under.american)){conflicts.push(book);continue;}
  independent.push(latest);
 }
 return{pairs:json(pairs.map(p=>({book:p.book,provider:p.provider,quoteIds:[p.over.id,p.under.id],american:[p.over.american,p.under.american],observedAt:[p.over.observedAt,p.under.observedAt],receivedAt:[p.over.receivedAt,p.under.receivedAt],fairOver:p.fairOver,direction:p.direction}))),independent,conflicts};
}

function exactEventComparisons(packet:GamePacket,player:Player){
 return independentPriorEvents(player).filter(p=>p.market!==null&&p.line!==null).map(prior=>{
  const source=player.evidence.find(e=>e.id===prior.sourceId),value=obj(source?.value);
  const verified=packet.sport!=='nba'||value.independentEventStatus==='stored_native_reference_side';
  const push=number(value.independentPush),integer=Number.isInteger(prior.line!);
  const probabilities=prior.overProbability!==null&&prior.underProbability!==null;
  const knownPush=probabilities&&(integer?push!==null&&push>=0&&push<=1&&Math.abs(prior.overProbability!+prior.underProbability!+push-1)<1e-8:Math.abs(prior.overProbability!+prior.underProbability!-1)<1e-8);
  const ordinary=prior.market!=='anytime_td'&&value.offerContract!=='milestone';
  const qualified=verified&&ordinary&&knownPush&&probabilities;
  const paired=currentPairs(packet,player.id,prior.market!,prior.line!);
  const preferred=qualified?direction(prior.overProbability!,prior.underProbability!):'unavailable';
  const directions=unique(paired.independent.map(p=>p.direction));
  const relation=!qualified||!paired.independent.length?'unavailable':preferred==='tie'?'tie':directions.length>1?'mixed_books':directions[0]==='tie'?'tie':directions[0]===preferred?'same_direction':'opposite_direction';
  return{market:prior.market,line:prior.line,contract:ordinary?'two_way':'milestone',priorSourceId:prior.sourceId,priorOver:prior.overProbability,priorUnder:prior.underProbability,priorPush:push,preferred,relation,
   unavailableReason:!verified?'unverified_prior_event':!ordinary?'one_way_contract':integer&&push===null?'integer_push_not_supplied':!probabilities?'prior_opposing_probability_missing':!knownPush?'prior_probability_contract_incomplete':!paired.independent.length?'no_current_exact_event_pair':null,
   pairs:paired.pairs,independentBooks:paired.independent.map(p=>p.book).sort(),conflictingBooks:paired.conflicts.sort(),
   meaning:'Exact same actor/statistic/line/ordinary event only. Other thresholds, openings, missing receipts and correlated same-book feeds cannot establish directional disagreement. Direction agreement is not probability equality, positive value or predictive validation.'};
 });
}

/** Pure source compilation with ORIGINAL packet actor/fact indices. */
export function compileReaderClaims(packet:GamePacket):Record<string,ReaderClaimCatalog>{
 const evidence=readerEvidence(packet);
 return Object.fromEntries(packet.players.map(player=>{
  const area=(key:ReaderArea):ReaderClaimCatalog['areas'][ReaderArea]=>({status:evidence[player.id][key].status,claims:[],requiredClaimIds:[]});
  const catalog:ReaderClaimCatalog={release:PROPS_AI_READER_CLAIM_RELEASE,areas:{recent_form:area('recent_form'),opportunity_role:area('opportunity_role'),matchup:area('matchup'),head_to_head:area('head_to_head'),availability:area('availability'),game_environment:area('game_environment'),market:area('market'),independent_model:area('independent_model')},claims:[]};
  const add=(area:ReaderArea,kind:string,text:string,shortText:string,facts:ReaderFact[],details?:unknown,supportingFacts:ReaderFact[]=[])=>{
   if(text.length>240||shortText.length>120)throw Error('Typed reader claim exceeds complete-text bound');
   const sources=unique([...facts,...supportingFacts]);
   const claim:ReaderClaim={id:`c${catalog.claims.length}`,area,kind,text,shortText,factIds:facts.map(f=>f.id),factHashes:sources.map(f=>f.hash),sourceIds:unique(sources.flatMap(f=>f.sourceIds)),availableAt:sources.length?new Date(Math.max(...sources.map(f=>instant(f.availableAt)))).toISOString():null,...(details===undefined?{}:{details:json(details)})};
   catalog.claims.push(claim);catalog.areas[area].claims.push(claim);catalog.areas[area].requiredClaimIds.push(claim.id);
  };
  for(const area of READER_AREAS){
   const source=evidence[player.id][area],facts=source.facts;
   if(!facts.length){add(area,'source_missing',`No usable ${areaName(area)} source was supplied.`,`No usable ${areaName(area)} source was supplied.`,[]);continue;}
   if(area==='availability'){
    const lineup=packet.sport==='mlb'&&player.markets.some(m=>m.startsWith('batter_'))?facts.find(f=>{const v=obj(f.value);return (v.status==='posted'||v.status==='confirmed')&&Number.isInteger(v.battingOrder)&&Number(v.battingOrder)>=1&&Number(v.battingOrder)<=9||v.status==='not in lineup';}):undefined;
    const eligibility=playerParticipationEligibility(packet,player),ownFacts=facts.filter(f=>Object.hasOwn(obj(f.value),'ownStatus'));
    const reports=ownFacts.map(f=>({fact:f,value:obj(f.value),own:obj(obj(f.value).ownReport),clearance:obj(obj(f.value).ownExplicitClearance)}));
    const admissible=(value:Record<string,unknown>,fact:ReaderFact)=>Object.keys(value).length>0&&['reportedAt','reported_at','availableAt'].every(key=>value[key]===undefined||value[key]===null||typeof value[key]==='string'&&Number.isFinite(Date.parse(value[key] as string))&&Date.parse(value[key] as string)<=instant(fact.availableAt)&&Date.parse(value[key] as string)<=instant(packet.cutoff));
    const rawStatuses=unique([...reports.flatMap(r=>[...(admissible(r.clearance,r.fact)?['Explicit clearance']:[]),...(admissible(r.own,r.fact)?[statusName(r.own.status)]:[])]),...eligibility.facts.filter(f=>f.ownIdentityBasis!=='exact_team_report_omission'&&f.ownIdentityBasis!=='attached_batter_lineup').map(f=>statusName(f.rawStatus))].filter((s):s is string=>s!==null));
    const labels=eligibility.conflict?'conflicting':rawStatuses.length>1?'multiple':rawStatuses[0]??null;
    const listed=`Own-player reports list ${rawStatuses.join(' and ')}; read their source clocks in order.`;
    const text=labels==='conflicting'||labels==='multiple'?listed.length<=180?listed:'Own-player reports contain multiple designations; source clocks and explicit clearances must be read in order.':labels?`The supplied own-player report lists ${labels}; this is separate from other players and a confirmed starting role.`:'No explicit own-player designation or clearance is supplied; other players\' injury rows do not establish this player\'s status.';
    const short=labels==='conflicting'||labels==='multiple'?'Own-player availability has multiple supplied designations.':labels?`The own-player report lists ${labels}; starting status is separate.`:'Own-player availability is unverified; other players\' injuries are separate.';
    const lineupValue=obj(lineup?.value),posted=lineupValue.status!=='not in lineup';
    const lineupText=lineup?posted?`The lineup posts batting position ${lineupValue.battingOrder}. `:'The supplied lineup omits this batter. ':'';
    const lineupShort=lineup?posted?'Posted batting position; ':'Absent from lineup; ':'';
    const boundFacts=unique([...(ownFacts.length?ownFacts:facts),...(lineup?[lineup]:[])]);
    add(area,labels==='Explicit clearance'?'own_availability_clearance':labels?'own_availability_status':lineup?'own_lineup_status':'own_availability_unknown',lineupText+text,lineupShort+short,boundFacts,{status:eligibility.status,blocked:eligibility.blocked,conflict:eligibility.conflict,ownDesignations:rawStatuses,...(lineup?{lineup:{factId:lineup.id,status:lineupValue.status,battingOrder:lineupValue.battingOrder??null,meaning:'Lineup opportunity is separate from the own-player medical designation; it does not establish medical clearance.'}}:{}),ownReports:reports.map(r=>({factId:r.fact.id,ownStatus:statusName(r.own.status),ownReportPresent:Object.keys(r.own).length>0,ownClearancePresent:Object.keys(r.clearance).length>0,ownTeamKnown:r.value.ownTeamKnown??false})),otherPlayersAreSeparate:true,meaning:'No own injury detail is copied from a team report. Unknown/unlisted is neither Out nor healthy; a clearance is not a confirmed starter.'});continue;
   }
   if(area==='game_environment'&&packet.sport==='nba'){
    const gameFacts=facts.filter(f=>f.label==='Game pace/scoring environment inputs'),benchFacts=facts.filter(f=>f.label==='Observed league pace reference using matching units');
    const gameValues=unique(gameFacts.flatMap(f=>rows(f.value).filter(r=>r.key==='game_pace_mean_5').flatMap(r=>number(r.value)===null||number(r.value)!<=0?[]:[number(r.value)!])));
    const benchmarks=player.evidence.filter(e=>e.kind==='matchup'&&obj(e.value).readerBenchmarks===true&&Object.entries(NBA_READER_UNIT_CONTRACT).every(([key,value])=>obj(obj(e.value).readerUnitContract)[key]===value));
    const refs=benchmarks.flatMap(e=>{const ref=obj(obj(e.value).reference),current=number(ref.league_current_season_pace),n=number(ref.league_current_season_team_games);return current!==null&&current>0&&n!==null&&Number.isSafeInteger(n)&&n>0?[{current,n,prior:number(ref.league_prior_season_pace),priorN:number(ref.league_prior_season_team_games),sourceId:e.id}]:[];});
    const distinct=unique(refs.map(r=>JSON.stringify([r.current,r.n,r.prior,r.priorN])));
    if(gameValues.length===1&&distinct.length===1&&refs.length&&benchFacts.length){
     const game=gameValues[0],ref=refs[0],relation=game<ref.current?'below':game>ref.current?'above':'equal to';
     add(area,'same_unit_pace_comparison',`Supplied game pace ${display(game)} is ${relation} the current reference ${display(ref.current)} (${ref.n} observed team-games), using the same possession convention. This does not prescribe a player-stat adjustment.`,`Supplied game pace is ${relation} the observed same-unit current reference.`,unique([...gameFacts,...benchFacts]),{metric:'game_pace_mean_5',unit:NBA_READER_PACE_UNIT,game,reference:ref,relation,delta:game-ref.current});continue;
    }
    if(gameValues.length||benchFacts.length){add(area,'pace_comparison_unavailable','Pace context is supplied, but a unique explicitly qualified same-unit game/reference comparison is unavailable.','A qualified same-unit pace comparison is unavailable.',unique([...gameFacts,...benchFacts]),{gameValues,referenceSources:refs,status:gameValues.length>1||distinct.length>1?'conflicting':'unqualified_or_missing_units'});continue;}
   }
   if(area==='market'){
    const comparisons=exactEventComparisons(packet,player),same=comparisons.filter(e=>e.relation==='same_direction'),opposite=comparisons.filter(e=>e.relation==='opposite_direction'),mixed=comparisons.filter(e=>e.relation==='mixed_books'),other=comparisons.length-same.length-opposite.length-mixed.length;
    const text=comparisons.length?`At exact matching events, ${same.length} independent-prior directions agree with current paired prices, ${opposite.length} oppose them, ${mixed.length} have mixed books, and ${other} cannot establish agreement or disagreement.`:'Retained named-book prices are source context; no qualified exact-event prior/market directional comparison is supplied.';
    const short=comparisons.length?`Exact-event comparisons: ${same.length} aligned, ${opposite.length} opposed, ${mixed.length} mixed, ${other} unavailable or tied.`:'No qualified exact-event prior/market directional comparison is supplied.';
    const priorFacts=evidence[player.id].independent_model.facts;
    add(area,comparisons.length?'exact_event_market_comparison':'exact_event_comparison_unavailable',text,short,facts,comparisons,priorFacts);continue;
   }
   if(area==='independent_model'){
    const priors=independentPriorEvents(player).map(p=>packet.sport==='nba'&&obj(player.evidence.find(e=>e.id===p.sourceId)?.value).independentEventStatus!=='stored_native_reference_side'?{...p,preferredOutcome:'unavailable',rawPreferredOutcome:p.preferredOutcome}:p),over=priors.filter(p=>p.preferredOutcome==='over'||p.preferredOutcome==='yes').length,under=priors.filter(p=>p.preferredOutcome==='under'||p.preferredOutcome==='no').length,unknown=priors.length-over-under;
    add(area,'independent_event_directions',`Supplied independent event preferences: ${over} Over or Yes, ${under} Under or No, and ${unknown} tied or unavailable. Each preference belongs only to its declared market and exact line.`,'Independent event preferences are tied to their own exact markets and lines.',facts,priors);continue;
   }
   const summary=facts.find(f=>f.label==='Reconciled recent recorded stat windows'||f.label==='Reconciled direct-opponent game samples');
   if(summary){const value=obj(summary.value),last10=obj(obj(value.windows).last10),statistics=obj(last10.statistics),samples=['points','rebounds','assists','threes','passing_yards','rushing_yards','receiving_yards'].flatMap(key=>{const metric=obj(statistics[key]),mean=number(metric.mean);return mean===null?[]:[`${key.replaceAll('_',' ')} ${display(mean)}`];}).slice(0,4),count=number(value.summarizedGames)??number(last10.records)??0,dated=source.limitations.some(s=>s.startsWith('old_game_history:'));
    const text=area==='head_to_head'?`The supplied direct-opponent history contains ${count} qualifying recorded games${dated?'; this history is dated':''}. Tiny or old samples do not establish the current matchup.`:`The supplied recent window contains ${count} qualifying recorded games${samples.length?`; last-ten means: ${samples.join(', ')}`:''}${dated?'. This history is dated and does not establish current form':''}.`;
    add(area,area==='head_to_head'?'direct_history_samples':'recent_recorded_samples',text,area==='head_to_head'?`Direct-opponent history contains ${count} qualifying recorded games.`:`Recent history contains ${count} qualifying recorded games${dated?' and is dated':''}.`,[summary],value);continue;
   }
   const metrics=facts.flatMap(f=>rows(f.value).flatMap(row=>{const n=number(row.value);return typeof row.key==='string'&&/^[a-z][a-z0-9_]{1,70}$/.test(row.key)&&n!==null?[{key:row.key,value:n,factId:f.id}]:[]}));
   if(metrics.length){const names=metrics.map(m=>`${m.key.replaceAll('_',' ')} ${display(m.value)}`),expanded=`Supplied ${areaName(area)} metrics: ${names.join('; ')}. These observations alone do not establish a causal player-stat adjustment.`,text=expanded.length<=240?expanded:`Supplied ${areaName(area)} context contains ${metrics.length} timestamped numeric entries. Complete values remain in the cited facts; no unprovided comparison or causal adjustment is inferred.`;add(area,'supplied_numeric_context',text,`Timestamped numeric ${areaName(area)} inputs are supplied.`,facts,metrics);continue;}
   add(area,source.status==='missing'?'source_unavailable':'supplied_context',source.status==='missing'?`The supplied ${areaName(area)} record reports no usable sample or context.`:`The supplied ${areaName(area)} context is retained with its source limitations; no unprovided comparison or current role confirmation is inferred.`,source.status==='missing'?`No usable ${areaName(area)} sample is reported.`:`Supplied ${areaName(area)} context retains its source limitations.`,facts);
  }
  return[player.id,catalog];
 }));
}

/** Model navigation only. Full raw facts and the full canonical catalog remain
 * unchanged; repeat only the new derived relationships, not logs/prior payloads. */
export function readerClaimModelInput(packet:GamePacket){
 const aliases=new Map([...evidenceAliases(packet)].map(([alias,id])=>[id,alias]));
 const quoteCollection=packet.executionQuotes??packet.quotes,quoteIndices=new Map(quoteCollection.map((q,i)=>[q.id,i]));
 const catalogs=compileReaderClaims(packet);
 const relationship=(claim:ReaderClaim):Json|undefined=>{
  const detail=obj(claim.details);
  if(claim.area==='availability')return json({ownDesignations:detail.ownDesignations??[],lineup:detail.lineup?{factId:obj(detail.lineup).factId,status:obj(detail.lineup).status,battingOrder:obj(detail.lineup).battingOrder}:null,otherPlayersAreSeparate:true,lineupIsNotMedicalClearance:true});
  if(claim.kind==='same_unit_pace_comparison'){const ref=obj(detail.reference);return json({metric:detail.metric,unit:detail.unit,game:detail.game,currentReference:[ref.current,ref.n],priorReference:[ref.prior,ref.priorN],relation:detail.relation,delta:detail.delta});}
  if(claim.kind==='pace_comparison_unavailable')return json({status:detail.status});
  if(claim.kind!=='exact_event_market_comparison')return undefined;
  return json({schema:'events=[market,line,contract,priorOver,priorUnder,priorPush,priorDirection,relation,unavailableReason,books,conflictingBooks]; books=[underlyingBook,provider,fairOver,direction,privateQuoteRefs]. Quote refs index the declared collection in the private source archive, not readable quoteTrace IDs. Original reader-area/book traces remain authoritative. Other thresholds/feeds are not extra votes.',quoteRefCollection:packet.executionQuotes?'executionQuotes':'quotes',events:rows(claim.details).map(event=>{
   const pairs=rows(event.pairs),books=Array.isArray(event.independentBooks)?event.independentBooks.filter((v):v is string=>typeof v==='string'):[];
   const selected=books.map(book=>{
    const candidates=pairs.filter(p=>p.book===book).sort((a,b)=>{
     const clock=(p:Record<string,unknown>,key:string)=>Array.isArray(p[key])?Math.max(...(p[key] as unknown[]).map(v=>typeof v==='string'?Date.parse(v):-Infinity)):-Infinity;
     return clock(b,'receivedAt')-clock(a,'receivedAt')||clock(b,'observedAt')-clock(a,'observedAt')||String(a.provider).localeCompare(String(b.provider));
    });
    const pair=candidates[0];if(!pair)throw Error('Compiled underlying book has no original paired reference');
    const refs=Array.isArray(pair.quoteIds)?pair.quoteIds.map(id=>{const index=quoteIndices.get(String(id));if(index===undefined)throw Error('Compiled pair reference is missing from the original quote collection');return index;}):[];
    return[book,pair.provider,pair.fairOver,pair.direction,refs];
   });
   return[event.market,event.line,event.contract,event.priorOver,event.priorUnder,event.priorPush,event.preferred,event.relation,event.unavailableReason,selected,event.conflictingBooks];
  })});
 };
 return Object.fromEntries(Object.entries(catalogs).map(([id,catalog])=>[id,{release:catalog.release,meaning:'Navigation of the same supplied source facts, not additional evidence or independent votes.',areas:Object.fromEntries(READER_AREAS.map(area=>[area,{status:catalog.areas[area].status,requiredClaimIds:[...catalog.areas[area].requiredClaimIds],claims:catalog.areas[area].claims.map(claim=>{
  const derived=relationship(claim);
  return{id:claim.id,kind:claim.kind,text:claim.text,shortText:claim.shortText,factIds:[...claim.factIds],sourceEvidence:claim.sourceIds.map(source=>aliases.get(source)??source),...(derived===undefined?{}:{relationship:derived})};
 })}]))}]));
}
