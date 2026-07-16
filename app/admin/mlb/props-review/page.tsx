"use client";

import { useCallback, useEffect, useState, type ReactNode } from "react";

type Metrics = {
  tracked: number;
  wins: number;
  losses: number;
  pushes: number;
  voids: number;
  pending: number;
  hitRate: number | null;
  units: number;
  riskedUnits: number;
  roi: number | null;
  averageClvProbabilityDelta: number | null;
  brierScore: number | null;
};

type RecentRow = {
  id: number;
  slateDate: string;
  gameStartTimestamp: string;
  player: string;
  team: string;
  opponent: string;
  market: string;
  side: "over" | "under";
  line: number;
  sportsbook: string;
  lockedOdds: number;
  finalProbability: number;
  marketProbability: number | null;
  edge: number | null;
  expectedValue: number | null;
  grade: string;
  confidence: number;
  stakeUnits: number;
  cohort: "actionable" | "model_observation";
  lockedAt: string;
  closingLine: number | null;
  closingOdds: number | null;
  clvStatus: string;
  clvProbabilityDelta: number | null;
  resultStatus: string;
  resultValue: number | null;
  resultUnits: number | null;
  settledAt: string | null;
  settlementError: string | null;
};

type TrackingResponse = {
  ok: true;
  reportError: string | null;
  health: {
    enabled: boolean;
    settlementEnabled: boolean;
    tableAvailable: boolean;
    totalEntries: number;
    pendingEntries: number;
    settledEntries: number;
    actionableEntries: number;
    latestLockedAt: string | null;
    latestSettlementRun: Record<string, unknown> | null;
    error: string | null;
  };
  launch: {
    slateDate: string;
    evaluatedAt: string;
    readyToOpen: boolean;
    mustClosePublic: boolean;
    publicState: string;
    consecutiveSnapshotsRequired: number;
    consecutiveSnapshotsFound: number;
    blockers: string[];
    warnings: string[];
    checks: Array<{ code: string; ok: boolean; critical: boolean; message: string }>;
    latestSnapshot: { ageMinutes: number; sourceRows: number; mappedRows: number; props: number; games: number; books: number; markets: number } | null;
  };
  report: {
    startDate: string;
    generatedAt: string;
    summary: Metrics;
    calibration: Metrics;
    byMarket: Array<{ key: string } & Metrics>;
    byGrade: Array<{ key: string } & Metrics>;
    recent: RecentRow[];
  };
};

export default function AdminMlbPropsReviewPage() {
  const [email, setEmail] = useState("");
  const [token, setToken] = useState("");
  const [ready, setReady] = useState(false);

  useEffect(() => {
    let timer: number | null = null;
    try {
      const stored = localStorage.getItem("admin_credentials");
      if (!stored) return;
      const credentials = JSON.parse(stored) as { email?: string; token?: string };
      if (!credentials.email || !credentials.token) return;
      timer = window.setTimeout(() => {
        setEmail(credentials.email as string);
        setToken(credentials.token as string);
        setReady(true);
      }, 0);
    } catch {
      // A malformed local credential is treated as signed out.
    }
    return () => { if (timer !== null) window.clearTimeout(timer); };
  }, []);

  if (!ready) {
    return (
      <main className="min-h-screen bg-[#07111f] px-5 py-20 text-slate-100">
        <form
          className="mx-auto max-w-md rounded-lg border border-slate-700 bg-[#0d1a2b] p-6 shadow-2xl"
          onSubmit={(event) => {
            event.preventDefault();
            localStorage.setItem("admin_credentials", JSON.stringify({ email, token }));
            setReady(true);
          }}
        >
          <p className="text-xs font-semibold uppercase text-cyan-300">Internal operations</p>
          <h1 className="mt-2 text-2xl font-semibold">MLB Props Control Room</h1>
          <p className="mt-2 text-sm text-slate-400">Private launch checks, immutable picks, closing prices, and settlement.</p>
          <label className="mt-6 block text-sm text-slate-300">
            Admin email
            <input className="mt-2 w-full rounded-md border border-slate-600 bg-[#07111f] px-3 py-2 outline-none focus:border-cyan-400" type="email" value={email} onChange={(event) => setEmail(event.target.value)} required />
          </label>
          <label className="mt-4 block text-sm text-slate-300">
            Admin token
            <input className="mt-2 w-full rounded-md border border-slate-600 bg-[#07111f] px-3 py-2 outline-none focus:border-cyan-400" type="password" value={token} onChange={(event) => setToken(event.target.value)} required />
          </label>
          <button className="mt-6 w-full rounded-md bg-cyan-400 px-4 py-2 font-semibold text-[#07111f] hover:bg-cyan-300" type="submit">Open control room</button>
        </form>
      </main>
    );
  }

  return <ControlRoom email={email} token={token} onSignOut={() => {
    localStorage.removeItem("admin_credentials");
    setReady(false);
    setToken("");
  }} />;
}

