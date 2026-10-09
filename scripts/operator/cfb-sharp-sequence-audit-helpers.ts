import type { CfbForwardContextFamily } from "../../lib/services/football/cfbForwardEvidenceCapture";
import type { CfbForwardMarketHistoryEvidence } from "../../lib/services/football/cfbForwardEvidence";

export type CfbSharpSequenceAuditMarket = "moneyline" | "spread" | "total";

/**
 * Returns only context families that were captured independently of the book
 * whose quote the historical decision evaluated.
 */
export function targetExcludedCfbContextFamilies(
  history: CfbForwardMarketHistoryEvidence,
  market: CfbSharpSequenceAuditMarket,
): CfbForwardContextFamily[] {
  const capture = history.payload.contextualEvidenceCapture?.markets[market];
  if (!capture) return [];
  const targetExcluded = new Set(capture.targetExcludedFamilies);
  return capture.families.filter((family) => targetExcluded.has(family[0]));
}
