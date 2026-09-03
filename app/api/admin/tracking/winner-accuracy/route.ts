import { unstable_cache } from "next/cache";

import { validateAdminAuth } from "@/lib/auth/admin";
import {
  WINNER_ACCURACY_DAILY_RECORD_CAP,
  loadWinnerAccuracyScorecards,
  resolveLockedDate,
  type WinnerAccuracyScorecardQueryResult,
} from "@/lib/services/tracking/winnerAccuracyScorecardQuery";

export const maxDuration = 30;

const SERVER_CACHE_SECONDS = 5 * 60;
const STALE_FALLBACK_MS = 30 * 60 * 1_000;
const QUERY_TIMEOUT_MS = 15_000;

type DailyWindow = "morning" | "nightly";
type LastGoodEntry = { value: WinnerAccuracyScorecardQueryResult; storedAtMs: number };

const lastGood = new Map<string, LastGoodEntry>();

const loadCachedDailyScorecard = unstable_cache(
  async (window: DailyWindow, lockedDate: string) => loadWinnerAccuracyScorecards({
    window,
    lockedDate,
    recordCap: WINNER_ACCURACY_DAILY_RECORD_CAP,
  }),
  ["admin-winner-accuracy-scorecard-v1"],
  { revalidate: SERVER_CACHE_SECONDS, tags: ["admin-winner-accuracy-scorecard"] },
);

function withTimeout<T>(promise: Promise<T>, timeoutMs: number): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timeout = setTimeout(
      () => reject(new Error(`winner-accuracy query timed out after ${timeoutMs}ms`)),
      timeoutMs,
    );
    promise.then(
      (value) => { clearTimeout(timeout); resolve(value); },
      (error) => { clearTimeout(timeout); reject(error); },
    );
  });
}

function responseBody(
  value: WinnerAccuracyScorecardQueryResult,
  cacheStatus: "current" | "stale_fallback",
  warning: string | null,
) {
  const dataAgeSeconds = Math.max(0, Math.round((Date.now() - Date.parse(value.generatedAt)) / 1_000));
  const stale = cacheStatus === "stale_fallback" || dataAgeSeconds > SERVER_CACHE_SECONDS;
  const sourceDegraded = value.monitoring.degraded;
  return {
    ...value,
    status: stale || sourceDegraded ? "degraded" : value.monitoring.state,
    monitoring: {
      ...value.monitoring,
      degraded: stale || sourceDegraded,
      cacheStatus,
      stale,
      dataAgeSeconds,
      warning,
    },
  };
}

function json(body: unknown, status = 200): Response {
  return Response.json(body, {
    status,
    headers: {
      "Cache-Control": "private, no-store",
      "Vary": "x-admin-email",
    },
  });
}

export async function GET(request: Request) {
  const auth = validateAdminAuth(request);
  if (!auth.ok) return auth.response;

  const url = new URL(request.url);
  const rawWindow = url.searchParams.get("window") ?? "morning";
  if (rawWindow !== "morning" && rawWindow !== "nightly") {
    return json({ status: "degraded", error: "window must be morning or nightly" }, 400);
  }

  let lockedDate: string;
  try {
    lockedDate = resolveLockedDate(rawWindow, url.searchParams.get("date"));
  } catch (error) {
    return json({
      status: "degraded",
      error: error instanceof Error ? error.message : String(error),
    }, 400);
  }

  const cacheKey = `${rawWindow}:${lockedDate}`;
  try {
    const value = await withTimeout(loadCachedDailyScorecard(rawWindow, lockedDate), QUERY_TIMEOUT_MS);
    lastGood.set(cacheKey, { value, storedAtMs: Date.now() });
    return json(responseBody(value, "current", null));
  } catch (error) {
    const prior = lastGood.get(cacheKey);
    const warning = error instanceof Error ? error.message : String(error);
    if (prior !== undefined && Date.now() - prior.storedAtMs <= STALE_FALLBACK_MS) {
      return json(responseBody(prior.value, "stale_fallback", warning));
    }
    return json({
      status: "degraded",
      monitoring: {
        state: "degraded",
        degraded: true,
        code: "scorecard_query_failed",
        cacheStatus: "unavailable",
        stale: true,
        warning,
      },
    }, 503);
  }
}