function ControlRoom({ email, token, onSignOut }: { email: string; token: string; onSignOut: () => void }) {
  const [data, setData] = useState<TrackingResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [settling, setSettling] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const response = await fetch("/api/admin/mlb/props/tracking", {
        headers: { "x-admin-email": email, "x-admin-token": token },
        cache: "no-store",
      });
      if (!response.ok) throw new Error(await response.text());
      setData(await response.json() as TrackingResponse);
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : String(loadError));
    } finally {
      setLoading(false);
    }
  }, [email, token]);

  useEffect(() => {
    const timer = window.setTimeout(() => { void load(); }, 0);
    return () => window.clearTimeout(timer);
  }, [load]);

  const settle = async () => {
    setSettling(true);
    setError(null);
    try {
      const response = await fetch("/api/admin/mlb/props/tracking", {
        method: "POST",
        headers: { "Content-Type": "application/json", "x-admin-email": email, "x-admin-token": token },
        body: JSON.stringify({ action: "settle" }),
      });
      if (!response.ok) throw new Error(await response.text());
      await load();
    } catch (settleError) {
      setError(settleError instanceof Error ? settleError.message : String(settleError));
    } finally {
      setSettling(false);
    }
  };

  return (
    <main className="min-h-screen bg-[#07111f] text-slate-100">
      <header className="border-b border-slate-800 bg-[#0a1626] px-5 py-4 sm:px-8">
        <div className="mx-auto flex max-w-[1500px] flex-wrap items-center justify-between gap-4">
          <div>
            <p className="text-xs font-semibold uppercase text-cyan-300">Oddsphere internal</p>
            <h1 className="mt-1 text-xl font-semibold">MLB Props Control Room</h1>
          </div>
          <div className="flex gap-2">
            <button className="rounded-md border border-slate-600 px-3 py-2 text-sm hover:border-slate-400" onClick={() => void load()}>Refresh</button>
            <button className="rounded-md bg-cyan-400 px-3 py-2 text-sm font-semibold text-[#07111f] disabled:opacity-50" disabled={settling} onClick={() => void settle()}>{settling ? "Settling" : "Run settlement"}</button>
            <button className="rounded-md border border-slate-700 px-3 py-2 text-sm text-slate-400 hover:text-slate-200" onClick={onSignOut}>Sign out</button>
          </div>
        </div>
      </header>

      <div className="mx-auto max-w-[1500px] px-5 py-6 sm:px-8">
        {error && <div className="mb-5 rounded-lg border border-rose-700 bg-rose-950/40 p-4 text-sm text-rose-200">{error}</div>}
        {loading && !data ? <div className="py-20 text-center text-slate-400">Loading private tracking data...</div> : null}
        {data ? <ControlRoomContent data={data} /> : null}
      </div>
    </main>
  );
}

