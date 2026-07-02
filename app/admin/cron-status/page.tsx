"use client";

/**
 * /admin/cron-status — production monitoring dashboard for the Lab's 10
 * cron jobs. Daniel checks this when something feels off in production.
 *
 * Auth: same email+token gate as /admin/scores-model. Credentials persisted
 * in localStorage. /api/admin/cron-status returns the latest run + derived
 * state per cron source; this page renders it as a status table.
 */

import { useCallback, useEffect, useState } from "react";

type Sport = "mlb" | "nba" | "nfl" | "cbb" | "cfb" | "nhl" | "ucl" | "wnba" | "soccer";

type SourceState = "live" | "updating" | "warning" | "stale" | "error" | "unknown";

type SourceStatus = {
  data_source: string;
  display_name: string;
  schedule: string;
  sport: Sport | null;
  cadence_minutes: number;
  last_started_at: string | null;
  last_completed_at: string | null;
  last_status: "success" | "partial" | "failed" | "in_progress" | null;
  last_error_message: string | null;
  records_updated: number | null;
  age_minutes: number | null;
  state: SourceState;
};

type DailyEdgeHealthAlert = {
  sport: Sport | null;
  refresh_started_at: string;
  refresh_completed_at: string | null;
  refresh_status: "success" | "partial" | "failed" | "in_progress";
  records_updated: number | null;
  error_message: string | null;
};

type ApiResponse = {
  as_of: string;
  sources: SourceStatus[];
  daily_edge_health_alerts: DailyEdgeHealthAlert[];
};

const STATE_VISUAL: Record<SourceState, { label: string; dotBg: string; textColor: string; pillBg: string; pillBorder: string }> = {
  live: {
    label: "LIVE",
    dotBg: "bg-emerald-400 shadow-[0_0_8px_rgba(52,211,153,0.7)]",
    textColor: "text-emerald-300",
    pillBg: "bg-emerald-950/30",
    pillBorder: "border-emerald-700/40",
  },
  updating: {
    label: "UPDATING",
    dotBg: "bg-amber-400 shadow-[0_0_8px_rgba(251,191,36,0.7)]",
    textColor: "text-amber-300",
    pillBg: "bg-amber-950/30",
    pillBorder: "border-amber-700/40",
  },
  warning: {
    label: "WARNING",
    dotBg: "bg-yellow-400 shadow-[0_0_8px_rgba(250,204,21,0.7)]",
    textColor: "text-yellow-300",
    pillBg: "bg-yellow-950/30",
    pillBorder: "border-yellow-700/50",
  },
  stale: {
    label: "STALE",
    dotBg: "bg-rose-400 shadow-[0_0_8px_rgba(251,113,133,0.7)]",
    textColor: "text-rose-300",
    pillBg: "bg-rose-950/30",
    pillBorder: "border-rose-700/40",
  },
  error: {
    label: "ERROR",
    dotBg: "bg-rose-500 shadow-[0_0_8px_rgba(244,63,94,0.8)]",
    textColor: "text-rose-300",
    pillBg: "bg-rose-950/40",
    pillBorder: "border-rose-700/60",
  },
  unknown: {
    label: "UNKNOWN",
    dotBg: "bg-gray-500",
    textColor: "text-gray-400",
    pillBg: "bg-gray-900/60",
    pillBorder: "border-gray-700/50",
  },
};

function formatAgo(ageMinutes: number | null): string {
  if (ageMinutes === null) return "—";
  if (ageMinutes < 1) return "just now";
  if (ageMinutes < 60) return `${Math.round(ageMinutes)}m ago`;
  const hours = Math.floor(ageMinutes / 60);
  if (hours < 24) return `${hours}h ${Math.round(ageMinutes % 60)}m ago`;
  const days = Math.floor(hours / 24);
  return `${days}d ${hours % 24}h ago`;
}

