"use client";

import { useEffect, useMemo, useState } from "react";

type PreviewMarket = "MLB" | "WNBA" | "World Cup";

type PreviewPick = {
  id: string;
  sport: PreviewMarket;
  game: string;
  market: string;
  pick: string;
  grade: "Best Angle" | "Lean" | "Watchlist" | "Caution" | "No Play";
  price: string;
  modelProbability: string;
  marketProbability: string;
  edge: string;
  projected: string;
  quickRead: string;
  marketRead: string;
  supportingEvidence: string;
  riskNote: string;
  oddsMove: [string, string, string];
  pulse: Array<{ label: string; value: string; tone?: "good" | "warn" | "muted" }>;
};

const previewPicks: PreviewPick[] = [
  {
    id: "mlb-ml",
    sport: "MLB",
    game: "NYM @ TOR",
    market: "Moneyline",
    pick: "NYM ML",
    grade: "Best Angle",
    price: "-104",
    modelProbability: "56%",
    marketProbability: "46%",
    edge: "+10.0 pp",
    projected: "NYM 5.0 · TOR 4.0",
    quickRead: "Strong model/value case with market movement improving toward the pick.",
    marketRead: "Consensus is balanced, while sharper money and price movement both lean toward NYM.",
    supportingEvidence: "The model sits above market implied probability at a playable price, with movement from plus money into a stronger current number.",
    riskNote: "Late lineup or price movement can tighten the edge.",
    oddsMove: ["+106", "-101", "-104"],
    pulse: [
      { label: "Consensus", value: "Balanced", tone: "muted" },
      { label: "Sharp Book", value: "Money support", tone: "good" },
      { label: "Movement", value: "Toward pick", tone: "good" },
    ],
  },
  {
    id: "mlb-total",
    sport: "MLB",
    game: "ATL @ WSH",
    market: "Total",
    pick: "Over 8.5",
    grade: "Lean",
    price: "-112",
    modelProbability: "57%",
    marketProbability: "52%",
    edge: "+5.0 pp",
    projected: "ATL 5.1 · WSH 4.6",
    quickRead: "Projection clears the number, but the edge is not clean enough for a top-tier grade.",
    marketRead: "The total has projection support, while market confirmation is mixed enough to keep this as a Lean.",
    supportingEvidence: "Projected scoring lands above 8.5 and the price remains playable, but the read still needs market support to be cleaner.",
    riskNote: "A worse number would move this closer to Watchlist.",
    oddsMove: ["-105", "-110", "-112"],
    pulse: [
      { label: "Projection", value: "Over support", tone: "good" },
      { label: "Consensus", value: "Slight support", tone: "good" },
      { label: "Movement", value: "Mild resistance", tone: "warn" },
    ],
  },
  {
    id: "wnba-spread",
    sport: "WNBA",
    game: "MIN @ NY",
    market: "Spread",
    pick: "MIN +1.5",
    grade: "Lean",
    price: "-108",
    modelProbability: "59%",
    marketProbability: "53%",
    edge: "+6.0 pp",
    projected: "MIN 87.0 · NY 83.8",
    quickRead: "The model likes the underdog spread at a playable price.",
    marketRead: "Consensus context is supportive enough, and price keeps the spread actionable.",
    supportingEvidence: "The projection favors MIN by more than the listed spread, creating a clear model edge at the current number.",
    riskNote: "Injury or rotation news can matter more in WNBA markets.",
    oddsMove: ["+2.5", "+2.0", "+1.5"],
    pulse: [
      { label: "Consensus", value: "MIN support", tone: "good" },
      { label: "Price", value: "Playable", tone: "good" },
      { label: "Movement", value: "Toward pick", tone: "good" },
    ],
  },
  {
    id: "wc-total",
    sport: "World Cup",
    game: "BEL @ BRA",
    market: "Total",
    pick: "Over 2.5",
    grade: "Watchlist",
    price: "+112",
    modelProbability: "54%",
    marketProbability: "47%",
    edge: "+7.0 pp",
    projected: "BEL 1.4 · BRA 1.6",
    quickRead: "The model sees value, but match-result volatility keeps this below action.",
    marketRead: "Price movement helps the Over, though the soccer context is not strong enough to upgrade beyond Watchlist.",
    supportingEvidence: "The price is attractive and the projected total clears 2.5, but confirmation is lighter than a cleaner play.",
    riskNote: "Game state and draw risk can slow the match down.",
    oddsMove: ["+122", "+116", "+112"],
    pulse: [
      { label: "Price", value: "Plus value", tone: "good" },
      { label: "Movement", value: "Toward Over", tone: "good" },
      { label: "Context", value: "Volatile", tone: "warn" },
    ],
  },
];

const sportTabs: PreviewMarket[] = ["MLB", "WNBA", "World Cup"];

