import {createHash} from "node:crypto";
import {buildCbbMeasurementInputs,cbbMeasurementTrainingRowsSha256,CBB_MEASUREMENT_CONTEXT_NAMES,type CbbMeasurementInputs,type CbbMeasurementTrainingRow,type CbbMeasurement} from "./contextualMeasurementForecast";
import {expandCbbMarketBehaviorPathStream,cbbPathBookFamily} from "./marketBehaviorPath";
import {cbbEvidenceReceiptBounds,cbbAvailabilityUpperBoundMs} from "./marketReceiptTime";
import {cbbExactMarketCenter} from "./marketReaderResearch";
import {cbbInterpretationQuoteIdentity} from "./contextualMarketInterpretation";
import {cbbContextualConsumerBook,type CbbContextualFeatureInput} from "./contextualForecastFeatures";
import type {CbbForecast,CbbQuote} from "./types";

export const CBB_CONTEXTUAL_OUTCOME_RELEASE="cbb_contextual_outcome_forecast_2026_11_06_v9_direct_outcome_clock_units" as const;
type Axis="margin"|"total";
export const CBB_OUTCOME_BLOCKS=["level","path","pressure","cross_path","cross_pressure"] as const;
type Block=typeof CBB_OUTCOME_BLOCKS[number];
const AXIS_BLOCKS={margin:["level","path","pressure"],total:CBB_OUTCOME_BLOCKS} as const;
export const cbbOutcomeKernelBlocks=(axis:Axis):readonly Block[]=>AXIS_BLOCKS[axis];
export const cbbOutcomeLinearLogSdIndex=(axis:Axis)=>2*cbbOutcomeKernelBlocks(axis).length;
export const cbbOutcomeNoiseLogVarianceIndex=(axis:Axis)=>cbbOutcomeLinearLogSdIndex(axis)+1;
export const cbbOutcomeNoiseBetaOffset=(axis:Axis)=>cbbOutcomeNoiseLogVarianceIndex(axis)+1;
export const CBB_OUTCOME_PRESSURE_BOOKS={professional:["circa","pinnacle","bookmaker"],consumer:["draftkings","fanduel","betmgm","fanatics","bovada","hardrock","betr","stations","south_point","wynn"]} as const;
type Vector={names:string[];values:number[];known:boolean[];parity:(1|-1)[]};
export type CbbOutcomeAxisInput={blocks:Record<Block,Vector>;noiseFeatures:(number|null)[]};
export type CbbOutcomeInputs={gameId:number;asOf:string;startsAt:string;margin:CbbOutcomeAxisInput;total:CbbOutcomeAxisInput;measurementInputs:CbbMeasurementInputs;verificationTraces:unknown[];pressureTraces:unknown[];endpointTraces:unknown[];contextTraces:unknown[]};
export const CBB_OUTCOME_NOISE_FEATURES=["independent_log_working_sd","identified_native_mean_log_sd_ratio","identified_native_log_sd_dispersion","maximum_last_known_availability_age_log1p_hours","maximum_genuine_provider_response_age_log1p_hours"] as const;
/** Age already has a natural dimensionless log1p-hour scale. A training cohort
 * whose responses differ by seconds must not turn an old quote into thousands
 * of noise-design units. This specifies the slope prior, not a variance cap. */
export const CBB_OUTCOME_NOISE_UNITS=["training_sd","training_sd","training_sd","natural_log1p_hours","natural_log1p_hours"] as const;
export const CBB_OUTCOME_HTTP_PROVIDERS=["owls","balldontlie","sharpapi","the_odds_api"] as const;
export const CBB_OUTCOME_METHOD={release:CBB_CONTEXTUAL_OUTCOME_RELEASE,
 target:"direct_actual_game_margin_and_total;no_source_forecast_reference_or_forecast_share",
 kernel:"regularized_linear_LEVEL_plus_RBF_LEVEL_plus_independent_conditioned_own_PATH_PRESSURE_and_Total_cross_PATH_PRESSURE;odd_Margin_even_Total_reflection",
 kernelLayout:{activeBlocks:AXIS_BLOCKS,parameters:"RBF_log_SD_log_length_pairs_then_linear_LEVEL_log_SD_then_log_game_variance_then_active_noise_slopes;no_linear_length_or_inactive_Margin_cross_parameters"},
 normalization:"fold_local_LEVEL_known_values;odd_zero_origin_RMS_even_centered_SD;ALL_LEVEL_clocks_centered_natural_log1p_hours_scale1_known_even_if_constant;known_masks_separate_even_context;unidentified_nonclock_coordinates_zero;linear_LEVEL_only_declared_scoring_and_price_features_no_clocks_masks_coverage_hold_or_shape_quality",
 trend:"Total_unknown_constant_exact_REML_and_universal_kriging_trend_uncertainty;Margin_zero_intercept_odd_symmetry",
 primitiveEvidence:"independent_point_and_named_physical_book_native_contract_centers_prices_as_covariates;no_fitted_measurement_reference;no_convex_forecast_aggregation_or_reserved_share",
 ownEvidenceNoninterference:"fixture_horizon_and_foreign_context_excluded_own_PATH_PRESSURE;cross_components_separate_learned_covariances",
 verification:{httpProviders:CBB_OUTCOME_HTTP_PROVIDERS,identity:"provider_namespace_bound_native_ID_guards_preserved"},
 pressurePhysicalBooks:CBB_OUTCOME_PRESSURE_BOOKS,noiseFeatures:CBB_OUTCOME_NOISE_FEATURES,noiseUnits:CBB_OUTCOME_NOISE_UNITS,
 likelihood:"Margin_Gaussian_marginal_likelihood;Total_exact_REML;unit_Gaussian_prior_active_noise_slopes",starts:[0,-.7,.7],maxIterations:250,gradientTolerance:1e-5,
 prediction:"populationMean+direct_function_posterior;game_noise+function_posterior_variance+unknown_constant_trend_variance",
 limits:["Retrospective development unless artifact was available at the input clock.","Quote center inversion is conditional on the declared working shape, not bookmaker truth or bettor intent.","Fitted hyperparameter uncertainty is not fully integrated; game-excluded calibration remains required.","Sparse contextual training cannot identify all market scenarios or prove predictive improvement.","Missing optional innovation is not observed flat; no fabricated source quality, nonzero-effect floor, grade quota or manual point adjustment."]} as const;
