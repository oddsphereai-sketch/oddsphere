import assert from "node:assert/strict";
import { isOwnerApprovedCbbMemberExclusion } from "../lib/cbb/memberBoardScope";
import type { DailyEdgeGameDto } from "../app/lab/lib/labTypes";

const incomplete={held:true,priceAmerican:null,modelProb:null};
const original={sport:"cbb",external_id:10882480,lockedAt:"2026-11-02T10:02:10.038Z",markets:{moneyline:{...incomplete},total:{...incomplete},first_inning:{...incomplete}}} as DailyEdgeGameDto;
const bytes=JSON.stringify(original);
assert.equal(isOwnerApprovedCbbMemberExclusion(original),true);
for(const altered of [
  {...original,external_id:10882481},
  {...original,lockedAt:"2026-11-02T10:02:10.039Z"},
  {...original,lockedAt:null},
  {...original,markets:{...original.markets,moneyline:{...original.markets.moneyline,held:false,priceAmerican:-110,modelProb:.55}}},
  {...original,markets:{...original.markets,moneyline:{...original.markets.moneyline,modelProb:.55}}},
])assert.equal(isOwnerApprovedCbbMemberExclusion(altered),false,"owner approval cannot suppress a different lock or evaluated market");
assert.equal(JSON.stringify(original),bytes,"visibility cannot rewrite the original public lock");
console.log("CBB approved scope: exact incomplete lock only; other games, evaluated values and stored payload remain unchanged.");