function ControlRoomContent({ data }: { data: TrackingResponse }) {
  const failedChecks = data.launch.checks.filter((check) => !check.ok);
  return (
    <>
      {data.reportError && <div className="mb-5 rounded-lg border border-amber-700 bg-amber-950/30 p-4 text-sm text-amber-200">Tracking report unavailable until V37 is applied: {data.reportError}</div>}
      <section className={`rounded-lg border p-5 ${data.launch.readyToOpen ? "border-emerald-600 bg-emerald-950/25" : "border-amber-600 bg-amber-950/20"}`}>
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <p className="text-xs font-semibold uppercase text-slate-400">Launch decision · {data.launch.slateDate}</p>
            <h2 className="mt-2 text-2xl font-semibold">{data.launch.readyToOpen ? "Launch gate passed" : "Launch blocked"}</h2>
            <p className="mt-2 text-sm text-slate-300">{data.launch.readyToOpen ? "Every required live-data and tracking control is healthy." : `${data.launch.blockers.length} required control${data.launch.blockers.length === 1 ? "" : "s"} still need attention.`}</p>
          </div>
          <div className="text-right text-sm text-slate-300">
            <div>Public state <strong className="ml-2 uppercase">{data.launch.publicState}</strong></div>
            <div className="mt-1">Snapshots <strong className="ml-2">{data.launch.consecutiveSnapshotsFound}/{data.launch.consecutiveSnapshotsRequired}</strong></div>
          </div>
        </div>
        {failedChecks.length > 0 && (
          <div className="mt-5 grid gap-2 md:grid-cols-2 xl:grid-cols-3">
            {failedChecks.map((check) => (
              <div className="rounded-md border border-white/10 bg-black/20 px-3 py-3" key={check.code}>
                <div className={`text-xs font-semibold ${check.critical ? "text-amber-300" : "text-slate-400"}`}>{check.code.replaceAll("_", " ")}</div>
                <div className="mt-1 text-sm text-slate-300">{check.message}</div>
              </div>
            ))}
          </div>
        )}
      </section>

      <section className="mt-5 grid gap-3 sm:grid-cols-2 xl:grid-cols-6">
        <MetricCard label="Actionable tracked" value={String(data.report.summary.tracked)} detail={`${data.report.summary.pending} pending`} tone="cyan" />
        <MetricCard label="Record" value={`${data.report.summary.wins}-${data.report.summary.losses}`} detail={`${data.report.summary.pushes} pushes · ${data.report.summary.voids} void`} tone="green" />
        <MetricCard label="Hit rate" value={percent(data.report.summary.hitRate)} detail="Pushes excluded" tone="blue" />
        <MetricCard label="Net units" value={signed(data.report.summary.units, 2)} detail={`${data.report.summary.riskedUnits.toFixed(1)}u risked`} tone={data.report.summary.units >= 0 ? "green" : "rose"} />
        <MetricCard label="ROI" value={percent(data.report.summary.roi)} detail="Locked odds only" tone={Number(data.report.summary.roi) >= 0 ? "green" : "rose"} />
        <MetricCard label="Avg CLV" value={probabilityPoints(data.report.summary.averageClvProbabilityDelta)} detail="Same line, same book" tone="violet" />
      </section>

      <section className="mt-5 grid gap-5 xl:grid-cols-[1fr_1fr_1.2fr]">
        <Breakdown title="By market" rows={data.report.byMarket} />
        <Breakdown title="By grade" rows={data.report.byGrade} />
        <div className="rounded-lg border border-slate-800 bg-[#0d1a2b] p-5">
          <h2 className="text-sm font-semibold">Operations</h2>
          <dl className="mt-4 grid grid-cols-2 gap-x-4 gap-y-3 text-sm">
            <Stat label="Ledger" value={data.health.tableAvailable ? "Available" : "Unavailable"} />
            <Stat label="Tracking job" value={data.health.enabled ? "Enabled" : "Disabled"} />
            <Stat label="Settlement job" value={data.health.settlementEnabled ? "Enabled" : "Disabled"} />
            <Stat label="Total entries" value={String(data.health.totalEntries)} />
            <Stat label="Pending results" value={String(data.health.pendingEntries)} />
            <Stat label="Last lock" value={shortDateTime(data.health.latestLockedAt)} />
          </dl>
          {data.launch.latestSnapshot && (
            <div className="mt-5 border-t border-slate-800 pt-4 text-sm text-slate-400">
              Latest board: {data.launch.latestSnapshot.props} rows from {data.launch.latestSnapshot.sourceRows} quotes across {data.launch.latestSnapshot.games} games and {data.launch.latestSnapshot.books} books. Age {data.launch.latestSnapshot.ageMinutes.toFixed(1)}m.
            </div>
          )}
        </div>
      </section>

      <section className="mt-5 overflow-hidden rounded-lg border border-slate-800 bg-[#0d1a2b]">
        <div className="flex flex-wrap items-end justify-between gap-3 border-b border-slate-800 px-5 py-4">
          <div><h2 className="font-semibold">Immutable prop ledger</h2><p className="mt-1 text-sm text-slate-400">One fixed pregame decision per player, game, and modeled market.</p></div>
          <div className="text-xs text-slate-500">Since {data.report.startDate}</div>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full min-w-[1180px] text-left text-sm">
            <thead className="bg-[#091524] text-xs uppercase text-slate-500">
              <tr><Th>Date</Th><Th>Player / matchup</Th><Th>Prop</Th><Th>Lock</Th><Th>Model</Th><Th>Close</Th><Th>CLV</Th><Th>Result</Th></tr>
            </thead>
            <tbody className="divide-y divide-slate-800">
              {data.report.recent.map((row) => <LedgerRow key={row.id} row={row} />)}
              {data.report.recent.length === 0 && <tr><td className="px-5 py-12 text-center text-slate-500" colSpan={8}>No props have reached the lock window yet.</td></tr>}
            </tbody>
          </table>
        </div>
      </section>
    </>
  );
}

