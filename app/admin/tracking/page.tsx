/**
 * Push 4 — admin tracking dashboard.
 *
 * Renders the full computeTrackingAggregate output:
 *   - Top-line cards (overall, Best Angles, baselines)
 *   - Historical CSV baselines table
 *   - Daily Edge fresh tracking (empty until tomorrow's graded slate)
 *   - Per-dimension breakdowns: sport, market, model_version, play_grade
 *   - Confidence bucket calibration with Brier / log-loss
 *   - Provisional + data-quality slices
 *
 * Same admin auth pattern as /admin/auto-predictions. Client component
 * because we fetch via the admin REST route.
 */

"use client";

import { useEffect, useState } from "react";

type AggregateMetrics = {
  picks: number;
  wins: number;
  losses: number;
  pushes: number;
  voids: number;
  pending: number;
  win_pct: number | null;
  avg_confidence: number | null;
  avg_edge: number | null;
  avg_ev: number | null;
  brier_score: number | null;
  log_loss: number | null;
};

type DimensionRow = { label: string; metrics: AggregateMetrics };
type BaselineRow = {
  source_label: string;
  sport: string;
  market: string;
  model_family: string;
  lifetime_wins: number;
  lifetime_total: number;
  lifetime_pct: number;
  current_season_wins: number | null;
  current_season_total: number | null;
  current_season_pct: number | null;
  weekly_wins: number | null;
  weekly_total: number | null;
  weekly_pct: number | null;
};

type TrackingResponse = {
  rowsConsidered: number;
  rowsCounted: number;
  overall: AggregateMetrics;
  bySport: DimensionRow[];
  byMarket: DimensionRow[];
  byModelVersion: DimensionRow[];
  byPlayGrade: DimensionRow[];
  byConfidenceBucket: DimensionRow[];
  byDataQualityTier: DimensionRow[];
  bestAngles: AggregateMetrics;
  leans: AggregateMetrics;
  provisionalOnly: AggregateMetrics;
  baselines: BaselineRow[];
  tablesInitialized: boolean;
};

function pct(v: number | null): string {
  return v === null ? "—" : `${v.toFixed(1)}%`;
}

function num(v: number | null, digits = 2): string {
  return v === null ? "—" : v.toFixed(digits);
}

function Card({ label, value, sub }: { label: string; value: string; sub?: string }) {
  return (
    <div style={{ background: "#0f172a", border: "1px solid #1e293b", borderRadius: 12, padding: 16, minHeight: 90, color: "#e2e8f0" }}>
      <div style={{ fontSize: 11, textTransform: "uppercase", letterSpacing: 0.5, color: "#94a3b8" }}>{label}</div>
      <div style={{ fontSize: 24, fontWeight: 600, marginTop: 6 }}>{value}</div>
      {sub && <div style={{ fontSize: 12, color: "#64748b", marginTop: 4 }}>{sub}</div>}
    </div>
  );
}

function MetricsTable({ title, rows }: { title: string; rows: DimensionRow[] }) {
  const sorted = [...rows].sort((a, b) => b.metrics.picks - a.metrics.picks);
  return (
    <div style={{ marginBottom: 24 }}>
      <h3 style={{ color: "#e2e8f0", fontSize: 14, marginBottom: 8 }}>{title}</h3>
      <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 12, color: "#cbd5e1" }}>
        <thead>
          <tr style={{ background: "#0f172a", color: "#94a3b8" }}>
            <th style={{ textAlign: "left", padding: 6 }}>Group</th>
            <th style={{ textAlign: "right", padding: 6 }}>Picks</th>
            <th style={{ textAlign: "right", padding: 6 }}>W</th>
            <th style={{ textAlign: "right", padding: 6 }}>L</th>
            <th style={{ textAlign: "right", padding: 6 }}>Push</th>
            <th style={{ textAlign: "right", padding: 6 }}>Pending</th>
            <th style={{ textAlign: "right", padding: 6 }}>Win %</th>
            <th style={{ textAlign: "right", padding: 6 }}>Avg conf</th>
            <th style={{ textAlign: "right", padding: 6 }}>Brier</th>
            <th style={{ textAlign: "right", padding: 6 }}>Log loss</th>
          </tr>
        </thead>
        <tbody>
          {sorted.map((r) => (
            <tr key={r.label} style={{ borderTop: "1px solid #1e293b" }}>
              <td style={{ padding: 6 }}>{r.label}</td>
              <td style={{ textAlign: "right", padding: 6 }}>{r.metrics.picks}</td>
              <td style={{ textAlign: "right", padding: 6 }}>{r.metrics.wins}</td>
              <td style={{ textAlign: "right", padding: 6 }}>{r.metrics.losses}</td>
              <td style={{ textAlign: "right", padding: 6 }}>{r.metrics.pushes}</td>
              <td style={{ textAlign: "right", padding: 6 }}>{r.metrics.pending}</td>
              <td style={{ textAlign: "right", padding: 6 }}>{pct(r.metrics.win_pct)}</td>
              <td style={{ textAlign: "right", padding: 6 }}>{num(r.metrics.avg_confidence, 1)}</td>
              <td style={{ textAlign: "right", padding: 6 }}>{num(r.metrics.brier_score, 4)}</td>
              <td style={{ textAlign: "right", padding: 6 }}>{num(r.metrics.log_loss, 4)}</td>
            </tr>
          ))}
          {sorted.length === 0 && (
            <tr><td colSpan={10} style={{ padding: 12, color: "#64748b", textAlign: "center" }}>No data yet</td></tr>
          )}
        </tbody>
      </table>
    </div>
  );
}

