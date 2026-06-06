/**
 * Push 4 — member tracking page.
 *
 * Read-only member-facing tracking surface. Shows the imported
 * historical baselines (always safe) + the fresh Daily Edge counts
 * once tomorrow's first slate has been graded.
 *
 * Until fresh tracking begins, the fresh-counts area shows a
 * polished "starts tomorrow" empty state — NEVER fake data,
 * NEVER launch-day picks, NEVER pending records.
 */

"use client";

import { useEffect, useState } from "react";

type BaselineRow = {
  sport: string;
  market: string;
  source_label: string;
  model_family: string;
  lifetime_wins: number;
  lifetime_total: number;
  lifetime_pct: number;
  current_season_wins: number | null;
  current_season_total: number | null;
  current_season_pct: number | null;
};

type MetricsRow = {
  label: string;
  metrics: {
    picks: number;
    wins: number;
    losses: number;
    pushes: number;
    voids: number;
    pending: number;
    win_pct: number | null;
  };
};

type LabTrackingResponse = {
  sport: string;
  baselines: BaselineRow[];
  overall: {
    picks: number;
    wins: number;
    losses: number;
    pushes: number;
    voids: number;
    pending: number;
    win_pct: number | null;
  };
  bySport: MetricsRow[];
  byMarket: MetricsRow[];
  bestAngles: {
    picks: number;
    wins: number;
    losses: number;
    pushes: number;
    voids: number;
    pending: number;
    win_pct: number | null;
  };
  tablesInitialized: boolean;
  freshTrackingStarted: boolean;
};

function fmtPct(v: number | null): string {
  return v === null ? "—" : `${v.toFixed(1)}%`;
}

export default function LabTrackingPage() {
  const [data, setData] = useState<LabTrackingResponse | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    fetch("/api/lab/tracking-foundation")
      .then(async (r) => {
        if (!r.ok) throw new Error(`HTTP ${r.status}`);
        return r.json();
      })
      .then(setData)
      .catch((e) => setError(e instanceof Error ? e.message : String(e)));
  }, []);

  if (error) {
    return (
      <div className="min-h-screen bg-slate-950 text-slate-100 p-6">
        <h1 className="text-xl">Tracking</h1>
        <p className="text-red-400 mt-2">{error}</p>
      </div>
    );
  }
  if (data === null) {
    return (
      <div className="min-h-screen bg-slate-950 text-slate-400 p-6">Loading tracking…</div>
    );
  }
  if (!data.tablesInitialized) {
    return (
      <div className="min-h-screen bg-slate-950 text-slate-100 p-6 max-w-3xl mx-auto">
        <h1 className="text-xl font-semibold">Tracking</h1>
        <div className="mt-6 rounded-lg border border-slate-800 bg-slate-900/60 p-6 text-slate-300">
          Tracking foundation is being initialized. Records will appear here once the system goes live.
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-slate-950 text-slate-100 px-4 sm:px-6 py-8">
      <div className="max-w-5xl mx-auto">
        <header className="mb-8">
          <h1 className="text-2xl font-semibold tracking-tight">Tracked Performance</h1>
          <p className="text-sm text-slate-400 mt-1">
            Model record across markets. Historical baselines reflect 2025 reference data; Daily Edge fresh tracking starts at the next graded slate.
          </p>
        </header>

        {/* Fresh tracking — empty state OR populated */}
        <section className="mb-12">
          <h2 className="text-lg font-medium mb-3">Daily Edge — Fresh Tracking</h2>
          {data.freshTrackingStarted ? (
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
              <Stat label="Overall" wins={data.overall.wins} losses={data.overall.losses} pct={data.overall.win_pct} picks={data.overall.picks} />
              <Stat label="Best Angles" wins={data.bestAngles.wins} losses={data.bestAngles.losses} pct={data.bestAngles.win_pct} picks={data.bestAngles.picks} />
              {/* per-market */}
              {data.byMarket.slice(0, 2).map((m) => (
                <Stat key={m.label} label={m.label} wins={m.metrics.wins} losses={m.metrics.losses} pct={m.metrics.win_pct} picks={m.metrics.picks} />
              ))}
            </div>
          ) : (
            <div className="rounded-xl border border-slate-800 bg-slate-900/60 p-8 text-slate-400">
              <div className="text-base text-slate-200 mb-1">Fresh Daily Edge tracking starts tomorrow.</div>
              <div className="text-sm">
                The first graded slate will populate this section. Historical baselines below remain the launch reference.
              </div>
            </div>
          )}
        </section>

        {/* Baselines */}
        <section>
          <h2 className="text-lg font-medium mb-3">Historical Baselines</h2>
          <p className="text-xs text-slate-500 mb-4">2025 reference data, imported once at launch.</p>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-slate-500 border-b border-slate-800">
                  <th className="py-2 pr-3">Sport</th>
                  <th className="py-2 pr-3">Market</th>
                  <th className="py-2 pr-3 text-right">Lifetime</th>
                  <th className="py-2 pr-3 text-right">Win %</th>
                  <th className="py-2 pr-3 text-right">Current Season</th>
                </tr>
              </thead>
              <tbody>
                {data.baselines.length === 0 ? (
                  <tr><td colSpan={5} className="py-6 text-center text-slate-500">Baselines pending import.</td></tr>
                ) : data.baselines.map((b) => (
                  <tr key={`${b.sport}_${b.market}_${b.source_label}`} className="border-b border-slate-900">
                    <td className="py-2 pr-3 uppercase tracking-wide">{b.sport}</td>
                    <td className="py-2 pr-3 text-slate-300">{b.source_label}</td>
                    <td className="py-2 pr-3 text-right">{b.lifetime_wins.toLocaleString()}/{b.lifetime_total.toLocaleString()}</td>
                    <td className="py-2 pr-3 text-right text-emerald-300">{b.lifetime_pct.toFixed(1)}%</td>
                    <td className="py-2 pr-3 text-right text-slate-400">
                      {b.current_season_wins !== null && b.current_season_total !== null
                        ? `${b.current_season_wins.toLocaleString()}/${b.current_season_total.toLocaleString()} (${fmtPct(b.current_season_pct)})`
                        : "—"}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>

        <footer className="mt-12 text-xs text-slate-600">
          Records track model performance over time. Pushes excluded from win percentages. Postponed and canceled games are voided. First-inning grades require first-inning scoring data.
        </footer>
      </div>
    </div>
  );
}

function Stat({ label, wins, losses, pct, picks }: { label: string; wins: number; losses: number; pct: number | null; picks: number }) {
  return (
    <div className="rounded-lg border border-slate-800 bg-slate-900/60 px-4 py-3">
      <div className="text-[10px] uppercase tracking-wider text-slate-500">{label}</div>
      <div className="text-xl font-semibold tabular-nums">{wins}-{losses}</div>
      <div className="text-xs text-slate-400 mt-1">{pct === null ? "—" : `${pct.toFixed(1)}%`} · {picks} picks</div>
    </div>
  );
}
