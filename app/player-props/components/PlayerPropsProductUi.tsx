"use client";

import type { ReactNode } from "react";

export type PlayerPropsHeroMetric = {
  label: string;
  value: string;
  tone: "best" | "lean" | "slate";
};

export function PlayerPropsSlateHero({
  eyebrow,
  title,
  description,
  badge,
  status,
  statusDetail,
  metrics,
}: {
  eyebrow: ReactNode;
  title: string;
  description: string;
  badge?: ReactNode;
  status: ReactNode;
  statusDetail: ReactNode;
  metrics: PlayerPropsHeroMetric[];
}) {
  return <div className="overflow-hidden rounded-xl border border-violet-400/20 bg-[radial-gradient(circle_at_top_right,rgba(139,92,246,0.14),transparent_42%),linear-gradient(145deg,#11151d,#090b10_68%)] p-5 sm:p-6">
    <div className="flex flex-wrap items-end justify-between gap-4">
      <div>{badge}<p className="text-[11px] font-bold text-emerald-300">{eyebrow}</p><h1 className="mt-1 text-3xl font-black text-white sm:text-4xl">{title}</h1><p className="mt-2 max-w-2xl text-sm leading-6 text-gray-400">{description}</p></div>
      <div className="rounded-lg border border-white/[0.08] bg-black/25 px-4 py-3 text-right"><p className="text-[9px] font-black uppercase tracking-wider text-gray-600">Board status</p><p className="mt-1 text-sm font-black text-emerald-300">{status}</p><p className="mt-1 text-[10px] text-gray-600">{statusDetail}</p></div>
    </div>
    <div className="mt-5 grid grid-cols-3 gap-2">{metrics.map((metric) => <PlayerPropsSignalMetric key={metric.label} {...metric} />)}</div>
  </div>;
}

export function PlayerPropsSignalMetric({ label, value, tone }: PlayerPropsHeroMetric) {
  const colors = tone === "best" ? "border-emerald-400/25 bg-emerald-400/[0.07] text-emerald-200" : tone === "lean" ? "border-sky-400/25 bg-sky-400/[0.07] text-sky-200" : "border-violet-400/25 bg-violet-400/[0.07] text-violet-200";
  return <div className={`rounded-lg border px-3 py-3 sm:px-4 ${colors}`}><strong className="block text-xl font-black tabular-nums sm:text-2xl">{value}</strong><span className="mt-0.5 block text-[8px] font-black uppercase tracking-wider text-gray-500 sm:text-[9px]">{label}</span></div>;
}

export function PlayerPropsSectionHeading({ eyebrow, title, count, description }: { eyebrow: string; title: string; count?: string; description?: string }) {
  return <div className="flex items-end justify-between gap-4"><div><p className="text-[10px] font-black uppercase text-emerald-300">{eyebrow}</p><h2 className="mt-1 text-2xl font-black text-white">{title}</h2>{description ? <p className="mt-1 max-w-2xl text-xs leading-5 text-gray-500">{description}</p> : null}</div>{count ? <span className="shrink-0 text-xs text-gray-500">{count}</span> : null}</div>;
}

export function PlayerPropsFilterButton({ label, active, onClick }: { label: string; active: boolean; onClick: () => void }) {
  return <button type="button" onClick={onClick} aria-pressed={active} className={`h-8 shrink-0 rounded-md border px-3 text-xs font-bold ${active ? "border-violet-400 bg-violet-500/15 text-violet-100" : "border-gray-800 bg-gray-950 text-gray-500 hover:border-gray-700 hover:text-white"}`}>{label}</button>;
}

export function PlayerPropsRadarCardFrame({ borderColor, background, accentColor, watermark, children }: { borderColor: string; background: string; accentColor: string; watermark?: ReactNode; children: ReactNode }) {
  return <article className="relative h-full w-[min(84vw,340px)] shrink-0 snap-start overflow-hidden rounded-lg border bg-[#0e1218] lg:w-[360px]" style={{ borderColor, boxShadow: `0 0 0 1px ${borderColor}22 inset`, background }}>
    <div className="absolute inset-x-0 top-0 h-0.5" style={{ backgroundColor: accentColor }} />
    {watermark ? <div className="absolute -right-8 top-12 opacity-[0.045]">{watermark}</div> : null}
    <div className="relative p-4">{children}</div>
  </article>;
}
