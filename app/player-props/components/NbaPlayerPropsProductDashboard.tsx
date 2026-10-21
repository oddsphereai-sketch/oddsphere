"use client";

import { useMemo, useState } from "react";
import type {
  NbaPlayerPropsMemberDecision as Row,
  NbaPlayerPropsMemberGrade,
  NbaPlayerPropsMemberSnapshot,
} from "@/lib/services/nba/nbaPlayerPropsProductContract";
import type { NbaPlayerPropsReaderMetric } from "@/lib/services/nba/nbaPlayerPropsReaderContract";
import { PlayerPropReaderDialog } from "./PlayerPropReaderDialog";
import {
  PlayerPropsFilterButton,
  PlayerPropsRadarCardFrame,
  PlayerPropsSectionHeading,
  PlayerPropsSlateHero,
} from "./PlayerPropsProductUi";

type GradeFilter = "All" | NbaPlayerPropsMemberGrade;
type GameSummary = NbaPlayerPropsMemberSnapshot["games"][number] & { reads: number };

export function NbaPlayerPropsProductDashboard({
  snapshot,
  initialSelectedKey = null,
}: {
  snapshot: NbaPlayerPropsMemberSnapshot;
  initialSelectedKey?: string | null;
}) {
  const [selectedGame, setSelectedGame] = useState("all");
  const [grade, setGrade] = useState<GradeFilter>("All");
  const [market, setMarket] = useState("all");
  const [search, setSearch] = useState("");
  const [selectedKey, setSelectedKey] = useState<string | null>(initialSelectedKey);
  const games = useMemo<GameSummary[]>(() => snapshot.games.map((game) => ({
    ...game,
    reads: snapshot.decisions.filter((row) => row.gameId === game.gameId).length,
  })), [snapshot]);
  const markets = useMemo(() => unique(snapshot.decisions.map((row) => row.market)).sort(), [snapshot]);
  const actionables = useMemo(() => snapshot.decisions
    .filter((row) => row.grade === "Best Angle" || row.grade === "Lean")
    .sort(sortRows)
    .slice(0, 8), [snapshot]);
  const rows = useMemo(() => snapshot.decisions.filter((row) => (
    (selectedGame === "all" || row.gameId === selectedGame)
    && (grade === "All" || row.grade === grade)
    && (market === "all" || row.market === market)
    && (!search.trim() || `${row.playerName} ${row.team} ${row.opponent} ${row.market} ${row.sportsbook}`
      .toLowerCase().includes(search.trim().toLowerCase()))
  )).sort(sortRows), [grade, market, search, selectedGame, snapshot]);
  const selected = snapshot.decisions.find((row) => row.decisionKey === selectedKey) ?? null;

  return <div className="w-full pb-10" data-review-surface="nba-player-props" data-product-release={snapshot.productRelease}>
    <aside className="mb-5 border border-amber-400/40 bg-amber-400/[0.08] px-4 py-3 sm:px-5">
      <p className="text-[10px] font-black uppercase text-amber-300">Private founder review · Historical confirmation slate</p>
      <p className="mt-1 max-w-4xl text-sm leading-6 text-amber-50/80">This is real point-in-time model, matchup, and exact-price evidence. It cannot publish, lock, settle, or appear in member navigation.</p>
    </aside>

    <header className="border-b border-gray-800 pb-6">
      <PlayerPropsSlateHero
        badge={<span className="mb-2 inline-flex rounded border border-amber-400/30 px-2 py-1 text-[10px] font-black uppercase text-amber-200">Review only</span>}
        eyebrow={<>NBA · {dateLabel(snapshot.slateDate)}</>}
        title="Player Props"
        description="Start with the strongest qualified reads, compare the exact offered price, then open the market-specific OddSphere research."
        status={<>Snapshot {localTime(snapshot.generatedAt)}</>}
        statusDetail={<>{snapshot.diagnostics.sportsbooks.length} exact-price books · publication disabled</>}
        metrics={[
          { label: "Best angles", value: String(snapshot.diagnostics.bestAngles), tone: "best" },
          { label: "Model leans", value: String(snapshot.diagnostics.leans), tone: "lean" },
          { label: "Slate games", value: String(snapshot.games.length), tone: "slate" },
        ]}
      />
      <GameNavigator games={games} selectedGame={selectedGame} onSelect={(gameId) => { setSelectedGame(gameId); setSelectedKey(null); }} />
    </header>

    <section className="border-b border-gray-800 py-7">
      <PlayerPropsSectionHeading eyebrow="Today’s Radar" title="Qualified model reads" count={`${actionables.length} shown`} description="Forecast direction, exact price, and grade remain one coherent decision." />
      <div className="mt-4 flex snap-x gap-3 overflow-x-auto pb-2">
        {actionables.map((row) => <RadarCard key={row.decisionKey} row={row} onSelect={setSelectedKey} />)}
      </div>
    </section>

    <section className="-mx-4 border-b border-gray-800 bg-[#07090d]/95 px-4 py-5 sm:-mx-6 sm:px-6 lg:-mx-8 lg:px-8">
      <div className="flex flex-col gap-3 lg:flex-row lg:items-center">
        <div className="shrink-0 lg:w-40"><p className="text-[10px] font-black uppercase text-violet-300">Research workspace</p><h2 className="mt-1 text-lg font-black text-white">Explore the board</h2></div>
        <label className="relative block flex-1"><span className="sr-only">Search NBA player props</span><span className="pointer-events-none absolute inset-y-0 left-3 flex items-center text-gray-600">⌕</span><input value={search} onChange={(event) => { setSearch(event.target.value); setSelectedKey(null); }} type="search" placeholder="Search a player, team, market, or sportsbook" className="h-11 w-full rounded-md border border-gray-700 bg-gray-950 pl-9 pr-3 text-sm text-white outline-none placeholder:text-gray-600 focus:border-violet-400" /></label>
        <p className="text-xs text-gray-500"><strong className="text-gray-200">{rows.length}</strong> canonical reads</p>
      </div>
      <div className="mt-3 flex gap-2 overflow-x-auto pb-1"><PlayerPropsFilterButton label="All markets" active={market === "all"} onClick={() => setMarket("all")} />{markets.map((value) => <PlayerPropsFilterButton key={value} label={marketLabel(value)} active={market === value} onClick={() => setMarket(value)} />)}</div>
      <div className="mt-3 flex gap-2 overflow-x-auto border-t border-gray-800 pt-3">{(["All", "Best Angle", "Lean", "Watchlist", "No Play"] as GradeFilter[]).map((value) => <PlayerPropsFilterButton key={value} label={value} active={grade === value} onClick={() => setGrade(value)} />)}</div>
    </section>

    <section className="py-7">
      <PlayerPropsSectionHeading eyebrow="Full board" title="One line. One projection. One read." count={`${rows.length} props`} />
      <div className="mt-4 overflow-hidden rounded-lg border border-gray-800">
        <div className="hidden grid-cols-[1.45fr_1fr_0.8fr_0.9fr_0.8fr_0.65fr] gap-3 border-b border-gray-800 bg-black/30 px-4 py-2 text-[9px] font-black uppercase text-gray-600 md:grid"><span>Player</span><span>Market</span><span>Forecast</span><span>Prediction</span><span>Price</span><span>Grade</span></div>
        {rows.map((row) => <BoardRow key={row.decisionKey} row={row} onSelect={setSelectedKey} />)}
      </div>
    </section>
    {selected ? <PropReader row={selected} onClose={() => setSelectedKey(null)} /> : null}
  </div>;
}

