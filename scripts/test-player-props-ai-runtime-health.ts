import assert from 'node:assert/strict';
import {summarizePropsAiRuntimeHealth,propsAiRuntimeFailure} from '../lib/playerPropsAi/runtimeHealth';
import {nflPlayerPropsRefreshFailure} from '../lib/cron/playerPropsRefreshTelemetry';
const at='2026-11-14T12:00:00Z',outcome={status:'active',games:[],findings:[],newlyCompletedReviews:0};
for(const findings of [[],['current_source_reload_unavailable_after_ready_lock:g:unclassified'],['review_deferred_empty_current_offers:game'],['accepted_review_read_failed_use_trusted_local']])assert.equal(propsAiRuntimeFailure(summarizePropsAiRuntimeHealth({...outcome,findings},at)),null);
for(const code of ['lock_source_unavailable:g:nfl_offered_player_identity_incomplete','source_or_review_unavailable:g:failed','current_source_unavailable:g:failed','due_review_read_failed','review_deferred_writer_deadline','ai_operational_fallback_keep_independent']){
 const health=summarizePropsAiRuntimeHealth({...outcome,findings:[code]},at);assert.equal(health.newlyCompletedReviews,0);assert.equal(propsAiRuntimeFailure(health),'incomplete');assert.match(nflPlayerPropsRefreshFailure({aiReviewRuntime:health})!,/coverage unverified/);
}
const secret=summarizePropsAiRuntimeHealth({...outcome,findings:['authorization=Bearer private-value','sk-sensitive-value']},at);assert(secret.findings.every(f=>f==='ai_process_finding_redacted'));assert(!JSON.stringify(secret).includes('private-value'));assert.equal(propsAiRuntimeFailure(secret),'incomplete');
assert.equal(propsAiRuntimeFailure(summarizePropsAiRuntimeHealth({...outcome,status:'disabled'},at)),null);
assert.equal(propsAiRuntimeFailure(summarizePropsAiRuntimeHealth({...outcome,status:'paid_disabled'},at)),null);
assert.equal(propsAiRuntimeFailure(summarizePropsAiRuntimeHealth({...outcome,status:'unavailable'},at)),'unavailable');
assert.equal(propsAiRuntimeFailure(summarizePropsAiRuntimeHealth({...outcome,status:'unknown'},at)),'unavailable');
assert.equal(propsAiRuntimeFailure(summarizePropsAiRuntimeHealth({...outcome,newlyCompletedReviews:-1},at)),'unavailable');
const many=summarizePropsAiRuntimeHealth({...outcome,findings:[...Array(65).fill('review_deferred_empty_current_offers:g'),'review_unavailable:g:failed']},at);assert.equal(many.findings.length,64);assert(many.findings.includes('ai_process_findings_truncated'));assert.equal(propsAiRuntimeFailure(many),'incomplete','bounded telemetry cannot silently hide a late finding');
const before=JSON.stringify(outcome),health=summarizePropsAiRuntimeHealth({...outcome,newlyCompletedReviews:2},at);assert.equal(health.newlyCompletedReviews,2);assert.equal(JSON.stringify(outcome),before);assert.equal(health.observedAt,at);
console.log('Private NFL AI health passed: exact new-completion counts, source/preparation/lookup failure truth, intentional disabled/empty states, bounded redaction, no source/member mutation or I/O.');
