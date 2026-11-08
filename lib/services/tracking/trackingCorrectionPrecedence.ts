import { nflTrackingCorrectionSupersededRecordId } from "../football/nflPublishedTrackingCorrection";
import { cfbTrackingCorrectionSupersededRecordId } from "../football/cfbPublishedTrackingCorrection";

/** Only explicitly released, append-only correction contracts supersede a row. */
export function trackingCorrectionSupersededRecordId(args: {
  modelVersion?: string | null; correctionRelease?: unknown; supersedesPredictionRecordId?: unknown;
}): number | null {
  return nflTrackingCorrectionSupersededRecordId(args) ?? cfbTrackingCorrectionSupersededRecordId(args);
}
