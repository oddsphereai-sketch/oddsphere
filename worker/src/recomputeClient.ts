/**
 * Client for the authenticated internal recompute route (chunk 3 wires the
 * route itself). The worker NEVER mutates predictions directly — it only asks
 * the Vercel route to run the lock-safe recompute. fetch is injected so tests
 * verify the call shape without a network.
 *
 * IMPORTANT: this client is only invoked when STREAM_RECOMPUTE_ACTIVE is on;
 * until then the worker records stream data but issues no recompute calls.
 */

import { redactSecrets } from "./config";

export type RecomputeRequest = {
  sport: string;
  date: string;
  gameExternalIds: number[];
  reason: string;
  shadow: boolean;
};

export type RecomputeResult = { ok: boolean; status: number };

export type FetchLike = (url: string, init: { method: string; headers: Record<string, string>; body: string }) => Promise<{ status: number; ok: boolean }>;

export type RecomputeClientOpts = {
  baseUrl: string;
  cronSecret: string;
  fetchImpl?: FetchLike;
  log?: (line: string) => void;
};

export interface RecomputeClient {
  requestRecompute(req: RecomputeRequest): Promise<RecomputeResult>;
}

export function makeRecomputeClient(opts: RecomputeClientOpts): RecomputeClient {
  const fetchImpl: FetchLike =
    opts.fetchImpl ??
    ((url, init) => fetch(url, init as RequestInit).then((r) => ({ status: r.status, ok: r.ok })));
  const log = (line: string) => opts.log?.(redactSecrets(line, [opts.cronSecret]));

  return {
    async requestRecompute(req) {
      if (req.gameExternalIds.length === 0) return { ok: true, status: 204 };
      const url = `${opts.baseUrl.replace(/\/$/, "")}/api/internal/stream-recompute`;
      try {
        const res = await fetchImpl(url, {
          method: "POST",
          headers: {
            "content-type": "application/json",
            authorization: `Bearer ${opts.cronSecret}`,
          },
          body: JSON.stringify(req),
        });
        if (!res.ok) log(`recompute non-2xx status=${res.status} games=${req.gameExternalIds.length}`);
        return { ok: res.ok, status: res.status };
      } catch (e) {
        log(`recompute error: ${String(e)}`);
        return { ok: false, status: 0 };
      }
    },
  };
}
