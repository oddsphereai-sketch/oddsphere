"use client";

import { useEffect, useState } from "react";
import { MarketingDailyEdgePreviewSurface } from "../lab/components/daily-edge/DailyEdgeShell";

export function HomepageDashboardPrototype() {
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
                  This uses the same reader and slate-card components as the member Daily Edge, with safe sample data.
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
