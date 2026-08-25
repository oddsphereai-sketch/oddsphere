import Link from "next/link";

export function PlayerPropsLeaguePills({ league, nflEnabled = false, reviewMode = false }: { league: "mlb" | "nfl"; nflEnabled?: boolean; reviewMode?: boolean }) {
  return <div className="mx-auto flex max-w-7xl items-center gap-2 px-4 pt-6 sm:px-6 lg:px-8" aria-label="Player props league">
    <Link href={reviewMode ? "/dev/mlb-props-preview" : "/mlb/props"} aria-current={league === "mlb" ? "page" : undefined} className={pill(league === "mlb")}>MLB</Link>
    {nflEnabled && <Link href={reviewMode ? "/dev/nfl-props-preview" : "/player-props?league=nfl"} aria-current={league === "nfl" ? "page" : undefined} className={pill(league === "nfl")}>NFL</Link>}
  </div>;
}

function pill(active: boolean): string { return `rounded-full border px-4 py-2 text-xs font-black uppercase tracking-[0.16em] transition-colors ${active ? "border-violet-400 bg-violet-400/15 text-white" : "border-gray-700 bg-gray-900/60 text-gray-400 hover:border-gray-500 hover:text-white"}`; }