export default function AdminCronStatusPage() {
  const [authed, setAuthed] = useState(false);
  const [email, setEmail] = useState("");
  const [token, setToken] = useState("");
  const [authError, setAuthError] = useState<string | null>(null);
  const [data, setData] = useState<ApiResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    try {
      const saved = localStorage.getItem("admin_credentials");
      if (saved) {
        const parsed = JSON.parse(saved) as { email: string; token: string };
        setEmail(parsed.email);
        setToken(parsed.token);
        setAuthed(true);
      }
    } catch {
      // ignore
    }
  }, []);

  const fetchStatus = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/admin/cron-status", {
        headers: { "x-admin-email": email, "x-admin-token": token },
        cache: "no-store",
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}: ${await res.text()}`);
      const body = (await res.json()) as ApiResponse;
      setData(body);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setLoading(false);
    }
  }, [email, token]);

  // Auto-refresh every 30s once authed.
  useEffect(() => {
    if (!authed) return;
    fetchStatus();
    const id = setInterval(fetchStatus, 30_000);
    return () => clearInterval(id);
  }, [authed, fetchStatus]);

  async function handleAuth() {
    setAuthError(null);
    const res = await fetch("/api/admin/cron-status", {
      headers: { "x-admin-email": email, "x-admin-token": token },
    });
    if (res.ok) {
      localStorage.setItem("admin_credentials", JSON.stringify({ email, token }));
      setAuthed(true);
    } else if (res.status === 401) {
      setAuthError("Invalid token.");
    } else if (res.status === 403) {
      setAuthError("Email not in admin allowlist.");
    } else {
      setAuthError(`Unexpected ${res.status}: ${await res.text()}`);
    }
  }

  if (!authed) {
    return (
      <main className="max-w-md mx-auto px-4 py-16">
        <h1 className="text-2xl font-black tracking-tight mb-2">Cron Status — Admin</h1>
        <p className="text-sm text-gray-400 mb-6">
          Enter admin credentials to view production cron health.
        </p>
        <div className="space-y-3">
          <input
            type="email"
            placeholder="admin@oddsphere.dev"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            className="w-full bg-gray-900 border border-gray-800 rounded-lg px-4 py-2.5 text-white placeholder:text-gray-500 focus:outline-none focus:border-violet-500"
          />
          <input
            type="password"
            placeholder="Admin token"
            value={token}
            onChange={(e) => setToken(e.target.value)}
            className="w-full bg-gray-900 border border-gray-800 rounded-lg px-4 py-2.5 text-white placeholder:text-gray-500 focus:outline-none focus:border-violet-500"
          />
          <button
            type="button"
            onClick={handleAuth}
            className="w-full bg-violet-600 hover:bg-violet-500 text-white font-semibold rounded-lg px-4 py-2.5 transition-colors"
          >
            Sign in
          </button>
          {authError && (
            <p className="text-sm text-rose-300">{authError}</p>
          )}
        </div>
      </main>
    );
  }

  return (
    <main className="max-w-5xl mx-auto px-4 sm:px-6 lg:px-8 py-12">
      <div className="flex items-start justify-between gap-4 mb-6">
        <div>
          <h1 className="text-3xl font-black tracking-tight">Cron Status</h1>
          <p className="text-sm text-gray-400 mt-1">
            Production health for all 11 cron jobs. Auto-refreshes every 30s.
          </p>
        </div>
        <button
          type="button"
          onClick={fetchStatus}
          disabled={loading}
          className="text-sm bg-gray-900 border border-gray-800 hover:border-violet-500 text-gray-200 hover:text-white font-semibold rounded-lg px-4 py-2 transition-colors disabled:opacity-50"
        >
          {loading ? "Refreshing…" : "Refresh"}
        </button>
      </div>

      {error && (
        <div className="bg-rose-950/40 border border-rose-800/50 rounded-lg p-4 text-sm text-rose-100 mb-4">
          <p className="font-semibold text-rose-200 mb-1">Couldn&rsquo;t load cron status.</p>
          <p className="text-rose-100/80">{error}</p>
        </div>
      )}

      {data ? (
        <>
        {data.daily_edge_health_alerts.length > 0 && (
          <section className="mb-4 rounded-xl border border-yellow-700/50 bg-yellow-950/20 p-4">
            <div className="flex items-start justify-between gap-3">
              <div>
                <h2 className="text-sm font-black uppercase tracking-wider text-yellow-200">
                  Daily Edge Health Alerts
                </h2>
                <p className="mt-1 text-xs text-yellow-100/70">
                  Unresolved monitor findings from the last 24 hours after repair attempts.
                </p>
              </div>
              <span className="rounded-full border border-yellow-700/60 bg-yellow-950/40 px-2.5 py-1 text-[10px] font-bold uppercase tracking-wider text-yellow-200">
                {data.daily_edge_health_alerts.length}
              </span>
            </div>
            <div className="mt-3 space-y-2">
              {data.daily_edge_health_alerts.map((alert, index) => (
                <div key={`${alert.refresh_started_at}-${alert.sport ?? "x"}-${index}`} className="rounded-lg border border-yellow-800/40 bg-black/20 p-3">
                  <div className="flex flex-wrap items-center gap-2 text-[10px] uppercase tracking-wider text-yellow-100/60">
                    <span>{alert.sport ? alert.sport.toUpperCase() : "Cross-sport"}</span>
                    <span>·</span>
                    <span>{alert.refresh_status}</span>
                    <span>·</span>
                    <span>{new Date(alert.refresh_started_at).toLocaleString()}</span>
                  </div>
                  <p className="mt-1 text-sm text-yellow-50">{alert.error_message}</p>
                </div>
              ))}
            </div>
          </section>
        )}
        <div className="bg-gradient-to-br from-gray-900 to-gray-950 border border-gray-800 rounded-xl overflow-hidden">
          {/* Desktop: table */}
          <div className="hidden md:block overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-[10px] uppercase tracking-wider text-gray-400 font-semibold border-b border-gray-800">
                  <th className="text-left py-3 px-4 font-semibold">State</th>
                  <th className="text-left py-3 px-4 font-semibold">Cron</th>
                  <th className="text-left py-3 px-4 font-semibold">Schedule</th>
                  <th className="text-left py-3 px-4 font-semibold">Sport</th>
                  <th className="text-right py-3 px-4 font-semibold">Last run</th>
                  <th className="text-right py-3 px-4 font-semibold">Records</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-800/60">
                {data.sources.map((s) => {
                  const visual = STATE_VISUAL[s.state];
                  return (
                    <tr key={`${s.data_source}-${s.sport ?? "x"}`} className="hover:bg-gray-900/40">
                      <td className="py-3 px-4 whitespace-nowrap">
                        <span className={`inline-flex items-center gap-2 rounded-full border ${visual.pillBorder} ${visual.pillBg} px-2.5 py-1`}>
                          <span aria-hidden="true" className={`inline-block h-2 w-2 rounded-full ${visual.dotBg}`} />
                          <span className={`text-[10px] uppercase tracking-wider font-bold ${visual.textColor}`}>
                            {visual.label}
                          </span>
                        </span>
                      </td>
                      <td className="py-3 px-4 font-medium text-gray-100">{s.display_name}</td>
                      <td className="py-3 px-4 text-xs text-gray-400">{s.schedule}</td>
                      <td className="py-3 px-4 text-xs uppercase tracking-wider text-gray-300">
                        {s.sport ? s.sport : "—"}
                      </td>
                      <td className="py-3 px-4 text-xs text-right tabular-nums text-gray-200">
                        {formatAgo(s.age_minutes)}
                      </td>
                      <td className="py-3 px-4 text-xs text-right tabular-nums text-gray-200">
                        {s.records_updated ?? "—"}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>

          {/* Mobile: cards */}
          <div className="md:hidden divide-y divide-gray-800/60">
            {data.sources.map((s) => {
              const visual = STATE_VISUAL[s.state];
              return (
                <div key={`${s.data_source}-${s.sport ?? "x"}`} className="p-4">
                  <div className="flex items-start justify-between gap-3 mb-2">
                    <div className="min-w-0">
                      <p className="font-semibold text-gray-100">{s.display_name}</p>
                      <p className="text-xs text-gray-400 mt-0.5">{s.schedule}</p>
                    </div>
                    <span className={`shrink-0 inline-flex items-center gap-1.5 rounded-full border ${visual.pillBorder} ${visual.pillBg} px-2 py-0.5`}>
                      <span aria-hidden="true" className={`inline-block h-1.5 w-1.5 rounded-full ${visual.dotBg}`} />
                      <span className={`text-[10px] uppercase tracking-wider font-bold ${visual.textColor}`}>
                        {visual.label}
                      </span>
                    </span>
                  </div>
                  <div className="flex items-center justify-between text-xs text-gray-300">
                    <span>{s.sport ? s.sport.toUpperCase() : "Cross-sport"}</span>
                    <span className="tabular-nums">
                      {formatAgo(s.age_minutes)} · {s.records_updated ?? "—"} records
                    </span>
                  </div>
                </div>
              );
            })}
          </div>

          <div className="px-4 py-3 border-t border-gray-800 text-[10px] text-gray-500 tabular-nums">
            Snapshot: {new Date(data.as_of).toLocaleString()}
          </div>
        </div>
        </>
      ) : !error ? (
        <div className="text-sm text-gray-400">Loading…</div>
      ) : null}
    </main>
  );
}
