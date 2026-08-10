"use client";

import { useEffect, useState } from "react";
import { MarketingDailyEdgePreviewSurface } from "../lab/components/daily-edge/DailyEdgeShell";

type MarketingMoneylineGame = {
  id: string;
  away: string;
  home: string;
  time: string;
  pick: string;
  price: string;
  grade: "Best Angle" | "Lean" | "Watchlist";
  probability: string;
  awayScore: string;
  homeScore: string;
  open: string;
  prior: string;
  current: string;
  pulse: string;
  publicMoney: number;
  publicTickets: number;
  sharpMoney: number;
  sharpTickets: number;
  note: string;
};

const MARKETING_MONEYLINE_GAMES: MarketingMoneylineGame[] = [
  {
    id: "bos-nyy",
    away: "NYY",
    home: "BOS",
    time: "7:10 PM",
    pick: "BOS",
    price: "-112",
    grade: "Best Angle",
    probability: "57.4%",
    awayScore: "4.1",
    homeScore: "4.8",
    open: "-104",
    prior: "-108",
    current: "-112",
    pulse: "Market supporting read",
    publicMoney: 46,
    publicTickets: 54,
    sharpMoney: 63,
    sharpTickets: 49,
    note: "The model favors Boston while the same-book price trail and sharper-book money support the selected side.",
  },
  {
    id: "lad-sd",
    away: "LAD",
    home: "SD",
    time: "9:40 PM",
    pick: "LAD",
    price: "+105",
    grade: "Lean",
    probability: "53.8%",
    awayScore: "4.6",
    homeScore: "4.2",
    open: "+112",
    prior: "+108",
    current: "+105",
    pulse: "Price moving toward our side",
    publicMoney: 52,
    publicTickets: 58,
    sharpMoney: 61,
    sharpTickets: 47,
    note: "Los Angeles carries the stronger projection, with modest price support but a thinner overall edge.",
  },
  {
    id: "sea-hou",
    away: "SEA",
    home: "HOU",
    time: "8:10 PM",
    pick: "HOU",
    price: "-118",
    grade: "Watchlist",
    probability: "54.1%",
    awayScore: "3.7",
    homeScore: "4.3",
    open: "-124",
    prior: "-120",
    current: "-118",
    pulse: "Market resisting read",
    publicMoney: 57,
    publicTickets: 62,
    sharpMoney: 48,
    sharpTickets: 51,
    note: "Houston remains the model side, but the price has moved against the read and keeps this on the Watchlist.",
  },
];

export function HomepageMoneylinePreview({ compact = false }: { compact?: boolean }) {
  const [selectedId, setSelectedId] = useState(MARKETING_MONEYLINE_GAMES[0].id);
  const game = MARKETING_MONEYLINE_GAMES.find((item) => item.id === selectedId) ?? MARKETING_MONEYLINE_GAMES[0];
  const supporting = game.pulse !== "Market resisting read";

  return (
    <div className="overflow-hidden rounded-xl border border-violet-400/25 bg-[#090a12] text-left shadow-[0_0_70px_rgba(124,58,237,0.16)]">
      <div className="flex items-center justify-between border-b border-white/10 bg-[#070811] px-3 py-2.5 sm:px-4">
        <div className="flex items-center gap-2">
          <span className="h-2 w-2 rounded-full bg-emerald-300" />
          <span className="text-[9px] font-black uppercase tracking-[0.18em] text-white">OddSphere Daily Edge</span>
        </div>
        <span className="text-[8px] font-black uppercase tracking-[0.15em] text-gray-500">Sample slate</span>
      </div>

      <div className="grid grid-cols-3 gap-1.5 border-b border-white/10 p-2 sm:gap-2 sm:p-3" aria-label="Sample Daily Edge games">
        {MARKETING_MONEYLINE_GAMES.map((item) => {
          const selected = item.id === game.id;
          return (
            <button
              key={item.id}
              type="button"
              onClick={() => setSelectedId(item.id)}
              aria-pressed={selected}
              className={`min-w-0 rounded-md border px-2 py-2 text-left transition ${selected ? "border-violet-300/60 bg-violet-500/15 shadow-[0_0_18px_rgba(139,92,246,0.13)]" : "border-white/10 bg-white/[0.025] hover:border-white/20"}`}
            >
              <strong className="block truncate text-[10px] text-white sm:text-xs">{item.away} @ {item.home}</strong>
              <span className="mt-1 block truncate text-[8px] font-bold uppercase tracking-wider text-gray-500">{item.pick} ML · {item.grade}</span>
            </button>
          );
        })}
      </div>

      <div className={`grid gap-px bg-white/10 ${compact ? "md:grid-cols-[0.9fr_1.1fr]" : "lg:grid-cols-[0.8fr_1.2fr_0.9fr]"}`}>
        <section className="bg-[#0d0e17] p-3 sm:p-4">
          <p className="text-[8px] font-black uppercase tracking-[0.18em] text-emerald-300">Moneyline quick read</p>
          <div className="mt-2 flex items-end justify-between gap-3">
            <div>
              <p className="text-[10px] font-bold text-gray-500">{game.away} @ {game.home} · {game.time}</p>
              <p className="mt-1 text-2xl font-black tracking-tight text-white sm:text-3xl">{game.pick} <span className="text-emerald-300">{game.price}</span></p>
            </div>
            <span className={`rounded border px-2 py-1 text-[8px] font-black uppercase ${game.grade === "Best Angle" ? "border-emerald-400/30 bg-emerald-400/10 text-emerald-200" : game.grade === "Lean" ? "border-sky-400/30 bg-sky-400/10 text-sky-200" : "border-amber-400/30 bg-amber-400/10 text-amber-200"}`}>{game.grade}</span>
          </div>
          <div className="mt-3 grid grid-cols-2 gap-2">
            <PreviewMetric label="Model probability" value={game.probability} />
            <PreviewMetric label="Projected score" value={`${game.awayScore}–${game.homeScore}`} />
          </div>
          {!compact ? <p className="mt-3 text-xs leading-5 text-gray-400">{game.note}</p> : null}
        </section>

        <section className="bg-[#0d0e17] p-3 sm:p-4">
          <div className="flex items-center justify-between gap-2">
            <p className="text-[8px] font-black uppercase tracking-[0.18em] text-violet-200">OddSphere Market Pulse</p>
            <span className={`rounded-full px-2 py-1 text-[8px] font-black uppercase ${supporting ? "bg-emerald-400/10 text-emerald-200" : "bg-rose-400/10 text-rose-200"}`}>{supporting ? "Supporting" : "Resisting"}</span>
          </div>
          <p className="mt-2 text-sm font-black text-white sm:text-base">{game.pulse}</p>
          <div className="mt-3 grid grid-cols-3 gap-1.5">
            <MovementPoint label="Open" value={game.open} />
            <MovementPoint label="Prior" value={game.prior} />
            <MovementPoint label="Current" value={game.current} active />
          </div>
          <div className="mt-3 h-1.5 overflow-hidden rounded-full bg-gray-800">
            <span className={`block h-full rounded-full ${supporting ? "w-[72%] bg-emerald-400" : "w-[42%] bg-rose-400"}`} />
          </div>
          <p className="mt-2 text-[9px] leading-4 text-gray-500">Same-book Moneyline trail · sample walkthrough</p>
        </section>

        {!compact ? (
          <section className="bg-[#0d0e17] p-3 sm:p-4">
            <p className="text-[8px] font-black uppercase tracking-[0.18em] text-sky-200">Market splits</p>
            <SplitPreview label="Public consensus" money={game.publicMoney} tickets={game.publicTickets} />
            <SplitPreview label="Sharp book" money={game.sharpMoney} tickets={game.sharpTickets} />
            <p className="mt-3 border-t border-white/10 pt-3 text-[9px] leading-4 text-gray-500">Public consensus and sharper-book activity remain separate signals.</p>
          </section>
        ) : null}
      </div>
    </div>
  );
}

