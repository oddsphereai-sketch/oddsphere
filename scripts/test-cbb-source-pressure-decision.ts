import assert from "node:assert/strict";
import {readCbbSourcePressure} from "../lib/cbb/sourcePressureDecision";
import type {CbbDecisionSplitContext} from "../lib/cbb/decisionSplitContext";
import type {CbbForecast,CbbQuote} from "../lib/cbb/types";
const forecast={gameId:1,asOf:"2026-11-03T18:30:00Z",margin:4,total:150,uncertainty:{marginSd:11,totalSd:16}} as CbbForecast;
const quote=(line:number,source:string,receipt:string,book="circa"):CbbQuote=>({gameId:1,market:"spread",line,firstPrice:-110,secondPrice:-110,
 sportsbook:book,provider:"owls",orientationVerified:true,phase:"current",providerObservedAt:source,fetchedAt:receipt} as CbbQuote);
const before=quote(-3.5,"2026-11-03T18:00:00Z","2026-11-03T18:01:00Z"),after=quote(-4.5,"2026-11-03T18:20:00Z","2026-11-03T18:21:00Z");
const context:CbbDecisionSplitContext={gameId:1,market:"spread",sourceBook:"circa",physicalFamily:"circa",sourceClass:"professional_adjacent_named_book",provider:"owls",
 sourceEventId:"ncaab:A@B-20261103",line:-3.5,firstMoney:.8,secondMoney:.2,firstTickets:.4,secondTickets:.6,
 observedAt:"2026-11-03T18:10:00Z",availableBy:"2026-11-03T18:11:00Z",clockBasis:"verified_provider_observation",observationIds:[]};
const run=(rows=[context],quotes=[before,after])=>readCbbSourcePressure({forecast,rows,quotes,quarantinedKeys:[]})[0];
assert.equal(run().reaction,"toward_money");assert.equal(run().reactionDirection,1);
assert.equal(run([{...context,firstMoney:.2,secondMoney:.8}]).reaction,"against_money","price direction is interpreted relative to actual source money");
const held=run([context],[before,{...after,line:before.line}]);assert.equal(held.reaction,"held");assert.equal(held.reactionDirection,0);
assert.equal(held.resolution,"held");
const reversal=run([context],[before,after,{...after,line:-4,providerObservedAt:"2026-11-03T18:25:00Z",fetchedAt:"2026-11-03T18:26:00Z"}]);
assert.equal(reversal.resolution,"contested");assert.equal(reversal.latestDirection,-1);assert.equal(reversal.reactionDirection,1);
const resumption=run([context],[before,after,{...after,line:-4,providerObservedAt:"2026-11-03T18:23:00Z",fetchedAt:"2026-11-03T18:24:00Z"},
 {...after,providerObservedAt:"2026-11-03T18:25:00Z",fetchedAt:"2026-11-03T18:26:00Z"}]);
assert.equal(resumption.resolution,"resumed");assert.equal(resumption.latestDirection,1);
assert.equal(run([context],[before]).reaction,"unbound","no later quote is not a hold");
assert.equal(run([{...context,sourceClass:"multi_book_consensus",physicalFamily:"playbook_consensus",line:null}]).reaction,"unbound","public aggregate cannot borrow Circa's reaction");
assert.equal(run([{...context,sourceBook:"draftkings",physicalFamily:"draftkings",sourceClass:"retail_named_book"}]).reaction,"unbound","different source histories cannot be matched");
assert.equal(run([{...context,line:-2.5}]).reaction,"unbound","flow's own contract must be genuine");
assert.equal(run([context],[before,{...before,line:-2.5,providerObservedAt:"2026-11-03T18:05:00Z",fetchedAt:"2026-11-03T18:06:00Z"},after]).reaction,"unbound","cannot skip an intervening changed native contract");
assert.equal(run([context],[before,{...after,providerObservedAt:"2026-11-03T18:09:00Z"}]).reaction,"unbound","pre-flow move is not a response");
assert.equal(run([context],[before,{...after,firstPrice:-130},after]).reaction,"unbound","ambiguous same-time prices do not author pressure response");
assert.equal(run([context],[before,after,{...after,line:-5.5,firstPrice:0,providerObservedAt:"2026-11-03T18:25:00Z",fetchedAt:"2026-11-03T18:26:00Z"}]).reaction,"unbound","known invalid newest state cannot revive older action support");
const offTarget=run();assert.equal(offTarget.ownLine,-3.5);assert.equal(offTarget.current?.line,-4.5,"native pressure remains meaningful when the line changes");
assert.equal(run([{...context,firstMoney:null,secondMoney:null}]).moneyDirection,null,"missing handle is never invented from tickets");
console.log("PASS CBB pressure interpretation: own-source chronology, actual hold, native contracts, distinct money/tickets and no aggregate causality");