function gradeClasses(grade: PreviewPick["grade"]): string {
  if (grade === "Best Angle") return "border-emerald-400/35 bg-emerald-400/12 text-emerald-200";
  if (grade === "Lean") return "border-violet-400/35 bg-violet-400/12 text-violet-100";
  if (grade === "Watchlist") return "border-amber-300/35 bg-amber-300/12 text-amber-100";
  if (grade === "Caution") return "border-yellow-400/35 bg-yellow-400/12 text-yellow-100";
  return "border-white/15 bg-white/[0.04] text-gray-300";
}

export function HomepageDashboardPrototype() {
  const [open, setOpen] = useState(false);
  const [sport, setSport] = useState<PreviewMarket>("MLB");
  const [selectedId, setSelectedId] = useState(previewPicks[0].id);

  const visiblePicks = useMemo(
    () => previewPicks.filter((pick) => pick.sport === sport),
    [sport],
  );
  const selected =
    previewPicks.find((pick) => pick.id === selectedId && pick.sport === sport) ??
    visiblePicks[0] ??
    previewPicks[0];

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
        <div className="fixed inset-0 z-50 overflow-y-auto bg-black/82 px-3 py-4 backdrop-blur-md sm:px-6 sm:py-8" role="dialog" aria-modal="true" aria-labelledby="dashboard-preview-title">
          <div className="mx-auto max-w-6xl overflow-hidden rounded-2xl border border-violet-400/30 bg-[#080712] shadow-[0_0_90px_rgba(124,58,237,0.25)]">
            <div className="flex flex-col gap-4 border-b border-white/10 bg-white/[0.035] px-4 py-4 sm:flex-row sm:items-center sm:justify-between sm:px-5">
              <div>
                <p className="text-[10px] font-black uppercase tracking-[0.2em] text-emerald-300">Interactive product tour</p>
                <h2 id="dashboard-preview-title" className="mt-1 text-xl font-black tracking-tight text-white sm:text-2xl">
                  Daily Edge preview
                </h2>
                <p className="mt-1 text-xs text-gray-400">
                  Uses illustrative data to show how the member dashboard works.
                </p>
              </div>
              <button
                type="button"
                onClick={() => setOpen(false)}
                className="inline-flex items-center justify-center rounded-lg border border-white/15 bg-white/[0.06] px-4 py-2 text-sm font-bold text-white transition hover:bg-white/[0.1] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-violet-300"
              >
                Close
              </button>
            </div>

            <div className="grid min-h-[660px] lg:grid-cols-[0.38fr_0.62fr]">
              <aside className="border-b border-white/10 p-4 lg:border-b-0 lg:border-r lg:p-5">
                <div className="flex gap-2 overflow-x-auto pb-1">
                  {sportTabs.map((tab) => (
                    <button
                      key={tab}
                      type="button"
                      onClick={() => {
                        setSport(tab);
                        setSelectedId(previewPicks.find((pick) => pick.sport === tab)?.id ?? previewPicks[0].id);
                      }}
                      className={`shrink-0 rounded-full border px-4 py-2 text-xs font-black uppercase tracking-[0.12em] transition ${
                        sport === tab
                          ? "border-emerald-400/35 bg-emerald-400/12 text-emerald-200"
                          : "border-white/10 bg-white/[0.04] text-gray-300 hover:border-violet-300/40"
                      }`}
                    >
                      {tab}
                    </button>
                  ))}
                </div>

                <div className="mt-5">
                  <div className="mb-3 flex items-center justify-between gap-3">
                    <p className="text-[10px] font-black uppercase tracking-[0.18em] text-violet-300">Slate board</p>
                    <span className="rounded-full border border-white/10 bg-white/[0.04] px-2.5 py-1 text-[10px] font-bold text-gray-300">
                      {visiblePicks.length} reads
                    </span>
                  </div>
                  <div className="space-y-3">
                    {visiblePicks.map((pick) => (
                      <button
                        key={pick.id}
                        type="button"
                        onClick={() => setSelectedId(pick.id)}
                        className={`w-full rounded-xl border p-4 text-left transition ${
                          selected.id === pick.id
                            ? "border-emerald-400/35 bg-emerald-400/[0.075]"
                            : "border-white/10 bg-white/[0.035] hover:border-violet-400/35"
                        }`}
                      >
                        <div className="flex items-start justify-between gap-3">
                          <div>
                            <p className="text-[10px] font-black uppercase tracking-[0.16em] text-gray-500">{pick.game}</p>
                            <p className="mt-1 text-lg font-black text-white">{pick.pick}</p>
                            <p className="mt-1 text-xs font-semibold text-gray-400">{pick.market} · {pick.price}</p>
                          </div>
                          <span className={`rounded-full border px-2.5 py-1 text-[10px] font-black uppercase tracking-[0.1em] ${gradeClasses(pick.grade)}`}>
                            {pick.grade}
                          </span>
                        </div>
                        <p className="mt-3 text-xs font-semibold text-gray-300">
                          {pick.modelProbability} model · {pick.edge} edge
                        </p>
                      </button>
                    ))}
                  </div>
                </div>
              </aside>

              <section className="p-4 sm:p-5">
                <div className="rounded-2xl border border-emerald-400/25 bg-emerald-400/[0.065] p-4">
                  <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
                    <div>
                      <p className="text-[10px] font-black uppercase tracking-[0.18em] text-emerald-200">Selected Edge</p>
                      <h3 className="mt-1 text-3xl font-black tracking-tight text-white">{selected.pick}</h3>
                      <p className="mt-1 text-xs font-black uppercase tracking-[0.14em] text-gray-400">{selected.game} · {selected.market}</p>
                    </div>
                    <span className={`w-fit rounded-full border px-3 py-1.5 text-xs font-black uppercase tracking-[0.12em] ${gradeClasses(selected.grade)}`}>
                      {selected.grade}
                    </span>
                  </div>
                  <p className="mt-4 max-w-2xl text-sm leading-relaxed text-gray-200">
                    {selected.quickRead}
                  </p>
                  <div className="mt-4 grid gap-2 sm:grid-cols-3">
                    {[
                      ["Model", selected.modelProbability],
                      ["Market", selected.marketProbability],
                      ["Edge", selected.edge],
                    ].map(([label, value]) => (
                      <div key={label} className="rounded-lg border border-white/10 bg-gray-950/55 p-3">
                        <p className="text-[9px] font-black uppercase tracking-[0.12em] text-gray-500">{label}</p>
                        <p className="mt-1 text-xl font-black tabular-nums text-white">{value}</p>
                      </div>
                    ))}
                  </div>
                </div>

                <div className="mt-4 grid gap-4 xl:grid-cols-[0.95fr_1.05fr]">
                  <div className="rounded-xl border border-white/10 bg-white/[0.035] p-4">
                    <p className="text-[10px] font-black uppercase tracking-[0.18em] text-violet-300">Odds Move</p>
                    <div className="mt-4 grid grid-cols-[1fr_auto_1fr_auto_1fr] items-center gap-2 text-center">
                      {selected.oddsMove.map((odd, index) => (
                        <div key={`${selected.id}-${odd}-${index}`} className="contents">
                          <div>
                            <p className="text-lg font-black tabular-nums text-white">{odd}</p>
                            <p className="mt-1 text-[9px] font-black uppercase tracking-[0.12em] text-gray-500">
                              {index === 0 ? "First" : index === 1 ? "Move" : "Current"}
                            </p>
                          </div>
                          {index < 2 ? <span className="text-gray-600">→</span> : null}
                        </div>
                      ))}
                    </div>
                  </div>

                  <div className="rounded-xl border border-white/10 bg-white/[0.035] p-4">
                    <p className="text-[10px] font-black uppercase tracking-[0.18em] text-violet-300">Market Pulse</p>
                    <div className="mt-4 space-y-2">
                      {selected.pulse.map((item) => (
                        <p key={item.label} className="flex items-center justify-between gap-4 text-sm">
                          <span className="text-gray-400">{item.label}</span>
                          <span className={
                            item.tone === "good"
                              ? "font-bold text-emerald-300"
                              : item.tone === "warn"
                                ? "font-bold text-amber-200"
                                : "font-bold text-gray-200"
                          }>
                            {item.value}
                          </span>
                        </p>
                      ))}
                    </div>
                  </div>
                </div>

                <div className="mt-4 grid gap-4 xl:grid-cols-2">
                  <div className="rounded-xl border border-white/10 bg-white/[0.035] p-4">
                    <p className="text-[10px] font-black uppercase tracking-[0.18em] text-violet-300">Market Read</p>
                    <p className="mt-3 text-sm leading-relaxed text-gray-200">{selected.marketRead}</p>
                  </div>
                  <div className="rounded-xl border border-white/10 bg-white/[0.035] p-4">
                    <p className="text-[10px] font-black uppercase tracking-[0.18em] text-violet-300">Projection</p>
                    <p className="mt-3 text-lg font-black text-white">{selected.projected}</p>
                    <p className="mt-2 text-sm leading-relaxed text-gray-400">Projection context is paired with current price and market movement.</p>
                  </div>
                </div>

                <div className="mt-4 rounded-xl border border-white/10 bg-white/[0.035] p-4">
                  <p className="text-[10px] font-black uppercase tracking-[0.18em] text-violet-300">Supporting Evidence</p>
                  <p className="mt-3 text-sm leading-relaxed text-gray-200">{selected.supportingEvidence}</p>
                  <div className="mt-4 rounded-lg border border-amber-300/20 bg-amber-300/[0.06] p-3 text-sm leading-relaxed text-amber-50">
                    {selected.riskNote}
                  </div>
                </div>
              </section>
            </div>
          </div>
        </div>
      ) : null}
    </>
  );
}
