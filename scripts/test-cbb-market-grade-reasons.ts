import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {gradeCbbReceivedMarket} from '../lib/cbb/marketBehaviorGrade';
import {readCbbMarketBehavior,type CbbMarketBehaviorReceipt} from '../lib/cbb/marketBehaviorCandidate';
import {CBB_CURRENT_SCORE_RELEASE} from '../lib/cbb/currentScoreRuntime';
import {cbbThresholdProbabilities,normalCdf} from '../lib/cbb/model';
import type {CbbForecast,CbbMarket,CbbQuote} from '../lib/cbb/types';
const at='2026-11-03T15:30:00.000Z',start='2026-11-03T19:00:00.000Z';
const quote=(market:CbbMarket,book='draftkings',firstPrice=-110,secondPrice=-110):CbbQuote=>({gameId:777,market,
 line:market==='spread'?-3.5:market==='total'?150.5:null,firstPrice,secondPrice,sportsbook:book,provider:'owls',phase:'current',
 providerObservedAt:'2026-11-03T15:20:00.000Z',fetchedAt:'2026-11-03T15:21:00.000Z',
 ...{orientationVerified:true}});
function forecast(margin=8,total=155):CbbForecast{
 const sd=11,zero=normalCdf((.5-margin)/sd)-normalCdf((-.5-margin)/sd);
 return {release:CBB_CURRENT_SCORE_RELEASE,gameId:777,asOf:at,homeId:1,awayId:2,homeScore:(total+margin)/2,awayScore:(total-margin)/2,
  margin,total,homeWinProbability:(1-normalCdf((.5-margin)/sd))/(1-zero),possessions:70,inputStatus:'complete',issues:[],
  uncertainty:{marginSd:sd,totalSd:16,marginTotalCorrelation:0,marginCorrection:0,totalCorrection:0,fitThroughSeason:2025,games:1000}};
}
function fixture(market:CbbMarket,state:'neutral'|'opposes'|'mixed'|'agrees'|'unavailable',options:{ev?:number;steep?:boolean;incomplete?:boolean}={}){
 const target=quote(market,'draftkings',options.steep?(market==='moneyline'?-300:-600):-110,options.steep?(market==='moneyline'?240:450):-110);
 let independent=forecast();
 if(options.steep)independent=forecast(24,185);
 if(options.ev!==undefined){let low=market==='total'?100:-30,high=market==='total'?200:40;
  for(let i=0;i<70;i++){const center=(low+high)/2,f=market==='total'?forecast(8,center):forecast(center,155),p=cbbThresholdProbabilities(f,market,target.line);
   const ev=p.first*(target.firstPrice>0?target.firstPrice/100:100/-target.firstPrice)-p.second;
   if(ev<options.ev)low=center;else high=center;
  }
  independent=market==='total'?forecast(8,(low+high)/2):forecast((low+high)/2,155);
 }
 if(options.incomplete)independent={...independent,inputStatus:'incomplete',issues:['fixture_incomplete']};
 const references=state==='unavailable'?[]:state==='mixed'?[quote(market,'pinnacle',-140,120),quote(market,'circa',120,-140)]:
  [quote(market,'pinnacle',...(state==='agrees'?[-140,120]:state==='opposes'?[120,-140]:[-110,-110]) as [number,number])];
 // This is a grade-reason regression matrix with a deliberately fixed final
 // forecast. The separate integrated suites exercise current-law inference.
 const args={independent,independentInputKey:'grade-reasons-fixture',startsAt:start,targets:[target],anchors:null};
 const result=readCbbMarketBehavior({...args,currentQuotes:[]});
 const sourceContext=readCbbMarketBehavior({...args,currentQuotes:references});
 result.receipt.currentProfessionalQuotes=references;
 result.receipt.pathPosture=sourceContext.receipt.pathPosture;
 const input={forecast:result.forecast,target,references,asOf:at};
 return {input,receipt:result.receipt,decision:gradeCbbReceivedMarket(input,result.receipt)};
}
const cases:Array<{name:string;decision:ReturnType<typeof gradeCbbReceivedMarket>;reason:string}>=[];
for(const market of ['moneyline','spread','total'] as const){
 for(const state of ['neutral','opposes','mixed'] as const){
  const r=fixture(market,state);assert.equal(r.decision.grade,'Watchlist');assert.ok(r.decision.expectedValue!>=.03);assert.equal(r.decision.referenceState,state);
  cases.push({name:`${market}-${state}-high`,decision:r.decision,reason:state==='opposes'?'professional_opposition':`professional_reference_${state}`});
 }
 for(const state of ['neutral','opposes','mixed','unavailable'] as const){
  const r=fixture(market,state,{ev:.01});assert.equal(r.decision.grade,'Watchlist');assert.ok(r.decision.expectedValue!>0&&r.decision.expectedValue!<.03);
  cases.push({name:`${market}-${state}-low`,decision:r.decision,reason:'edge_below_actionable_reserve'});
 }
 for(const state of ['agrees','opposes','mixed','neutral','unavailable'] as const){
  const r=fixture(market,state,{steep:true});assert.equal(r.decision.grade,'Watchlist');assert.ok(r.decision.expectedValue!>=.03);
  cases.push({name:`${market}-${state}-steep`,decision:r.decision,reason:'price_too_steep_for_actionable'});
 }
 for(const state of ['agrees','unavailable'] as const){const r=fixture(market,state);assert.equal(r.decision.grade,'Lean');
  cases.push({name:`${market}-${state}-actionable`,decision:r.decision,reason:'positive_model_value_without_qualified_action_confirmation'});
 }
 const negative=fixture(market,'neutral',{ev:-.01});assert.equal(negative.decision.grade,'No Play');
 cases.push({name:`${market}-negative`,decision:negative.decision,reason:'non_positive_exact_price_value'});
 const held=fixture(market,'unavailable',{incomplete:true});assert.equal(held.decision.grade,'Held');
 cases.push({name:`${market}-held`,decision:held.decision,reason:'incomplete_forecast_or_executable_quote'});
}
for(const market of ['moneyline','spread','total'] as const){
 const below=fixture(market,'unavailable',{ev:.029999}),above=fixture(market,'unavailable',{ev:.030001});
 assert.equal(below.decision.grade,'Watchlist');assert.equal(below.decision.reason,'edge_below_actionable_reserve');
 assert.equal(above.decision.grade,'Lean');assert.equal(above.decision.reason,'positive_model_value_without_qualified_action_confirmation');
 const highNeutral=fixture(market,'neutral',{ev:.030001});assert.equal(highNeutral.decision.grade,'Watchlist');assert.equal(highNeutral.decision.reason,'professional_reference_neutral');
 const steepLow=fixture(market,'opposes',{ev:.01,steep:true});assert.equal(steepLow.decision.grade,'Watchlist');assert.equal(steepLow.decision.reason,'edge_below_actionable_reserve');
}
const resisted=fixture('spread','mixed');
// Two named sources held money toward this pick: keep the existing demotion reason.
resisted.receipt.currentProfessionalQuotes=[quote('spread','pinnacle',-140,120),quote('spread','circa',-140,120)];
resisted.receipt.pathPosture=resisted.receipt.pathPosture.map(s=>({...s,status:'observed',latestFlowMatched:true,flowResponse:'held',
 boundFlowDirection:1,flowReactionDirection:0,flowCurrentResolution:'held',flowConcentrationDirection:1}));
