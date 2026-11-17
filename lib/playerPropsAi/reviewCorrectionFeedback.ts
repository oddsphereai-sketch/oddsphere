/** One runtime/audit dispatch for the original sport-specific correction. */
import type {GamePacket} from './evidenceContract';
import {namedSourceCorrection} from './sourceConstraintCards';
import {sourceAwareDiagnosticCorrection} from './sourceAwareCorrectionFeedback';
import {withOriginalDraftCorrectionContext} from './originalDraftCorrectionContext';

export function reviewCorrectionFeedback(packet:GamePacket,draft:unknown){
 const feedback=packet.sport==='nba'?namedSourceCorrection(packet,draft):sourceAwareDiagnosticCorrection(packet,draft);
 return withOriginalDraftCorrectionContext(packet,draft,feedback);
}
