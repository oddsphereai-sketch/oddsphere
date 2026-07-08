/**
 * Typed fetch helper + SWR fetcher for the Lab's internal REST API.
 *
 * All /api/lab/* hooks go through `labFetcher` so error handling stays
 * consistent. Non-2xx responses throw `LabApiError` carrying the status
 * code and body — SWR exposes this on the hook's `error` field.
 *
 * Usage:
 *   useSWR<RefreshStatusResponse>("/api/lab/refresh-status?sport=mlb", labFetcher);
 */

export class LabApiError extends Error {
  constructor(
    public readonly status: number,
    public readonly body: string,
    public readonly url: string
  ) {
    const detail = body.length > 200 ? `${body.slice(0, 200)}…` : body;
    super(`Lab API ${status} (${url}): ${detail || "(empty body)"}`);
    this.name = "LabApiError";
  }
}

export async function labFetcher<T>(url: string): Promise<T> {
  const controller = new AbortController();
  const timeout = window.setTimeout(() => controller.abort(), 45000);
  try {
    const res = await fetch(url, {
      headers: { Accept: "application/json" },
      cache: "no-store",
      signal: controller.signal,
    });
    if (!res.ok) {
      const body = await res.text().catch(() => "");
      throw new LabApiError(res.status, body, url);
    }
    return res.json() as Promise<T>;
  } catch (error) {
    if (error instanceof DOMException && error.name === "AbortError") {
      throw new LabApiError(408, "The data service is taking too long to respond. Please refresh in a moment.", url);
    }
    throw error;
  } finally {
    window.clearTimeout(timeout);
  }
}

/**
 * Build a query-string from a partial record, dropping null/undefined values
 * and preserving param order for stable SWR keys.
 */
export function buildLabUrl(
  path: string,
  params: Record<string, string | number | boolean | null | undefined> = {}
): string {
  const search = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) {
    if (v === null || v === undefined || v === "") continue;
    search.set(k, String(v));
  }
  const qs = search.toString();
  return qs ? `${path}?${qs}` : path;
}
