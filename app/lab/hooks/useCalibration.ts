"use client";

/**
 * useCalibration — SWR hook for /api/lab/calibration.
 *
 * 5-minute poll matches the rest of the Lab. Calibration changes weekly when
 * the weekly-calibration cron runs (Sundays 3am ET), so we don't need a tight
 * refresh — the poll covers tab-return + manual revalidation.
 */

import useSWR from "swr";
import { labFetcher } from "../lib/labClient";
import type { CalibrationResponse } from "../lib/labTypes";

export type UseCalibrationOptions = {
  refreshIntervalMs?: number;
};

export type UseCalibrationResult = {
  data: CalibrationResponse | undefined;
  error: Error | undefined;
  isLoading: boolean;
  refresh: () => Promise<CalibrationResponse | undefined>;
};

export function useCalibration(options: UseCalibrationOptions = {}): UseCalibrationResult {
  const { refreshIntervalMs = 300_000 } = options;
  const { data, error, isLoading, mutate } = useSWR<CalibrationResponse>(
    "/api/lab/calibration",
    labFetcher,
    {
      refreshInterval: refreshIntervalMs,
      revalidateOnFocus: true,
      revalidateOnReconnect: true,
      keepPreviousData: true,
    }
  );
  return {
    data,
    error: error as Error | undefined,
    isLoading,
    refresh: () => mutate(),
  };
}