function PreviewMetric({ label, value }: { label: string; value: string }) {
  return <div className="rounded-md border border-white/10 bg-black/20 p-2"><span className="block text-[7px] font-black uppercase tracking-wider text-gray-600">{label}</span><strong className="mt-1 block text-sm tabular-nums text-white">{value}</strong></div>;
}

function MovementPoint({ label, value, active = false }: { label: string; value: string; active?: boolean }) {
  return <div className={`rounded-md border p-2 ${active ? "border-emerald-400/25 bg-emerald-400/[0.06]" : "border-white/10 bg-black/20"}`}><span className="block text-[7px] font-black uppercase tracking-wider text-gray-600">{label}</span><strong className={`mt-1 block text-sm tabular-nums ${active ? "text-emerald-200" : "text-white"}`}>{value}</strong></div>;
}

function SplitPreview({ label, money, tickets }: { label: string; money: number; tickets: number }) {
  return <div className="mt-3"><div className="flex items-center justify-between text-[9px]"><strong className="text-gray-300">{label}</strong><span className="text-gray-500">Money {money}% · Tickets {tickets}%</span></div><div className="mt-1.5 flex h-2 overflow-hidden rounded-full bg-gray-800"><span className="h-full bg-emerald-400" style={{ width: `${money}%` }} /><span className="h-full flex-1 bg-violet-400/35" /></div></div>;
}

export function HomepageDashboardPrototype({ candidate = false }: { candidate?: boolean }) {
  const [open, setOpen] = useState(false);

  useEffect(() => {
    if (!open) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") setOpen(false);
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [open]);

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="inline-flex items-center justify-center rounded-lg border border-white/15 bg-white/[0.05] px-7 py-3.5 text-sm font-bold text-white transition hover:border-violet-400/50 hover:bg-white/[0.08] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-violet-300"
      >
        Preview Dashboard
      </button>

      {open ? (
        <div
          className="fixed inset-0 z-50 overflow-y-auto bg-black/90 px-3 py-4 backdrop-blur-md sm:px-6 sm:py-8"
          role="dialog"
          aria-modal="true"
          aria-labelledby="dashboard-preview-title"
        >
          <div className="mx-auto max-w-7xl">
            <div className="mb-3 flex items-center justify-between gap-3">
              <div>
                <p className="text-[10px] font-black uppercase tracking-[0.2em] text-emerald-300">
                  Product preview
                </p>
                <h2 id="dashboard-preview-title" className="mt-1 text-xl font-black tracking-tight text-white sm:text-2xl">
                  Daily Edge reader
                </h2>
                <p className="mt-1 text-xs text-gray-400">
                  {candidate
                    ? "See the redesigned OddSphere reader from the slate-level decision through Market Pulse and supporting evidence."
                    : "This uses the same reader and slate-card components as the member Daily Edge, with safe sample data."}
                </p>
              </div>
              <button
                type="button"
                onClick={() => setOpen(false)}
                className="inline-flex items-center justify-center rounded-lg border border-white/15 bg-white/[0.08] px-4 py-2 text-sm font-bold text-white transition hover:bg-white/[0.12] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-violet-300"
              >
                Close
              </button>
            </div>
            <MarketingDailyEdgePreviewSurface />
          </div>
        </div>
      ) : null}
    </>
  );
}