const sha=(value:unknown)=>createHash("sha256").update(JSON.stringify(value)).digest("hex");
export const cbbOutcomeMethodSha256=()=>sha(CBB_OUTCOME_METHOD);
const finite=(x:unknown):x is number=>typeof x==="number"&&Number.isFinite(x);
const mean=(x:readonly number[])=>x.reduce((s,v)=>s+v,0)/x.length;
const dot=(x:readonly number[],y:readonly number[])=>x.reduce((s,v,j)=>s+v*y[j],0);
const clock=(value:unknown)=>typeof value==="string"?Date.parse(value):NaN;
const age=(at:string,value:unknown)=>{const v=clock(value),a=clock(at);return finite(v)&&v<=a?(a-v)/3600000:null;};
type Raw=Record<string,unknown>;
function vector(){return{names:[],values:[],known:[],parity:[]} as Vector;}
function add(v:Vector,name:string,value:number|null,parity:1|-1){v.names.push(name);v.values.push(value??0);v.known.push(value!==null);v.parity.push(parity);}
function rawRows(input:CbbContextualFeatureInput):Raw[]{const rows=[...input.currentQuotes,...(input.historyQuotes??[]),...(input.consumerCurrentQuotes??[]),...(input.consumerHistoryQuotes??[])],tape=input.pathTape;if(tape&&tape.gameId===input.independent.gameId&&tape.startsAt===input.startsAt&&finite(cbbAvailabilityUpperBoundMs(tape.capturedAt))&&cbbAvailabilityUpperBoundMs(tape.capturedAt)<=clock(input.asOf))for(const stream of tape.streams)if(!stream.quarantined)rows.push(...expandCbbMarketBehaviorPathStream(tape,stream).quotes);return rows as unknown as Raw[];}
function preciseClock(value:unknown):bigint|null{if(typeof value!=="string"||!finite(clock(value)))return null;const frac=value.match(/\.(\d+)(?:Z|[+-]\d{2}:?\d{2})$/i)?.[1]??"";if(frac.length>9&&/[1-9]/.test(frac.slice(9)))return null;return BigInt(clock(value))*BigInt(1000000)+BigInt(frac.slice(3,9).padEnd(6,"0"));}
function verification(input:CbbContextualFeatureInput,m:CbbMeasurement,rows:Raw[]){
 const quotes=m.quotes.filter(q=>!m.assumptions.some(a=>/spread-only|independently_valid_spread/.test(a))||q.rawQuote.market==="spread");
 return quotes.map(q=>{const candidates=rows.filter(raw=>raw.gameId===input.independent.gameId&&cbbPathBookFamily(String(raw.sportsbook))===m.book&&raw.market===q.rawQuote.market&&raw.line===q.line&&raw.firstPrice===q.firstPrice&&raw.secondPrice===q.secondPrice&&preciseClock(raw.providerObservedAt)!==null&&preciseClock(raw.providerObservedAt)===preciseClock(q.nativeAt));let latestAvailable:string|null=null,latestHttp:string|null=null,latestLower:string|null=null;const receipts:unknown[]=[],rejected:unknown[]=[];
  for(const raw of candidates){
   const reject=(reason:string)=>rejected.push({reason,nativeAt:raw.providerObservedAt});
   if(raw.phase==="opening"||raw.orientationVerified===false){reject("archived_or_explicitly_unverified");continue;}
   const orientation=raw.orientationVerified===true||["stored_labeled_pair","native_home_away_fields","named_fixture_attested","canonical_named_fixture_join"].includes(String(raw.orientationProof))||sha(raw)===sha(q.rawQuote);
   if(!orientation){reject("orientation_not_attested");continue;}
   const hasCanonical=Object.hasOwn(raw,"canonicalReceipt"),canon=raw.canonicalReceipt as Raw|undefined;
   if(hasCanonical&&(!canon||typeof canon!=="object")){reject("invalid_explicit_canonical_receipt");continue;}
   if(q.provider&&typeof raw.provider==="string"&&q.provider!==raw.provider){reject("provider_namespace_mismatch");continue;}
   const ownIdentity=cbbInterpretationQuoteIdentity(raw as unknown as CbbQuote);
   if(ownIdentity.invalid||ownIdentity.conflict||q.eventId&&q.provider===raw.provider&&ownIdentity.eventId&&ownIdentity.eventId!==q.eventId){reject("known_native_identity_conflict");continue;}
   let available:string|null=null,lower:string|null=null,http:string|null=null,kind:string;
   if(canon){const bounds=cbbEvidenceReceiptBounds(raw as unknown as CbbQuote);if(!finite(bounds.available)){reject("invalid_canonical_bounds");continue;}available=String(canon.availableBy);kind="db_inserted_upper_bound";}
   else if(raw.availabilityKind==="stored_snapshot_upper_bound"||raw.availabilityKind==="db_inserted_upper_bound"){available=typeof raw.availableBy==="string"?raw.availableBy:null;kind=String(raw.availabilityKind);}
   else if(raw.availabilityKind==="http_response"||!Object.hasOwn(raw,"availabilityKind")&&raw.phase==="current"&&(CBB_OUTCOME_HTTP_PROVIDERS as readonly string[]).includes(String(raw.provider))){http=typeof raw.receivedAt==="string"?raw.receivedAt:typeof raw.fetchedAt==="string"?raw.fetchedAt:null;available=http;kind="actual_provider_response";}
   else{reject("unknown_receipt_kind");continue;}
   if(raw.availabilityKind==="http_response"&&(preciseClock(raw.availableBy)===null||preciseClock(raw.availableBy)!==preciseClock(http)||preciseClock(raw.availableBy)!==preciseClock(raw.fetchedAt))){reject("http_availability_not_own_completed_receipt");continue;}
   if(["fetchedAt","receivedAt"].some(key=>Object.hasOwn(raw,key)&&(typeof raw[key]!=="string"||!finite(clock(raw[key]))))){reject("invalid_explicit_transport_clock");continue;}
   const upper=available?cbbAvailabilityUpperBoundMs(available):NaN,native=preciseClock(q.nativeAt),arrival=preciseClock(available),requested=raw.requestedAt===undefined?undefined:preciseClock(raw.requestedAt),received=raw.receivedAt===undefined?undefined:preciseClock(raw.receivedAt),fetched=raw.fetchedAt===undefined?undefined:preciseClock(raw.fetchedAt);
   if(!available||!finite(upper)||upper>clock(input.asOf)||native===null||arrival===null||native>arrival||fetched!==undefined&&(fetched===null||fetched>arrival)||received!==undefined&&(received===null||received>arrival||fetched!==undefined&&received<fetched!)){reject("invalid_or_unavailable_native_receipt_clock");continue;}
   if(requested!==undefined){if(requested!==null&&fetched!==undefined&&fetched!==null&&requested<=fetched)lower=String(raw.requestedAt);else reject("request_lower_unknown_price_availability_preserved");}
   else if(typeof canon?.collectionStartedAt==="string"){const start=preciseClock(canon.collectionStartedAt);if(start!==null&&fetched!==undefined&&fetched!==null&&start<=fetched)lower=canon.collectionStartedAt;else reject("collection_lower_unknown_price_availability_preserved");}
   else if(canon&&m.role==="professional"&&raw.provider==="owls")lower=typeof raw.fetchedAt==="string"?raw.fetchedAt:null;
   if(!latestAvailable||arrival>preciseClock(latestAvailable)!){latestAvailable=available;latestLower=lower;}if(http&&(!latestHttp||preciseClock(http)!>preciseClock(latestHttp)!))latestHttp=http;receipts.push({kind,lower,available,http,nativeAt:raw.providerObservedAt,requestedAt:raw.requestedAt??null,fetchedAt:raw.fetchedAt??null,receivedAt:raw.receivedAt??null});
  }
  return{book:m.book,market:q.rawQuote.market,nativeAt:q.nativeAt,lastKnownAvailability:latestAvailable,lastGenuineProviderResponse:latestHttp,availabilityLower:latestLower,nativeAgeHours:age(input.asOf,q.nativeAt),availableAgeHours:age(input.asOf,latestAvailable),genuineHttpAgeHours:age(input.asOf,latestHttp),receipts,rejected,meaning:"fresh_transport_reread_is_distinct_from_new_native_move;stored_DTO_capture_is_never_synthesized_as_HTTP_completion"};});
}
function qFair(first:number,second:number){const implied=(p:number)=>p>0?100/(100+p):-p/(-p+100);return implied(first)/(implied(first)+implied(second));}
function responseDelta(input:CbbContextualFeatureInput,m:CbbMeasurement,axis:Axis){const prior=input.independent,u=prior.uncertainty;if(!u?.marginSd||!u.totalSd)return null;const base={gameId:prior.gameId,margin:prior.margin,total:prior.total,uncertainty:{marginSd:u.marginSd,totalSd:u.totalSd},homeWinProbability:prior.homeWinProbability??.5} as CbbForecast;
 const evidence=(m.contextEvidence??[]) as {market?:CbbQuote["market"];actualResponse?:{baseline?:{line:number|null;firstPrice:number;secondPrice:number};response?:{line:number|null;firstPrice:number;secondPrice:number}}|null}[],values:number[]=[];
 for(const e of evidence)if(e.market&&e.actualResponse?.baseline&&e.actualResponse.response){try{const arithmetic=(q:{line:number|null;firstPrice:number;secondPrice:number})=>({gameId:prior.gameId,sportsbook:m.book!,market:e.market!,phase:"current",...q}) as CbbQuote,b=e.actualResponse.baseline,a=e.actualResponse.response;values.push((cbbExactMarketCenter(base,arithmetic(a),qFair(a.firstPrice,a.secondPrice))-cbbExactMarketCenter(base,arithmetic(b),qFair(b.firstPrice,b.secondPrice)))/(axis==="margin"?u.marginSd:u.totalSd));}catch{/* exact-center context failure remains unknown */}}
 return values.length?mean(values):null;
}
function crossMarginEvidenceView(input:CbbContextualFeatureInput,built:CbbMeasurementInputs){
 const conflicts=built.receipt.streams.flatMap(stream=>{
  if(!["professional","consumer"].includes(stream.role)||stream.market==="total")return[];
  const total=built.receipt.streams.find(s=>s.book===stream.book&&s.role===stream.role&&s.market==="total")?.currentQuote;
  if(!total)return[];
  return([{kind:"quote" as const,state:stream.currentQuote},{kind:"pressure" as const,state:stream.pressures.at(-1)}]).flatMap(({kind,state:q})=>total.provider&&q?.provider===total.provider&&q.eventId&&total.eventId&&q.eventId!==total.eventId?[{book:stream.book,market:stream.market,kind,provider:q.provider,marginEventId:q.eventId,totalEventId:total.eventId,marginNativeAt:q.nativeAt,totalNativeAt:total.nativeAt,reason:"same_provider_known_current_total_margin_native_identity_conflict"}]:[]);
 });
 if(!conflicts.length)return{input,built,conflicts};
 const family=(book:string)=>cbbContextualConsumerBook(cbbPathBookFamily(book.trim().toLowerCase())).replace(/^draftkings_network$/,"draftkings"),blockedQuotes=new Set(conflicts.filter(r=>r.kind==="quote").map(r=>`${r.book}:${r.market}`)),blockedPressure=new Set(conflicts.map(r=>`${r.book}:${r.market}`));
 const retain=(q:{sportsbook:string;market:string})=>!blockedQuotes.has(`${family(q.sportsbook)}:${q.market}`);
 const splits=(rows:NonNullable<CbbContextualFeatureInput["splitContext"]>):NonNullable<CbbContextualFeatureInput["splitContext"]>[number][]=>rows.flatMap(row=>{
  const named=["professional_adjacent_named_book","retail_named_book","retail_ticket_share"].includes(row.sourceClass);
  if(named&&blockedPressure.has(`${family(row.physicalFamily||row.sourceBook)}:${row.market}`))return[];
  return[{...row,...(row.sourceHistory?{sourceHistory:splits(row.sourceHistory)}:{})}];
 });
 // Filter a separate relation view, including retained history/frontiers. A
 // rejected current stream cannot silently reappear as its older price here.
 // The original receipt and both actual forecast axes remain untouched.
 const view:CbbContextualFeatureInput={...input,currentQuotes:input.currentQuotes.filter(retain),historyQuotes:input.historyQuotes?.filter(retain),consumerCurrentQuotes:input.consumerCurrentQuotes?.filter(retain),consumerHistoryQuotes:input.consumerHistoryQuotes?.filter(retain),sourceBaselineQuotes:input.sourceBaselineQuotes?.filter(retain),splitContext:input.splitContext?splits(input.splitContext):undefined,
  pathTape:input.pathTape?{...input.pathTape,streams:input.pathTape.streams.filter(s=>!blockedQuotes.has(`${family(s.book)}:${s.market}`)).map(s=>blockedPressure.has(`${family(s.book)}:${s.market}`)?{...s,flows:[],flowEventIds:[]}:s)}:input.pathTape};
 return{input:view,built:buildCbbMeasurementInputs(view),conflicts};
}
export function buildCbbOutcomeInputs(input:CbbContextualFeatureInput):CbbOutcomeInputs{
 const built=buildCbbMeasurementInputs(input),raw=rawRows(input),verificationTraces:unknown[]=[],pressureTraces:unknown[]=[],endpointTraces:unknown[]=[],contextTraces:unknown[]=[];
 const crossView=crossMarginEvidenceView(input,built),crossRaw=crossView.input===input?raw:rawRows(crossView.input);
 if(crossView.conflicts.length)contextTraces.push({sourceAxis:"margin",targetAxis:"total",withheldRelations:crossView.conflicts,meaning:"only_cross_axis_named_book_relation_withheld;own_valid_Total_and_actual_Margin_measurements_preserved;no_cross_provider_ID_equivalence_or_conflict"});
 const hoursToStart=(clock(input.startsAt)-clock(input.asOf))/3_600_000,horizon=Math.log1p(hoursToStart);
 if(!(hoursToStart>0&&finite(horizon)))throw Error("Outcome fixture horizon unavailable");
 contextTraces.push({source:"fixture_clock",startsAt:input.startsAt,asOf:input.asOf,hoursToStart,coordinate:"fixture.hours_to_start_log1p",blocks:{margin:["level"],total:["level","cross_path","cross_pressure"]},meaning:"pregame_position_context_separate_from_source_observation_age;never_in_own_PATH_PRESSURE_geometry;not_economic_innovation_or_proof_of_new_money"});
 const originalBuilt=built,originalRaw=raw;
 const axis=(which:Axis,built=originalBuilt,raw=originalRaw,traceAxis:string=which):CbbOutcomeAxisInput=>{const measurements=built[which].measurements,books=measurements.filter(m=>m.role!=="independent"),sd=which==="margin"?input.independent.uncertainty?.marginSd:input.independent.uncertainty?.totalSd;if(!sd||!finite(sd))throw Error("Outcome natural working shape unavailable");const parity:1|-1=which==="margin"?-1:1,blocks={level:vector(),path:vector(),pressure:vector(),cross_path:vector(),cross_pressure:vector()},ageContext=vector(),axisVerificationTraces:ReturnType<typeof verification>=[],joint=books.filter(m=>m.shape==="native_joint_identified");
  add(blocks.level,"fixture.hours_to_start_log1p",horizon,1);
  add(blocks.level,"independent.point",input.independent[which],parity);
  const other=which==="margin"?"total":"margin";
  add(blocks.level,"independent.other_axis_point",which==="total"?Math.abs(input.independent[other]):input.independent[other],1);
  const namedBooks=[...CBB_OUTCOME_PRESSURE_BOOKS.professional,...CBB_OUTCOME_PRESSURE_BOOKS.consumer,"caesars","betrivers","betonline","espnbet","pointsbet","unibet","superbook","sportsbetting","betus","lowvig","mybookie"];
  const primitiveStreams=built.receipt.streams.filter(s=>(s.role==="professional"||s.role==="consumer")&&s.currentQuote&&(which==="margin"?s.market!=="total":s.market==="total")&&!built.rejected.some(r=>r.book===s.book&&r.reason==="physical_book_role_collision")&&!(s.market==="moneyline"&&built.receipt.crossMarket.some(c=>c.book===s.book&&c.continuity==="conflict")));
  const centerOf=(q:NonNullable<typeof primitiveStreams[number]["currentQuote"]>)=>{try{return cbbExactMarketCenter(input.independent as CbbForecast,q.rawQuote as CbbQuote,qFair(q.firstPrice,q.secondPrice));}catch{return null;}};
  for(const book of namedBooks)for(const market of which==="margin"?["moneyline","spread"] as const:["total"] as const){
   const stream=primitiveStreams.find(s=>s.book===book&&s.market===market),q=stream?.currentQuote,prefix=`book.${book}.${market}`;
   const center=q?centerOf(q):null;
   add(blocks.level,`${prefix}.center`,center,parity);
   add(blocks.level,`${prefix}.line`,q?.line===null||q?.line===undefined?null:market==="spread"?-q.line:q.line,parity);
   add(blocks.level,`${prefix}.fair_balance`,q?qFair(q.firstPrice,q.secondPrice)-.5:null,parity);
   const probability=q?qFair(q.firstPrice,q.secondPrice):null;add(blocks.level,`${prefix}.fair_logodds`,probability===null?null:Math.log(probability/(1-probability)),parity);
   const net=stream?.baselineNet?.change??stream?.net,latest=stream?.latest;
   for(const [kind,change] of [["net",net],["latest",latest]] as const){add(blocks.path,`${prefix}.${kind}_line_move`,change?(market==="spread"?-change.lineDelta:change.lineDelta):null,parity);add(blocks.path,`${prefix}.${kind}_logodds_move`,change?change.logitDelta:null,parity);}
   const implied=(p:number)=>p>0?100/(100+p):-p/(-p+100);
   add(blocks.level,`${prefix}.overround`,q?implied(q.firstPrice)+implied(q.secondPrice)-1:null,1);
   add(blocks.level,`${prefix}.native_age_log1p_hours`,q?Math.log1p(age(input.asOf,q.nativeAt)!):null,1);
   add(blocks.level,`${prefix}.availability_age_log1p_hours`,q?Math.log1p(age(input.asOf,q.availableBy)!):null,1);
  }
  // Permutation-safe primitive coverage includes every qualified physical
  // book, including identities not observed in the training cohort. These
  // summaries are outcome covariates, never a source-forecast reference.
  for(const role of ["professional","consumer"] as const)for(const market of which==="margin"?["moneyline","spread"] as const:["total"] as const){
   const streams=primitiveStreams.filter(s=>s.role===role&&s.market===market),prefix=`${role}.${market}.primitive`;
   add(blocks.level,`${prefix}.book_count`,streams.length,1);
   const summarize=(block:Block,name:string,values:(number|null)[],p:1|-1)=>{const known=values.filter(finite),lo=known.length?Math.min(...known):null,hi=known.length?Math.max(...known):null;add(blocks[block],`${prefix}.${name}.midrange`,lo===null?null:(lo+hi!)/2,p);add(blocks[block],`${prefix}.${name}.range`,lo===null?null:hi!-lo,1);};
   summarize("level","line",streams.map(s=>s.currentQuote!.line===null?null:market==="spread"?-s.currentQuote!.line!:s.currentQuote!.line),parity);
   summarize("level","logodds",streams.map(s=>s.currentQuote!.logit),parity);
   summarize("level","center",streams.map(s=>centerOf(s.currentQuote!)),parity);
   for(const block of ["level","path"] as const){summarize(block,"native_age_log1p_hours",streams.map(s=>Math.log1p(age(input.asOf,s.currentQuote!.nativeAt)!)),1);summarize(block,"availability_age_log1p_hours",streams.map(s=>{const q=s.currentQuote!,latest=[q.availableBy,...q.observedAgainAt].sort((a,b)=>clock(b)-clock(a))[0];return Math.log1p(age(input.asOf,latest)!);}),1);}
   for(const kind of ["net","latest"] as const){const changes=streams.map(s=>kind==="net"?s.baselineNet?.change??s.net:s.latest);summarize("path",`${kind}_line_move`,changes.map(c=>c?(market==="spread"?-c.lineDelta:c.lineDelta):null),parity);summarize("path",`${kind}_logodds_move`,changes.map(c=>c?c.logitDelta:null),parity);}
  }
  for(const role of ["professional","consumer"] as const){const own=books.filter(m=>m.role===role);
   // ML-only books are still relevant to the scoring environment. A Total
   // measurement owns only its Total quote, so read the qualified Margin
   // measurements rather than accidentally making this channel always absent.
   // Take each book's magnitude before averaging: opposed favorite labels
   // must not cancel the strength context of the two physical prices.
   const mlEvidence=which==="total"?crossView.built:built,mlSources=which==="total"?mlEvidence.margin.measurements.filter(m=>m.role===role):own;
   const ml=mlSources.filter(m=>!mlEvidence.rejected.some(r=>r.book===m.book&&r.reason.includes("known_native_identity_conflict"))).flatMap(m=>m.quotes.filter(q=>q.rawQuote.market==="moneyline").map(q=>{const balance=qFair(q.firstPrice,q.secondPrice)-.5;return which==="total"?Math.abs(balance):balance;}));add(blocks.level,`${role}.ML_fair_balance`,ml.length?mean(ml):null,parity);
   const descriptors=own.flatMap(m=>(m.contextEvidence??[]) as {book?:string;market?:CbbQuote["market"];netNormalizedCenterChange?:number|null;latestNormalizedCenterChange?:number|null}[]);
   // ML and Spread are different contracts. Their opposing responses cannot
   // be averaged into an apparently flat path before contextual inference.
   for(const market of which==="margin"?["moneyline","spread"] as const:["total"] as const){const net:number[]=[],latest=descriptors.filter(d=>d.market===market).map(d=>d.latestNormalizedCenterChange).filter(finite);
   for(const stream of built.receipt.streams.filter(s=>s.role===role&&own.some(m=>m.book===s.book)&&s.market===market)){const retained=descriptors.find(d=>d.book===stream.book&&d.market===stream.market)?.netNormalizedCenterChange,endpoint=stream.baselineNet;let endpointChange:number|null=null;
    if(endpoint&&!(stream.market==="moneyline"&&built.rejected.some(r=>r.book===stream.book&&r.reason.includes("known_native_identity_conflict"))))try{const shape={gameId:input.independent.gameId,margin:input.independent.margin,total:input.independent.total,homeWinProbability:input.independent.homeWinProbability??.5,uncertainty:input.independent.uncertainty} as CbbForecast,center=(q:typeof endpoint.current)=>cbbExactMarketCenter(shape,q.rawQuote as CbbQuote,qFair(q.firstPrice,q.secondPrice));endpointChange=(center(endpoint.current)-center(endpoint.baseline))/sd;}catch{/* invalid endpoint mapping stays unknown, never a fabricated leg */}
    const selected=endpointChange??(finite(retained)?retained:null);if(selected!==null)net.push(selected);endpointTraces.push({axis:traceAxis,book:stream.book,market:stream.market,endpoint: endpoint??null,endpointNormalizedCenterChange:endpointChange,retainedNormalizedCenterChange:retained??null,selectedNet:selected,meaning:endpointChange!==null?"original_to_current_endpoint_net_only;not_contiguous_path_or_causal_response":"retained_contiguous_net_or_unknown"});
   }
   const prefix=which==="margin"?`${role}.${market}`:role;add(blocks.path,`${prefix}.net_center_move`,net.length?mean(net):null,parity);add(blocks.path,`${prefix}.latest_center_move`,latest.length?mean(latest):null,parity);
   }
   const actual=own.map(m=>responseDelta(input,m,which)).filter(finite);add(blocks.pressure,`${role}.actual_response_center_move`,actual.length?mean(actual):null,parity);
   const held=own.flatMap(m=>(m.contextEvidence??[]) as {latestProvedHold?:{activeCurrent:boolean;relation:string;hadActualMove:boolean;laterReversal:boolean;pressure:{moneyBalance:number|null;ticketBalance:number|null}}|null}[]).map(e=>e.latestProvedHold).filter(h=>h?.activeCurrent&&h.relation==="held_observed"&&!h.hadActualMove&&!h.laterReversal);
   for(const [key,name] of [["moneyBalance","money"],["ticketBalance","tickets"]] as const){const shares=held.map(h=>h!.pressure[key]).filter(finite);add(blocks.pressure,`${role}.raw_current_held_${name}_composition`,shares.length?mean(shares):null,parity);}
   const traces=own.flatMap(m=>verification(input,m,raw));verificationTraces.push(...traces.map(t=>({axis:traceAxis,...t})));axisVerificationTraces.push(...traces);for(const key of ["nativeAgeHours","availableAgeHours","genuineHttpAgeHours"] as const){const values=traces.map(t=>t[key]).filter(finite);add(ageContext,`${role}.${key}.mean_log1p`,values.length?mean(values.map(Math.log1p)):null,1);add(ageContext,`${role}.${key}.max_log1p`,values.length?Math.log1p(Math.max(...values)):null,1);}
  }
  add(blocks.level,"native_identified_mean_log_sd_ratio",joint.length?mean(joint.map(m=>Math.log(m.workingSd/sd))):null,1);add(blocks.level,"native_identified_log_sd_dispersion",joint.length?Math.sqrt(mean(joint.map(m=>(Math.log(m.workingSd/sd))**2))):null,1);
  for(let j=0;j<CBB_MEASUREMENT_CONTEXT_NAMES.length;j++){const values=books.map(m=>m.context[j]).filter(finite),isTime=/hours/.test(CBB_MEASUREMENT_CONTEXT_NAMES[j]);add(blocks.pressure,CBB_MEASUREMENT_CONTEXT_NAMES[j],values.length?mean(values.map(v=>isTime?Math.sign(v)*Math.log1p(Math.abs(v)):v)):null,1);}
  add(blocks.pressure,"independent.point_context",input.independent[which]/sd,parity);
  // Whole qualified latest cumulative compositions are evidence, not a
  // categorical causal-response or professional-intent claim. Keep markets
  // separate so opposing ML/SP compositions cannot average away.
  const ageMaximum=(key:"availableAgeHours"|"genuineHttpAgeHours")=>{const values=axisVerificationTraces.map(t=>t[key]).filter(finite);return values.length?Math.log1p(Math.max(...values)):null;};
  const lastAvailabilityAge=ageMaximum("availableAgeHours"),lastHttpAge=ageMaximum("genuineHttpAgeHours");
  for(const block of [blocks.path,blocks.pressure]){for(let j=0;j<ageContext.names.length;j++)add(block,ageContext.names[j],ageContext.known[j]?ageContext.values[j]:null,ageContext.parity[j]);add(block,"quote.maximum_last_known_availability_age_log1p_hours",lastAvailabilityAge,1);add(block,"quote.maximum_genuine_provider_response_age_log1p_hours",lastHttpAge,1);}
  for(const role of ["professional","consumer","public_context","retail_context"] as const)for(const market of which==="margin"?["moneyline","spread"] as const:["total"] as const){
   const admitted:Array<{book:string;money:number|null;tickets:number|null;nativeAge:number|null;availableAge:number;line:number|null;lineGap:number|null}>=[];
   for(const stream of built.receipt.streams.filter(s=>s.role===role&&s.market===market)){
    const p=stream.pressures.at(-1);if(!p)continue;const q=stream.currentQuote??stream.quotes.at(-1),provider=p.provider??null;
    const reason=p.conflict?"latest_pressure_state_conflict":p.eventId&&q?.eventId&&provider&&q.provider===provider&&p.eventId!==q.eventId?"same_provider_native_quote_pressure_identity_conflict":null;
    pressureTraces.push({axis:traceAxis,book:stream.book,role,market,provider,eventId:p.eventId,nativeAt:p.nativeAt,availableBy:p.availableBy,line:p.line,sourceClass:p.sourceClass,moneyBalance:p.moneyBalance,ticketBalance:p.ticketBalance,admitted:reason===null,rejectionReason:reason,meaning:"cumulative_share_at_reported_contract;not_new_money_volume_or_professional_intent;no_causal_response_required"});
    if(reason)continue;
    admitted.push({book:stream.book,money:p.moneyBalance,tickets:p.ticketBalance,nativeAge:p.nativeAt?age(input.asOf,p.nativeAt):null,availableAge:age(input.asOf,p.availableBy)!,line:p.line,lineGap:p.line!==null&&stream.currentQuote?.line!==null&&stream.currentQuote?.line!==undefined?p.line-stream.currentQuote.line:null});
   }
   const average=(key:Exclude<keyof typeof admitted[number],"book">)=>{const values=admitted.map(p=>p[key]).filter(finite);return values.length?mean(values):null;};
   const prefix=`${role}.${market}`;add(blocks.pressure,`${prefix}.latest_money_composition`,average("money"),parity);add(blocks.pressure,`${prefix}.latest_tickets_composition`,average("tickets"),parity);
   for(const key of ["nativeAge","availableAge"] as const){const value=average(key);add(blocks.pressure,`${prefix}.${key}_log1p_hours`,value===null?null:Math.log1p(value),1);}
   const line=average("line"),lineGap=average("lineGap");add(blocks.pressure,`${prefix}.reported_line_context`,line===null?null:line/sd,parity);add(blocks.pressure,`${prefix}.reported_current_line_gap_context`,lineGap===null?null:lineGap/sd,parity);
   const roster:readonly string[]=role==="professional"?CBB_OUTCOME_PRESSURE_BOOKS.professional:role==="consumer"?CBB_OUTCOME_PRESSURE_BOOKS.consumer:[];
   for(const book of roster){const row=admitted.find(p=>p.book===book),named=`${prefix}.${book}`;add(blocks.pressure,`${named}.latest_money_composition`,row?.money??null,parity);add(blocks.pressure,`${named}.latest_tickets_composition`,row?.tickets??null,parity);for(const key of ["nativeAge","availableAge"] as const)add(blocks.pressure,`${named}.${key}_log1p_hours`,row?.[key]===null||row?.[key]===undefined?null:Math.log1p(row[key]!),1);add(blocks.pressure,`${named}.reported_line_context`,row?.line===null||row?.line===undefined?null:row.line/sd,parity);add(blocks.pressure,`${named}.reported_current_line_gap_context`,row?.lineGap===null||row?.lineGap===undefined?null:row.lineGap/sd,parity);}
   const residual=admitted.filter(p=>!roster.includes(p.book));for(const key of ["money","tickets"] as const){const values=residual.map(p=>p[key]).filter(finite),center=values.length?mean(values):null;add(blocks.pressure,`${prefix}.residual.latest_${key}_composition`,center,parity);add(blocks.pressure,`${prefix}.residual_${key}_composition_dispersion`,center===null?null:Math.sqrt(mean(values.map(v=>(v-center)**2))),1);}
  }
  return{blocks,noiseFeatures:[Math.log(sd),joint.length?mean(joint.map(m=>Math.log(m.workingSd/sd))):null,joint.length?Math.sqrt(mean(joint.map(m=>(Math.log(m.workingSd/sd))**2))):null,lastAvailabilityAge,lastHttpAge]};
 };
 const margin=axis("margin"),total=axis("total"),crossMargin=crossView.built===built?margin:axis("margin",crossView.built,crossRaw,"cross_margin");
 // These are coordinates of the already-qualified Margin evidence, not new
 // source votes or score measurements. Keep signed current level and signed
 // movement together until the Total kernel's even reflection; taking each
 // sign's absolute value here would erase favorite-strength/response relations.
 const crossCurrent=(name:string)=>name==="independent.point"||/^book\..*\.(center|fair_balance|fair_logodds|line|overround)$/.test(name)||/^(professional|consumer)\.(ML_fair_balance|(?:moneyline|spread)\.primitive\.)/.test(name);
 const copy=(sourceBlock:Block,targetBlock:Block,select:(name:string)=>boolean,current=false)=>{
  const source=crossMargin.blocks[sourceBlock],target=total.blocks[targetBlock],coordinates:Array<{source:string;target:string;parity:1|-1;known:boolean}>=[];
  for(let j=0;j<source.names.length;j++){const name=source.names[j];if(!select(name))continue;const targetName=`cross_margin.${current?"current.":""}${name}`;
   add(target,targetName,source.known[j]?source.values[j]:null,source.parity[j]);coordinates.push({source:name,target:targetName,parity:source.parity[j],known:source.known[j]});}
  contextTraces.push({sourceAxis:"margin",sourceBlock,targetAxis:"total",targetBlock,coordinates,sourceEvidence:crossView.conflicts.length?"separate_cross_margin_evidence_view;endpointTraces_and_pressureTraces_axis_cross_margin":"measurementInputs.margin_and_receipt_native_book_contracts;endpointTraces_and_pressureTraces_axis_margin",withheldRelations:crossView.conflicts,meaning:"same_qualified_source_coordinates_once_in_this_block;preserved_reflection_parity;current_levels_and_distinct_ML_SP_contract_clocks_are_context_not_innovation"});
 };
 for(const target of ["cross_path","cross_pressure"] as const){add(total.blocks[target],"fixture.hours_to_start_log1p",horizon,1);copy("level",target,crossCurrent,true);}
 // Margin quote ages belong to ML/SP contracts, not Total quotes. Retain
 // those distinct clocks; omit only the shared fixture horizon already added.
 copy("path","cross_path",name=>name!=="fixture.hours_to_start_log1p");
 copy("pressure","cross_pressure",name=>
  /^(professional|consumer)\.(actual_response_center_move|raw_current_held_(money|tickets)_composition)$/.test(name)||
  /^(professional|consumer|public_context|retail_context)\.(moneyline|spread)\./.test(name)||
  /^(professional|consumer)\.(nativeAgeHours|availableAgeHours|genuineHttpAgeHours)\./.test(name)||
  /^quote\.maximum_/.test(name));
 return{gameId:input.independent.gameId,asOf:input.asOf,startsAt:input.startsAt,margin,total,measurementInputs:built,verificationTraces,pressureTraces,endpointTraces,contextTraces};
}
export type CbbOutcomeNoiseNormalizer={center:number[];scale:number[];knownCounts:number[];active:number[]};
export function cbbOutcomeNoiseNormalizer(inputs:readonly CbbOutcomeAxisInput[]):CbbOutcomeNoiseNormalizer{
 const values=CBB_OUTCOME_NOISE_FEATURES.map((_,j)=>inputs.map(x=>x.noiseFeatures[j]).filter(finite)),center=values.map(v=>v.length?mean(v):0),scale=values.map((v,j)=>CBB_OUTCOME_NOISE_UNITS[j]==="natural_log1p_hours"?1:v.length?Math.sqrt(mean(v.map(x=>(x-center[j])**2)))||1:1),active=values.flatMap((v,j)=>v.length&&Math.max(...v)-Math.min(...v)>64*Number.EPSILON*Math.max(1,...v.map(Math.abs))?[j]:[]);return{center,scale:scale.map((v,j)=>active.includes(j)?v:1),knownCounts:values.map(v=>v.length),active};
}
function noiseDesign(input:CbbOutcomeAxisInput,normal:CbbOutcomeNoiseNormalizer){return normal.active.map(j=>input.noiseFeatures[j]===null?0:(input.noiseFeatures[j]!-normal.center[j])/normal.scale[j]);}
function radial(distance:number,logLength:number){if(distance===0)return{value:1,logLengthDerivative:0};if(!finite(distance))return{value:0,logLengthDerivative:0};const exponent=Math.exp(Math.log(distance)-2*logLength);if(!finite(exponent))return{value:0,logLengthDerivative:0};const value=Math.exp(-exponent/2);return{value,logLengthDerivative:exponent*value};}
/** Schur-complement covariance after observing the zero-innovation function
 * value to be zero. Unlike four-term differencing, this still decays far from
 * observed support. Stable expm1 avoids subtracting nearly equal RBFs. */
