"use client";

import type { Sport } from "../data/mockData";
import { PROP_TYPE_META } from "../data/mockData";

type Props = {
  sport: Sport;
  active: string;
  onChange: (next: string) => void;
};

export default function PropTabs({ sport, active, onChange }: Props) {
  const tabs = Object.keys(PROP_TYPE_META[sport]);
  if (tabs.length === 0) return null;

  return (
    <div className="-mx-4 sm:mx-0 overflow-x-auto">
      <div
        role="tablist"
        aria-label="Prop type"
        className="flex gap-2 px-4 sm:px-0 pb-2 sm:pb-0 sm:gap-3 min-w-max sm:min-w-0"
      >
        {tabs.map((key) => {
          const meta = PROP_TYPE_META[sport][key];
          const isActive = active === key;
          return (
            <button
              key={key}
              role="tab"
              type="button"
              aria-selected={isActive}
              onClick={() => onChange(key)}
              className={`inline-flex sm:flex-1 items-center justify-center gap-2 whitespace-nowrap rounded-lg px-4 py-3 text-sm font-semibold transition-all duration-200 min-h-12 ${
                isActive
                  ? "bg-violet-600/20 border border-violet-500 text-white shadow-[0_0_20px_rgba(167,139,250,0.25)]"
                  : "bg-gray-900/60 border border-gray-800 text-gray-300 hover:text-white hover:border-violet-500/40 hover:bg-gray-800/60"
              }`}
            >
              <span aria-hidden="true">{meta.icon}</span>
              <span>{meta.label}</span>
            </button>
          );
        })}
      </div>
    </div>
  );
}
