"use client";

import Image from "next/image";
import { useEffect, useState } from "react";

type Hotspot = {
  id: string;
  label: string;
  title: string;
  body: string;
  className: string;
};

const hotspots: Hotspot[] = [
  {
    id: "market-tabs",
    label: "Market selector",
    title: "Switch between markets",
    body: "The selected edge lets members move between moneyline, total, and first-inning reads without leaving the card.",
    className: "left-[38%] top-[11%] h-[8%] w-[56%]",
  },
  {
    id: "quick-read",
    label: "Quick Read",
    title: "Quick Read",
    body: "The left rail explains the pick, projected score, model edge, price, grade, and risk note in the same format members see.",
    className: "left-[3%] top-[23%] h-[54%] w-[25%]",
  },
  {
    id: "evidence",
    label: "Supporting Evidence",
    title: "Supporting Evidence",
    body: "The center column shows model probability, market implied probability, price, odds movement, Market Read, and split context.",
    className: "left-[30%] top-[24%] h-[61%] w-[40%]",
  },
  {
    id: "stats",
    label: "Key Stats",
    title: "Key Stats & Notes",
    body: "The right rail adds matchup context, market notes, and risk language so the pick is not just a label.",
    className: "left-[70%] top-[24%] h-[38%] w-[27%]",
  },
  {
    id: "splits",
    label: "Market Pulse",
    title: "Market Pulse · Splits",
    body: "When available, the reader shows Consensus Splits and Sharp Book Splits directly in the card. Unsupported sports do not show empty split sections.",
    className: "left-[30%] top-[64%] h-[32%] w-[39%]",
  },
];

export function HomepageDashboardPrototype() {
  const [open, setOpen] = useState(false);
  const [activeHotspot, setActiveHotspot] = useState<Hotspot>(hotspots[0]);

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
          className="fixed inset-0 z-50 overflow-y-auto bg-black/88 px-3 py-4 backdrop-blur-md sm:px-6 sm:py-8"
          role="dialog"
          aria-modal="true"
          aria-labelledby="dashboard-preview-title"
        >
          <div className="mx-auto max-w-7xl">
            <div className="mb-3 flex items-center justify-between gap-3">
              <div>
                <p className="text-[10px] font-black uppercase tracking-[0.2em] text-emerald-300">
                  Interactive product tour
                </p>
                <h2 id="dashboard-preview-title" className="mt-1 text-xl font-black tracking-tight text-white sm:text-2xl">
                  Daily Edge reader preview
                </h2>
              </div>
              <button
                type="button"
                onClick={() => setOpen(false)}
                className="inline-flex items-center justify-center rounded-lg border border-white/15 bg-white/[0.08] px-4 py-2 text-sm font-bold text-white transition hover:bg-white/[0.12] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-violet-300"
              >
                Close
              </button>
            </div>

            <div className="overflow-hidden rounded-2xl border border-violet-400/35 bg-[#080712] shadow-[0_0_90px_rgba(124,58,237,0.25)]">
              <div className="relative aspect-[1.182/1] bg-black">
                <Image
                  src="/marketing/daily-edge-expanded-reader.jpg"
                  alt="OddSphere Daily Edge selected edge reader"
                  fill
                  priority
                  sizes="min(1280px, 100vw)"
                  className="object-cover"
                />
                {hotspots.map((hotspot) => (
                  <button
                    key={hotspot.id}
                    type="button"
                    aria-label={hotspot.label}
                    onClick={() => setActiveHotspot(hotspot)}
                    className={`absolute rounded-xl border border-transparent bg-transparent transition hover:border-emerald-300/45 hover:bg-emerald-300/[0.06] focus-visible:border-emerald-200 focus-visible:bg-emerald-300/[0.08] focus-visible:outline-none ${hotspot.className}`}
                  />
                ))}
              </div>
            </div>

            <div className="mt-3 rounded-2xl border border-white/10 bg-gray-950/90 p-4 shadow-xl shadow-black/30 sm:flex sm:items-start sm:justify-between sm:gap-5">
              <div>
                <p className="text-[10px] font-black uppercase tracking-[0.18em] text-violet-300">
                  {activeHotspot.label}
                </p>
                <h3 className="mt-1 text-lg font-black text-white">{activeHotspot.title}</h3>
                <p className="mt-2 max-w-3xl text-sm leading-relaxed text-gray-300">{activeHotspot.body}</p>
              </div>
              <div className="mt-4 flex flex-wrap gap-2 sm:mt-0 sm:justify-end">
                {hotspots.map((hotspot) => (
                  <button
                    key={`chip-${hotspot.id}`}
                    type="button"
                    onClick={() => setActiveHotspot(hotspot)}
                    className={`rounded-full border px-3 py-1.5 text-xs font-black uppercase tracking-[0.1em] transition ${
                      activeHotspot.id === hotspot.id
                        ? "border-emerald-300/40 bg-emerald-300/12 text-emerald-200"
                        : "border-white/10 bg-white/[0.04] text-gray-300 hover:border-violet-300/40"
                    }`}
                  >
                    {hotspot.label}
                  </button>
                ))}
              </div>
            </div>
          </div>
        </div>
      ) : null}
    </>
  );
}