function GameNavigator({ games, selectedGame, onSelect }: { games: GameSummary[]; selectedGame: string; onSelect: (gameId: string) => void }) {
  return <div className="mt-3 flex gap-2 overflow-x-auto pb-1">
    <button type="button" onClick={() => onSelect("all")} aria-pressed={selectedGame === "all"} className={gameButton(selectedGame === "all")}><span className="text-[9px] font-black uppercase text-violet-300">Full slate</span><strong className="mt-1 block text-sm text-white">All {games.length} games</strong></button>
    {games.map((game) => <button key={game.gameId} type="button" onClick={() => onSelect(game.gameId)} aria-pressed={selectedGame === game.gameId} className={gameButton(selectedGame === game.gameId)}><span className="flex items-center justify-between gap-3"><span className="flex gap-1"><TeamBadge team={game.awayTeam} /><TeamBadge team={game.homeTeam} /></span><span className="text-[9px] text-gray-500">{gameTime(game.scheduledStart)}</span></span><strong className="mt-2 block text-sm text-white">{game.awayTeam} @ {game.homeTeam}</strong><span className="mt-2 block text-[9px] text-gray-500">{game.reads} reads</span></button>)}
  </div>;
}

function RadarCard({ row, onSelect }: { row: Row; onSelect: (key: string) => void }) {
  const colors = gradeColors(row.grade);
  return <PlayerPropsRadarCardFrame borderColor={colors.border} background={`linear-gradient(180deg, ${colors.background}, rgba(14,18,24,.98) 44%)`} accentColor={teamColor(row.team)} watermark={<span className="text-[96px] font-black text-white">{row.team}</span>}>
    <div className="flex items-start justify-between gap-3"><span className="text-[10px] font-black uppercase text-violet-300">{marketLabel(row.market)}</span><GradeBadge grade={row.grade} /></div>
    <div className="mt-4 flex items-center gap-3"><TeamBadge team={row.team} large /><div className="min-w-0"><h3 className="truncate text-lg font-black text-white">{row.playerName}</h3><p className="text-[10px] text-gray-500">{row.team} vs {row.opponent}</p></div></div>
    <div className="mt-4 grid grid-cols-3 gap-px overflow-hidden rounded-md border border-gray-800 bg-gray-800"><Metric title="Projection" value={row.projection.toFixed(1)} /><Metric title="Line" value={row.line.toFixed(1)} /><Metric title="Model" value={percent(row.probability)} /></div>
    <div className="mt-4 flex items-end justify-between gap-3"><div><p className="text-[9px] font-black uppercase text-gray-600">OddSphere read</p><strong className="mt-1 block text-xl text-white">{selection(row)}</strong><p className="mt-1 text-[10px] text-gray-500">{book(row.sportsbook)} · {price(row.americanPrice)}</p></div><button type="button" onClick={() => onSelect(row.decisionKey)} className="rounded-md border border-violet-400/40 px-3 py-2 text-[10px] font-black uppercase text-violet-200 hover:bg-violet-400/10">Open reader ↑</button></div>
  </PlayerPropsRadarCardFrame>;
}

