/** One runtime/audit dispatch for the original sport-specific correction. */
import type {GamePacket} from './evidenceContract';
import {namedSourceCorrection} from './sourceConstraintCards';
import {sourceAwareDiagnosticCorrection} from './sourceAwareCorrectionFeedback';

export function reviewCorrectionFeedback(packet:GamePacket,draft:unknown){
 return packet.sport==='nba'?namedSourceCorrection(packet,draft):sourceAwareDiagnosticCorrection(packet,draft);
}
