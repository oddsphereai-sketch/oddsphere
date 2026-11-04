import {cbbAvailabilityUpperBoundMs,cbbEvidenceAvailableAt,cbbEvidenceReceiptBounds} from "./marketReceiptTime";
import type {CbbPressureDecision} from "./sourcePressureDecision";
import type {CbbQuote} from "./types";

const family=(book:string)=>["pinnacle","ps3838"].includes(book.toLowerCase())?"pinnacle":book.toLowerCase();
const tuple=(q:CbbQuote)=>JSON.stringify([q.line,q.firstPrice,q.secondPrice]);
/** The response must still be the admitted current physical-book contract.
 * A split percentage, a later read, or a past cancelled response is not one. */
export function cbbCurrentNativeReaction(row:CbbPressureDecision,current:readonly CbbQuote[],asOf:string,direction:1|-1):boolean{
 const at=Date.parse(asOf),available=cbbAvailabilityUpperBoundMs(row.availableBy),observed=Date.parse(row.sourceAt??"");
 if(row.sourceClass!=="professional_adjacent_named_book"||row.reaction==="unbound"||
   row.reactionDirection!==direction||row.latestDirection!==direction||
   !["ongoing","resumed","reversed"].includes(row.resolution)||!row.baseline||!row.current||
   ![at,available,observed].every(Number.isFinite)||available>at)return false;
 const before=row.baseline,after=row.current;
 return before.gameId===after.gameId&&before.market===row.market&&after.market===row.market&&
   family(before.sportsbook)===row.book&&family(after.sportsbook)===row.book&&
   before.line===row.ownLine&&Date.parse(before.providerObservedAt)<=observed&&
   cbbEvidenceAvailableAt(before)<=available&&Date.parse(after.providerObservedAt)>observed&&
   cbbEvidenceReceiptBounds(after).earliest>=available&&cbbEvidenceAvailableAt(after)<=at&&
   current.some(q=>q.gameId===after.gameId&&family(q.sportsbook)===row.book&&q.market===row.market&&
     tuple(q)===tuple(after)&&Date.parse(q.providerObservedAt)===Date.parse(after.providerObservedAt));
}
export function cbbQualifiedCounterpressure(row:CbbPressureDecision,current:readonly CbbQuote[],asOf:string,direction:1|-1):boolean{
 return row.reaction==="against_money"&&row.moneyDirection===-direction&&cbbCurrentNativeReaction(row,current,asOf,direction);
}
