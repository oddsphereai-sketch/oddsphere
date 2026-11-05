import {createHash} from "node:crypto";
import {CBB_CONTEXTUAL_MARKET_INTERPRETATION_RELEASE,buildCbbContextualMarketInterpretation,type CbbContextualMarketInterpretation,type CbbInterpretedMarketStream,type CbbInterpretedQuote} from "./contextualMarketInterpretation";
import {cbbExactMarketCenter} from "./marketReaderResearch";
import {invertCbbJointMarginLaw} from "./jointMarketLaw";
import type {CbbContextualFeatureInput} from "./contextualForecastFeatures";
import type {CbbForecast,CbbQuote} from "./types";

export const CBB_CONTEXTUAL_MEASUREMENT_RELEASE="cbb_contextual_measurement_forecast_2026_11_05_v3_provider_receipt_contract" as const;
type Axis="margin"|"total";
export type CbbMeasurementRole="independent"|"professional"|"consumer";
export const CBB_MEASUREMENT_CONTEXT_NAMES=["absolute_independent_disagreement","retained_net_gap_alignment","latest_gap_alignment","net_latest_opposition_strength","own_actual_response_money_alignment","own_actual_response_tickets_alignment","latest_proved_hold_money_gap_alignment","latest_proved_hold_tickets_gap_alignment","public_money_same_market_latest_alignment","public_tickets_same_market_latest_alignment","pressure_native_to_first_actual_response_hours","pressure_available_to_first_response_lower_hours","first_actual_response_native_age_hours","current_native_age_hours","current_availability_bound_delay_hours","borrowed_shape_ml_sp_discrepancy","retained_total_variation","retained_reversal_strength","retained_native_span_hours","other_professional_center_RMS_disagreement","other_consumer_center_RMS_disagreement","retained_actual_update_relative_timing_hours"] as const;
export const CBB_MEASUREMENT_METHOD={release:CBB_CONTEXTUAL_MEASUREMENT_RELEASE,
 inputInterpretationRelease:CBB_CONTEXTUAL_MARKET_INTERPRETATION_RELEASE,
 sourceIdentity:"provider_scoped_native_event_identity;independently_attested_fixture_binding_across_provider_namespaces;no_cross_provider_native_ID_equality_or_conflict_claim",
 family:"working_gaussian_measurement_error_factor_with_diffuse_latent_game_center",
 residualCovariance:"gameVariance*11prime+sharedMarketVariance*marketIndicatorOuter+diag(roleSourceVariance*exp(contextBetaDesign))",
 prediction:"GLS_from_sharedMarketPlusSourceError_ONLY;gameVariance_added_once_to_latent_center_variance",
 centers:"fixed_input_independent_shape_exact_discrete_no_tie_no_push_contract_inversion;coherent_same_book_ML_SP_joint_identification_once;unmatched_ML_is_discrepancy_context_not_second_measurement",
 sourceRoles:["independent","professional","consumer"],varianceComponents:["game","sharedMarket","independent","professional","consumer"],
 contexts:CBB_MEASUREMENT_CONTEXT_NAMES,contextDesign:"observed_training_RMS_zero_origin_odd_asinh;unknown_design_zero_with_explicit_masks;variance_only_no_additive_points;home_away_even",
 regularizationCandidates:[null,1,10,100],selection:"training_only_5gamefold_ONE_heldout_predictive_GAME_Gaussian_NLL_pergame;GLSmean_plus_game_and_latent_location_variance;normalizer_and_base_factor_refit_each_fold;null_context_free_candidate",
 innerAssignment:"sha256(cbb_measurement_inner_v1:+gameId)_mod5",optimizer:{algorithm:"analytic_gradient_BFGS_Armijo",defaultMaxIterations:250,gradientTolerance:1e-6,backtracks:35},
 limits:["Unbiased noisy source-center working assumption; book-implied centers conditional on explicit frozen shape, not uniquely quote-identified expected scores.","Role-level errors are learned, not per-book reliability claims; shared market correlation prevents independent-vote counting.","Reliability-context residual likelihood is a working conditional estimating likelihood, not a fully specified joint data-generating distribution for prices and paths.","Empirical covariance parameters and context-selected reliability omit parameter-selection uncertainty; outer calibration required before probability or grade claims.","No output cap, prior privilege, preset mixing weight, additive path-point correction or outcome-based source selector."]} as const;
