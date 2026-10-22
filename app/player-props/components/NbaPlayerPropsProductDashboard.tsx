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
  reviewSource = "historical",
}: {
  snapshot: NbaPlayerPropsMemberSnapshot;
  initialSelectedKey?: string | null;
  reviewSource?: "live" | "historical";
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
      <p className="text-[10px] font-black uppercase text-amber-300">Private founder review · {reviewSource === "live" ? "Current candidate slate" : "Historical confirmation slate"}</p>
      <p className="mt-1 max-w-4xl text-sm leading-6 text-amber-50/80">This is real point-in-time model, matchup, and exact-price evidence. It cannot appear in member navigation while publication remains disabled.</p>
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

    <section className="py-7" data-product-zone="full-board">
      <PlayerPropsSectionHeading eyebrow="Full board" title="One line. One projection. One read." count={`${rows.length} props`} />
      <div className="mt-4 grid gap-3 md:grid-cols-2">
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
    <div className="flex items-start justify-between gap-3"><span className="text-sm font-black text-violet-200">{marketLabel(row.market)}</span><GradeBadge grade={row.grade} /></div>
    <div className="mt-4 flex items-center gap-3"><PlayerVisual row={row} compact /><div className="min-w-0"><h3 className="truncate text-lg font-black text-white">{row.playerName}</h3><p className="text-[10px] text-gray-500">{row.team} vs {row.opponent} · {gameTime(row.scheduledStart)}</p></div></div>
    <div className="mt-4 grid grid-cols-[1.25fr_1fr] gap-2">
      <DecisionTile row={row} />
      <MarketQuoteTile row={row} />
    </div>
    <div className="mt-2 grid grid-cols-2 gap-px overflow-hidden rounded-md border border-gray-800 bg-gray-800"><Metric title="Model projection" value={row.projection.toFixed(1)} /><Metric title="Pick confidence" value={percent(row.probability)} /></div>
    <div className="mt-4 flex items-center justify-between gap-3"><p className={`text-[9px] font-black uppercase tracking-wider ${movementTone(row)}`}>{movementLabel(row)}</p><button type="button" onClick={() => onSelect(row.decisionKey)} className="rounded-md border border-violet-400/40 px-3 py-2 text-[10px] font-black uppercase text-violet-200 hover:bg-violet-400/10">Open reader ↑</button></div>
  </PlayerPropsRadarCardFrame>;
}

function BoardRow({ row, onSelect }: { row: Row; onSelect: (key: string) => void }) {
  const colors = gradeColors(row.grade);
  return <button
    type="button"
    onClick={() => onSelect(row.decisionKey)}
    className="group relative overflow-hidden rounded-xl border bg-[#0b0e14] text-left transition hover:-translate-y-0.5 hover:border-violet-400/55 hover:shadow-[0_18px_50px_rgba(0,0,0,.32)]"
    style={{ borderColor: colors.border }}
  >
    <span className="absolute inset-x-0 top-0 h-20 opacity-80" style={{ background: `linear-gradient(105deg, ${teamColor(row.team)}30, ${colors.background}, transparent 78%)` }} />
    <span className="relative flex items-start gap-3 px-4 pt-4">
      <PlayerVisual row={row} />
      <span className="min-w-0 flex-1 pt-0.5">
        <span className="flex items-start justify-between gap-3">
          <span className="min-w-0"><strong className="block truncate text-base font-black text-white">{row.playerName}</strong><span className="mt-0.5 block text-[10px] text-gray-500">{row.team} vs {row.opponent} · {gameTime(row.scheduledStart)}</span></span>
          <GradeBadge grade={row.grade} />
        </span>
        <span className="mt-3 inline-flex rounded-md border border-violet-400/25 bg-violet-400/[0.08] px-2.5 py-1 text-sm font-black text-violet-100">{marketLabel(row.market)}</span>
      </span>
    </span>
    <span className="relative mt-3 grid grid-cols-[1.2fr_1fr] gap-2 px-4">
      <DecisionTile row={row} />
      <MarketQuoteTile row={row} />
    </span>
    <span className="relative mx-4 mt-2 grid grid-cols-3 gap-px overflow-hidden rounded-lg border border-gray-800 bg-gray-800">
      <Metric title="Model projection" value={row.projection.toFixed(1)} />
      <Metric title="Pick confidence" value={percent(row.probability)} />
      <Metric title="Other-book market" value={percent(row.targetExcludedProbability)} />
    </span>
    <span className="relative mt-4 flex items-center justify-between border-t border-gray-800 px-4 py-3 text-[9px] font-black uppercase tracking-wider">
      <span className={movementTone(row)}>{movementLabel(row)}</span>
      <span className="text-violet-200 transition group-hover:text-white">Open reader ↑</span>
    </span>
  </button>;
}

