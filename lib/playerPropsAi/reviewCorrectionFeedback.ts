/** One runtime/audit dispatch for the original sport-specific correction. */
import type {GamePacket} from './evidenceContract';
import {namedSourceCorrection} from './sourceConstraintCards';
import {sourceAwareDiagnosticCorrection} from './sourceAwareCorrectionFeedback';
import {withOriginalDraftCorrectionContext} from './originalDraftCorrectionContext';

export function reviewCorrectionFeedback(packet:GamePacket,draft:unknown){
 const feedback=packet.sport==='nba'?namedSourceCorrection(packet,draft):sourceAwareDiagnosticCorrection(packet,draft);
 const result=withOriginalDraftCorrectionContext(packet,draft,feedback);
 // Optional tail detail must not displace a complete original draft reference
 // that previously fit. Rebuild the legacy navigation only on this bounded case.
 if(result===feedback&&feedback.status==='ready'&&feedback.text.includes('positive-weight range')){
  const original=packet.sport==='nba'?namedSourceCorrection(packet,draft,false):sourceAwareDiagnosticCorrection(packet,draft,false);
  const referenced=withOriginalDraftCorrectionContext(packet,draft,original);
  if(referenced!==original)return referenced;
 }
 return result;
}