function conditionedPath(distance:number,originNorm:number,crossDot:number,logLength:number){
 if(crossDot===0)return{value:0,logLengthDerivative:0};
 const ordinary=radial(distance,logLength),origin=radial(originNorm,logLength),ratio=Math.sign(crossDot)*Math.exp(Math.log(Math.abs(crossDot))-2*logLength);
 if(crossDot>=0){if(ordinary.value===0)return{value:0,logLengthDerivative:0};const difference=-Math.expm1(-ratio),distanceRatio=distance===0?0:Math.exp(Math.log(distance)-2*logLength),dampedDot=finite(ratio)?ratio*Math.exp(-ratio):0;return{value:ordinary.value*difference,logLengthDerivative:ordinary.value*(distanceRatio*difference-2*dampedDot)};}
 if(origin.value===0)return{value:0,logLengthDerivative:0};const difference=Math.expm1(ratio),originRatio=originNorm===0?0:Math.exp(Math.log(originNorm)-2*logLength),dampedDot=finite(ratio)?ratio*Math.exp(ratio):0;
 return{value:origin.value*difference,logLengthDerivative:origin.value*(originRatio*difference-2*dampedDot)};
}
export function cbbOutcomeIsInnovation(block:Block,name:string){
 if(block==="cross_path")return cbbOutcomeIsInnovation("path",name);
 if(block==="cross_pressure")return cbbOutcomeIsInnovation("pressure",name);
 if(name.startsWith("cross_margin.current."))return false;
 if(name.startsWith("cross_margin."))return cbbOutcomeIsInnovation(block,name.slice("cross_margin.".length));
 if(block==="path")return /\.(net_center_move|latest_center_move|net_line_move|latest_line_move|net_logodds_move|latest_logodds_move)(\.(midrange|range))?$/.test(name);
 if(block!=="pressure")return false;
 return /residual_(money|tickets)_composition_dispersion$|actual_response_center_move|raw_current_held_(money|tickets)_composition|\.latest_(money|tickets)_composition$|^own_actual_response_(money|tickets)_alignment$|^public_(money|tickets)_same_market_latest_alignment$/.test(name);
}
export function cbbOutcomeIsLevelClock(name:string){return /(?:log1p_hours|hours_to_start_log1p)(?:\.(?:midrange|range))?$/.test(name);}
/** The extrapolating scoring trend uses scoring and price levels only.
 * Freshness, availability and shape are context for the RBF, not unbounded
 * point-per-unit trends. This roster is semantic, never selected by outcomes. */
