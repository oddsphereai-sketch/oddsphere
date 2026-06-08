"use client";

/**
 * Phase 7B v0c-DE — NBA Daily Edge preview entrypoint.
 *
 * INTERNAL / ADMIN-ONLY. NOT member-facing. Lives only on the nba-v0a
 * branch and inherits the same temporary preview-branch auth bypass as
 * /admin/nba-preview.
 *
 * Visual goal: matches the Daily Edge product feel (slate list + reader,
 * verdict palette, market trackers, splits, source badges) but renders
 * NBA-specific data: ML / spread / total with model + market context,
 * series context, ratings/lines/splits provenance, honest missing-data
 * labels.
 *
 * Data source: /api/admin/nba-preview?date=YYYY-MM-DD (ET-interpreted
 * date in the URL → ET-day UTC window on the server). Same auth bypass
 * applies, so this page does NOT show a login form on the nba-v0a
 * preview deployment.
 *
 * Removal: when nba-v0a is merged to main this entire route should be
 * deleted (or kept but gated behind a feature flag). Either way the
 * temporary auth bypass MUST be removed first.
 */

import { useCallback, useEffect, useState } from "react";
import type { NbaDailyEdgeDto } from "@/lib/services/nba/buildNbaDailyEdgeDto";
import { NbaDailyEdgeShell } from "./components/NbaDailyEdgeShell";

// ─── Page-side auth-bypass mirror ──────────────────────────────────
// The route enforces the same gate server-side; this client-side check
// just decides whether to show the login form vs go straight to fetch.
function isPreviewBranchAuthBypassEnabled(): boolean {
  if (typeof window === "undefined") return false;
  return window.location.hostname.endsWith(".vercel.app");
}

function todayEt(): string {
  // Returns YYYY-MM-DD for "today" in ET.
  const fmt = new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/New_York",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  });
  return fmt.format(new Date());
}

export default function NbaDailyEdgePreviewPage() {
  const [date, setDate] = useState<string>(todayEt());
  const [dto, setDto] = useState<NbaDailyEdgeDto | null>(null);
  const [loading, setLoading] = useState<boolean>(false);
  const [error, setError] = useState<string | null>(null);
  const [adminEmail, setAdminEmail] = useState<string>("");
  const [adminToken, setAdminToken] = useState<string>("");

  const fetchDto = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const headers: Record<string, string> = {};
      if (adminEmail !== "" && adminToken !== "") {
        headers["x-admin-email"] = adminEmail;
        headers["x-admin-token"] = adminToken;
      }
      const res = await fetch(`/api/admin/nba-preview?date=${date}`, { headers });
      if (!res.ok) {
        const body = await res.text();
        setError(`HTTP ${res.status}: ${body.slice(0, 200)}`);
        setDto(null);
        return;
      }
      const json = (await res.json()) as NbaDailyEdgeDto;
      setDto(json);
    } catch (e) {
      setError((e as Error).message);
      setDto(null);
    } finally {
      setLoading(false);
    }
  }, [date, adminEmail, adminToken]);

  // Auto-fetch on preview deployment (auth bypass), or after user enters creds.
  useEffect(() => {
    if (isPreviewBranchAuthBypassEnabled()) {
      void fetchDto();
    }
  }, [fetchDto]);

  return (
    <div className="min-h-screen bg-[#0a0a0f] text-gray-200">
      {/* Top control bar */}
      <div className="border-b border-gray-800/60 bg-gray-950/80 px-4 py-3 flex flex-wrap items-center gap-2">
        <span className="text-xs font-semibold uppercase tracking-widest text-gray-400">
          NBA Daily Edge · Preview
        </span>
        <label className="ml-2 inline-flex items-center gap-1.5 text-xs text-gray-400">
          Slate date (ET)
          <input
            type="date"
            value={date}
            onChange={(e) => setDate(e.target.value)}
            className="bg-gray-900 border border-gray-700 rounded px-2 py-1 text-sm font-mono text-gray-100"
          />
        </label>
        <button
          type="button"
          onClick={() => void fetchDto()}
          className="px-3 py-1 rounded bg-violet-500/20 border border-violet-400/40 text-sm text-violet-200 hover:bg-violet-500/30"
        >
          {loading ? "Loading…" : "Refresh"}
        </button>
        {!isPreviewBranchAuthBypassEnabled() && (
          <div className="ml-auto flex items-center gap-1.5">
            <input
              type="email"
              placeholder="admin email"
              value={adminEmail}
              onChange={(e) => setAdminEmail(e.target.value)}
              className="bg-gray-900 border border-gray-700 rounded px-2 py-1 text-xs font-mono w-44"
            />
            <input
              type="password"
              placeholder="admin token"
              value={adminToken}
              onChange={(e) => setAdminToken(e.target.value)}
              className="bg-gray-900 border border-gray-700 rounded px-2 py-1 text-xs font-mono w-44"
            />
          </div>
        )}
      </div>

      {error !== null && (
        <div className="border-b border-rose-500/30 bg-rose-500/10 px-4 py-2 text-xs text-rose-200">
          ✗ {error}
        </div>
      )}

      {dto === null ? (
        <div className="p-8 text-center text-sm text-gray-500">
          {loading ? "Loading NBA preview…" : "No data yet — pick a date and click Refresh."}
        </div>
      ) : (
        <NbaDailyEdgeShell dto={dto} />
      )}
    </div>
  );
}