const resistanceDecision=gradeCbbReceivedMarket(resisted.input,resisted.receipt);assert.equal(resistanceDecision.grade,'Watchlist');
cases.push({name:'corroborated-resistance',decision:resistanceDecision,reason:'corroborated_unresolved_source_resistance'});
const canon=(v:unknown):unknown=>Array.isArray(v)?v.map(canon):v&&typeof v==='object'?Object.fromEntries(Object.entries(v).sort(([a],[b])=>a.localeCompare(b)).map(([k,x])=>[k,canon(x)])):v;
function decisionHash(decision:ReturnType<typeof gradeCbbReceivedMarket>){const {reason,release,splitRead,contextualResistance,contrarianSupport,...unchanged}=decision;void reason;void release;
 assert.deepEqual(splitRead,[],"a fixture with no split input must not invent source pressure");
 if(contextualResistance!==undefined)assert.equal(contextualResistance,false);
 if(contrarianSupport!==undefined)assert.equal(contrarianSupport,false);
 return createHash('sha256').update(JSON.stringify(canon(unchanged))).digest('hex');}
// Frozen against base d8690e1 before the reason-only edit. This covers the WHOLE
// decision, including probabilities/EV/prices/reference evidence and every flag.
const BASELINE:Record<string,string>={
  "moneyline-neutral-high": "6138f0f220e032fbf71710f1bb7ee36dba2ebe63a4a7a418c4d24278c3e43335",
  "moneyline-opposes-high": "5082b3a15bcc03f1e883ce016384d9f56524d632d537a8c3de1b6785b5b4a1a0",
  "moneyline-mixed-high": "8b64f51e4a009ea988f4d4a15216e7a62d975120fd26398360f10052ef1fd00d",
  "moneyline-neutral-low": "3fc728d80baf05b78643a1e0d644113dd8afcc83896e953370fc20a4d098c6c7",
  "moneyline-opposes-low": "3a320378e680bbda9686b6ea5ca15ab163e9d4d719770a73285e4c32323106ea",
  "moneyline-mixed-low": "05a269b96be211d77ff1dde6a48c217dcaa2a60698d3e553ccf22b136dd00cc8",
  "moneyline-unavailable-low": "20b692f0711134f3b7f02c744fd24468b795e6d5ac49e482c30409034edff38b",
  "moneyline-agrees-steep": "f8d4770b637572dd9ae4d5a4207dd7b2380e7d4712753f20d48de7d3838af825",
  "moneyline-opposes-steep": "d478f577f87a0b7c79eb3e5d010235ec3e589510cd676f80f7f06f970c74b681",
  "moneyline-mixed-steep": "1f209a606469768a3dd0509cb31bd34999c0767980fbe0f45e47529469f0c032",
  "moneyline-neutral-steep": "563a67333f7f03cb1091fcfe2f7cef11f79752081005bd433080448bcc1eb52b",
  "moneyline-unavailable-steep": "e0ad40cbc4c41f7ef4f675b40a2bd8cafb518d4989a2f5b757d80344bd32446a",
  "moneyline-agrees-actionable": "3631d77845ab832a2f0b3745825843fb9335b693c584c62650b649a7ef164db0",
  "moneyline-unavailable-actionable": "71f7d32ed5aa31e66a241f46937b4706f4add21d9fd323cf5427ff6194a949bf",
  "moneyline-negative": "ace89f634d299a7f733fe4d8825d7efe050270e52561d165d328dd91e1a9a2cb",
  "moneyline-held": "777756a7bad6a8bf14ff49e838e61efc29b59ed65b7bba12acc9f8a2faad68d1",
  "spread-neutral-high": "0b262303a8366414692831bc14abf66e22589dda3a866e2f2329252be721028e",
  "spread-opposes-high": "aa4ef01542c8d1ab39efb6d38f4a7bc7a1650bbe39ba0ddea9eaab64d6e2fd0a",
  "spread-mixed-high": "8b9cd0bc2ff3e13e26d76127ca74dbcb1e60e60ce243ee56eaa054a925dd285e",
  "spread-neutral-low": "99ca4f1eaad01f681b59814f012f057d856037c94097d1932394a74deaea404b",
  "spread-opposes-low": "640e1939d6c5e178179b7063cbd9705bc9d8ed0c264d207b5fe2b84128854336",
  "spread-mixed-low": "f59442ea9e4bfc8d80a624d898f83089f249c6218d2e1104adc0537b76753194",
  "spread-unavailable-low": "0131c441858a6270b5635d99207f2453c350e0d73461f93e41278c473f7cdb50",
  "spread-agrees-steep": "a190faa4eef79591fa5bed3d0add12888a6d0b448c6783135b590f0a976dbf37",
  "spread-opposes-steep": "bfcfa24c6f0a78bee92fcc022480f8aa2fa01c09cabb307b2ba21f090fc5cc4a",
  "spread-mixed-steep": "07b58fedfea493a1fef2f05db62ae9328893ecbf61b30518fe479cd480fd29b2",
  "spread-neutral-steep": "f08d0cff9fe0189104d40079f7550e81528333e9f9bcf2f79d25cd29c7b99570",
  "spread-unavailable-steep": "5df5e93c0e5268ce2975a2cc71a027fb458ef7e537fe5af91c1623701cd35653",
  "spread-agrees-actionable": "80e6e8c4e318d3e1ed93c544c5a08bc30da1c38a477cf998ecf314786cb20263",
  "spread-unavailable-actionable": "0401b4abe05e6821ad76fc1d2207385f8ed1fd19f12d50204ea8052ec20d91c7",
  "spread-negative": "ecd31eb922f5231bd0ce88b078282b9fcd2b1f79eae3dfd48b15c9f7172029a4",
  "spread-held": "1168a22cef22059ffd5cb9ed2a4126d7dc9dfbf2870643dfa363e151d65f78a7",
  "total-neutral-high": "a5732d4442707144308c457cd34fe19d03fbe15d7321c5b633f415acaaf6b67a",
  "total-opposes-high": "f603c42423054b7ff90e6721c11f3aa66142bd0d9e1833d7bcb019a88cb3c276",
  "total-mixed-high": "6a05206b86b193c3907cc1de3c778f6fb3718e14a72481d556722483cb7f8f0d",
  "total-neutral-low": "81fca40338a5235cd5714af89cf31ce8da0cc268426d1dedfbfa1b196f3b9d9a",
  "total-opposes-low": "c2d69022b0aae591989a2cacbf5fa14e9f090c18fa7483fa64fcb46d015aa37e",
  "total-mixed-low": "91a16e90eaa1c7b620c70c80a49a3dc35139b0e137530f6511b90f21e9b7883d",
  "total-unavailable-low": "d532fec22bacf5eec3a55e6cc7607111c750d241b2601156033e09a63daa9470",
  "total-agrees-steep": "1bebb73cdd9c39e30a061d8f5906658aeab43bc9d6dd6fe40b0ad4ce00d6ff0e",
  "total-opposes-steep": "c3a4bed5f8625d9b31e68d6d8e710f6305e18e23a31331fd12d88aa3802a8922",
  "total-mixed-steep": "c8a7d7723868dcad5216d0c08b8d849f294e26079335297c8e2e3834fb86422f",
  "total-neutral-steep": "248938f0b2b759c8a51df942ab915dad80a84b98b1ed8686016c171ec6cdc83e",
  "total-unavailable-steep": "22af8114c0d00a97da55df315133465616d28cacff00332cf7df389bd06b3fc2",
  "total-agrees-actionable": "92ec09dbe64357be13e4fcff14a395fd51653b0f7efe364dbeb24f4e9a298edf",
  "total-unavailable-actionable": "69a8a54c80d4c52817e7d6b3246fa543494489eae75e9ccf5cf68543d2880335",
  "total-negative": "203143643b58ad5910ade6b3999255876449ba19485c96b09113d5e9bedc8b5c",
  "total-held": "4ca8a392d389436c56b60b6c2de6c1f5d0462b7059d67600e1e698e32bce0a0a",
  "corroborated-resistance": "9499a053d9290678961c63e13bbc803b484ab8fcdac5c22fd8ee420d8e28e0be"
};
for(const c of cases){assert.equal(c.decision.reason,c.reason,c.name);
 assert.equal(decisionHash(c.decision),BASELINE[c.name],`${c.name}: full decision changed beyond declared candidate decision`);}
// Relabeling same-direction unequal effects as unresolved retains every
// cautious gate that conflicting previously supplied; no grade consequence.
const guarded=fixture('spread','agrees');
const conflicting=structuredClone(guarded.receipt),unresolved=structuredClone(guarded.receipt);
conflicting.margin={...conflicting.margin,status:'conflicting',delta:0,sourceBook:null,sourceMarket:null};
unresolved.margin={...unresolved.margin,status:'unresolved',delta:0,sourceBook:null,sourceMarket:null} as CbbMarketBehaviorReceipt['margin'];
const before=gradeCbbReceivedMarket(guarded.input,conflicting),after=gradeCbbReceivedMarket(guarded.input,unresolved);
assert.equal(before.pathResistance,true);assert.equal(before.grade,'Lean');assert.deepEqual(after,before);
console.log(`PASS ${cases.length} full frozen decisions unchanged except truthful reason/release; unresolved retains conflicting resistance gates.`);
