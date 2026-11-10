import type { DailyEdgeResponse } from "@/app/lab/lib/labTypes";

export function UclUpcomingSchedule({ schedule }: { schedule: NonNullable<DailyEdgeResponse["uclUpcomingSchedule"]> }) {
  return <section className="rounded-2xl border border-violet-400/20 bg-gray-950/60 p-5 sm:p-6" aria-labelledby="ucl-upcoming-title">
    <p className="text-xs font-bold uppercase tracking-wider text-violet-300">Champions League · Upcoming matchweek</p>
    <h2 id="ucl-upcoming-title" className="mt-2 text-xl font-black text-white">{schedule.games.length} upcoming matches</h2>
    <p className="mt-2 text-sm text-gray-400">The schedule is available. Forecasts are temporarily unavailable while a required data source is offline. Predictions and play grades will appear after a successful refresh.</p>
    <div className="mt-5 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">{schedule.games.map(game => <article key={game.externalId} className="rounded-xl border border-white/10 bg-black/20 p-4">
      <p className="text-xs text-gray-400">{new Intl.DateTimeFormat("en-US", { timeZone: "America/New_York", month: "short", day: "numeric", hour: "numeric", minute: "2-digit", timeZoneName: "short" }).format(new Date(game.gameStartAt))}</p>
      <p className="mt-2 font-bold text-white">{game.homeTeam} <span className="font-normal text-gray-500">vs</span> {game.awayTeam}</p>
      <p className="mt-3 text-xs text-amber-200">Forecast unavailable</p>
    </article>)}</div>
  </section>;
}
