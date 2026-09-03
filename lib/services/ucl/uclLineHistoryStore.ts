import type { DailyEdgeResponse } from "@/app/lab/lib/labTypes";
import type { EplStoredPriceObservation } from "@/lib/services/epl/buildEplDailyEdgePreview";
import { persistEplLineHistory, readEplStoredPriceHistory } from "@/lib/services/epl/eplLineHistoryStore";
import { UCL_EXTERNAL_ID_OFFSET } from "./uclCompetitionContext";

export function readUclStoredPriceHistory(providerIds: number[]): Promise<EplStoredPriceObservation[]> {
  return readEplStoredPriceHistory(providerIds, UCL_EXTERNAL_ID_OFFSET, "UCL");
}

export function persistUclLineHistory(input: { response: DailyEdgeResponse; allBookPrices?: EplStoredPriceObservation[]; apply: boolean }) {
  return persistEplLineHistory({ ...input, externalIdOffset: UCL_EXTERNAL_ID_OFFSET, label: "UCL" });
}