export default function AdminTrackingPage() {
  const [data, setData] = useState<TrackingResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [email, setEmail] = useState("");
  const [token, setToken] = useState("");
  const [submitted, setSubmitted] = useState(false);

  useEffect(() => {
    if (!submitted) return;
    setLoading(true);
    fetch("/api/admin/tracking", {
      headers: {
        "x-admin-email": email,
        "x-admin-token": token,
      },
    })
      .then(async (r) => {
        if (!r.ok) {
          throw new Error(`HTTP ${r.status}: ${await r.text()}`);
        }
        return r.json();
      })
      .then((j) => { setData(j); setError(null); })
      .catch((e) => setError(e instanceof Error ? e.message : String(e)))
      .finally(() => setLoading(false));
  }, [submitted, email, token]);

  if (!submitted) {
    return (
      <div style={{ background: "#020617", minHeight: "100vh", padding: 24, color: "#e2e8f0" }}>
        <h1 style={{ fontSize: 18 }}>Admin Tracking — auth</h1>
        <form
          onSubmit={(e) => { e.preventDefault(); setSubmitted(true); }}
          style={{ marginTop: 12, display: "flex", flexDirection: "column", gap: 8, maxWidth: 360 }}
        >
          <input value={email} onChange={(e) => setEmail(e.target.value)} placeholder="email" style={{ padding: 8 }} />
          <input value={token} onChange={(e) => setToken(e.target.value)} placeholder="admin token" type="password" style={{ padding: 8 }} />
          <button type="submit" style={{ padding: 8, background: "#22c55e", color: "#0f172a", borderRadius: 4 }}>Load tracking</button>
        </form>
      </div>
    );
  }

  if (loading) return <div style={{ padding: 24, color: "#94a3b8", background: "#020617", minHeight: "100vh" }}>Loading…</div>;
  if (error) return <div style={{ padding: 24, color: "#fca5a5", background: "#020617", minHeight: "100vh" }}>Error: {error}</div>;
  if (!data) return null;

  if (!data.tablesInitialized) {
    return (
      <div style={{ padding: 24, background: "#020617", minHeight: "100vh", color: "#e2e8f0" }}>
        <h1>Tracking — not yet initialized</h1>
        <p style={{ color: "#94a3b8" }}>
          The tracking tables (prediction_records, prediction_grades, tracking_baselines) have not been created yet. Apply <code>lib/db/schema-migration-v17.sql</code> in the Supabase SQL editor, then refresh this page.
        </p>
      </div>
    );
  }

  return (
    <div style={{ background: "#020617", minHeight: "100vh", padding: 24, color: "#e2e8f0", fontFamily: "system-ui, -apple-system, sans-serif" }}>
      <h1 style={{ fontSize: 22, marginBottom: 4 }}>Tracking</h1>
      <div style={{ color: "#64748b", fontSize: 12, marginBottom: 16 }}>
        {data.rowsCounted}/{data.rowsConsidered} rows counted (launch-day rows excluded from fresh counts)
      </div>

      {/* Top cards */}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: 12, marginBottom: 24 }}>
        <Card label="Overall — Daily Edge fresh" value={`${data.overall.wins}-${data.overall.losses}`} sub={`Win % ${pct(data.overall.win_pct)} · ${data.overall.picks} picks`} />
        <Card label="Best Angles" value={`${data.bestAngles.wins}-${data.bestAngles.losses}`} sub={`Win % ${pct(data.bestAngles.win_pct)} · ${data.bestAngles.picks} picks`} />
        <Card label="Leans" value={`${data.leans.wins}-${data.leans.losses}`} sub={`Win % ${pct(data.leans.win_pct)} · ${data.leans.picks} picks`} />
        <Card label="Provisional (low data quality)" value={`${data.provisionalOnly.wins}-${data.provisionalOnly.losses}`} sub={`Win % ${pct(data.provisionalOnly.win_pct)} · ${data.provisionalOnly.picks} picks`} />
      </div>

      {/* Empty state for fresh */}
      {data.overall.picks === 0 && (
        <div style={{ background: "#0f172a", border: "1px solid #1e293b", borderRadius: 12, padding: 24, marginBottom: 24 }}>
          <div style={{ fontSize: 14, color: "#cbd5e1" }}>
            Fresh Daily Edge tracking starts tomorrow. Today&rsquo;s 2026-06-06 launch-day picks are excluded from the rolling counts and tracked separately as manual-entry pending.
          </div>
        </div>
      )}

      {/* Baselines */}
      <h2 style={{ fontSize: 16, marginTop: 24, marginBottom: 8 }}>Historical Baselines</h2>
      <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 12, color: "#cbd5e1", marginBottom: 24 }}>
        <thead>
          <tr style={{ background: "#0f172a", color: "#94a3b8" }}>
            <th style={{ textAlign: "left", padding: 6 }}>Sport</th>
            <th style={{ textAlign: "left", padding: 6 }}>Market</th>
            <th style={{ textAlign: "left", padding: 6 }}>Label</th>
            <th style={{ textAlign: "right", padding: 6 }}>Lifetime</th>
            <th style={{ textAlign: "right", padding: 6 }}>Win %</th>
            <th style={{ textAlign: "right", padding: 6 }}>Current Season</th>
            <th style={{ textAlign: "right", padding: 6 }}>Weekly</th>
          </tr>
        </thead>
        <tbody>
          {data.baselines.map((b) => (
            <tr key={`${b.sport}_${b.market}_${b.source_label}`} style={{ borderTop: "1px solid #1e293b" }}>
              <td style={{ padding: 6 }}>{b.sport.toUpperCase()}</td>
              <td style={{ padding: 6 }}>{b.market}</td>
              <td style={{ padding: 6 }}>{b.source_label}</td>
              <td style={{ textAlign: "right", padding: 6 }}>{b.lifetime_wins}/{b.lifetime_total}</td>
              <td style={{ textAlign: "right", padding: 6, color: "#86efac" }}>{b.lifetime_pct.toFixed(1)}%</td>
              <td style={{ textAlign: "right", padding: 6 }}>{b.current_season_wins !== null ? `${b.current_season_wins}/${b.current_season_total}` : "—"}</td>
              <td style={{ textAlign: "right", padding: 6 }}>{b.weekly_wins !== null ? `${b.weekly_wins}/${b.weekly_total}` : "—"}</td>
            </tr>
          ))}
          {data.baselines.length === 0 && (
            <tr><td colSpan={7} style={{ padding: 12, color: "#64748b", textAlign: "center" }}>No baselines imported yet. Run <code>import-tracking-baseline.ts --apply</code>.</td></tr>
          )}
        </tbody>
      </table>

      <MetricsTable title="By Sport" rows={data.bySport} />
      <MetricsTable title="By Market" rows={data.byMarket} />
      <MetricsTable title="By Model Version" rows={data.byModelVersion} />
      <MetricsTable title="By Play Grade" rows={data.byPlayGrade} />
      <MetricsTable title="By Confidence Bucket" rows={data.byConfidenceBucket} />
      <MetricsTable title="By Data Quality Tier" rows={data.byDataQualityTier} />
    </div>
  );
}