function BoardRow({ row, onSelect }: { row: Row; onSelect: (key: string) => void }) {
  return <button type="button" onClick={() => onSelect(row.decisionKey)} className="grid w-full gap-3 border-b border-gray-800 px-4 py-4 text-left last:border-b-0 hover:bg-white/[0.025] md:grid-cols-[1.45fr_1fr_0.8fr_0.9fr_0.8fr_0.65fr] md:items-center">
    <span className="flex min-w-0 items-center gap-3"><TeamBadge team={row.team} /><span className="min-w-0"><strong className="block truncate text-sm text-white">{row.playerName}</strong><span className="text-[10px] text-gray-500">{row.team} vs {row.opponent}</span></span></span>
    <span><span className="block text-[9px] font-black uppercase text-gray-600 md:hidden">Market</span><strong className="text-xs text-gray-300">{marketLabel(row.market)}</strong></span>
    <span><span className="block text-[9px] font-black uppercase text-gray-600 md:hidden">Forecast</span><strong className="text-sm tabular-nums text-white">{row.projection.toFixed(1)}</strong><span className="ml-1 text-[10px] text-gray-600">vs {row.line}</span></span>
    <span className="font-black text-white">{selection(row)}</span>
    <span><strong className="block text-xs text-white">{price(row.americanPrice)}</strong><span className="text-[9px] text-gray-500">{book(row.sportsbook)}</span></span>
    <GradeBadge grade={row.grade} />
  </button>;
}

