import type {SiteReviewOutcome} from './siteRuntime';

export const PROPS_AI_RUNTIME_HEALTH_RELEASE='player_props_ai_runtime_health_2026_11_14_r1_private' as const;
export type PropsAiRuntimeHealth=Readonly<{
 release:typeof PROPS_AI_RUNTIME_HEALTH_RELEASE;
 status:'active'|'disabled'|'paid_disabled'|'unavailable';
 newlyCompletedReviews:number;
 findings:readonly string[];
 observedAt:string;
}>;
/** Internal process evidence only. Never model accuracy or member coverage. */
export function summarizePropsAiRuntimeHealth(outcome:SiteReviewOutcome,observedAt:string):PropsAiRuntimeHealth{
 const status=['active','disabled','paid_disabled','unavailable'].includes(outcome.status)?outcome.status as PropsAiRuntimeHealth['status']:'unavailable';
 const validCount=Number.isSafeInteger(outcome.newlyCompletedReviews??0)&&(outcome.newlyCompletedReviews??0)>=0;
 const findings=outcome.findings.slice(0,outcome.findings.length>64?63:64).map(f=>/^[A-Za-z0-9_:|.\-]{1,320}$/.test(f)&&!/sk-|bearer/i.test(f)?f:'ai_process_finding_redacted');
 if(outcome.findings.length>64)findings.push('ai_process_findings_truncated');
 return{release:PROPS_AI_RUNTIME_HEALTH_RELEASE,status:validCount?status:'unavailable',newlyCompletedReviews:validCount?outcome.newlyCompletedReviews??0:0,findings,observedAt};
}
const critical=/^(?:source_or_review_unavailable:|current_source_unavailable:|lock_source_unavailable:|lock_prior_authority_unavailable|review_unavailable:|review_deferred_writer_|review_preparation_deferred_|calendar_identity_unavailable|pending_review_inventory_exceeds_two_slots_per_game|ai_unavailable:|due_review_read_failed|ai_operational_fallback_keep_independent|ai_process_finding_redacted|ai_process_findings_truncated)/;
export function propsAiRuntimeCriticalFindings(health:PropsAiRuntimeHealth):string[]{return health.findings.filter(f=>critical.test(f)).slice(0,16);}
export function propsAiRuntimeFailure(health:PropsAiRuntimeHealth|undefined):'unavailable'|'incomplete'|null{
 if(health?.status==='unavailable')return'unavailable';
 return health&&propsAiRuntimeCriticalFindings(health).length?'incomplete':null;
}