export function cbbOutcomeIsLinearLevelFeature(name:string){return name==="independent.point"||name==="independent.other_axis_point"||/^book\.[^.]+\.(?:moneyline|spread|total)\.(?:center|line|fair_balance|fair_logodds)$/.test(name)||/^(?:professional|consumer)\.ML_fair_balance$/.test(name)||/^(?:professional|consumer)\.(?:moneyline|spread|total)\.primitive\.(?:line|logodds|center)\.(?:midrange|range)$/.test(name);}
export type CbbOutcomeLevelNormalizer={names:string[];parity:(1|-1)[];units:("natural_log1p_hours"|"training_scale")[];center:number[];scale:number[];knownCounts:number[];active:boolean[];trainingGames:number};
export function cbbOutcomeLevelNormalizer(inputs:readonly CbbOutcomeAxisInput[]):CbbOutcomeLevelNormalizer{
 if(!inputs.length)throw Error("Outcome LEVEL normalizer needs own training cohort");const v=inputs[0].blocks.level;
 if(inputs.some(x=>sha(x.blocks.level.names)!==sha(v.names)||sha(x.blocks.level.parity)!==sha(v.parity)))throw Error("Outcome LEVEL schema mismatch");
 const values=v.names.map((_,j)=>inputs.filter(x=>x.blocks.level.known[j]).map(x=>x.blocks.level.values[j])),center=values.map((xs,j)=>v.parity[j]===-1||!xs.length?0:mean(xs)),rms=values.map((xs,j)=>xs.length?Math.sqrt(mean(xs.map(x=>(x-center[j])**2))):0),units=v.names.map(name=>cbbOutcomeIsLevelClock(name)?"natural_log1p_hours" as const:"training_scale" as const),active=rms.map((r,j)=>units[j]==="natural_log1p_hours"?values[j].length>0:r>64*Number.EPSILON*Math.max(1,...values[j].map(Math.abs)));
 return{names:[...v.names],parity:[...v.parity],units,center,scale:rms.map((r,j)=>units[j]==="natural_log1p_hours"?1:active[j]?r:1),knownCounts:values.map(xs=>xs.length),active,trainingGames:inputs.length};
}
export function cbbOutcomeNormalizeInput(input:CbbOutcomeAxisInput,n:CbbOutcomeLevelNormalizer):CbbOutcomeAxisInput{
 const v=input.blocks.level;if(sha(v.names)!==sha(n.names)||sha(v.parity)!==sha(n.parity))throw Error("Outcome LEVEL normalizer feature binding mismatch");
 const level=vector();for(let j=0;j<v.names.length;j++){add(level,v.names[j],v.known[j]&&n.active[j]?(v.values[j]-n.center[j])/n.scale[j]:0,v.parity[j]);level.known[j]=v.known[j];}
 for(let j=0;j<v.names.length;j++){const p=n.knownCounts[j]/n.trainingGames,sd=Math.sqrt(p*(1-p));add(level,`${v.names[j]}.known`,(Number(v.known[j])-p)/(sd||1),1);}
 return{...input,blocks:{...input.blocks,level}};
}
export function cbbOutcomeKernelParts(x:CbbOutcomeAxisInput,y:CbbOutcomeAxisInput,axis:Axis,theta:readonly number[]){
 const blocks=cbbOutcomeKernelBlocks(axis),linearIndex=cbbOutcomeLinearLogSdIndex(axis);
 if(theta.length<=linearIndex||!theta.slice(0,linearIndex+1).every(finite))throw Error("Outcome kernel active parameter layout unavailable");
 if(axis==="margin"&&[x,y].some(input=>["cross_path","cross_pressure"].some(block=>input.blocks[block as Block].values.length)))throw Error("Margin has no parameterized cross evidence component");
 const terms=blocks.map((block,b)=>{const a=x.blocks[block],c=y.blocks[block];if(a.values.length!==c.values.length||sha(a.names)!==sha(c.names)||sha(a.parity)!==sha(c.parity))throw Error("Outcome kernel feature schema mismatch");let distance=0,mirrorDistance=0,innovationNorm=0,crossDot=0,mirrorDot=0,contextDistance=0,contextMirrorDistance=0;
  for(let j=0;j<a.values.length;j++){const d=(a.values[j]-c.values[j])**2,md=(a.values[j]-c.parity[j]*c.values[j])**2;distance+=d;mirrorDistance+=md;if(cbbOutcomeIsInnovation(block,a.names[j])){innovationNorm+=a.values[j]**2+c.values[j]**2;crossDot+=a.values[j]*c.values[j];mirrorDot+=a.values[j]*c.parity[j]*c.values[j];}else{contextDistance+=d;contextMirrorDistance+=md;}}
  const originNorm=contextDistance+innovationNorm,mirrorOriginNorm=contextMirrorDistance+innovationNorm,variance=Math.exp(2*theta[2*b]),ra=block!=="level"?conditionedPath(distance,originNorm,crossDot,theta[2*b+1]):radial(distance,theta[2*b+1]),rb=block!=="level"?conditionedPath(mirrorDistance,mirrorOriginNorm,mirrorDot,theta[2*b+1]):radial(mirrorDistance,theta[2*b+1]),sign=axis==="margin"?-1:1,value=.5*variance*(ra.value+sign*rb.value),lengthDerivative=.5*variance*(ra.logLengthDerivative+sign*rb.logLengthDerivative);return{block:block as Block|"linear_level",value,amplitudeDerivative:2*value,lengthDerivative,distance,mirrorDistance,originNorm,mirrorOriginNorm,crossDot,mirrorDot};});
 const a=x.blocks.level,c=y.blocks.level,sign=axis==="margin"?-1:1;let linear=0;for(let j=0;j<a.values.length;j++)if(cbbOutcomeIsLinearLevelFeature(a.names[j]))linear+=.5*a.values[j]*c.values[j]*(1+sign*c.parity[j]);
 const value=Math.exp(2*theta[linearIndex])*linear;terms.push({block:"linear_level",value,amplitudeDerivative:2*value,lengthDerivative:0,distance:0,mirrorDistance:0,originNorm:0,mirrorOriginNorm:0,crossDot:linear,mirrorDot:linear});
 return{value:terms.reduce((s,v)=>s+v.value,0),terms};
}
function factor(matrix:Float64Array,n:number){const l=Array.from({length:n},()=>Array(n).fill(0) as number[]);for(let i=0;i<n;i++)for(let j=0;j<=i;j++){let value=matrix[i*n+j];for(let k=0;k<j;k++)value-=l[i][k]*l[j][k];if(i===j){if(!(value>0&&finite(value)))return null;l[i][j]=Math.sqrt(value);}else l[i][j]=value/l[j][j];}return l;}
function lowerSolve(l:readonly number[][],y:readonly number[]){return y.reduce<number[]>((out,value,i)=>{for(let j=0;j<i;j++)value-=l[i][j]*out[j];out.push(value/l[i][i]);return out;},[]);}
function solve(l:readonly number[][],y:readonly number[]){const v=lowerSolve(l,y),out=Array(y.length).fill(0) as number[];for(let i=y.length-1;i>=0;i--){let value=v[i];for(let j=i+1;j<y.length;j++)value-=l[j][i]*out[j];out[i]=value/l[i][i];}return out;}
type Geometry={n:number;inputs:CbbOutcomeAxisInput[];axis:Axis;blocks:readonly Block[];distance:Float64Array[];mirror:Float64Array[];origin:Float64Array[];mirrorOrigin:Float64Array[];innovationDot:Float64Array[];innovationMirrorDot:Float64Array[];linear:Float64Array;levelNormalizer:CbbOutcomeLevelNormalizer;noiseNormalizer:CbbOutcomeNoiseNormalizer;noiseDesign:number[][]};
function geometry(rawInputs:CbbOutcomeAxisInput[],axis:Axis):Geometry{
 if(!rawInputs.length)throw Error("Outcome GP needs training inputs");const levelNormalizer=cbbOutcomeLevelNormalizer(rawInputs),inputs=rawInputs.map(x=>cbbOutcomeNormalizeInput(x,levelNormalizer)),n=inputs.length,blocks=cbbOutcomeKernelBlocks(axis),distance=blocks.map(()=>new Float64Array(n*n)),mirror=blocks.map(()=>new Float64Array(n*n)),origin=blocks.map(()=>new Float64Array(n*n)),mirrorOrigin=blocks.map(()=>new Float64Array(n*n)),innovationDot=blocks.map(()=>new Float64Array(n*n)),innovationMirrorDot=blocks.map(()=>new Float64Array(n*n)),linear=new Float64Array(n*n);
 for(let i=0;i<n;i++){for(const block of CBB_OUTCOME_BLOCKS){const v=inputs[i].blocks[block];if(v.values.length!==v.names.length||v.values.length!==v.known.length||v.values.length!==v.parity.length||!v.values.every(finite)||v.parity.some(p=>p!==1&&p!==-1))throw Error("Outcome feature values invalid");}for(let j=0;j<=i;j++){const parts=cbbOutcomeKernelParts(inputs[i],inputs[j],axis,Array(cbbOutcomeLinearLogSdIndex(axis)+1).fill(0));parts.terms.forEach((term,b)=>{for(const k of [i*n+j,j*n+i]){if(term.block==="linear_level"){linear[k]=term.crossDot;continue;}distance[b][k]=term.distance;mirror[b][k]=term.mirrorDistance;origin[b][k]=term.originNorm;mirrorOrigin[b][k]=term.mirrorOriginNorm;innovationDot[b][k]=term.crossDot;innovationMirrorDot[b][k]=term.mirrorDot;}});}}
 const noiseNormalizer=cbbOutcomeNoiseNormalizer(inputs);return{n,inputs,axis,blocks,distance,mirror,origin,mirrorOrigin,innovationDot,innovationMirrorDot,linear,levelNormalizer,noiseNormalizer,noiseDesign:inputs.map(x=>noiseDesign(x,noiseNormalizer))};
}
type Evaluation={value:number;marginalNll:number;gradient:number[];cholesky?:number[][];alpha?:number[];populationMean?:number;interceptPrecision?:number;inverseOnes?:number[];conditionInfinity?:number;effectiveDegreesOfFreedom?:number};
function evaluate(g:Geometry,y:number[],theta:number[],gradient:boolean):Evaluation{
 const n=g.n,linearIndex=cbbOutcomeLinearLogSdIndex(g.axis),noiseIndex=cbbOutcomeNoiseLogVarianceIndex(g.axis),betaOffset=cbbOutcomeNoiseBetaOffset(g.axis),bad=()=>({value:Infinity,marginalNll:Infinity,gradient:theta.map(()=>0)});if(theta.length!==betaOffset+g.noiseNormalizer.active.length||!theta.every(finite)||y.length!==n||!y.every(finite)||g.axis==="total"&&n<2)return bad();
 const variance=g.blocks.map((_,j)=>Math.exp(2*theta[2*j])),linearVariance=Math.exp(2*theta[linearIndex]);if(![...variance,linearVariance].every(v=>finite(v)&&v>=0))return bad();
 const noise=g.noiseDesign.map(z=>Math.exp(theta[noiseIndex]+dot(z,theta.slice(betaOffset))));if(noise.some(v=>!finite(v)||v<0))return bad();const matrix=new Float64Array(n*n),kernels=new Float64Array(n*n),derivatives=gradient?Array.from({length:linearIndex+1},()=>new Float64Array(n*n)):[],sign=g.axis==="margin"?-1:1;
 for(let i=0;i<n;i++)for(let j=0;j<=i;j++){const k=i*n+j;let kernel=linearVariance*g.linear[k];if(gradient)for(const offset of [k,j*n+i])derivatives[linearIndex][offset]=2*kernel;for(let b=0;b<g.blocks.length;b++){const a=b!==0?conditionedPath(g.distance[b][k],g.origin[b][k],g.innovationDot[b][k],theta[2*b+1]):radial(g.distance[b][k],theta[2*b+1]),c=b!==0?conditionedPath(g.mirror[b][k],g.mirrorOrigin[b][k],g.innovationMirrorDot[b][k],theta[2*b+1]):radial(g.mirror[b][k],theta[2*b+1]),v=.5*variance[b]*(a.value+sign*c.value);kernel+=v;if(gradient)for(const offset of [k,j*n+i]){derivatives[2*b][offset]=2*v;derivatives[2*b+1][offset]=.5*variance[b]*(a.logLengthDerivative+sign*c.logLengthDerivative);}}
  for(const offset of [k,j*n+i]){kernels[offset]=kernel;matrix[offset]=kernel+(i===j?noise[i]:0);}
 }
 const l=factor(matrix,n);if(!l)return bad();const inverseY=solve(l,y),inverseOnes=g.axis==="total"?solve(l,Array(n).fill(1)):[],interceptPrecision=g.axis==="total"?inverseOnes.reduce((a,b)=>a+b,0):0;if(g.axis==="total"&&!(interceptPrecision>0&&finite(interceptPrecision)))return bad();const populationMean=g.axis==="total"?dot(inverseOnes,y)/interceptPrecision:0,alpha=inverseY.map((v,j)=>v-populationMean*(inverseOnes[j]??0)),marginalNll=.5*dot(y.map(v=>v-populationMean),alpha)+l.reduce((s,r,i)=>s+Math.log(r[i]),0)+.5*(n-Number(g.axis==="total"))*Math.log(2*Math.PI)+(g.axis==="total"?.5*Math.log(interceptPrecision):0),penalty=.5*dot(theta.slice(betaOffset),theta.slice(betaOffset)),value=marginalNll+penalty;if(!finite(value))return bad();
 const inverse=Array.from({length:n},(_,j)=>{const e=Array(n).fill(0);e[j]=1;return solve(l,e);}),norm=Math.max(...Array.from({length:n},(_,i)=>Array.from({length:n},(_,j)=>Math.abs(matrix[i*n+j])).reduce((a,b)=>a+b,0))),inverseNorm=Math.max(...Array.from({length:n},(_,i)=>inverse.reduce((s,c)=>s+Math.abs(c[i]),0))),conditionInfinity=norm*inverseNorm;if(!finite(conditionInfinity)||64*n*Number.EPSILON*conditionInfinity>=1)return bad();
 const precision=(i:number,j:number)=>inverse[j][i]-(g.axis==="total"?inverseOnes[i]*inverseOnes[j]/interceptPrecision:0);
 const out:Evaluation={value,marginalNll,gradient:theta.map(()=>0),cholesky:l,alpha,populationMean,interceptPrecision,inverseOnes,conditionInfinity,effectiveDegreesOfFreedom:Number(g.axis==="total")+Array.from({length:n},(_,i)=>Array.from({length:n},(_,j)=>kernels[i*n+j]*precision(i,j)).reduce((a,b)=>a+b,0)).reduce((a,b)=>a+b,0)};if(!gradient)return out;
 for(let i=0;i<n;i++)for(let j=0;j<n;j++){const weight=.5*(precision(i,j)-alpha[i]*alpha[j]),k=i*n+j;for(let t=0;t<=linearIndex;t++)out.gradient[t]+=weight*derivatives[t][k];if(i===j){out.gradient[noiseIndex]+=weight*noise[i];g.noiseDesign[i].forEach((v,t)=>out.gradient[betaOffset+t]+=weight*noise[i]*v);}}
 theta.slice(betaOffset).forEach((v,j)=>out.gradient[betaOffset+j]+=v);return out;
}
export function cbbOutcomeObjectiveForTest(inputs:CbbOutcomeAxisInput[],outcomes:number[],axis:Axis,theta:number[]){const g=geometry(inputs,axis);return{...evaluate(g,outcomes,theta,true),noiseNormalizer:g.noiseNormalizer,levelNormalizer:g.levelNormalizer,normalizedInputs:g.inputs};}
type Optimizer={theta:number[];converged:boolean;iterations:number;evaluations:number;reason:string;objective:number;gradientInfinity:number};
function minimize(g:Geometry,y:number[],initial:number[],maxIterations:number):Optimizer{
 let theta=[...initial],current=evaluate(g,y,theta,true),evaluations=1,iterations=0,converged=false,reason="iteration_budget",h=Array.from({length:initial.length},(_,i)=>Array.from({length:initial.length},(_,j)=>Number(i===j)));
 for(;iterations<maxIterations;iterations++){if(!finite(current.value)){reason="initial_covariance_unresolved";break;}if(Math.max(...current.gradient.map(Math.abs))<1e-5){converged=true;reason="gradient_tolerance";break;}let direction=h.map(r=>-dot(r,current.gradient));if(!(dot(direction,current.gradient)<0)){h=h.map((r,i)=>r.map((_,j)=>Number(i===j)));direction=current.gradient.map(v=>-v);}const slope=dot(direction,current.gradient);let step=1,next:Evaluation|undefined,nextTheta:number[]=[];
  for(let attempt=0;attempt<35;attempt++){nextTheta=theta.map((v,j)=>v+step*direction[j]);const trial=evaluate(g,y,nextTheta,false);evaluations++;if(finite(trial.value)&&trial.value<=current.value+1e-4*step*slope){next=evaluate(g,y,nextTheta,true);evaluations++;break;}step*=.5;}if(!next){reason="line_search_unresolved";break;}
  const s=nextTheta.map((v,j)=>v-theta[j]),delta=next.gradient.map((v,j)=>v-current.gradient[j]),curvature=dot(s,delta);if(curvature>Number.EPSILON*Math.sqrt(dot(s,s)*dot(delta,delta))){const hd=h.map(r=>dot(r,delta)),coefficient=(curvature+dot(delta,hd))/(curvature*curvature);h=h.map((r,i)=>r.map((v,j)=>v+coefficient*s[i]*s[j]-(hd[i]*s[j]+s[i]*hd[j])/curvature));}else h=h.map((r,i)=>r.map((_,j)=>Number(i===j)));theta=nextTheta;current=next;
 }
 return{theta,converged,iterations,evaluations,reason,objective:current.value,gradientInfinity:Math.max(...current.gradient.map(Math.abs))};
}
export type CbbOutcomeAxisArtifact={axis:Axis;kernelBlocks:readonly Block[];inputs:CbbOutcomeAxisInput[];levelNormalizer:CbbOutcomeLevelNormalizer;theta:number[];noiseNormalizer:CbbOutcomeNoiseNormalizer;noiseBeta:number[];populationMean:number;interceptPrecision:number;inverseOnes:number[];alpha:number[];cholesky:number[][];objective:number;marginalNll:number;conditionInfinity:number;effectiveDegreesOfFreedom:number;optimizer:Optimizer;trials:Optimizer[]};
export type CbbOutcomeArtifact={release:typeof CBB_CONTEXTUAL_OUTCOME_RELEASE;authority:"offline_research_only";methodSha256:string;trainingRowsSha256:string;trainingGameIds:number[];trainingGames:number;createdAt:string;availableBy:string;trainingCutoff:string;margin:CbbOutcomeAxisArtifact;total:CbbOutcomeAxisArtifact};
function fitAxis(inputs:CbbOutcomeAxisInput[],outcomes:number[],axis:Axis,maxIterations:number):CbbOutcomeAxisArtifact{
 const g=geometry(inputs,axis),center=axis==="total"?mean(outcomes):0,scale=Math.sqrt(mean(outcomes.map(v=>(v-center)**2)));if(!(scale>0))throw Error("Outcome training scale unavailable");const initial=g.blocks.flatMap((_,b)=>{const d=[...g.distance[b]].filter(v=>v>0).sort((a,b)=>a-b),length=Math.sqrt(d[Math.floor(d.length/2)]??1);return[Math.log(scale/4),Math.log(length)];});initial.push(Math.log(scale/4),Math.log(scale*scale),...g.noiseNormalizer.active.map(()=>0));
 const trials=CBB_OUTCOME_METHOD.starts.map(shift=>minimize(g,outcomes,initial.map((v,j)=>j===cbbOutcomeNoiseLogVarianceIndex(axis)?v+shift:v),maxIterations)).sort((a,b)=>a.objective-b.objective),best=trials.find(t=>t.converged)??trials[0];if(!best.converged)throw Error(`Outcome ${axis} GP optimizer unresolved:${best.reason};gradient=${best.gradientInfinity}`);const fitted=evaluate(g,outcomes,best.theta,true);if(!fitted.alpha||!fitted.cholesky||!finite(fitted.value))throw Error("Outcome final GP covariance unresolved");
 return{axis,kernelBlocks:g.blocks,inputs:g.inputs,levelNormalizer:g.levelNormalizer,theta:best.theta,noiseNormalizer:g.noiseNormalizer,noiseBeta:CBB_OUTCOME_NOISE_FEATURES.map((_,j)=>{const k=g.noiseNormalizer.active.indexOf(j);return k<0?0:best.theta[cbbOutcomeNoiseBetaOffset(axis)+k];}),populationMean:fitted.populationMean!,interceptPrecision:fitted.interceptPrecision!,inverseOnes:fitted.inverseOnes!,alpha:fitted.alpha,cholesky:fitted.cholesky,objective:fitted.value,marginalNll:fitted.marginalNll,conditionInfinity:fitted.conditionInfinity!,effectiveDegreesOfFreedom:fitted.effectiveDegreesOfFreedom!,optimizer:best,trials};
}
export const cbbOutcomeFitAxisForTest=fitAxis;
export function cbbOutcomeTrainingRowsSha256(rows:readonly CbbMeasurementTrainingRow[]){return sha({sourceTrainingRowsSha256:cbbMeasurementTrainingRowsSha256(rows),rows:[...rows].sort((a,b)=>a.gameId-b.gameId).map(r=>{const x=buildCbbOutcomeInputs(r.input);return{gameId:r.gameId,provenanceSha256:r.provenanceSha256,decisionAt:r.decisionAt,startsAt:r.startsAt,outcomeAvailableBy:r.outcomeAvailableBy,margin:x.margin,total:x.total,actualHome:r.actualHome,actualAway:r.actualAway};})});}
export function fitCbbContextualOutcomeForecast(rows:readonly CbbMeasurementTrainingRow[],options:{trainingCutoff:string;createdAt:string;maxIterations?:number}){
 const cutoff=clock(options.trainingCutoff),created=clock(options.createdAt),maxIterations=options.maxIterations??250;if(!finite(cutoff)||!finite(created)||created<cutoff||rows.length<10||!Number.isSafeInteger(maxIterations)||maxIterations<1)throw Error("Outcome training clocks/cohort/options invalid");const ordered=[...rows].sort((a,b)=>a.gameId-b.gameId),ids=ordered.map(r=>r.gameId);if(new Set(ids).size!==ids.length||ordered.some(r=>!Number.isSafeInteger(r.gameId)||r.gameId<=0||r.gameId!==r.input.independent.gameId||r.decisionAt!==r.input.asOf||r.startsAt!==r.input.startsAt||!(clock(r.decisionAt)<clock(r.startsAt))||!(clock(r.startsAt)<clock(r.outcomeAvailableBy))||!(clock(r.outcomeAvailableBy)<=cutoff)||![r.actualHome,r.actualAway].every(v=>Number.isSafeInteger(v)&&v>=0)||r.actualHome===r.actualAway||!/^[a-f0-9]{64}$/.test(r.provenanceSha256)))throw Error("Outcome training identity/label/availability invalid");
 const built=ordered.map(r=>buildCbbOutcomeInputs(r.input)),margin=fitAxis(built.map(r=>r.margin),ordered.map(r=>r.actualHome-r.actualAway),"margin",maxIterations),total=fitAxis(built.map(r=>r.total),ordered.map(r=>r.actualHome+r.actualAway),"total",maxIterations),availableBy=new Date().toISOString();if(clock(availableBy)<created)throw Error("Outcome head availability invalid");
 const artifact:CbbOutcomeArtifact={release:CBB_CONTEXTUAL_OUTCOME_RELEASE,authority:"offline_research_only",methodSha256:cbbOutcomeMethodSha256(),trainingRowsSha256:cbbOutcomeTrainingRowsSha256(ordered),trainingGameIds:ids,trainingGames:ids.length,createdAt:options.createdAt,availableBy,trainingCutoff:options.trainingCutoff,margin,total};
 return{artifact,diagnostics:{actualOutcomes:ids.length,pseudoMirrorRows:0,directTargets:true,sourceReference:false,totalUnknownConstantREML:true,empiricalPluginNotExactFullBayes:true,limits:CBB_OUTCOME_METHOD.limits}};
}
export function validateCbbOutcomeArtifact(a:CbbOutcomeArtifact){if(a.release!==CBB_CONTEXTUAL_OUTCOME_RELEASE||a.authority!=="offline_research_only"||a.methodSha256!==cbbOutcomeMethodSha256()||a.trainingGames!==a.trainingGameIds.length||new Set(a.trainingGameIds).size!==a.trainingGames||!a.trainingGames)throw Error("Outcome artifact method/cohort binding invalid");for(const axis of ["margin","total"] as const){const f=a[axis],n=f?.levelNormalizer;
 if(f?.axis!==axis||!Array.isArray(f.kernelBlocks)||sha(f.kernelBlocks)!==sha(cbbOutcomeKernelBlocks(axis))||f.inputs.length!==a.trainingGames||f.alpha.length!==a.trainingGames||!f.alpha.every(finite)||f.cholesky.length!==a.trainingGames||f.cholesky.some((r,i)=>r.length!==a.trainingGames||!r.every(finite)||!(r[i]>0))||f.theta.length!==cbbOutcomeNoiseBetaOffset(axis)+f.noiseNormalizer.active.length||!f.theta.every(finite)||sha(f.theta)!==sha(f.optimizer.theta)||!n||n.trainingGames!==a.trainingGames||[n.center,n.scale,n.knownCounts,n.active,n.parity,n.units].some(v=>v.length!==n.names.length)||n.scale.some((v,j)=>!finite(v)||v<=0||cbbOutcomeIsLevelClock(n.names[j])&&(v!==1||n.units[j]!=="natural_log1p_hours"||n.active[j]!==Boolean(n.knownCounts[j])))||n.units.some((unit,j)=>unit!==(cbbOutcomeIsLevelClock(n.names[j])?"natural_log1p_hours":"training_scale"))||n.center.some((v,j)=>!finite(v)||n.parity[j]===-1&&v!==0)||n.knownCounts.some(v=>!Number.isSafeInteger(v)||v<0||v>a.trainingGames)||!finite(f.populationMean)||!finite(f.interceptPrecision)||axis==="margin"&&(f.populationMean!==0||f.interceptPrecision!==0||f.inverseOnes.length!==0)||axis==="total"&&(!(f.interceptPrecision>0)||f.inverseOnes.length!==a.trainingGames||!f.inverseOnes.every(finite))||f.noiseNormalizer.center.length!==CBB_OUTCOME_NOISE_FEATURES.length||f.noiseNormalizer.scale.length!==CBB_OUTCOME_NOISE_FEATURES.length||f.noiseNormalizer.scale.some(v=>!finite(v)||v<=0)||new Set(f.noiseNormalizer.active).size!==f.noiseNormalizer.active.length||f.noiseNormalizer.active.some(j=>!Number.isSafeInteger(j)||j<0||j>=CBB_OUTCOME_NOISE_FEATURES.length)||f.noiseBeta.length!==CBB_OUTCOME_NOISE_FEATURES.length||f.noiseBeta.some((v,j)=>{const k=f.noiseNormalizer.active.indexOf(j);return v!==(k<0?0:f.theta[cbbOutcomeNoiseBetaOffset(axis)+k]);}))throw Error("Outcome GP artifact schema/parallel field mismatch");
 const names=[...n.names,...n.names.map(name=>`${name}.known`)],parity=[...n.parity,...n.names.map(()=>1)];
 if(new Set(n.names).size!==n.names.length||n.active.some(v=>typeof v!=="boolean")||n.parity.some(v=>v!==1&&v!==-1)||f.inputs.some(input=>sha(input.blocks.level.names)!==sha(names)||sha(input.blocks.level.parity)!==sha(parity)||CBB_OUTCOME_BLOCKS.some(block=>{const v=input.blocks[block];return v.names.length!==v.values.length||v.known.length!==v.names.length||v.parity.length!==v.names.length||v.values.some(x=>!finite(x))||v.known.some(x=>typeof x!=="boolean")||v.parity.some(x=>x!==1&&x!==-1);})||input.noiseFeatures.length!==CBB_OUTCOME_NOISE_FEATURES.length||input.noiseFeatures.some(x=>x!==null&&!finite(x))))throw Error("Outcome normalized feature schema invalid");
 if(axis==="total"){const expected=solve(f.cholesky,Array(a.trainingGames).fill(1));if(expected.some((v,j)=>Math.abs(v-f.inverseOnes[j])>1e-10*Math.max(1,Math.abs(v)))||Math.abs(expected.reduce((a,b)=>a+b,0)-f.interceptPrecision)>1e-10*Math.max(1,f.interceptPrecision))throw Error("Outcome exact trend covariance binding invalid");}
 }}