function MetricCard({ label, value, detail, tone }: { label: string; value: string; detail: string; tone: string }) {
  const colors: Record<string, string> = { cyan: "text-cyan-300", green: "text-emerald-300", blue: "text-sky-300", rose: "text-rose-300", violet: "text-violet-300" };
  return <div className="rounded-lg border border-slate-800 bg-[#0d1a2b] p-4"><div className="text-xs uppercase text-slate-500">{label}</div><div className={`mt-2 text-2xl font-semibold ${colors[tone] ?? "text-white"}`}>{value}</div><div className="mt-1 text-xs text-slate-500">{detail}</div></div>;
}

function Breakdown({ title, rows }: { title: string; rows: Array<{ key: string } & Metrics> }) {
  return <div className="rounded-lg border border-slate-800 bg-[#0d1a2b] p-5"><h2 className="text-sm font-semibold">{title}</h2><div className="mt-3 divide-y divide-slate-800">{rows.map((row) => <div className="grid grid-cols-[1fr_auto_auto] gap-4 py-3 text-sm" key={row.key}><span>{labelFor(row.key)}</span><span className="text-slate-400">{row.wins}-{row.losses}</span><span className="w-14 text-right font-medium">{percent(row.hitRate)}</span></div>)}{rows.length === 0 && <div className="py-8 text-center text-sm text-slate-500">Awaiting locked results</div>}</div></div>;
}

function Stat({ label, value }: { label: string; value: string }) { return <div><dt className="text-xs text-slate-500">{label}</dt><dd className="mt-1 font-medium text-slate-200">{value}</dd></div>; }
function Th({ children }: { children: ReactNode }) { return <th className="px-5 py-3 font-semibold">{children}</th>; }

function LedgerRow({ row }: { row: RecentRow }) {
  return (
    <tr className="hover:bg-white/[0.02]">
      <td className="px-5 py-4 text-slate-400"><div>{row.slateDate}</div><div className="mt-1 text-xs">{time(row.gameStartTimestamp)}</div></td>
      <td className="px-5 py-4"><div className="font-medium">{row.player}</div><div className="mt-1 text-xs text-slate-500">{row.team} vs {row.opponent} · {row.cohort === "actionable" ? "Actionable" : "Observation"}</div></td>
      <td className="px-5 py-4"><div>{labelFor(row.market)}</div><div className="mt-1 text-xs text-slate-500">{row.side.toUpperCase()} {row.line}</div></td>
      <td className="px-5 py-4"><div>{american(row.lockedOdds)} · {row.sportsbook}</div><div className="mt-1 text-xs text-slate-500">{row.grade.replaceAll("_", " ")} · {row.stakeUnits.toFixed(1)}u</div></td>
      <td className="px-5 py-4"><div>{percent(row.finalProbability)}</div><div className="mt-1 text-xs text-slate-500">Edge {probabilityPoints(row.edge)}</div></td>
      <td className="px-5 py-4"><div>{row.closingOdds === null ? "Pending" : `${american(row.closingOdds)} · ${row.closingLine}`}</div><div className="mt-1 text-xs text-slate-500">{row.clvStatus.replaceAll("_", " ")}</div></td>
      <td className={`px-5 py-4 font-medium ${(row.clvProbabilityDelta ?? 0) > 0 ? "text-emerald-300" : (row.clvProbabilityDelta ?? 0) < 0 ? "text-rose-300" : "text-slate-400"}`}>{probabilityPoints(row.clvProbabilityDelta)}</td>
      <td className="px-5 py-4"><div className={resultColor(row.resultStatus)}>{row.resultStatus.toUpperCase()}</div><div className="mt-1 text-xs text-slate-500">{row.resultValue === null ? "" : `Final ${row.resultValue} · `}{row.resultUnits === null ? "" : `${signed(row.resultUnits, 2)}u`}</div></td>
    </tr>
  );
}

function percent(value: number | null) { return value === null ? "--" : `${(value * 100).toFixed(1)}%`; }
function probabilityPoints(value: number | null) { return value === null ? "--" : `${value >= 0 ? "+" : ""}${(value * 100).toFixed(1)} pp`; }
function signed(value: number, digits: number) { return `${value >= 0 ? "+" : ""}${value.toFixed(digits)}`; }
function american(value: number) { return value > 0 ? `+${value}` : String(value); }
function shortDateTime(value: string | null) { return value ? new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" }).format(new Date(value)) : "None yet"; }
function time(value: string) { return new Intl.DateTimeFormat("en-US", { hour: "numeric", minute: "2-digit" }).format(new Date(value)); }
function labelFor(value: string) { return value.replace(/^pitcher_/, "Pitcher ").replaceAll("_", " ").replace(/\b\w/g, (character) => character.toUpperCase()); }
function resultColor(status: string) { return status === "win" ? "font-semibold text-emerald-300" : status === "loss" ? "font-semibold text-rose-300" : status === "pending" ? "text-amber-300" : "text-slate-300"; }
