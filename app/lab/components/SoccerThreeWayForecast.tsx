import type {DailyEdgeGameDto, MarketEdgeDto} from "@/app/lab/lib/labTypes";

function soccerForecastLabel(probability: number): string {
  if (probability >= 0.6) return "Strong model favorite";
  if (probability >= 0.5) return "Model favorite";
  if (probability >= 0.4) return "Open three-way";
  return "Very open three-way";
}

export function SoccerThreeWayForecast({ game, market }: { game: DailyEdgeGameDto; market: MarketEdgeDto }) {
  const context = market.soccerMatchResultContext;
  if (!context) return null;
  const outcomes = [
    { key: "away" as const, label: game.awayTeam },
    { key: "draw" as const, label: "Draw" },
    { key: "home" as const, label: game.homeTeam },
  ];
  const favoriteProbability = context.model[context.displayed_side];
  const forecastLabel = soccerForecastLabel(favoriteProbability);
  return <section className="mt-3 rounded-lg border border-sky-400/15 bg-sky-400/[0.035] p-3"><div className="flex flex-wrap items-start justify-between gap-2"><div><p className="text-[8px] font-black uppercase tracking-[0.15em] text-sky-200">Outcome confidence · three-way win outlook</p><p className="mt-1 text-[11px] font-black text-white">{forecastLabel}</p></div><span className="rounded-full border border-white/[0.08] px-2 py-1 text-[7px] font-black uppercase tracking-wider text-gray-400">Separate from Bet grade</span></div><div className="mt-3 grid grid-cols-3 gap-2">{outcomes.map((outcome) => { const selected = outcome.key === context.displayed_side; return <div key={outcome.key} className={`rounded-lg border p-2 text-center ${selected ? "border-sky-300/30 bg-sky-400/[0.09]" : "border-white/[0.07] bg-black/20"}`}><p className="truncate text-[8px] font-black text-gray-400">{outcome.label}</p><p className={`mt-1 font-mono text-base font-black ${selected ? "text-sky-200" : "text-white"}`}>{(context.model[outcome.key] * 100).toFixed(1)}%</p><p className="mt-0.5 text-[7px] text-gray-600">Market {context.market ? `${(context.market[outcome.key] * 100).toFixed(1)}%` : "—"}</p></div>; })}</div></section>;
}

