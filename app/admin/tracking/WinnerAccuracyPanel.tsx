"use client";

import { useCallback, useState } from "react";

import type { ReleaseWinnerScorecard } from "@/lib/services/tracking/winnerAccuracyScorecard";

type DailyWindow = "morning" | "nightly";

type ApiResponse = {
  status: "healthy" | "degraded" | "no_data";
  generatedAt: string;
  lockedDate: string;
  settledRows: number;
  omittedIncompleteRows: number;
  scorecards: ReleaseWinnerScorecard[];
  monitoring: {
    state: "healthy" | "degraded" | "no_data";
    degraded: boolean;
    code: string;
    cacheStatus: "current" | "stale_fallback";
    stale: boolean;
    dataAgeSeconds: number;
    warning: string | null;
  };
};

function pct(value: number | null): string {
  return value === null ? "—" : `${value.toFixed(1)}%`;
}

function decimal(value: number | null): string {
  return value === null ? "—" : value.toFixed(4);
}

function releaseLabel(value: string): string {
  return value.length <= 76 ? value : `${value.slice(0, 73)}…`;
}

function Metric({ label, value }: { label: string; value: string }) {
  return (
    <div style={{ background: "#111c30", borderRadius: 8, padding: "9px 10px" }}>
      <div style={{ color: "#64748b", fontSize: 10, textTransform: "uppercase", letterSpacing: 0.4 }}>{label}</div>
      <div style={{ color: "#e2e8f0", fontSize: 14, fontWeight: 650, marginTop: 3 }}>{value}</div>
    </div>
  );
}

function ReleaseCard({ row }: { row: ReleaseWinnerScorecard }) {
  const draw = row.drawDetection;
  const actionClv = row.clv.actionableOnly;
  return (
    <article style={{ border: "1px solid #1e293b", background: "#0b1425", borderRadius: 12, padding: 14 }}>
      <div style={{ display: "flex", alignItems: "baseline", gap: 10, flexWrap: "wrap", marginBottom: 10 }}>
        <strong style={{ fontSize: 14, color: "#f8fafc" }}>{row.sport.toUpperCase()}</strong>
        <span title={row.releaseKey} style={{ color: "#64748b", fontSize: 11 }}>{releaseLabel(row.releaseKey)}</span>
      </div>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(145px, 1fr))", gap: 8 }}>
        <Metric label="Winner accuracy" value={`${row.winnerAccuracy.correct}/${row.winnerAccuracy.sample} · ${pct(row.winnerAccuracy.accuracyPct)}`} />
        <Metric label="Market favorite" value={`${row.marketFavoriteBenchmark.correct}/${row.marketFavoriteBenchmark.sample} · ${pct(row.marketFavoriteBenchmark.accuracyPct)}`} />
        <Metric label="Model Brier / log" value={`${decimal(row.modelProbability.brierScore)} / ${decimal(row.modelProbability.logLoss)}`} />
        <Metric label="Market Brier / log" value={`${decimal(row.marketProbability.brierScore)} / ${decimal(row.marketProbability.logLoss)}`} />
        <Metric label="Calibration gap" value={pct(row.modelProbability.expectedCalibrationError === null ? null : row.modelProbability.expectedCalibrationError * 100)} />
        <Metric label="Favorite picks" value={`${row.favoriteSelections.correct}/${row.favoriteSelections.sample} · ${pct(row.favoriteSelections.accuracyPct)}`} />
        <Metric label="Underdog picks" value={`${row.underdogSelections.correct}/${row.underdogSelections.sample} · ${pct(row.underdogSelections.accuracyPct)}`} />
        <Metric label="Upset precision / recall" value={`${pct(row.upsetDetection.precisionPct)} / ${pct(row.upsetDetection.recallPct)}`} />
        {draw !== null && <Metric label="Draw precision / recall" value={`${pct(draw.precisionPct)} / ${pct(draw.recallPct)}`} />}
        <Metric label="Disagreement model / market" value={`${pct(row.modelMarketDisagreements.modelAccuracyPct)} / ${pct(row.modelMarketDisagreements.marketFavoriteAccuracyPct)} · n=${row.modelMarketDisagreements.sample}`} />
        <Metric label="Actionable exact-price ROI" value={`${pct(row.exactPriceReturns.actionableOnly.roiPct)} · n=${row.exactPriceReturns.actionableOnly.resolved}`} />
        <Metric label="Actionable CLV" value={`${pct(actionClv.coveragePct)} covered · ${actionClv.covered === 0 ? "—" : `${pct(actionClv.averageClvPct)} avg`}`} />
      </div>
    </article>
  );
}