function PropReader({ row, onClose }: { row: Row; onClose: () => void }) {
  const bestPickQuote = bestExactQuote(row, row.side);
  const otherSide = row.side === "over" ? "under" : "over";
  const bestOpposingQuote = bestExactQuote(row, otherSide);
  return <PlayerPropReaderDialog ariaLabel={`${row.playerName} ${marketLabel(row.market)} prop reader`} title={`${row.playerName} · ${marketLabel(row.market)}`} leading={<TeamBadge team={row.team} large />} onClose={onClose}>
    <div className="p-4 sm:p-6">
      <div className="relative overflow-hidden rounded-xl border border-gray-800 bg-[#0d1015] p-4 sm:p-5">
        <div className="absolute inset-x-0 top-0 h-28 opacity-70" style={{ background: `linear-gradient(105deg, ${teamColor(row.team)}38, rgba(124,58,237,.10), transparent 75%)` }} />
        <div className="relative grid gap-4 sm:grid-cols-[auto_1fr] sm:items-center">
          <PlayerVisual row={row} hero />
          <div>
            <div className="flex flex-wrap items-center gap-2"><span className="rounded-md border border-violet-400/30 bg-violet-400/[0.10] px-3 py-1.5 text-sm font-black text-violet-100">{marketLabel(row.market)}</span><span className="text-[9px] text-gray-600">{row.team} vs {row.opponent} · {gameTime(row.scheduledStart)}</span></div>
            <h3 className="mt-2 text-2xl font-black text-white">{row.playerName}</h3>
          </div>
        </div>
        <div className="relative mt-4 grid gap-2 sm:grid-cols-[1.2fr_1fr]">
          <DecisionTile row={row} showGrade />
          <MarketQuoteTile row={row} />
        </div>
        <div className="relative mt-2 grid grid-cols-3 gap-px overflow-hidden rounded-lg border border-gray-800 bg-gray-800">
          <Metric title="Model projection" value={row.projection.toFixed(1)} /><Metric title="Pick confidence" value={percent(row.probability)} /><Metric title="Other-book market" value={percent(row.targetExcludedProbability)} />
        </div>
      </div>
      <FeaturedEvidence row={row} />
      <section className="mt-5 overflow-hidden rounded-xl border border-sky-400/20 bg-[linear-gradient(145deg,rgba(14,165,233,.07),rgba(0,0,0,.20)_62%)] p-4 sm:p-5">
        <div className="flex flex-wrap items-end justify-between gap-2"><div><p className="text-[10px] font-black uppercase tracking-wider text-sky-300">Market check</p><h4 className="mt-1 text-lg font-black text-white">Price and confirmation</h4></div><p className="text-[10px] text-gray-500">{row.targetExcludedBooks} other books · {row.targetExcludedReferenceBooks} reference books</p></div>
        <div className="mt-4 grid gap-3 lg:grid-cols-[1fr_1.15fr]">
          <div className="grid grid-cols-2 gap-2">
            {bestPickQuote ? <PriceChoiceCard title={`Best ${capitalize(row.side)}`} quote={bestPickQuote} selected /> : null}
            {bestOpposingQuote ? <PriceChoiceCard title={`Best ${capitalize(otherSide)}`} quote={bestOpposingQuote} /> : null}
          </div>
          <div className="rounded-lg border border-gray-800 bg-black/25 p-4"><ProbabilityBar title="OddSphere forecast" value={row.probability} tone="bg-violet-400" /><div className="mt-4"><ProbabilityBar title="Other-book market" value={row.targetExcludedProbability} tone="bg-sky-400" /></div></div>
        </div>
        {row.movement ? <div className="mt-3 rounded-lg border border-gray-800 bg-black/20 px-3 py-2.5"><span className="text-[9px] font-black uppercase tracking-wider text-gray-500">Same-book move</span><p className="mt-1 text-xs text-gray-300">{book(row.movement.sportsbook)} · {row.movement.openingLine} {price(row.movement.openingPrice)} → {row.movement.currentLine} {price(row.movement.currentPrice)}</p></div> : null}
        <details className="mt-3 rounded-lg border border-gray-800 bg-black/20">
          <summary className="cursor-pointer list-none px-3 py-3 text-xs font-black text-violet-200">Compare all {row.priceLadder.length} available prices <span aria-hidden="true" className="float-right text-gray-600">＋</span></summary>
          <div className="border-t border-gray-800 px-3 py-1">{row.priceLadder.map((quote, index) => <div key={`${quote.sportsbook}-${quote.side}-${index}`} className="grid grid-cols-[1fr_auto_auto] items-center gap-3 border-b border-gray-800 py-2 text-xs last:border-b-0"><strong className="text-gray-200">{book(quote.sportsbook)}</strong><span className={quote.side === row.side ? "text-emerald-300" : "text-gray-500"}>{capitalize(quote.side)} {quote.line}</span><strong className="text-white">{price(quote.americanPrice)}</strong></div>)}</div>
        </details>
      </section>
      <details className="mt-5 rounded-xl border border-gray-800 bg-black/20">
        <summary className="cursor-pointer list-none px-4 py-4 text-sm font-black text-violet-200">View every model input <span aria-hidden="true" className="float-right text-gray-600">＋</span></summary>
        <div className="grid gap-3 border-t border-gray-800 p-4 lg:grid-cols-3"><EvidencePanel title="Role & minutes" metrics={row.role} /><EvidencePanel title="Recent production" metrics={row.production} /><EvidencePanel title="Matchup" metrics={row.matchup} /></div>
      </details>
    </div>
  </PlayerPropReaderDialog>;
}

