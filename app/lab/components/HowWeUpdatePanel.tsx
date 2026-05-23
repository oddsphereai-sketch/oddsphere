"use client";

/**
 * HowWeUpdatePanel — collapsible educational panel describing the cron
 * schedule in plain English. Lives at the bottom of the Daily Edge view.
 *
 * Static content — no data fetch. Brand voice: "we update X at Y because Z."
 * No marketing fluff, no jargon. The RefreshIndicator in the navbar carries
 * the live status; this panel explains what those refreshes actually do.
 */

import { useState } from "react";
import Icon from "./Icon";

type Refresh = {
  time: string;
  title: string;
  body: string;
};

const REFRESHES: Refresh[] = [
  {
    time: "8am ET",
    title: "Morning slate refresh",
    body: "Load tonight's games and probable pitchers. Pull opening lines from Pinnacle as the de-vig reference, plus DraftKings, FanDuel, and BetMGM for best-price comparison.",
  },
  {
    time: "12pm ET",
    title: "Midday refresh",
    body: "Re-pull lines and scan for sharp movement — steam moves, reverse line movement, divergence between public bets and public money.",
  },
  {
    time: "4pm ET",
    title: "Afternoon refresh",
    body: "Last full lineup + weather pull before games. We rerun the prop model with confirmed lineups so cards reflect who is actually playing.",
  },
  {
    time: "7pm ET",
    title: "Evening refresh",
    body: "Final sweep before first pitch. Closing-line snapshot for the day's predictions so we can measure CLV against where the market closed.",
  },
  {
    time: "Every 30 min · 6–10pm ET",
    title: "Lineup watch",
    body: "Catch confirmed lineups as they post. A late scratch can flip a prop from premium to skip — we re-grade as soon as the lineup is official.",
  },
  {
    time: "Every 15 min · within 90 min of first pitch",
    title: "Pre-game sweep",
    body: "Tight loop on lines + signals. This is when sharp money typically arrives. Cards update in place; the RefreshIndicator turns amber while a sweep is running.",
  },
  {
    time: "1am ET",
    title: "Post-game results",
    body: "Resolve outcomes for every prediction. Update the Tracking page, mark CLV, and feed the calibration system. Every result is logged before the next morning slate runs.",
  },
  {
    time: "Mondays · 4am ET",
    title: "Weekly park-factor refresh",
    body: "Pull updated park factors from FanGraphs. Park geometry, altitude, and historical run environment all feed into the prop model.",
  },
  {
    time: "Sundays · 3am ET",
    title: "Weekly calibration",
    body: "Recompute calibration buckets from the prior week's resolved predictions. This is how we know our 60% confidence picks actually hit 57% — and we show you that delta on the Tracking page.",
  },
];

export default function HowWeUpdatePanel() {
  const [open, setOpen] = useState(false);

  return (
    <section className="max-w-3xl mx-auto mt-10">
      <div className="bg-gradient-to-br from-gray-900/60 to-gray-950/60 border border-gray-800 rounded-xl overflow-hidden">
        <button
          type="button"
          onClick={() => setOpen((v) => !v)}
          aria-expanded={open}
          className="w-full flex items-center justify-between gap-3 px-5 py-4 text-left hover:bg-gray-900/40 transition-colors"
        >
          <div className="min-w-0">
            <h2 className="text-sm sm:text-base font-bold tracking-tight text-white">
              How we keep this page fresh
            </h2>
            <p className="text-xs text-gray-400 mt-0.5">
              Every refresh, every cron, in plain English.
            </p>
          </div>
          <Icon
            name="chevron-down"
            className={`shrink-0 w-4 h-4 text-gray-300 transition-transform duration-200 ${
              open ? "rotate-180" : ""
            }`}
          />
        </button>

        {open && (
          <div className="border-t border-gray-800 px-5 py-5 sm:px-6 sm:py-6">
            <ul className="space-y-4">
              {REFRESHES.map((r) => (
                <li key={r.title}>
                  <div className="flex flex-wrap items-baseline gap-x-3 gap-y-0.5 mb-1">
                    <span className="text-[10px] uppercase tracking-[0.12em] text-violet-300 font-bold whitespace-nowrap">
                      {r.time}
                    </span>
                    <span className="text-sm font-semibold text-white">
                      {r.title}
                    </span>
                  </div>
                  <p className="text-sm text-gray-300 leading-relaxed">
                    {r.body}
                  </p>
                </li>
              ))}
            </ul>

            <p className="mt-6 pt-5 border-t border-gray-800/60 text-xs text-violet-200/80 leading-relaxed italic">
              Every data refresh is logged. The pill in the navbar shows
              real-time status — click it for a per-source breakdown.
            </p>
          </div>
        )}
      </div>
    </section>
  );
}