export default function WinnerAccuracyPanel({ email, token }: { email: string; token: string }) {
  const [expanded, setExpanded] = useState(false);
  const [windowName, setWindowName] = useState<DailyWindow>("morning");
  const [date, setDate] = useState("");
  const [data, setData] = useState<ApiResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async (nextWindow: DailyWindow = windowName) => {
    setLoading(true);
    setError(null);
    try {
      const params = new URLSearchParams({ window: nextWindow });
      if (date) params.set("date", date);
      const response = await fetch(`/api/admin/tracking/winner-accuracy?${params.toString()}`, {
        headers: { "x-admin-email": email, "x-admin-token": token },
        cache: "no-store",
      });
      if (!response.ok) throw new Error(`Winner-accuracy fetch failed (${response.status}): ${await response.text()}`);
      setData(await response.json() as ApiResponse);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : String(reason));
    } finally {
      setLoading(false);
    }
  }, [date, email, token, windowName]);

  if (!expanded) {
    return (
      <section style={{ marginBottom: 24 }}>
        <button
          onClick={() => { setExpanded(true); void load(); }}
          style={{ padding: "9px 14px", background: "#172554", color: "#bfdbfe", border: "1px solid #1d4ed8", borderRadius: 8, cursor: "pointer", fontWeight: 650 }}
        >
          Load release-pure winner accuracy
        </button>
      </section>
    );
  }

  return (
    <section style={{ border: "1px solid #1e293b", borderRadius: 14, background: "#07101f", padding: 16, marginBottom: 28 }}>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12, flexWrap: "wrap" }}>
        <div>
          <h2 style={{ fontSize: 16, margin: 0 }}>Release-pure winner accuracy</h2>
          <div style={{ color: "#64748b", fontSize: 11, marginTop: 4 }}>Winner quality and market benchmark are separate from exact-price returns.</div>
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 7, flexWrap: "wrap" }}>
          {(["morning", "nightly"] as const).map((option) => (
            <button
              key={option}
              onClick={() => { setWindowName(option); void load(option); }}
              style={{ padding: "6px 10px", borderRadius: 7, cursor: "pointer", border: `1px solid ${windowName === option ? "#3b82f6" : "#334155"}`, background: windowName === option ? "#1e3a8a" : "#0f172a", color: "#e2e8f0", textTransform: "capitalize" }}
            >
              {option}
            </button>
          ))}
          <input
            aria-label="Locked date"
            type="date"
            value={date}
            onChange={(event) => setDate(event.target.value)}
            style={{ colorScheme: "dark", background: "#0f172a", color: "#e2e8f0", border: "1px solid #334155", borderRadius: 7, padding: "5px 8px" }}
          />
          <button onClick={() => void load()} disabled={loading} style={{ padding: "6px 10px", background: "#1e293b", color: "#cbd5e1", border: "1px solid #334155", borderRadius: 7, cursor: "pointer" }}>
            Refresh
          </button>
        </div>
      </div>

      {loading && <div style={{ color: "#94a3b8", padding: "18px 0" }}>Loading daily scorecard…</div>}
      {error && <div style={{ color: "#fca5a5", padding: "18px 0" }}>{error}</div>}
      {!loading && data !== null && (
        <>
          <div style={{ display: "flex", gap: 12, flexWrap: "wrap", color: data.status === "degraded" ? "#fbbf24" : "#94a3b8", fontSize: 11, margin: "12px 0" }}>
            <span>Status: {data.status}</span>
            <span>{data.lockedDate} ET</span>
            <span>{data.settledRows} settled rows</span>
            <span>cache: {data.monitoring.cacheStatus}{data.monitoring.stale ? " (stale)" : ""}</span>
            <span>generated {new Date(data.generatedAt).toLocaleString()}</span>
          </div>
          {data.monitoring.warning && <div style={{ color: "#fbbf24", fontSize: 11, marginBottom: 10 }}>{data.monitoring.warning}</div>}
          {data.scorecards.length === 0 ? (
            <div style={{ color: "#64748b", padding: "16px 0" }}>No settled locked winner predictions in this window.</div>
          ) : (
            <div style={{ display: "grid", gap: 10 }}>
              {data.scorecards.map((row) => <ReleaseCard key={`${row.sport}:${row.releaseKey}`} row={row} />)}
            </div>
          )}
        </>
      )}
    </section>
  );
}