function FeaturedEvidence({ row }: { row: Row }) {
  return <section className="mt-5 rounded-xl border border-violet-400/20 bg-[radial-gradient(circle_at_top_right,rgba(139,92,246,.12),transparent_48%),rgba(0,0,0,.20)] p-4 sm:p-5">
    <p className="text-[10px] font-black uppercase tracking-wider text-emerald-300">Why this pick</p>
    <div className="mt-1 flex flex-wrap items-end justify-between gap-2"><h4 className="text-lg font-black text-white">Key drivers for {marketLabel(row.market)}</h4><p className="text-[10px] text-gray-500">Market-specific model inputs</p></div>
    <div className="mt-4 grid grid-cols-2 gap-2 lg:grid-cols-4">{featuredMetrics(row).map(({ metric, group }) => <FeaturedMetric key={metric.key} metric={metric} group={group} />)}</div>
  </section>;
}
function FeaturedMetric({ metric, group }: { metric: NbaPlayerPropsReaderMetric; group: string }) {
  return <div className="min-h-28 rounded-lg border border-white/[0.08] bg-[#0b0e14]/90 p-3">
    <span className="text-[8px] font-black uppercase tracking-[0.14em] text-violet-300">{group}</span>
    <strong className="mt-3 block text-2xl font-black tabular-nums text-white">{metricValue(metric)}</strong>
    <span className="mt-1 block text-[10px] leading-4 text-gray-500">{metric.label}</span>
  </div>;
}
function PriceChoiceCard({ title, quote, selected = false }: { title: string; quote: Row["priceLadder"][number]; selected?: boolean }) {
  return <div className={`rounded-lg border p-3 ${selected ? "border-emerald-400/35 bg-emerald-400/[0.08]" : "border-gray-800 bg-black/25"}`}>
    <span className={`text-[8px] font-black uppercase tracking-wider ${selected ? "text-emerald-300" : "text-gray-500"}`}>{title}</span>
    <strong className="mt-2 block text-xl font-black text-white">{capitalize(quote.side)} {quote.line}</strong>
    <span className="mt-1 block text-xs text-gray-400">{price(quote.americanPrice)} · {book(quote.sportsbook)}</span>
  </div>;
}
function EvidencePanel({ title, metrics }: { title: string; metrics: readonly NbaPlayerPropsReaderMetric[] }) { return <section className="rounded-lg border border-gray-800 bg-black/20 p-4"><PanelTitle>{title}</PanelTitle><div className="mt-3 space-y-2">{metrics.map((metric) => <div key={metric.key} className="flex justify-between gap-3 border-b border-gray-800 pb-2 text-xs last:border-b-0 last:pb-0"><span className="text-gray-500">{metric.label}</span><strong className="text-gray-100">{metricValue(metric)}</strong></div>)}</div></section>; }
function DecisionTile({ row, showGrade = false }: { row: Row; showGrade?: boolean }) {
  const colors = gradeColors(row.grade);
  return <span className="rounded-lg border p-3" style={{ borderColor: colors.border, background: colors.background }}>
    <span className="flex items-center justify-between gap-2"><span className="block text-[8px] font-black uppercase tracking-[0.16em] text-emerald-300">Our pick</span>{showGrade ? <GradeBadge grade={row.grade} /> : null}</span>
    <strong className="mt-1 block text-xl font-black text-white sm:text-2xl">{selection(row)}</strong>
    <span className="mt-1 block text-[9px] text-gray-500">Prediction against the listed market line</span>
  </span>;
}
function MarketQuoteTile({ row }: { row: Row }) {
  return <span className="rounded-lg border border-gray-700 bg-black/30 p-3">
    <span className="block text-[8px] font-black uppercase tracking-[0.16em] text-sky-300">Market offer</span>
    <strong className="mt-1 block text-lg font-black text-white sm:text-xl">{row.line.toFixed(1)} <span className="text-sm text-gray-400">· {price(row.americanPrice)}</span></strong>
    <span className="mt-1 block text-[9px] text-gray-500">{book(row.sportsbook)} · evaluated quote</span>
  </span>;
}
function ProbabilityBar({ title, value, tone }: { title: string; value: number; tone: string }) { return <div><div className="flex justify-between text-xs"><span className="text-gray-500">{title}</span><strong className="text-white">{percent(value)}</strong></div><div className="mt-2 h-2 overflow-hidden rounded-full bg-gray-800"><span className={`block h-full ${tone}`} style={{ width: `${Math.max(0, Math.min(100, value * 100))}%` }} /></div></div>; }
function PanelTitle({ children }: { children: React.ReactNode }) { return <p className="text-[10px] font-black uppercase tracking-wider text-violet-300">{children}</p>; }
function Metric({ title, value }: { title: string; value: string }) { return <span className="bg-gray-950 px-2 py-3 text-center"><span className="block text-[8px] font-black uppercase text-gray-600">{title}</span><strong className="mt-1 block text-sm tabular-nums text-white">{value}</strong></span>; }
function GradeBadge({ grade }: { grade: NbaPlayerPropsMemberGrade }) { const colors = gradeColors(grade); return <span className="inline-flex w-fit rounded border px-2 py-1 text-[9px] font-black uppercase tracking-wider" style={{ borderColor: colors.border, background: colors.background, color: colors.text }}>{grade}</span>; }
function PlayerVisual({ row, compact = false, hero = false }: { row: Row; compact?: boolean; hero?: boolean }) {
  const dimensions = hero ? "h-24 w-24" : compact ? "h-12 w-12" : "h-16 w-14";
  const initials = row.playerName.split(/\s+/).filter(Boolean).slice(0, 2).map((name) => name[0]).join("");
  return <span className={`relative inline-flex shrink-0 items-end justify-center overflow-hidden rounded-xl border ${dimensions}`} style={{ borderColor: `${teamColor(row.team)}88`, background: `linear-gradient(145deg, ${teamColor(row.team)}88, #0b0e14 72%)` }}>
    <span className={`${hero ? "text-4xl" : compact ? "text-lg" : "text-2xl"} absolute inset-0 flex items-center justify-center font-black text-white/15`}>{initials}</span>
    <span className={`relative mb-1.5 rounded-full border bg-white shadow-[0_5px_18px_rgba(0,0,0,.38)] ${hero ? "h-12 w-12" : compact ? "h-7 w-7" : "h-9 w-9"}`} style={{ borderColor: teamColor(row.team) }}>
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img src={`https://a.espncdn.com/i/teamlogos/nba/500/${row.team.toLowerCase()}.png`} alt="" className="h-full w-full object-contain p-0.5" />
    </span>
  </span>;
}
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
function featuredMetrics(row: Row): Array<{ metric: NbaPlayerPropsReaderMetric; group: string }> {
  const keys = FEATURED_METRIC_KEYS[row.market] ?? [];
  const grouped = [
    { group: "Role", metrics: row.role },
    { group: "Production", metrics: row.production },
    { group: "Matchup", metrics: row.matchup },
  ];
  const selected = keys.flatMap((key) => grouped.flatMap(({ group, metrics }) => {
    const metric = metrics.find((candidate) => candidate.key === key);
    return metric ? [{ metric, group }] : [];
  }));
  if (selected.length >= 4) return selected.slice(0, 4);
  const existing = new Set(selected.map(({ metric }) => metric.key));
  const representedGroups = new Set(selected.map(({ group }) => group));
  const missingGroups = grouped.flatMap(({ group, metrics }) => representedGroups.has(group) || !metrics[0] ? [] : [{ metric: metrics[0], group }]);
  const seen = new Set(existing);
  const fallback = [...missingGroups, ...grouped.flatMap(({ group, metrics }) => metrics.map((metric) => ({ metric, group })))]
    .filter(({ metric }) => {
      if (seen.has(metric.key)) return false;
      seen.add(metric.key);
      return true;
    });
  return [...selected, ...fallback].slice(0, 4);
}
const FEATURED_METRIC_KEYS: Partial<Record<Row["market"], readonly string[]>> = {
  points: ["minutes_mean_10", "usage_mean_5", "points_per_minute_10", "opponent_efg_allowed_5"],
  rebounds: ["minutes_mean_10", "rebounds_per_minute_10", "rebound_chances_per_minute_5", "opponent_rebound_chances_per100_5"],
  assists: ["minutes_mean_10", "assists_per_minute_10", "touches_per_minute_5", "opponent_deflections_per100_5"],
  threes: ["minutes_mean_10", "fg3a_per_minute_10", "threes_per_minute_10", "opponent_matchup_three_point_pct_5"],
  points_rebounds_assists: ["minutes_mean_10", "usage_mean_5", "points_per_minute_10", "game_pace_mean_5"],
  points_rebounds: ["minutes_mean_10", "points_per_minute_10", "rebound_chances_per_minute_5", "game_pace_mean_5"],
  points_assists: ["minutes_mean_10", "usage_mean_5", "points_per_minute_10", "assists_per_minute_10"],
  rebounds_assists: ["minutes_mean_10", "rebounds_per_minute_10", "assist_percentage_mean_5", "game_pace_mean_5"],
};
function bestExactQuote(row: Row, side: "over" | "under"): Row["priceLadder"][number] | null {
  return row.priceLadder
    .filter((quote) => quote.side === side && quote.line === row.line)
    .reduce<Row["priceLadder"][number] | null>((best, quote) => !best || quote.americanPrice > best.americanPrice ? quote : best, null);
}
function teamColor(team: string): string { return TEAM_COLORS[team] ?? "#7c3aed"; }
const TEAM_COLORS: Record<string, string> = { ATL: "#E03A3E", BOS: "#007A33", BKN: "#000000", CHA: "#1D1160", CHI: "#CE1141", CLE: "#860038", DAL: "#00538C", DEN: "#0E2240", DET: "#C8102E", GSW: "#1D428A", HOU: "#CE1141", IND: "#002D62", LAC: "#C8102E", LAL: "#552583", MEM: "#5D76A9", MIA: "#98002E", MIL: "#00471B", MIN: "#0C2340", NOP: "#0C2340", NYK: "#006BB6", OKC: "#007AC1", ORL: "#0077C0", PHI: "#006BB6", PHX: "#1D1160", POR: "#E03A3E", SAC: "#5A2D81", SAS: "#C4CED4", TOR: "#CE1141", UTA: "#002B5C", WAS: "#002B5C" };
function book(value: string): string { const labels: Record<string, string> = { betmgm: "BetMGM", betrivers: "BetRivers", caesars: "Caesars", draftkings: "DraftKings", fanduel: "FanDuel" }; return labels[value.toLowerCase()] ?? value; }
function price(value: number): string { return value > 0 ? `+${value}` : String(value); }
function percent(value: number): string { return `${(value * 100).toFixed(1)}%`; }
function movementLabel(row: Row): string {
  if (!row.movement) return "";
  const lineDelta = row.movement.currentLine - row.movement.openingLine;
  if (lineDelta === 0 && row.movement.currentPrice === row.movement.openingPrice) return "Same-book market flat";
  if (lineDelta > 0) return "Line moved toward Over";
  if (lineDelta < 0) return "Line moved toward Under";
  return row.movement.currentPrice < row.movement.openingPrice ? `Price strengthened ${capitalize(row.side)}` : `Price eased ${capitalize(row.side)}`;
}
function movementTone(row: Row): string {
  if (!row.movement) return "text-gray-600";
  const supportsSide = row.side === "over"
    ? row.movement.currentLine > row.movement.openingLine || row.movement.currentPrice < row.movement.openingPrice
    : row.movement.currentLine < row.movement.openingLine || row.movement.currentPrice < row.movement.openingPrice;
  return supportsSide ? "text-emerald-300" : "text-amber-300";
}
function capitalize(value: string): string { return value.charAt(0).toUpperCase() + value.slice(1); }
function unique(values: string[]): string[] { return [...new Set(values)]; }
function gameTime(value: string): string { return new Date(value).toLocaleString("en-US", { weekday: "short", hour: "numeric", minute: "2-digit", timeZone: "America/New_York" }); }
function localTime(value: string): string { return new Date(value).toLocaleString("en-US", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit", timeZone: "America/New_York", timeZoneName: "short" }); }
function dateLabel(value: string): string { return new Date(`${value}T12:00:00-04:00`).toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric", timeZone: "America/New_York" }); }
