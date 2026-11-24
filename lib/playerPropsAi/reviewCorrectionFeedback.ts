/** One runtime/audit dispatch for the original sport-specific correction. */
import type {GamePacket} from './evidenceContract';
import {namedSourceCorrection} from './sourceConstraintCards';
import {sourceAwareDiagnosticCorrection} from './sourceAwareCorrectionFeedback';
import {withOriginalDraftCorrectionContext} from './originalDraftCorrectionContext';
import {withAllActorNumericCorrection} from './allActorNumericCorrection';
import {withPreviousEventWitnesses} from './previousEventWitnesses';

function originalCompleteCorrectionFeedback(packet:GamePacket,draft:unknown){
 const feedback=packet.sport==='nba'?namedSourceCorrection(packet,draft):sourceAwareDiagnosticCorrection(packet,draft);
 const result=withOriginalDraftCorrectionContext(packet,draft,feedback);
 // Optional tail detail must not displace a complete original draft reference
 // that previously fit. Rebuild the legacy navigation only on this bounded case.
 if(result===feedback&&feedback.status==='ready'&&packet.sport==='nba'&&feedback.text.includes('counts active pair signs')){
  const original=namedSourceCorrection(packet,draft,true,false);
  const referenced=withOriginalDraftCorrectionContext(packet,draft,original);
  if(referenced!==original)return referenced;
 }
 if(result===feedback&&feedback.status==='ready'&&(feedback.text.includes('positive-weight range')||feedback.text.includes('counts active pair signs'))){
  const original=packet.sport==='nba'?namedSourceCorrection(packet,draft,false):sourceAwareDiagnosticCorrection(packet,draft,false);
  const referenced=withOriginalDraftCorrectionContext(packet,draft,original);
  if(referenced!==original)return referenced;
 }
 return result;
}

export function reviewCorrectionFeedback(packet:GamePacket,draft:unknown){
 return withPreviousEventWitnesses(packet,draft,withAllActorNumericCorrection(packet,draft,originalCompleteCorrectionFeedback(packet,draft)));
}
