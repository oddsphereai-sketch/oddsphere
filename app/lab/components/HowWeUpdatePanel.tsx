"use client";

/**
 * HowWeUpdatePanel — collapsible educational panel below the Daily Edge.
 *
 * Condensed in 5F.1 from a 9-cron breakdown (too much info for a member
 * scanning the page) to 4 high-level beats. The RefreshIndicator in the
 * navbar carries live status; this panel just explains the cadence so
 * trust is built without overwhelming.
 */

import { useState } from "react";
import Icon from "./Icon";

type Beat = {
  label: string;
  body: string;
};

const BEATS: Beat[] = [
  {
    label: "Lines update throughout the day",
    body: "We pull from Pinnacle (the de-vig reference), DraftKings, FanDuel, BetMGM, and Caesars on a rolling cadence so cards reflect what books are showing right now — including steam moves and reverse line movement.",
  },
  {
    label: "Lineups confirmed pre-game",
    body: "A 30-minute loop watches for confirmed lineups in the 4 hours before first pitch, then a 15-minute sweep covers the final 90 minutes. A late scratch can flip a prop from premium to skip — we re-grade as soon as the lineup is official.",
  },
  {
    label: "Results graded overnight",
    body: "Every prediction is logged before games start and resolved at 1am ET against final scores. No edits, no cherry-picking — what you saw on the card last night is exactly what shows up in tracking this morning.",
  },
  {
    label: "Calibration recomputed weekly",
    body: "Every Sunday we recompute our calibration buckets from the prior week. This is how we know our 60% confidence picks actually hit 57% — and why the Tracking page shows you that delta honestly.",
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
              Four beats, in plain English.
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
              {BEATS.map((b) => (
                <li key={b.label}>
                  <p className="text-sm font-semibold text-white mb-1">
                    {b.label}
                  </p>
                  <p className="text-sm text-gray-300 leading-relaxed">
                    {b.body}
                  </p>
                </li>
              ))}
            </ul>

            <p className="mt-6 pt-5 border-t border-gray-800/60 text-xs text-violet-200/80 leading-relaxed italic">
              Every refresh is logged. The pill in the navbar shows real-time
              status — click it for a per-source breakdown.
            </p>
          </div>
        )}
      </div>
    </section>
  );
}
