import Link from "next/link";
import { SportIcon } from "@/app/lab/components/SportIcon";
import type { Sport } from "@/lib/types/domain/Sport";

export function PlayerPropsLeaguePills({ league, nflEnabled = false, reviewMode = false }: { league: "mlb" | "nfl"; nflEnabled?: boolean; reviewMode?: boolean }) {
  const leagues: Array<{ key: Sport; label: string; href?: string }> = [
    { key: "mlb", label: "MLB", href: reviewMode ? "/dev/mlb-props-preview" : "/mlb/props" },
    { key: "nfl", label: "NFL", href: nflEnabled ? (reviewMode ? "/dev/nfl-props-preview" : "/player-props?league=nfl") : undefined },
    { key: "cfb", label: "CFB" },
    { key: "nba", label: "NBA" },
    { key: "wnba", label: "WNBA" },
    { key: "cbb", label: "CBB" },
    { key: "nhl", label: "NHL" },
    { key: "soccer", label: "Soccer" },
  ];

  return <nav aria-label="Player props leagues" className="-mx-4 mb-5 border-y border-white/[0.05] bg-white/[0.015] px-4 py-2.5 sm:-mx-6 sm:px-6 lg:-mx-8 lg:px-8">
    <div className="flex gap-2 overflow-x-auto pb-1">
      {leagues.map((item) => {
        const active = item.key === league;
        const contents = <><span className={`inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-full ${active ? "bg-violet-500/[0.22] ring-1 ring-violet-400/40" : "bg-white/[0.04] ring-1 ring-white/[0.06]"}`}><SportIcon sport={item.key} active={active} /></span><span className="min-w-0"><strong className={`block text-[11px] uppercase ${active ? "text-white" : "text-gray-300"}`}>{item.label}</strong><span className={`mt-0.5 block text-[9px] ${active ? "text-emerald-300" : item.href ? "text-violet-300" : "text-gray-500"}`}>{active ? "Active" : item.href ? "View props" : "Coming soon"}</span></span></>;
        const className = `inline-flex min-w-[112px] shrink-0 items-center gap-2.5 rounded-lg border px-3 py-2 text-left transition-colors ${active ? "border-violet-400/55 bg-violet-500/[0.14]" : item.href ? "border-white/[0.10] bg-white/[0.025] hover:border-violet-400/40 hover:bg-violet-500/[0.08]" : "cursor-not-allowed border-white/[0.06] bg-white/[0.02] opacity-65"}`;
        return item.href
          ? <Link key={item.key} href={item.href} aria-current={active ? "page" : undefined} aria-label={`${item.label} player props${active ? ", active" : ""}`} className={className}>{contents}</Link>
          : <button key={item.key} type="button" disabled aria-label={`${item.label} player props, coming soon`} className={className}>{contents}</button>;
      })}
    </div>
  </nav>;
}
