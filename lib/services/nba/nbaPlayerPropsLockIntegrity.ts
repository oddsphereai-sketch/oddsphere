/** Stored corrupt/ambiguous locks remain opaque public records. Refuse a write
 * rather than choosing, deduplicating or repairing an authority without approval. */
import type {NbaPlayerPropsMemberDecision as Row} from './nbaPlayerPropsProductContract';
import {nbaLockScope} from '../../playerPropsAi/nbaLockAuthority';
import {digest} from '../../playerPropsAi/evidence';

export const NBA_PLAYER_PROPS_LOCK_INTEGRITY_RELEASE='nba_player_props_lock_integrity_2026_11_18_r1_opaque_stored_authority' as const;
function groups(rows:readonly Row[]){const result=new Map<string,Row[]>();for(const row of rows){const key=nbaLockScope(row),group=result.get(key)??[];group.push(row);result.set(key,group);}return result;}
export function assertNbaStoredLocksUnambiguous(rows:readonly Row[]){
 for(const group of groups(rows).values())if(group.length>1&&group.some(row=>row.lockedAt!==null))throw new Error('NBA stored locked authority is ambiguous; preserve the original snapshot pending owner review');
}
export function assertNbaLockedPayloadsPreserved(previous:readonly Row[],candidate:readonly Row[]){
 assertNbaStoredLocksUnambiguous(previous);assertNbaStoredLocksUnambiguous(candidate);
 const current=groups(candidate);
 for(const row of previous)if(row.lockedAt!==null){const next=current.get(nbaLockScope(row));if(next?.length!==1||digest(row)!==digest(next[0]))throw new Error('NBA guarded publication refuses a changed or omitted stored lock');}
}