const sha=(value:unknown)=>createHash("sha256").update(JSON.stringify(value)).digest("hex");
export const cbbMeasurementMethodSha256=()=>sha(CBB_MEASUREMENT_METHOD);
const finite=(v:unknown):v is number=>typeof v==="number"&&Number.isFinite(v);
const mean=(x:readonly number[])=>x.reduce((s,v)=>s+v,0)/x.length;
const dot=(a:readonly number[],b:readonly number[])=>a.reduce((s,v,j)=>s+v*b[j],0);
const fair=(q:CbbInterpretedQuote)=>1/(1+Math.exp(-q.logit));
export type CbbMeasurement={physicalSourceId:string;source:string;book:string|null;role:CbbMeasurementRole;center:number;workingSd:number;shape:"independent_forecast"|"native_joint_identified"|"borrowed_independent_shape";quotes:CbbInterpretedQuote[];context:(number|null)[];contextEvidence?:unknown[];assumptions:string[]};
export type CbbMeasurementAxisInput={measurements:CbbMeasurement[];contextNames:readonly string[]};
export type CbbMeasurementInputs={gameId:number;asOf:string;startsAt:string;margin:CbbMeasurementAxisInput;total:CbbMeasurementAxisInput;receipt:CbbContextualMarketInterpretation;rejected:{book:string;axis:Axis;reason:string}[]};
function arithmeticQuote(input:CbbContextualFeatureInput,book:string,market:CbbQuote["market"],q:CbbInterpretedQuote):CbbQuote{
 // Existing inversion reads ONLY contract arithmetic fields. No transport clock
 // or opaque event ID is invented by this arithmetic-only adapter.
 return {gameId:input.independent.gameId,sportsbook:book,market,line:q.line,firstPrice:q.firstPrice,secondPrice:q.secondPrice,phase:"current"} as CbbQuote;
}
function baseForecast(input:CbbContextualFeatureInput):CbbForecast{
 const u=input.independent.uncertainty;if(!u||!finite(u.marginSd)||u.marginSd<=0||!finite(u.totalSd)||u.totalSd<=0)throw Error("Measurement centers require independently attested positive working SDs");
 const m=input.independent.margin,t=input.independent.total;
 return{release:input.independent.release,gameId:input.independent.gameId,asOf:input.asOf,homeId:0,awayId:0,homeScore:(t+m)/2,awayScore:(t-m)/2,margin:m,total:t,possessions:0,homeWinProbability:input.independent.homeWinProbability??.5,inputStatus:"complete",issues:["arithmetic_only_ids_and_possessions_unused_by_exact_center"],uncertainty:{marginSd:u.marginSd,totalSd:u.totalSd,marginTotalCorrelation:u.marginTotalCorrelation??0,marginCorrection:u.marginCorrection??0,totalCorrection:u.totalCorrection??0,fitThroughSeason:u.fitThroughSeason??0,games:u.games??0}};
}
function sameFrame(a:CbbInterpretedQuote,b:CbbInterpretedQuote){
 const x=a.rawQuote,y=b.rawQuote;
 if(!a.provider||a.provider!==b.provider||a.eventId&&b.eventId&&a.eventId!==b.eventId)return false;
 const an=nanos(a.nativeAt),bn=nanos(b.nativeAt);if(an!==null&&bn!==null&&an===bn)return true;
 if(x.canonicalReceipt&&y.canonicalReceipt)return x.canonicalReceipt.ingestionRunId===y.canonicalReceipt.ingestionRunId;
 const actualHttp=(q:typeof x)=>!q.canonicalReceipt&&q.fetchedAt&&(!("availabilityKind"in q)||q.availabilityKind==="http_response");
 return Boolean(actualHttp(x)&&actualHttp(y)&&x.fetchedAt===y.fetchedAt);
}
function nanos(value:string):bigint|null{
 const ms=Date.parse(value);if(!finite(ms))return null;const fraction=value.match(/\.(\d+)(?:Z|[+-]\d{2}:?\d{2})$/i)?.[1]??"";if(fraction.length>9&&/[1-9]/.test(fraction.slice(9)))return null;return BigInt(ms)*BigInt(1000000)+BigInt(fraction.slice(3,9).padEnd(6,"0"));
}
const hours=(after:string,before:string)=>{const a=nanos(after),b=nanos(before);return a===null||b===null||a<b?null:Number(a-b)/3.6e12;};
function reliabilityContext(input:CbbContextualFeatureInput,prior:CbbForecast,axis:Axis,center:number,streams:CbbInterpretedMarketStream[],publicStreams:CbbInterpretedMarketStream[],discrepancy:number|null){
 const sd=axis==="margin"?prior.uncertainty.marginSd:prior.uncertainty.totalSd,gap=(center-prior[axis])/sd,values:number[][]=CBB_MEASUREMENT_CONTEXT_NAMES.map(()=>[]),evidence:unknown[]=[],cache=new Map<string,number>();
 const exact=(stream:CbbInterpretedMarketStream,q:CbbInterpretedQuote)=>{const key=JSON.stringify([stream.market,q.line,q.firstPrice,q.secondPrice]);if(cache.has(key))return cache.get(key)!;const v=cbbExactMarketCenter(prior,arithmeticQuote(input,stream.book,stream.market,q),fair(q));cache.set(key,v);return v;};
 const add=(j:number,v:number|null|undefined)=>{if(finite(v))values[j].push(v);};add(0,Math.abs(gap));add(15,discrepancy);
 for(const stream of streams){
  const current=stream.currentQuote;if(current){add(13,hours(input.asOf,current.nativeAt));add(14,hours(current.availableBy,current.nativeAt));}
  if(stream.continuity==="conflict")continue;
  try{
   const start=stream.net&&stream.coverage.interpretedFromAt?stream.quotes.find(q=>q.nativeAt===stream.coverage.interpretedFromAt):undefined,last=stream.quotes.at(-1),leg=stream.legs.at(-1),net=start&&last?(exact(stream,last)-exact(stream,start))/sd:null,latest=leg?(exact(stream,leg.after)-exact(stream,leg.before))/sd:stream.net?0:null;
   if(net!==null)add(1,net*gap);if(latest!==null)add(2,latest*gap);if(net!==null&&latest!==null)add(3,-net*latest);
   const legChanges=stream.legs.map(l=>(exact(stream,l.after)-exact(stream,l.before))/sd);if(stream.net){add(16,legChanges.reduce((s,v)=>s+Math.abs(v),0));add(17,legChanges.slice(1).reduce((s,v,j)=>s+(v*legChanges[j]<0?Math.min(Math.abs(v),Math.abs(legChanges[j])):0),0));if(start&&last)add(18,hours(last.nativeAt,start.nativeAt));}
   const eligible=stream.pressureResponses.filter(r=>r.baseline&&r.response&&r.continuity!=="conflict"),actual=[...eligible].reverse().find(r=>r.hadActualMove),held=[...eligible].reverse().find(r=>r.activeCurrent&&r.relation==="held_observed"&&!r.hadActualMove&&!r.laterReversal);
   let firstActual:CbbInterpretedQuote|undefined;
   if(actual?.baseline&&actual.response){const d=(exact(stream,actual.response)-exact(stream,actual.baseline))/sd;add(4,actual.pressure.moneyBalance===null?null:d*actual.pressure.moneyBalance);add(5,actual.pressure.ticketBalance===null?null:d*actual.pressure.ticketBalance);
    const p=actual.pressure,pn=p.nativeAt?nanos(p.nativeAt):null,pa=nanos(p.availableBy),end=nanos(actual.response.nativeAt),base=JSON.stringify([actual.baseline.line,actual.baseline.firstPrice,actual.baseline.secondPrice]);
    if(pn!==null&&pa!==null&&end!==null)firstActual=stream.quotes.find(q=>{const qn=nanos(q.nativeAt),lower=q.receiptEarliest?nanos(q.receiptEarliest):null;return qn!==null&&qn>pn&&qn<=end&&lower!==null&&lower>=pa&&JSON.stringify([q.line,q.firstPrice,q.secondPrice])!==base;});
    if(firstActual&&p.nativeAt){add(10,hours(firstActual.nativeAt,p.nativeAt));add(11,firstActual.receiptEarliest?hours(firstActual.receiptEarliest,p.availableBy):null);add(12,hours(input.asOf,firstActual.nativeAt));}
   }
   if(held){add(6,held.pressure.moneyBalance===null?null:gap*held.pressure.moneyBalance);add(7,held.pressure.ticketBalance===null?null:gap*held.pressure.ticketBalance);}
   if(latest!==null)for(const publicStream of publicStreams.filter(p=>p.market===stream.market)){const p=publicStream.pressures.at(-1);if(!p||p.conflict)continue;add(8,p.moneyBalance===null?null:latest*p.moneyBalance);add(9,p.ticketBalance===null?null:latest*p.ticketBalance);}
   evidence.push({market:stream.market,book:stream.book,workingShape:"frozen_input_independent_SD_for_each_same_contract_center",netNormalizedCenterChange:net,latestNormalizedCenterChange:latest,retainedLegChanges:legChanges,lineAndJuicePartiallyOrdered:stream.legs.some(l=>l.direction===null),actualResponse:actual?{pressure:actual.pressure,baseline:actual.baseline,response:actual.response,firstActualResponse:firstActual??null}:null,latestProvedHold:held??null});
  }catch(error){evidence.push({market:stream.market,book:stream.book,contextUnavailable:error instanceof Error?error.message:String(error)});}
 }
 return{values:values.map(v=>v.length?mean(v):null),evidence};
}
export function buildCbbMeasurementInputs(input:CbbContextualFeatureInput):CbbMeasurementInputs{
 const p=input.independent;if(p.inputStatus!=="complete"||!Number.isSafeInteger(p.gameId)||![p.margin,p.total].every(Number.isFinite)||p.total<=Math.abs(p.margin)||!(Date.parse(p.asOf)<=Date.parse(input.asOf))||!(Date.parse(input.asOf)<Date.parse(input.startsAt)))throw Error("Measurement fixture/independent/as-of inputs invalid");
 const prior=baseForecast(input),receipt=buildCbbContextualMarketInterpretation(input),rejected:CbbMeasurementInputs["rejected"]=[],axis=(which:Axis):CbbMeasurementAxisInput=>({measurements:[{physicalSourceId:"independent",source:"independent",book:null,role:"independent",center:p[which],workingSd:which==="margin"?prior.uncertainty.marginSd:prior.uncertainty.totalSd,shape:"independent_forecast",quotes:[],context:CBB_MEASUREMENT_CONTEXT_NAMES.map(()=>null),assumptions:["independent point is fallible; no privileged precision"]}],contextNames:CBB_MEASUREMENT_CONTEXT_NAMES});
 const out:CbbMeasurementInputs={gameId:p.gameId,asOf:input.asOf,startsAt:input.startsAt,margin:axis("margin"),total:axis("total"),receipt,rejected};
 const books=new Set(receipt.streams.filter(s=>s.role==="professional"||s.role==="consumer").map(s=>s.book));
 for(const book of [...books].sort()){
  const own=receipt.streams.filter(s=>s.book===book&&(s.role==="professional"||s.role==="consumer")),roles=new Set(own.map(s=>s.role));if(roles.size!==1){for(const which of ["margin","total"] as const)rejected.push({book,axis:which,reason:"physical_book_role_collision"});continue;}
  const role=own[0].role as "professional"|"consumer",sp=own.find(s=>s.market==="spread")?.currentQuote,ml=own.find(s=>s.market==="moneyline")?.currentQuote,total=own.find(s=>s.market==="total")?.currentQuote;
  for(const which of ["margin","total"] as const){
   const quotes=which==="margin"?[sp,ml].filter((q):q is CbbInterpretedQuote=>Boolean(q)):total?[total]:[];if(!quotes.length)continue;
   let center:number,workingSd=which==="margin"?prior.uncertainty.marginSd:prior.uncertainty.totalSd,shape:CbbMeasurement["shape"]="borrowed_independent_shape",discrepancy:number|null=null;const assumptions=["paired prices are de-vigged and conditioned on no push; fixed independently stored working shape is not quote-identified truth"];
   try{
    if(which==="margin"&&sp&&ml){const sq=arithmeticQuote(input,book,"spread",sp),mq=arithmeticQuote(input,book,"moneyline",ml),scenter=cbbExactMarketCenter(prior,sq,fair(sp));
     const identityConflict=receipt.crossMarket.some(c=>c.book===book&&c.continuity==="conflict");
     if(identityConflict){center=scenter;assumptions.push("known_cross_market_native_identity_conflict; independently valid spread-only center, ML relation unknown");rejected.push({book,axis:which,reason:"ML_SP_known_native_identity_conflict_relation_withheld"});}
     else{const mcenter=cbbExactMarketCenter(prior,mq,fair(ml));discrepancy=Math.abs(scenter-mcenter)/workingSd;
     if(sameFrame(sp,ml)){const joint=invertCbbJointMarginLaw(prior,mq,sq);if(joint.margin===null||joint.marginSd===null||!["identified","underidentified"].includes(joint.status)){center=scenter;assumptions.push(`joint_mapping_rejected_${joint.status}:${joint.reason}; independently_valid_spread_center_preserved_with_borrowed_shape`);rejected.push({book,axis:which,reason:`coherent_native_joint_${joint.status}:${joint.reason}`});}else{center=joint.margin;workingSd=joint.marginSd;shape=joint.status==="identified"?"native_joint_identified":"borrowed_independent_shape";assumptions.push(joint.reason);}}
     else{center=scenter;assumptions.push("ML_SP_native_frame_unproved; spread-only center with borrowed shape; ML retained as discrepancy context, not additional measurement");}}
    }else{const q=quotes[0],market=which==="total"?"total":sp?"spread":"moneyline";center=cbbExactMarketCenter(prior,arithmeticQuote(input,book,market,q),fair(q));assumptions.push("single contract underidentifies shape");}
   }catch(error){rejected.push({book,axis:which,reason:`exact_contract_center_unavailable:${error instanceof Error?error.message:String(error)}`});continue;}
   if(!finite(center)||!finite(workingSd)||workingSd<=0){rejected.push({book,axis:which,reason:"nonfinite_center_or_shape"});continue;}
   const identityConflict=which==="margin"&&receipt.crossMarket.some(c=>c.book===book&&c.continuity==="conflict"),streams=own.filter(s=>(which==="margin"?s.market!=="total":s.market==="total")&&!(identityConflict&&s.market==="moneyline")),publicStreams=receipt.streams.filter(s=>(s.role==="public_context"||s.role==="retail_context")&&(which==="margin"?s.market!=="total":s.market==="total"));
   const context=reliabilityContext(input,prior,which,center,streams,publicStreams,discrepancy);out[which].measurements.push({physicalSourceId:book,source:book,book,role,center,workingSd,shape,quotes,context:context.values,contextEvidence:context.evidence,assumptions});
  }
 }
 for(const which of ["margin","total"] as const){const sd=which==="margin"?prior.uncertainty.marginSd:prior.uncertainty.totalSd;
  const latestLeg=(book:string)=>receipt.streams.filter(s=>s.book===book&&(which==="margin"?s.market!=="total":s.market==="total")&&!(which==="margin"&&s.market==="moneyline"&&receipt.crossMarket.some(c=>c.book===book&&c.continuity==="conflict"))).flatMap(s=>s.legs.at(-1)?[s.legs.at(-1)!.after.nativeAt]:[]).sort((a,b)=>{const x=nanos(a),y=nanos(b);return x===null||y===null?0:x<y?-1:x>y?1:0;}).at(-1);
  for(const m of out[which].measurements){const peers=out[which].measurements.filter(p=>p.physicalSourceId!==m.physicalSourceId&&p.role!=="independent");for(const [j,role]of [[19,"professional"],[20,"consumer"]] as const){const values=peers.filter(p=>p.role===role).map(p=>((m.center-p.center)/sd)**2);m.context[j]=m.role!=="independent"&&values.length?Math.sqrt(mean(values)):null;}
   const own=m.book?latestLeg(m.book):undefined,peerTimes=[...books].filter(b=>b!==m.book).flatMap(book=>{const at=latestLeg(book);return at?[{book,at}]:[];}),ownNs=own?nanos(own):null,relative=ownNs===null?[]:peerTimes.flatMap(p=>{const ns=nanos(p.at);return ns===null?[]:[Number(ownNs-ns)/3.6e12];});m.context[21]=relative.length?mean(relative):null;
   m.contextEvidence=[...(m.contextEvidence??[]),{peerCenters:peers.map(p=>({book:p.book,role:p.role,center:p.center})),peerContextRole:m.role==="independent"?"descriptive_only_independent_error_role_variance_remains_fallible_but_context_free":"learned_book_reliability_context",ownLatestRetainedActualNativeLeg:own??null,peerLatestRetainedActualNativeLegs:peerTimes,timingMeaning:"retained_update_relative_timing_only; not_first_market_move_or_causal_leadership"}];
  }
 }
 return out;
}
export type CbbMeasurementTrainingRow={gameId:number;decisionAt:string;startsAt:string;outcomeAvailableBy:string;input:CbbContextualFeatureInput;actualHome:number;actualAway:number;provenanceSha256:string};
export type CbbMeasurementContextNormalizer={scale:number[];knownCounts:number[];active:number[];trainingPhysicalMeasurements:number;trainingMeasurements:number};
export function cbbMeasurementContextNormalizer(rows:readonly CbbMeasurementAxisInput[]):CbbMeasurementContextNormalizer{
 const sources=rows.flatMap(r=>r.measurements),scale=CBB_MEASUREMENT_CONTEXT_NAMES.map((_,j)=>{const values=sources.map(m=>m.context[j]).filter(finite);return values.length?Math.sqrt(mean(values.map(v=>v*v)))||1:1;}),knownCounts=scale.map((_,j)=>sources.filter(m=>m.context[j]!==null).length);
 const active=scale.flatMap((_,j)=>["independent","professional","consumer"].some(role=>{const values=sources.filter(m=>m.role===role).map(m=>m.context[j]===null?0:Math.asinh(m.context[j]!/scale[j]));return values.length>1&&values.some(v=>v!==values[0]);})?[j]:[]);
 return{scale,knownCounts,active,trainingPhysicalMeasurements:sources.filter(m=>m.role!=="independent").length,trainingMeasurements:sources.length};
}
export function cbbMeasurementContextDesign(context:(number|null)[],normal:CbbMeasurementContextNormalizer){return context.map((v,j)=>v===null||!normal.active.includes(j)?0:Math.asinh(v/normal.scale[j]));}
type Prepared={gameId:number;actual:number;measurements:CbbMeasurement[]};
const roleIndex=(role:CbbMeasurementRole)=>role==="independent"?2:role==="professional"?3:4;
type Evaluation={value:number;gradient:number[];unpenalized:number}|null;
function evaluate(rows:Prepared[],theta:number[],normal:CbbMeasurementContextNormalizer,penalty:number|null):Evaluation{
 const variances=theta.slice(0,5).map(Math.exp);if(variances.some(v=>!finite(v)||v<0)||variances.slice(2).some(v=>!(v>0)))return null;
 const beta=CBB_MEASUREMENT_CONTEXT_NAMES.map((_,j)=>{const k=normal.active.indexOf(j);return penalty===null||k<0?0:theta[5+k];}),gradient=Array(theta.length).fill(0) as number[];let value=0;
 for(const row of rows){const measured=row.measurements.map(m=>{const x=m.role==="independent"?CBB_MEASUREMENT_CONTEXT_NAMES.map(()=>0):cbbMeasurementContextDesign(m.context,normal),d=variances[roleIndex(m.role)]*Math.exp(dot(x,beta));return{m,x,d,r:m.center-row.actual,market:m.role!=="independent"};});if(measured.some(v=>!(v.d>0&&finite(v.d))))return null;
  const independent=measured.filter(m=>!m.market);if(independent.length!==1)return null;const i=independent[0],books=measured.filter(m=>m.market),g=variances[0],h=variances[1],A=g+i.d,a=g/A,k=h+g*i.d/A,precisions=books.map(m=>1/m.d),P=precisions.reduce((s,v)=>s+v,0),den=1+k*P;
  if(!(A>0&&finite(A)&&finite(P)&&finite(den)))return null;
  const e=books.map(m=>m.r-a*i.r),anchor=e[0]??0,weightedMean=P?anchor+e.reduce((s,v,j)=>s+(v-anchor)*(precisions[j]/P),0):0,information=P/den,sumBookU=weightedMean*information,uI=i.r/A-a*sumBookU;
  const bookU=books.map((_,j)=>precisions[j]/den*(e[j]+k*e.reduce((sum,v,q)=>sum+(q===j?0:precisions[q]*(e[j]-v)),0))),diagonal=books.map((_,j)=>precisions[j]/den*(1+k*precisions.reduce((sum,v,q)=>sum+(q===j?0:v),0))),diagI=1/A+a*a*information;
  const logdet=Math.log(A)+books.reduce((s,m)=>s+Math.log(m.d),0)+Math.log1p(k*P),quadratic=i.r*i.r/A+e.reduce((sum,v,j)=>sum+precisions[j]*(v-weightedMean)**2,0)+weightedMean*weightedMean*information;
  if(![logdet,quadratic,uI,diagI,...bookU,...diagonal].every(finite)||quadratic<0)return null;value+=.5*(logdet+quadratic+measured.length*Math.log(2*Math.PI));
  const remaining=i.d/A,sumU=i.r/A+remaining*sumBookU;gradient[0]+=.5*(1/A+remaining*remaining*information-sumU*sumU)*g;gradient[1]+=.5*(information-sumBookU*sumBookU)*h;
  const directionI=.5*(diagI-uI*uI)*i.d;gradient[2]+=directionI;
  books.forEach((v,j)=>{const direction=.5*(diagonal[j]-bookU[j]*bookU[j])*v.d;gradient[roleIndex(v.m.role)]+=direction;if(penalty!==null)normal.active.forEach((col,q)=>gradient[5+q]+=direction*v.x[col]);});
 }
 const unpenalized=value;if(penalty!==null)for(let j=5;j<theta.length;j++){value+=.5*penalty*theta[j]*theta[j];gradient[j]+=penalty*theta[j];}
 if(!finite(value)||!gradient.every(finite))return null;return{value,gradient,unpenalized};
}
export function cbbMeasurementObjectiveForTest(rows:{gameId:number;actual:number;measurements:CbbMeasurement[]}[],theta:number[],normal:CbbMeasurementContextNormalizer,penalty:number|null){return evaluate(rows,theta,normal,penalty);}
type Optimizer={converged:boolean;iterations:number;reason:string;objective:number;gradientInfinity:number;theta:number[];evaluations:number};
function optimize(rows:Prepared[],normal:CbbMeasurementContextNormalizer,penalty:number|null,initial:number[],maxIterations:number):Optimizer{
 const n=initial.length;let theta=[...initial],current=evaluate(rows,theta,normal,penalty),evaluations=1;if(!current)throw Error("Measurement initial covariance unresolved");let inverse=Array.from({length:n},(_,i)=>Array.from({length:n},(_,j)=>Number(i===j))),iterations=0,reason="max_iterations",converged=false;
 for(;iterations<maxIterations;iterations++){
  if(Math.max(...current.gradient.map(Math.abs))<=1e-6){converged=true;reason="gradient_tolerance";break;}
  let direction=inverse.map(row=>-dot(row,current!.gradient));if(dot(direction,current.gradient)>=0){inverse=Array.from({length:n},(_,i)=>Array.from({length:n},(_,j)=>Number(i===j)));direction=current.gradient.map(v=>-v);}
  const slope=dot(direction,current.gradient);let candidate:Evaluation=null,next:number[]=[],step=1;
  for(let backtrack=0;backtrack<35;backtrack++){next=theta.map((v,j)=>v+step*direction[j]);candidate=evaluate(rows,next,normal,penalty);evaluations++;if(candidate&&candidate.value<=current.value+1e-4*step*slope)break;candidate=null;step*=.5;}
  if(!candidate){reason="line_search_unresolved";break;}
  const s=next.map((v,j)=>v-theta[j]),y=candidate.gradient.map((v,j)=>v-current!.gradient[j]),sy=dot(s,y);
  if(sy>Number.EPSILON*Math.sqrt(dot(s,s)*dot(y,y))){const hy=inverse.map(row=>dot(row,y)),yhy=dot(y,hy);inverse=inverse.map((row,i)=>row.map((v,j)=>v+(1+yhy/sy)*s[i]*s[j]/sy-(s[i]*hy[j]+hy[i]*s[j])/sy));}else inverse=Array.from({length:n},(_,i)=>Array.from({length:n},(_,j)=>Number(i===j)));
  theta=next;current=candidate;
 }
 return{converged,iterations,reason,objective:current.value,gradientInfinity:Math.max(...current.gradient.map(Math.abs)),theta,evaluations};
}
const fold=(id:number)=>Number(BigInt("0x"+createHash("sha256").update("cbb_measurement_inner_v1:"+id).digest("hex"))%BigInt(5));
export const cbbMeasurementInnerFold=fold;
function initialTheta(rows:Prepared[]){const scale=mean(rows.flatMap(r=>r.measurements.map(m=>(m.center-r.actual)**2)));return Array(5).fill(Math.log(scale/3||1)) as number[];}
function factorFit(rows:Prepared[],normal:CbbMeasurementContextNormalizer,maxIterations:number){const initial=initialTheta(rows),trials=[0,-.7,.7].map(shift=>optimize(rows,normal,null,initial.map((v,j)=>v+(j<2?shift:0)),maxIterations));trials.sort((a,b)=>a.objective-b.objective);return{best:trials.find(t=>t.converged)??trials[0],trials};}
function heldoutGameNll(rows:Prepared[],theta:number[],normal:CbbMeasurementContextNormalizer,penalty:number|null){
 const [game,sharedMarket,...roleErrors]=theta.slice(0,5).map(Math.exp),beta=CBB_MEASUREMENT_CONTEXT_NAMES.map((_,j)=>{const k=normal.active.indexOf(j);return penalty===null||k<0?0:theta[5+k];});let score=0;
 for(const row of rows){const measurements=row.measurements.map(m=>({center:m.center,market:m.role!=="independent",precision:1/(roleErrors[roleIndex(m.role)-2]*Math.exp(dot(m.role==="independent"?CBB_MEASUREMENT_CONTEXT_NAMES.map(()=>0):cbbMeasurementContextDesign(m.context,normal),beta)))})),bookPrecision=measurements.reduce((s,m)=>s+(m.market?m.precision:0),0),sharedDen=1+sharedMarket*bookPrecision,information=measurements.map(m=>m.precision/(m.market?sharedDen:1)),sum=information.reduce((s,v)=>s+v,0),location=measurements.reduce((s,m,j)=>s+m.center*information[j]/sum,0),variance=game+1/sum;
  if(!(variance>0&&finite(variance)&&finite(location)))return Infinity;score+=.5*(Math.log(2*Math.PI*variance)+(row.actual-location)**2/variance);
 }return score;
}
function structuralSupport(rows:Prepared[]){
 const gram=Array.from({length:5},()=>Array(5).fill(0) as number[]);for(const row of rows)for(const a of row.measurements)for(const b of row.measurements){const basis=[1,Number(a.role!=="independent"&&b.role!=="independent"),Number(a===b&&a.role==="independent"),Number(a===b&&a.role==="professional"),Number(a===b&&a.role==="consumer")];for(let i=0;i<5;i++)for(let j=0;j<5;j++)gram[i][j]+=basis[i]*basis[j];}
 const a=gram.map(r=>[...r]),norm=Math.max(...a.map(r=>r.reduce((s,v)=>s+Math.abs(v),0))),tol=64*5*Number.EPSILON*norm;let rank=0;for(let j=0;j<5;j++){let pivot=rank;for(let i=rank;i<5;i++)if(Math.abs(a[i][j])>Math.abs(a[pivot][j]))pivot=i;if(Math.abs(a[pivot][j])<=tol)continue;[a[pivot],a[rank]]=[a[rank],a[pivot]];const v=a[rank][j];for(let k=j;k<5;k++)a[rank][k]/=v;for(let i=rank+1;i<5;i++){const q=a[i][j];for(let k=j;k<5;k++)a[i][k]-=q*a[rank][k];}rank++;}
 return{covarianceComponentDesignGram:gram,rank,requiredRank:5,games:rows.length,roleMeasurements:Object.fromEntries((["independent","professional","consumer"] as const).map(role=>[role,rows.reduce((s,r)=>s+r.measurements.filter(m=>m.role===role).length,0)])),independentBookOverlapGames:rows.filter(r=>r.measurements.some(m=>m.role==="independent")&&r.measurements.some(m=>m.role!=="independent")).length,multiplePhysicalBookGames:rows.filter(r=>r.measurements.filter(m=>m.role!=="independent").length>=2).length};
}
export type CbbMeasurementAxisArtifact={axis:Axis;contextNormalizer:CbbMeasurementContextNormalizer;logVariances:number[];contextBeta:number[];selectedPenalty:number|null;optimizer:Optimizer;contextFree:Optimizer;support:ReturnType<typeof structuralSupport>;innerFolds:{foldId:number;trainingGameIds:number[];heldoutGameIds:number[];contextNormalizer:CbbMeasurementContextNormalizer}[];selection:{penalty:number|null;heldoutNll:number|null;resolved:boolean}[];varianceComponents:{game:number;sharedMarket:number;independent:number;professional:number;consumer:number}};
export type CbbMeasurementArtifact={release:typeof CBB_CONTEXTUAL_MEASUREMENT_RELEASE;authority:"offline_research_only";methodSha256:string;trainingRowsSha256:string;trainingGameIds:number[];trainingGames:number;createdAt:string;availableBy:string;trainingCutoff:string;shapeContract:typeof CBB_MEASUREMENT_METHOD.centers;margin:CbbMeasurementAxisArtifact;total:CbbMeasurementAxisArtifact};
function fitAxis(rows:Prepared[],axis:Axis,maxIterations:number):CbbMeasurementAxisArtifact{
 const normal=cbbMeasurementContextNormalizer(rows.map(r=>({measurements:r.measurements,contextNames:CBB_MEASUREMENT_CONTEXT_NAMES}))),support=structuralSupport(rows);if(support.rank!==5)throw Error(`Measurement ${axis} five-component covariance is structurally unidentified`);
 const fullBase=factorFit(rows,normal,maxIterations);if(!fullBase.best.converged)throw Error(`Measurement ${axis} context-free factor optimizer unresolved:${fullBase.best.reason}`);
 const folds=Array.from({length:5},(_,foldId)=>{const training=rows.filter(r=>fold(r.gameId)!==foldId),heldout=rows.filter(r=>fold(r.gameId)===foldId);if(!training.length||!heldout.length||structuralSupport(training).rank!==5)throw Error("Measurement inner covariance support/folds unavailable");const contextNormalizer=cbbMeasurementContextNormalizer(training.map(r=>({measurements:r.measurements,contextNames:CBB_MEASUREMENT_CONTEXT_NAMES}))),base=factorFit(training,contextNormalizer,maxIterations);return{foldId,training,heldout,contextNormalizer,base:base.best};});
 const candidates=CBB_MEASUREMENT_METHOD.regularizationCandidates.map(penalty=>{let heldoutNll=0,resolved=true;for(const f of folds){if(!f.base.converged){resolved=false;break;}const result=penalty===null?f.base:optimize(f.training,f.contextNormalizer,penalty,[...f.base.theta,...f.contextNormalizer.active.map(()=>0)],maxIterations);if(!result.converged){resolved=false;break;}const score=heldoutGameNll(f.heldout,result.theta,f.contextNormalizer,penalty);if(!finite(score)){resolved=false;break;}heldoutNll+=score;}return{penalty,heldoutNll:resolved?heldoutNll/rows.length:Infinity,resolved};}).sort((a,b)=>a.heldoutNll-b.heldoutNll);
 let selected:typeof candidates[number]|undefined,result:Optimizer|undefined;for(const candidate of candidates){if(!candidate.resolved)continue;const fit=candidate.penalty===null?fullBase.best:optimize(rows,normal,candidate.penalty,[...fullBase.best.theta,...normal.active.map(()=>0)],maxIterations);if(fit.converged){selected=candidate;result=fit;break;}}
 if(!selected||!result)throw Error(`Measurement regularized reliability fit unresolved:${JSON.stringify({axis,folds:folds.map(f=>({fold:f.foldId,reason:f.base.reason,converged:f.base.converged,gradientInfinity:f.base.gradientInfinity,iterations:f.base.iterations})),candidates})}`);
 const [game,sharedMarket,independent,professional,consumer]=result.theta.slice(0,5).map(Math.exp),contextBeta=CBB_MEASUREMENT_CONTEXT_NAMES.map((_,j)=>{const k=normal.active.indexOf(j);return selected!.penalty===null||k<0?0:result!.theta[5+k];});
 return{axis,contextNormalizer:normal,logVariances:result.theta.slice(0,5),contextBeta,selectedPenalty:selected.penalty,optimizer:result,contextFree:fullBase.best,support,innerFolds:folds.map(f=>({foldId:f.foldId,trainingGameIds:f.training.map(r=>r.gameId),heldoutGameIds:f.heldout.map(r=>r.gameId),contextNormalizer:f.contextNormalizer})),selection:candidates.map(c=>({...c,heldoutNll:finite(c.heldoutNll)?c.heldoutNll:null})),varianceComponents:{game,sharedMarket,independent,professional,consumer}};
}
const fingerprint=(row:CbbMeasurementTrainingRow,inputs:CbbMeasurementInputs)=>({gameId:row.gameId,decisionAt:row.decisionAt,startsAt:row.startsAt,outcomeAvailableBy:row.outcomeAvailableBy,provenanceSha256:row.provenanceSha256,margin:inputs.margin.measurements.map(m=>({source:m.source,role:m.role,center:m.center,workingSd:m.workingSd,shape:m.shape,context:m.context})),total:inputs.total.measurements.map(m=>({source:m.source,role:m.role,center:m.center,workingSd:m.workingSd,shape:m.shape,context:m.context})),actualHome:row.actualHome,actualAway:row.actualAway});
export const cbbMeasurementTrainingRowsSha256=(rows:readonly CbbMeasurementTrainingRow[])=>sha([...rows].sort((a,b)=>a.gameId-b.gameId).map(r=>fingerprint(r,buildCbbMeasurementInputs(r.input))));
export function fitCbbContextualMeasurementForecast(rows:readonly CbbMeasurementTrainingRow[],options:{trainingCutoff:string;createdAt:string;maxIterations?:number}){
 const cutoff=Date.parse(options.trainingCutoff),created=Date.parse(options.createdAt),maxIterations=options.maxIterations??250;if(!finite(cutoff)||!finite(created)||created<cutoff||rows.length<10||!Number.isSafeInteger(maxIterations)||maxIterations<1)throw Error("Measurement fit clocks/cohort/options invalid");
 const ordered=[...rows].sort((a,b)=>a.gameId-b.gameId),ids=new Set<number>(),built=ordered.map(r=>{if(!Number.isSafeInteger(r.gameId)||r.gameId<=0||ids.has(r.gameId)||r.input.independent.gameId!==r.gameId||r.input.asOf!==r.decisionAt||r.input.startsAt!==r.startsAt||!(Date.parse(r.decisionAt)<Date.parse(r.startsAt))||!(Date.parse(r.startsAt)<Date.parse(r.outcomeAvailableBy))||!(Date.parse(r.outcomeAvailableBy)<=cutoff)||![r.actualHome,r.actualAway].every(v=>Number.isSafeInteger(v)&&v>=0)||r.actualHome===r.actualAway||!/^[a-f0-9]{64}$/.test(r.provenanceSha256))throw Error("Measurement training identity/label/availability invalid");ids.add(r.gameId);return buildCbbMeasurementInputs(r.input);});
 const axis=(key:Axis)=>ordered.map((r,j)=>({gameId:r.gameId,actual:key==="margin"?r.actualHome-r.actualAway:r.actualHome+r.actualAway,measurements:built[j][key].measurements})),margin=fitAxis(axis("margin"),"margin",maxIterations),total=fitAxis(axis("total"),"total",maxIterations),availableBy=new Date().toISOString();if(Date.parse(availableBy)<created)throw Error("Measurement artifact creation future");
 const artifact:CbbMeasurementArtifact={release:CBB_CONTEXTUAL_MEASUREMENT_RELEASE,authority:"offline_research_only",methodSha256:cbbMeasurementMethodSha256(),trainingRowsSha256:sha(ordered.map((r,j)=>fingerprint(r,built[j]))),trainingGameIds:ordered.map(r=>r.gameId),trainingGames:ordered.length,createdAt:options.createdAt,availableBy,trainingCutoff:options.trainingCutoff,shapeContract:CBB_MEASUREMENT_METHOD.centers,margin,total};
 return{artifact,diagnostics:{shapeContract:artifact.shapeContract,sourceRejections:built.flatMap(b=>b.rejected.map(r=>({gameId:b.gameId,...r}))),roleLevelCredibilityNotPerBookEstimates:true,workingLikelihoodNotPricePathJointDensity:true,optimizerConverged:margin.optimizer.converged&&total.optimizer.converged,limits:CBB_MEASUREMENT_METHOD.limits}};
}
function validateArtifact(a:CbbMeasurementArtifact){
 if(a.release!==CBB_CONTEXTUAL_MEASUREMENT_RELEASE||a.authority!=="offline_research_only"||a.methodSha256!==cbbMeasurementMethodSha256()||a.shapeContract!==CBB_MEASUREMENT_METHOD.centers)throw Error("Measurement artifact method/shape mismatch");
 if(!Array.isArray(a.trainingGameIds)||a.trainingGames!==a.trainingGameIds.length||new Set(a.trainingGameIds).size!==a.trainingGames||a.trainingGameIds.some(id=>!Number.isSafeInteger(id)||id<=0)||!/^[a-f0-9]{64}$/.test(a.trainingRowsSha256))throw Error("Measurement artifact training identity invalid");
 for(const axis of ["margin","total"] as const){const f=a[axis],normal=f.contextNormalizer;
  if(f.logVariances.length!==5||!f.logVariances.every(finite)||f.contextBeta.length!==CBB_MEASUREMENT_CONTEXT_NAMES.length||!f.contextBeta.every(finite)||normal.scale.length!==f.contextBeta.length||normal.scale.some(v=>!finite(v)||v<=0)||new Set(normal.active).size!==normal.active.length||normal.active.some(j=>!Number.isSafeInteger(j)||j<0||j>=f.contextBeta.length)||normal.knownCounts.length!==f.contextBeta.length||normal.knownCounts.some(n=>!Number.isSafeInteger(n)||n<0))throw Error("Measurement variance/context artifact invalid");
  const keys=["game","sharedMarket","independent","professional","consumer"] as const;
  if(keys.some((key,j)=>Math.exp(f.logVariances[j])!==f.varianceComponents[key])||f.optimizer.theta.length!==(f.selectedPenalty===null?5:5+normal.active.length)||f.optimizer.theta.slice(0,5).some((v,j)=>v!==f.logVariances[j])||f.contextBeta.some((v,j)=>{const k=normal.active.indexOf(j);return v!==(f.selectedPenalty===null||k<0?0:f.optimizer.theta[5+k]);}))throw Error("Measurement variance/theta/context parallel fields disagree");
 }
}
function posterior(axis:CbbMeasurementAxisArtifact,input:CbbMeasurementAxisInput){
 const seen=new Set<string>(),v=axis.varianceComponents,measurements=input.measurements.map(m=>{if(seen.has(m.physicalSourceId)||!finite(m.center)||m.context.length!==CBB_MEASUREMENT_CONTEXT_NAMES.length)throw Error("Measurement duplicate physical book/invalid center");seen.add(m.physicalSourceId);const design=m.role==="independent"?CBB_MEASUREMENT_CONTEXT_NAMES.map(()=>0):cbbMeasurementContextDesign(m.context,axis.contextNormalizer),sourceErrorVariance=v[m.role]*Math.exp(dot(design,axis.contextBeta));if(!(sourceErrorVariance>0&&finite(sourceErrorVariance)))throw Error("Measurement predictive source error unresolved");return{...m,contextDesign:design,sourceErrorVariance,rawPrecision:1/sourceErrorVariance};});
 if(!measurements.some(m=>m.role==="independent")||measurements.filter(m=>m.role==="independent").length!==1)throw Error("Exactly one fallible independent measurement required");
 const marketPrecision=measurements.reduce((s,m)=>s+(m.role==="independent"?0:m.rawPrecision),0),sharedDenominator=1+v.sharedMarket*marketPrecision,information=measurements.map(m=>m.rawPrecision/(m.role==="independent"?1:sharedDenominator)),totalInformation=information.reduce((s,x)=>s+x,0),latentLocation=1/totalInformation;
 if(!(latentLocation>0&&finite(latentLocation)))throw Error("Measurement predictive information unresolved");const traced=measurements.map((m,j)=>({...m,informationAfterSharedMarket:information[j],reliabilityWeight:information[j]/totalInformation})),location=traced.reduce((s,m)=>s+m.center*m.reliabilityWeight,0),variance=v.game+latentLocation;
 if(!(variance>0&&finite(variance)&&finite(location)))throw Error("Measurement posterior variance/mean unresolved");
 return{mean:location,sd:Math.sqrt(variance),measurements:traced,varianceComponents:{game:v.game,latentLocation},sharedMarketVariance:v.sharedMarket,sourceRoleBaselineVariances:{independent:v.independent,professional:v.professional,consumer:v.consumer},varianceSemantics:"predictive_sd_game_noise_added_once_to_latent_measurement_location_uncertainty" as const,locationEnvelope:{minimum:Math.min(...measurements.map(m=>m.center)),maximum:Math.max(...measurements.map(m=>m.center)),meaning:"structural_positive_GLS_weight_property_not_output_cap;integer_conditioning_may_change_final_score_law_expectation"},uncertaintyLimit:"working_empirical_parameters;excludes_covariance_parameter_and_context_selection_uncertainty_until_outer_calibration"};
}
export function predictCbbMeasurementFromInputs(artifact:CbbMeasurementArtifact,input:Pick<CbbMeasurementInputs,"margin"|"total">){validateArtifact(artifact);return{margin:posterior(artifact.margin,input.margin),total:posterior(artifact.total,input.total),covariance:0,correlation:0,diagnosticOnly:true as const,availabilityClaim:"none_off_manifest_input_diagnostic" as const};}
export function predictCbbContextualMeasurementForecast(artifact:CbbMeasurementArtifact,input:{gameId:number;asOf:string;input:CbbContextualFeatureInput},mode:"future"|"retrospective_development"){
 validateArtifact(artifact);const clocks=[artifact.trainingCutoff,artifact.createdAt,artifact.availableBy,input.asOf].map(Date.parse);if(!clocks.every(finite)||clocks[0]>clocks[1]||clocks[1]>clocks[2]||input.gameId!==input.input.independent.gameId||input.asOf!==input.input.asOf||artifact.trainingGameIds.includes(input.gameId)||!Number.isSafeInteger(input.gameId)||input.gameId<=0)throw Error("Measurement identity/training exclusion/clocks invalid");if(!["future","retrospective_development"].includes(mode)||mode==="future"&&clocks[3]<clocks[2])throw Error("Measurement artifact unavailable at input");
 const built=buildCbbMeasurementInputs(input.input);return{release:artifact.release,authority:artifact.authority,mode,gameId:input.gameId,inputAsOf:input.asOf,artifactAvailableBy:artifact.availableBy,margin:posterior(artifact.margin,built.margin),total:posterior(artifact.total,built.total),covariance:0,correlation:0,receipt:built.receipt,measurementInputs:built,rejected:built.rejected,probabilityClaim:"none_until_outer_game_excluded_joint_calibration" as const};
}
export type CbbMeasurementPrediction=ReturnType<typeof predictCbbContextualMeasurementForecast>;
export type CbbMeasurementFitResult=ReturnType<typeof fitCbbContextualMeasurementForecast>;