function predictAxis(f:CbbOutcomeAxisArtifact,raw:CbbOutcomeAxisInput){
 const input=cbbOutcomeNormalizeInput(raw,f.levelNormalizer),parts=f.inputs.map(x=>cbbOutcomeKernelParts(input,x,f.axis,f.theta)),cross=parts.map(x=>x.value),diagonal=cbbOutcomeKernelParts(input,input,f.axis,f.theta).value,functionMean=dot(cross,f.alpha),lower=lowerSolve(f.cholesky,cross),functionPosterior=diagonal-dot(lower,lower),trendPosterior=f.axis==="total"?(1-dot(f.inverseOnes,cross))**2/f.interceptPrecision:0;if(!(functionPosterior>=0&&finite(functionPosterior)&&trendPosterior>=0&&finite(trendPosterior)))throw Error("Outcome GP posterior function/trend variance unresolved; no clipping");const remainingGameNoise=Math.exp(f.theta[cbbOutcomeNoiseLogVarianceIndex(f.axis)]+dot(noiseDesign(input,f.noiseNormalizer),f.theta.slice(cbbOutcomeNoiseBetaOffset(f.axis)))),variance=remainingGameNoise+functionPosterior+trendPosterior;if(!(variance>0&&finite(variance)))throw Error("Outcome predictive variance unresolved");
 return{populationMean:f.populationMean,functionMean,mean:f.populationMean+functionMean,sd:Math.sqrt(variance),varianceComponents:{remainingGameNoise,functionPosterior,trendPosterior},varianceSemantics:"predictive_sd_game_noise_plus_direct_function_plus_unknown_constant_trend" as const,kernelCrossCovariance:{maximumAbsolute:Math.max(...cross.map(Math.abs)),nonzero:cross.filter(v=>v!==0).length},kernelBlocks:f.kernelBlocks,inactiveKernelBlocks:CBB_OUTCOME_BLOCKS.filter(b=>!f.kernelBlocks.includes(b)),semanticContributions:Object.fromEntries([...f.kernelBlocks,"linear_level"].map((b,j)=>[b,dot(parts.map(x=>x.terms[j].value),f.alpha)])),noiseDesign:noiseDesign(input,f.noiseNormalizer),identifiedShapeFeatures:input.noiseFeatures,uncertaintyLimit:"conditions_on_fitted_GP_hyperparameters_and_shape_gamma;outer_calibration_required"};
}
export const cbbOutcomePredictAxisForTest=predictAxis;
export function predictCbbOutcomeFromInputs(artifact:CbbOutcomeArtifact,input:Pick<CbbOutcomeInputs,"margin"|"total">){validateCbbOutcomeArtifact(artifact);return{margin:predictAxis(artifact.margin,input.margin),total:predictAxis(artifact.total,input.total),correlation:0,covariance:0,diagnosticOnly:true as const,availabilityClaim:"none_off_manifest_input_diagnostic" as const};}
export function predictCbbContextualOutcomeForecast(artifact:CbbOutcomeArtifact,input:{gameId:number;asOf:string;input:CbbContextualFeatureInput},mode:"future"|"retrospective_development"){
 validateCbbOutcomeArtifact(artifact);const clocks=[artifact.trainingCutoff,artifact.createdAt,artifact.availableBy,input.asOf].map(clock);if(!clocks.every(finite)||clocks[0]>clocks[1]||clocks[1]>clocks[2]||input.gameId!==input.input.independent.gameId||input.asOf!==input.input.asOf||artifact.trainingGameIds.includes(input.gameId)||!Number.isSafeInteger(input.gameId)||input.gameId<=0)throw Error("Outcome identity/training exclusion/clocks invalid");if(!["future","retrospective_development"].includes(mode)||mode==="future"&&clocks[3]<clocks[2])throw Error("Outcome artifact unavailable at input");const built=buildCbbOutcomeInputs(input.input);return{release:artifact.release,authority:artifact.authority,mode,gameId:input.gameId,inputAsOf:input.asOf,artifactAvailableBy:artifact.availableBy,margin:predictAxis(artifact.margin,built.margin),total:predictAxis(artifact.total,built.total),correlation:0,covariance:0,receipt:built.measurementInputs.receipt,outcomeInputs:built,probabilityClaim:"none_until_outer_game_excluded_joint_calibration" as const};
}
export type CbbOutcomePrediction=ReturnType<typeof predictCbbContextualOutcomeForecast>;
export type CbbOutcomeFitResult=ReturnType<typeof fitCbbContextualOutcomeForecast>;

