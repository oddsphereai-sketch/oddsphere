import type { SupabaseClient } from "@supabase/supabase-js";
import type { DailyEdgeResponse } from "@/app/lab/lib/labTypes";
import type { EplStoredPriceObservation } from "@/lib/services/epl/buildEplDailyEdgePreview";
import { persistEplLineHistory, readEplStoredPriceHistory } from "@/lib/services/epl/eplLineHistoryStore";
import { UCL_EXTERNAL_ID_OFFSET } from "./uclCompetitionContext";

export function readUclStoredPriceHistory(providerIds: number[], options: { client?: SupabaseClient } = {}): Promise<EplStoredPriceObservation[]> {
  return readEplStoredPriceHistory(providerIds, UCL_EXTERNAL_ID_OFFSET, "UCL", { ...options, exactTotalContracts: true });
}

export function persistUclLineHistory(input: { response: DailyEdgeResponse; allBookPrices?: EplStoredPriceObservation[]; apply: boolean; client?: SupabaseClient }) {
  return persistEplLineHistory({ ...input, externalIdOffset: UCL_EXTERNAL_ID_OFFSET, label: "UCL", exactTotalContracts: true });
}
