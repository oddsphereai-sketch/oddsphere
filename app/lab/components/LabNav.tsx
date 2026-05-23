"use client";

import RefreshIndicator from "./RefreshIndicator";

export type LabSection = "edge" | "props" | "tracking" | "mybets";

type Tab = {
  key: LabSection;
  icon: string;
  label: string;
};

const TABS: Tab[] = [
  { key: "edge", icon: "🎯", label: "Daily Edge" },
  { key: "props", icon: "🎮", label: "Player Props" },
  { key: "tracking", icon: "📈", label: "Tracking" },
  { key: "mybets", icon: "📊", label: "My Bets" },
];

type Props = {
  active: LabSection;
  onChange: (next: LabSection) => void;
};

export default function LabNav({ active, onChange }: Props) {
  return (
    <div className="border-b border-gray-800">
      {/* Top row: tabs + status pill. On mobile the pill stacks under the
          tab row so the dot remains thumb-reachable without horizontal scroll. */}
      <div className="flex flex-col-reverse sm:flex-row sm:items-end sm:justify-between gap-3 sm:gap-4">
        <div className="-mx-4 sm:mx-0 overflow-x-auto sm:overflow-visible">
          <nav
            role="tablist"
            aria-label="Lab section"
            className="flex gap-1 px-4 sm:px-0 sm:gap-2 min-w-max"
          >
            {TABS.map((t) => {
              const isActive = active === t.key;
              return (
                <button
                  key={t.key}
                  type="button"
                  role="tab"
                  aria-selected={isActive}
                  onClick={() => onChange(t.key)}
                  className={`relative inline-flex items-center justify-center gap-2 whitespace-nowrap px-4 py-3 sm:py-4 min-h-12 text-xs sm:text-sm font-bold uppercase tracking-[0.12em] transition-colors ${
                    isActive
                      ? "text-white"
                      : "text-gray-400 hover:text-violet-300"
                  }`}
                >
                  <span aria-hidden="true" className="text-base">
                    {t.icon}
                  </span>
                  <span>{t.label}</span>
                  {isActive && (
                    <span
                      aria-hidden="true"
                      className="absolute inset-x-3 sm:inset-x-6 -bottom-px h-[3px] bg-violet-400 shadow-[0_0_10px_rgba(167,139,250,0.7)] rounded-full"
                    />
                  )}
                </button>
              );
            })}
          </nav>
        </div>

        <div className="px-4 sm:px-0 sm:pb-3 self-start sm:self-end">
          <RefreshIndicator />
        </div>
      </div>
    </div>
  );
}