/** Scoped retained Total inference. The unused V9 Margin GP is never called. */
export function predictCbbDirectTotalForecast(artifact:CbbOutcomeArtifact,input:{gameId:number;asOf:string;input:CbbContextualFeatureInput},mode:"future"|"retrospective_development"){
 validateCbbOutcomeArtifact(artifact);const clocks=[artifact.trainingCutoff,artifact.createdAt,artifact.availableBy,input.asOf].map(clock);if(!clocks.every(finite)||clocks[0]>clocks[1]||clocks[1]>clocks[2]||input.gameId!==input.input.independent.gameId||input.asOf!==input.input.asOf||artifact.trainingGameIds.includes(input.gameId)||!Number.isSafeInteger(input.gameId)||input.gameId<=0)throw Error("Outcome identity/training exclusion/clocks invalid");if(!["future","retrospective_development"].includes(mode)||mode==="future"&&clocks[3]<clocks[2])throw Error("Outcome artifact unavailable at input");const built=buildCbbOutcomeInputs(input.input);return{release:artifact.release,authority:artifact.authority,mode,gameId:input.gameId,inputAsOf:input.asOf,artifactAvailableBy:artifact.availableBy,total:predictAxis(artifact.total,built.total),receipt:built.measurementInputs.receipt,outcomeInputs:built,probabilityClaim:"none_until_component_bound_joint_calibration" as const};
}