function PropReader({ row, onClose }: { row: Row; onClose: () => void }) {
  const bestPrices = bestPriceBySide(row.priceLadder);
  return <PlayerPropReaderDialog ariaLabel={`${row.playerName} ${marketLabel(row.market)} prop reader`} title={`${row.playerName} · ${marketLabel(row.market)}`} leading={<TeamBadge team={row.team} large />} onClose={onClose}>
    <div className="p-4 sm:p-6">
      <div className="grid gap-3 rounded-lg border border-gray-800 bg-[#0d1015] p-4 sm:grid-cols-[1.4fr_repeat(3,1fr)] sm:items-center">
        <div><GradeBadge grade={row.grade} /><h3 className="mt-3 text-2xl font-black text-white">{selection(row)}</h3><p className="mt-1 text-xs text-gray-500">{row.team} vs {row.opponent} · {book(row.sportsbook)} {price(row.americanPrice)}</p></div>
        <Metric title="Projection" value={row.projection.toFixed(1)} /><Metric title="Line" value={row.line.toFixed(1)} /><Metric title="Probability" value={percent(row.probability)} />
      </div>
      <div className="mt-5 grid gap-4 lg:grid-cols-3"><EvidencePanel title="Role & minutes" metrics={row.role} /><EvidencePanel title="Recent production" metrics={row.production} /><EvidencePanel title="Matchup" metrics={row.matchup} /></div>
      <div className="mt-5 grid gap-4 lg:grid-cols-2">
        <section className="rounded-lg border border-gray-800 bg-black/20 p-4"><PanelTitle>Price ladder</PanelTitle><div className="mt-3 space-y-2">{row.priceLadder.map((quote, index) => <div key={`${quote.sportsbook}-${quote.side}-${index}`} className="grid grid-cols-[1fr_auto_auto] items-center gap-3 border-b border-gray-800 pb-2 text-xs last:border-b-0 last:pb-0"><strong className="text-gray-200">{book(quote.sportsbook)}</strong><span className={quote.side === row.side ? "text-emerald-300" : "text-gray-500"}>{capitalize(quote.side)} {quote.line}</span><strong className={bestPrices[quote.side] === quote.americanPrice ? "text-emerald-300" : "text-white"}>{price(quote.americanPrice)}</strong></div>)}</div></section>
        <section className="rounded-lg border border-gray-800 bg-black/20 p-4"><PanelTitle>Market confirmation</PanelTitle><ProbabilityBar title="OddSphere forecast" value={row.probability} tone="bg-violet-400" /><div className="mt-4"><ProbabilityBar title="Target-excluded market" value={row.targetExcludedProbability} tone="bg-sky-400" /></div><div className="mt-4 grid grid-cols-2 gap-px overflow-hidden rounded border border-gray-800 bg-gray-800"><Metric title="Other books" value={String(row.targetExcludedBooks)} /><Metric title="Reference books" value={String(row.targetExcludedReferenceBooks)} /></div></section>
      </div>
      {row.movement ? <section className="mt-5 rounded-lg border border-gray-800 bg-black/20 p-4"><PanelTitle>Same-book movement</PanelTitle><p className="mt-2 text-sm text-gray-300">{book(row.movement.sportsbook)} · {row.movement.openingLine} {price(row.movement.openingPrice)} → {row.movement.currentLine} {price(row.movement.currentPrice)}</p></section> : null}
    </div>
  </PlayerPropReaderDialog>;
}

function EvidencePanel({ title, metrics }: { title: string; metrics: readonly NbaPlayerPropsReaderMetric[] }) { return <section className="rounded-lg border border-gray-800 bg-black/20 p-4"><PanelTitle>{title}</PanelTitle><div className="mt-3 space-y-3">{metrics.map((metric) => <div key={metric.key}><div className="flex justify-between gap-3 text-xs"><span className="text-gray-500">{metric.label}</span><strong className="text-gray-100">{metricValue(metric)}</strong></div><div className="mt-1.5 h-1 overflow-hidden rounded-full bg-gray-800"><span className="block h-full rounded-full bg-violet-400" style={{ width: `${metricWidth(metric)}%` }} /></div></div>)}</div></section>; }
function ProbabilityBar({ title, value, tone }: { title: string; value: number; tone: string }) { return <div><div className="flex justify-between text-xs"><span className="text-gray-500">{title}</span><strong className="text-white">{percent(value)}</strong></div><div className="mt-2 h-2 overflow-hidden rounded-full bg-gray-800"><span className={`block h-full ${tone}`} style={{ width: `${Math.max(0, Math.min(100, value * 100))}%` }} /></div></div>; }
function PanelTitle({ children }: { children: React.ReactNode }) { return <p className="text-[10px] font-black uppercase tracking-wider text-violet-300">{children}</p>; }
function Metric({ title, value }: { title: string; value: string }) { return <span className="bg-gray-950 px-2 py-3 text-center"><span className="block text-[8px] font-black uppercase text-gray-600">{title}</span><strong className="mt-1 block text-sm tabular-nums text-white">{value}</strong></span>; }
function GradeBadge({ grade }: { grade: NbaPlayerPropsMemberGrade }) { const colors = gradeColors(grade); return <span className="inline-flex w-fit rounded border px-2 py-1 text-[9px] font-black uppercase tracking-wider" style={{ borderColor: colors.border, background: colors.background, color: colors.text }}>{grade}</span>; }
function TeamBadge({ team, large = false }: { team: string; large?: boolean }) {
  const size = large ? "h-11 w-11" : "h-8 w-8";
  return <span className={`relative inline-flex shrink-0 items-center justify-center overflow-hidden rounded-full border bg-white font-black ${size}`} style={{ borderColor: teamColor(team), color: teamColor(team) }}>
    <span className="text-[8px]">{team}</span>
    {/* eslint-disable-next-line @next/next/no-img-element */}
    <img src={`https://a.espncdn.com/i/teamlogos/nba/500/${team.toLowerCase()}.png`} alt={`${team} logo`} className="absolute inset-0 h-full w-full bg-white object-contain p-0.5" onError={(event) => { event.currentTarget.style.display = "none"; }} />
  </span>;
}

