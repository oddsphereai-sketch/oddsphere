/** Synthetic future-wire builder only. Never used by runtime admission or on a
 * stored/accepted response; negative fixtures mutate the returned raw draft. */
import type {GamePacket} from '../../lib/playerPropsAi/evidenceContract';
import {compileReaderClaims} from '../../lib/playerPropsAi/readerClaims';
import {READER_AREAS,type ReaderArea,type ReaderCoverage} from '../../lib/playerPropsAi/readerCoverage';
export type FixtureJudgment='supports'|'cautions'|'mixed'|'uncertain'|'neutral';
export type FixtureReaderSelection={claimIds:string[];judgment:FixtureJudgment};
export type FixtureCoverage=Record<ReaderArea,FixtureReaderSelection&{effect:ReaderCoverage[ReaderArea]['effect']}>;
export function buildVerifiedReaderSelections(packet:GamePacket,playerId:string,options:{effects?:Partial<Record<ReaderArea,ReaderCoverage[ReaderArea]['effect']>>;judgment?:FixtureJudgment;exceptions?:readonly unknown[];gaps?:readonly unknown[]}={}){
 const player=packet.players.find(p=>p.id===playerId);if(!player)throw Error('Synthetic fixture actor missing');
 const catalog=compileReaderClaims(packet)[playerId],judgment=options.judgment??'uncertain';
 const coverage=Object.fromEntries(READER_AREAS.map(area=>{
  const source=catalog.areas[area],claimIds=source.requiredClaimIds.length?[...source.requiredClaimIds]:source.claims.slice(0,1).map(c=>c.id);
  return[area,{claimIds,judgment,effect:source.status==='missing'?'unavailable':options.effects?.[area]??'uncertain'}];
 })) as FixtureCoverage;
 const assessment={claimIds:[...new Set([...(coverage.recent_form?.claimIds??[]),...(coverage.availability?.claimIds??[])])].slice(0,2),judgment};
 const reason=(value:unknown)=>typeof value==='string'&&/source.event|interception.*unresolved|unresolved.*interception/i.test(value)?'source_event_unresolved':'forecast_declined';
 return{assessment,coverage,gaps:(options.gaps??[]).map(reason),exceptions:(options.exceptions??player.markets.map(()=>null)).map(v=>v===null?null:reason(v))};
}
export function verifiedReaderFixture<T extends {coverage?:unknown;exceptions?:readonly unknown[];gaps?:readonly unknown[]}>(packet:GamePacket,playerId:string,row:T):Omit<T,keyof ReturnType<typeof buildVerifiedReaderSelections>>&ReturnType<typeof buildVerifiedReaderSelections>{
 const legacy=row.coverage as Partial<Record<ReaderArea,{effect?:ReaderCoverage[ReaderArea]['effect']}>>|undefined;
 const effects=Object.fromEntries(READER_AREAS.flatMap(area=>legacy?.[area]?.effect?[[area,legacy[area]!.effect]]:[]));
 return{...row,...buildVerifiedReaderSelections(packet,playerId,{effects,exceptions:row.exceptions,gaps:row.gaps})};
}
export function verifiedReaderDraft<T extends {players:Record<string,{coverage?:unknown;exceptions?:readonly unknown[];gaps?:readonly unknown[]}>}>(packet:GamePacket,draft:T){
 return{...draft,players:Object.fromEntries(Object.entries(draft.players).map(([id,row])=>[id,verifiedReaderFixture(packet,id,row)]))};
}
