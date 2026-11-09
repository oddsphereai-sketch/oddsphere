/** Synthetic admission checks only; no model/provider/network access. */
import assert from "node:assert/strict";
import {draftAdmissionSummary,draftFormattingFindings} from "../lib/playerPropsAi/draftDiagnostics";
import {physicalLawFindings} from "../lib/playerPropsAi/physicalDiagnostics";
import {jointReviewSchema,correctionFeedback} from "../lib/playerPropsAi/request";
import {READER_AREAS} from "../lib/playerPropsAi/readerCoverage";
import {PRODUCT_RELEASE,type GamePacket} from "../lib/playerPropsAi/evidenceContract";
const v=(n:number)=>Array<number>(16).fill(n);
const packet:GamePacket={release:PRODUCT_RELEASE,sport:"nfl",gameId:"synthetic",start:"2026-11-09T23:00:00Z",lock:"2026-11-09T22:00:00Z",cutoff:"2026-11-09T16:00:00Z",stage:"early",quotes:[],sourceLimitations:[],players:Array.from({length:8},(_,i)=>({id:`p${i}`,name:`Synthetic ${i}`,team:"A",opponent:"B",markets:["passing_yards"],evidence:[],missing:[]}))};
const draft={players:Object.fromEntries(packet.players.map(p=>[p.id,{assessment:"This clipped source interpretation has no ending",coverage:Object.fromEntries(READER_AREAS.map(a=>[a,{observation:"This reader statement is also unfinished"}])),law:{weights:v(1),outcomes:{passing_attempts:v(0),passing_completions:v(1),passing_tds:v(2),interceptions:v(1),passing_yards:v(200)}}}]))};
const original=JSON.stringify(draft),summary=draftAdmissionSummary(packet,draft)!;
assert.equal(draftFormattingFindings(packet,draft).length,72);assert(physicalLawFindings(packet,draft).length>0);assert(summary.length<=1024);assert(correctionFeedback(summary).length<2048);
for(let i=0;i<8;i++){assert(summary.includes(`P${i} A,R0,R1,R2,R3,R4,R5,R6,R7`));for(const rule of ["CMP<=ATT","TD<=CMP","INT<=ATT-CMP"])assert(summary.includes(rule));}
assert.equal(JSON.stringify(draft),original,"diagnostics cannot fix or normalize rejected bytes");
for(const row of Object.values(draft.players)){row.assessment="The supplied evidence needs contextual caution.";for(const area of Object.values(row.coverage))area.observation="The supplied context is uncertain.";}
assert.equal(draftFormattingFindings(packet,draft).length,0);assert(draftAdmissionSummary(packet,draft)!.includes("INT<=ATT-CMP"),"text repair cannot waive physical identity");
for(const row of Object.values(draft.players))row.law.outcomes={...row.law.outcomes,passing_attempts:v(3),passing_completions:v(1),passing_tds:v(1),interceptions:v(1)};
assert.equal(draftAdmissionSummary(packet,draft),null);
const schema=jointReviewSchema(packet) as unknown as {properties:{players:{properties:Record<string,{properties:{assessment:{pattern:string};coverage:{properties:Record<string,{properties:{observation:{pattern:string}}}>}}}>}}};
for(const p of packet.players){const s=schema.properties.players.properties[p.id].properties;assert(new RegExp(s.assessment.pattern).test("The evidence supports a conditional forecast."));assert(!new RegExp(s.assessment.pattern).test("The evidence ends mid-thought"));for(const area of READER_AREAS){const re=new RegExp(s.coverage.properties[area].properties.observation.pattern);assert(re.test("The source is incomplete."));assert(!re.test("The source is incomplete"));assert(!re.test("The source states 12."));}}
console.log("Complete-sentence admission passed: all actors/areas and physical failures reported together within unchanged feedback, schema matches existing checks, no text/number mutation or paid calls.");