function gradeColors(grade: NbaPlayerPropsMemberGrade) { if (grade === "Best Angle") return { border: "#34d39988", background: "#34d39914", text: "#6ee7b7" }; if (grade === "Lean") return { border: "#38bdf888", background: "#38bdf814", text: "#7dd3fc" }; if (grade === "Watchlist") return { border: "#a78bfa77", background: "#8b5cf614", text: "#c4b5fd" }; return { border: "#4b556366", background: "#11182799", text: "#9ca3af" }; }
function gameButton(active: boolean): string { return `w-[220px] shrink-0 rounded-lg border px-4 py-3 text-left ${active ? "border-violet-400 bg-violet-400/[0.10]" : "border-gray-800 bg-[#0d1015] hover:border-violet-400/50"}`; }
function sortRows(left: Row, right: Row): number { return gradeRank(left.grade) - gradeRank(right.grade) || right.expectedValue - left.expectedValue || left.playerName.localeCompare(right.playerName); }
function gradeRank(grade: NbaPlayerPropsMemberGrade): number { return grade === "Best Angle" ? 0 : grade === "Lean" ? 1 : grade === "Watchlist" ? 2 : 3; }
function selection(row: Row): string { return `${capitalize(row.side)} ${row.line}`; }
function marketLabel(value: string): string { const labels: Record<string, string> = { points: "Points", rebounds: "Rebounds", assists: "Assists", threes: "Made threes", points_rebounds_assists: "Pts + Reb + Ast", points_rebounds: "Pts + Reb", points_assists: "Pts + Ast", rebounds_assists: "Reb + Ast" }; return labels[value] ?? value.split("_").map(capitalize).join(" "); }
function metricValue(metric: NbaPlayerPropsReaderMetric): string { if (metric.format === "percent") return percent(metric.value); if (metric.format === "minutes") return `${metric.value.toFixed(1)} min`; if (metric.format === "count") return metric.value.toFixed(0); return metric.value.toFixed(metric.value < 2 ? 3 : 1); }
function metricWidth(metric: NbaPlayerPropsReaderMetric): number { if (metric.format === "percent") return Math.max(5, Math.min(100, metric.value * 100)); if (metric.format === "minutes") return Math.max(5, Math.min(100, metric.value / 0.48)); return Math.max(8, Math.min(100, Math.abs(metric.value) * (metric.value < 2 ? 70 : 0.8))); }
function bestPriceBySide(values: Row["priceLadder"]): Record<"over" | "under", number | null> { return { over: bestPrice(values.filter((row) => row.side === "over").map((row) => row.americanPrice)), under: bestPrice(values.filter((row) => row.side === "under").map((row) => row.americanPrice)) }; }
function bestPrice(values: number[]): number | null { return values.length ? Math.max(...values) : null; }
function teamColor(team: string): string { return TEAM_COLORS[team] ?? "#7c3aed"; }
const TEAM_COLORS: Record<string, string> = { ATL: "#E03A3E", BOS: "#007A33", BKN: "#000000", CHA: "#1D1160", CHI: "#CE1141", CLE: "#860038", DAL: "#00538C", DEN: "#0E2240", DET: "#C8102E", GSW: "#1D428A", HOU: "#CE1141", IND: "#002D62", LAC: "#C8102E", LAL: "#552583", MEM: "#5D76A9", MIA: "#98002E", MIL: "#00471B", MIN: "#0C2340", NOP: "#0C2340", NYK: "#006BB6", OKC: "#007AC1", ORL: "#0077C0", PHI: "#006BB6", PHX: "#1D1160", POR: "#E03A3E", SAC: "#5A2D81", SAS: "#C4CED4", TOR: "#CE1141", UTA: "#002B5C", WAS: "#002B5C" };
function book(value: string): string { const labels: Record<string, string> = { betmgm: "BetMGM", betrivers: "BetRivers", caesars: "Caesars", draftkings: "DraftKings", fanduel: "FanDuel" }; return labels[value.toLowerCase()] ?? value; }
function price(value: number): string { return value > 0 ? `+${value}` : String(value); }
function percent(value: number): string { return `${(value * 100).toFixed(1)}%`; }
function capitalize(value: string): string { return value.charAt(0).toUpperCase() + value.slice(1); }
function unique(values: string[]): string[] { return [...new Set(values)]; }
function gameTime(value: string): string { return new Date(value).toLocaleString("en-US", { weekday: "short", hour: "numeric", minute: "2-digit", timeZone: "America/New_York" }); }
function localTime(value: string): string { return new Date(value).toLocaleString("en-US", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit", timeZone: "America/New_York", timeZoneName: "short" }); }
function dateLabel(value: string): string { return new Date(`${value}T12:00:00-04:00`).toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric", timeZone: "America/New_York" }); }
