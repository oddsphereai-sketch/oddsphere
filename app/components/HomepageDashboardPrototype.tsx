"use client";

import { useEffect, useMemo, useState } from "react";

type MarketKey = "moneyline" | "total" | "first_inning";
type PlayGrade = "Best Angle" | "Lean" | "Watchlist" | "Caution" | "No Play";

type OddsMove = {
  direction: "toward" | "away" | "flat";
  first: string;
  move?: string;
  current: string;
};

type SplitRow = {
  team: string;
  money: number;
  bets: number;
};

type PrototypeMarket = {
  key: MarketKey;
  label: string;
  pick: string;
  probability: string;
  grade: PlayGrade;
  price: string;
  modelProbability: string;
  marketProbability: string;
  edge: string;
  book: string;
  oddsMove: OddsMove;
  marketReadTitle: string;
  marketRead: string;
  quickRead: string;
  supportCopy: string;
  riskCopy: string;
  whyCopy: string;
  projectionLabel: string;
  consensus?: {
    updated: string;
    rows: SplitRow[];
  };
  sharp?: {
    updated: string;
    rows: SplitRow[];
  };
};

type PrototypeGame = {
  id: string;
  away: string;
  home: string;
  time: string;
  scoreProjection: string;
  starters: string;
  statRows: Array<{
    label: string;
    away: string;
    home: string;
    edge: string;
  }>;
  markets: Record<MarketKey, PrototypeMarket>;
};

const marketOrder: MarketKey[] = ["moneyline", "total", "first_inning"];

const games: PrototypeGame[] = [
  {
    id: "nym-tor",
    away: "NYM",
    home: "TOR",
    time: "7:07 PM",
    scoreProjection: "NYM 5.0 · TOR 4.0",
    starters: "Nolan McLean (RHP) vs Kevin Gausman (RHP)",
    statRows: [
      { label: "Starter ERA", away: "4.03", home: "4.36", edge: "NYM slight edge" },
      { label: "Bullpen quality", away: "18% better than league avg", home: "2% worse than league avg", edge: "NYM clear edge" },
    ],
    markets: {
      moneyline: {
        key: "moneyline",
        label: "Moneyline",
        pick: "NYM",
        probability: "56%",
        grade: "Best Angle",
        price: "-104",
        modelProbability: "56%",
        marketProbability: "46%",
        edge: "+10.0 pp",
        book: "betmgm",
        oddsMove: { direction: "toward", first: "+106", move: "-101", current: "-104" },
        marketReadTitle: "Market resistance with model/value override",
        marketRead:
          "Consensus is slightly shaded away from NYM, but the sharp-book profile and price move both lean toward the Mets. The model edge is strong enough to keep the thesis intact.",
        quickRead: "Strong model/value case with a price move toward NYM, though consensus is not fully aligned.",
        supportCopy:
          "NYM has 56% model probability versus 46% implied at -104, for about +10.0 pp edge. Sharp-book money is heavier on NYM while the price has moved from plus money toward the pick.",
        riskCopy: "Consensus is not fully aligned, so late price tightening can reduce the value.",
        whyCopy: "Driver: model win-probability edge, playable price, and movement toward the pick.",
        projectionLabel: "NYM projected win case",
        consensus: {
          updated: "3:30 PM",
          rows: [
            { team: "NYM", money: 60, bets: 56 },
            { team: "TOR", money: 40, bets: 44 },
          ],
        },
        sharp: {
          updated: "3:21 PM",
          rows: [
            { team: "NYM", money: 78, bets: 37 },
            { team: "TOR", money: 22, bets: 63 },
          ],
        },
      },
      total: {
        key: "total",
        label: "Total",
        pick: "Over 7.5",
        probability: "60%",
        grade: "Lean",
        price: "-112",
        modelProbability: "60%",
        marketProbability: "52%",
        edge: "+8.0 pp",
        book: "betmgm",
        oddsMove: { direction: "toward", first: "+100", move: "-108", current: "-112" },
        marketReadTitle: "Projection support",
        marketRead:
          "The projection clears the total and the price has firmed toward the Over. Consensus is supportive enough to keep this playable, but not clean enough for a top-tier read.",
        quickRead: "Projection supports the Over, with price movement adding confirmation.",
        supportCopy:
          "The model projects 9.0 runs against a 7.5 total, with 60% probability versus 52% implied at -112.",
        riskCopy: "The number has already moved, so the edge is more sensitive to late juice.",
        whyCopy: "Driver: projected total above the market line and movement toward the Over.",
        projectionLabel: "Projected total 9.0 vs line 7.5",
        consensus: {
          updated: "3:30 PM",
          rows: [
            { team: "Over", money: 64, bets: 58 },
            { team: "Under", money: 36, bets: 42 },
          ],
        },
        sharp: {
          updated: "3:21 PM",
          rows: [
            { team: "Over", money: 69, bets: 44 },
            { team: "Under", money: 31, bets: 56 },
          ],
        },
      },
      first_inning: {
        key: "first_inning",
        label: "1st Inning",
        pick: "Toss-Up",
        probability: "52%",
        grade: "No Play",
        price: "n/a",
        modelProbability: "52%",
        marketProbability: "51%",
        edge: "+1.0 pp",
        book: "n/a",
        oddsMove: { direction: "flat", first: "n/a", current: "n/a" },
        marketReadTitle: "FI toss-up",
        marketRead:
          "The first-inning model does not show enough separation at the current number. This stays No Play until price or starter context creates a clearer edge.",
        quickRead: "FI remains No Play because the model edge is too thin.",
        supportCopy: "The FI read is close to market implied probability, so there is not enough actionable value.",
        riskCopy: "No first-inning edge is strong enough to act on.",
        whyCopy: "Driver: thin FI edge.",
        projectionLabel: "FI model close to market",
      },
    },
  },
  {
    id: "atl-wsh",
    away: "ATL",
    home: "WSH",
    time: "7:30 PM",
    scoreProjection: "ATL 4.8 · WSH 4.2",
    starters: "Spencer Strider (RHP) vs Jake Irvin (RHP)",
    statRows: [
      { label: "Starter profile", away: "Strikeout edge", home: "Contact risk", edge: "ATL edge" },
      { label: "Lineup form", away: "Above average", home: "Neutral", edge: "ATL slight edge" },
    ],
    markets: {
      moneyline: {
        key: "moneyline",
        label: "Moneyline",
        pick: "ATL",
        probability: "59%",
        grade: "Lean",
        price: "-126",
        modelProbability: "59%",
        marketProbability: "54%",
        edge: "+5.0 pp",
        book: "draftkings",
        oddsMove: { direction: "away", first: "-121", move: "-117", current: "-110" },
        marketReadTitle: "Mixed but playable",
        marketRead:
          "The model still supports ATL, but the price movement has drifted away from the pick. That keeps this actionable, not a cleaner Best Angle.",
        quickRead: "Playable model edge, but the odds move keeps the read below top-tier.",
        supportCopy: "ATL has 59% model probability versus 54% implied, with movement drifting away from the pick.",
        riskCopy: "Movement away from ATL is the main cap on the grade.",
        whyCopy: "Driver: model edge with movement friction.",
        projectionLabel: "ATL projected win case",
        consensus: {
          updated: "3:15 PM",
          rows: [
            { team: "ATL", money: 57, bets: 54 },
            { team: "WSH", money: 43, bets: 46 },
          ],
        },
        sharp: {
          updated: "3:10 PM",
          rows: [
            { team: "ATL", money: 51, bets: 55 },
            { team: "WSH", money: 49, bets: 45 },
          ],
        },
      },
      total: {
        key: "total",
        label: "Total",
        pick: "Over 8.5",
        probability: "57%",
        grade: "Watchlist",
        price: "-115",
        modelProbability: "57%",
        marketProbability: "53%",
        edge: "+4.0 pp",
        book: "draftkings",
        oddsMove: { direction: "flat", first: "-110", move: "-112", current: "-115" },
        marketReadTitle: "Thin edge watchlist",
        marketRead:
          "The projection leans Over, but the edge is thin at the current price. This is worth monitoring rather than treating as an action play.",
        quickRead: "Projection leans Over, but the price keeps it on Watchlist.",
        supportCopy: "The model shows a modest Over edge, but current juice limits the value.",
        riskCopy: "Thin edge and added juice are the main reasons this is not stronger.",
        whyCopy: "Driver: projection support, capped by price.",
        projectionLabel: "Projected total 9.1 vs line 8.5",
        consensus: {
          updated: "3:15 PM",
          rows: [
            { team: "Over", money: 55, bets: 51 },
            { team: "Under", money: 45, bets: 49 },
          ],
        },
      },
      first_inning: {
        key: "first_inning",
        label: "1st Inning",
        pick: "YRFI",
        probability: "55%",
        grade: "Watchlist",
        price: "-128",
        modelProbability: "55%",
        marketProbability: "56%",
        edge: "-1.0 pp",
        book: "draftkings",
        oddsMove: { direction: "flat", first: "-124", move: "-126", current: "-128" },
        marketReadTitle: "FI price capped",
        marketRead:
          "The YRFI case is reasonable on starter and top-order context, but the price is too expensive for a stronger grade.",
        quickRead: "YRFI has a case, but current price keeps it in monitor territory.",
        supportCopy: "Starter and early-offense context are playable, while the price leaves little value cushion.",
        riskCopy: "Price is the cap here.",
        whyCopy: "Driver: FI context with limited price value.",
        projectionLabel: "FI context supports YRFI",
      },
    },
  },
  {
    id: "bel-bra",
    away: "BEL",
    home: "BRA",
    time: "8:00 PM",
    scoreProjection: "BEL 1.3 · BRA 1.1",
    starters: "World Cup market read",
    statRows: [
      { label: "Chance creation", away: "Slight edge", home: "Neutral", edge: "BEL slight edge" },
      { label: "Draw risk", away: "Elevated", home: "Elevated", edge: "Market caveat" },
    ],
    markets: {
      moneyline: {
        key: "moneyline",
        label: "Match Result",
        pick: "BEL",
        probability: "41%",
        grade: "Watchlist",
        price: "+145",
        modelProbability: "41%",
        marketProbability: "38%",
        edge: "+3.0 pp",
        book: "fanduel",
        oddsMove: { direction: "toward", first: "+158", move: "+150", current: "+145" },
        marketReadTitle: "Movement support, draw risk",
        marketRead:
          "The price has moved toward BEL and the model shows slight value, but draw risk keeps this from becoming fully actionable.",
        quickRead: "Movement supports BEL, but draw risk keeps this on Watchlist.",
        supportCopy: "BEL is +145 with a small model edge and movement toward the pick. The three-way market still carries meaningful draw risk.",
        riskCopy: "Draw risk is the main reason this is not a Lean.",
        whyCopy: "Driver: value plus movement, capped by draw risk.",
        projectionLabel: "BEL has slight match-result value",
      },
      total: {
        key: "total",
        label: "Total",
        pick: "Over 2.5",
        probability: "54%",
        grade: "No Play",
        price: "-112",
        modelProbability: "54%",
        marketProbability: "53%",
        edge: "+1.0 pp",
        book: "fanduel",
        oddsMove: { direction: "toward", first: "+112", move: "-116", current: "-112" },
        marketReadTitle: "Movement support, thin value",
        marketRead:
          "The price move leans toward the Over, but the model edge is too thin at the current number. Movement is a signal, not enough by itself to make this actionable.",
        quickRead: "The Over has movement support, but not enough model value to act.",
        supportCopy: "Over 2.5 moved from plus money into minus money, while the model sits only about +1.0 pp above market implied.",
        riskCopy: "Thin model value is the blocker.",
        whyCopy: "Driver: movement support, capped by thin edge.",
        projectionLabel: "Projected total close to line",
      },
      first_inning: {
        key: "first_inning",
        label: "BTTS",
        pick: "BTTS Yes",
        probability: "49%",
        grade: "Caution",
        price: "+105",
        modelProbability: "49%",
        marketProbability: "48%",
        edge: "+1.0 pp",
        book: "fanduel",
        oddsMove: { direction: "flat", first: "+102", current: "+105" },
        marketReadTitle: "Thin BTTS edge",
        marketRead:
          "BTTS is priced fairly close to the model. The value is not strong enough to move beyond Caution.",
        quickRead: "BTTS is close to fair price, so the edge is not strong enough.",
        supportCopy: "The model and market are nearly aligned, leaving limited betting value.",
        riskCopy: "Limited edge is the main issue.",
        whyCopy: "Driver: fair-price BTTS read.",
        projectionLabel: "BTTS model near market",
      },
    },
  },
];

function gradeTone(grade: PlayGrade) {
  if (grade === "Best Angle") return "border-emerald-300/35 bg-emerald-300/12 text-emerald-200";
  if (grade === "Lean") return "border-sky-300/30 bg-sky-300/10 text-sky-200";
  if (grade === "Watchlist") return "border-amber-300/35 bg-amber-300/10 text-amber-200";
  if (grade === "Caution") return "border-yellow-300/35 bg-yellow-300/10 text-yellow-200";
  return "border-white/15 bg-white/[0.04] text-gray-300";
}

function gradeIcon(grade: PlayGrade) {
  if (grade === "Best Angle") return "★";
  if (grade === "Lean") return "↗";
  if (grade === "Watchlist") return "◐";
  if (grade === "Caution") return "⚠";
  return "○";
}

function movementIcon(direction: OddsMove["direction"]) {
  if (direction === "toward") return "↗";
  if (direction === "away") return "↘";
  return "→";
}

function nextIndex(index: number, direction: 1 | -1) {
  return (index + direction + games.length) % games.length;
}

export function HomepageDashboardPrototype() {
  const [open, setOpen] = useState(false);
  const [selectedGameId, setSelectedGameId] = useState(games[0].id);
  const [selectedMarket, setSelectedMarket] = useState<MarketKey>("moneyline");
  const [readerMode, setReaderMode] = useState<"full" | "compact">("full");

  const selectedIndex = Math.max(
    0,
    games.findIndex((game) => game.id === selectedGameId),
  );
  const selectedGame = games[selectedIndex] ?? games[0];
  const activeMarket = selectedGame.markets[selectedMarket] ?? selectedGame.markets.moneyline;

  const slateCounts = useMemo(() => {
    const markets = games.flatMap((game) => Object.values(game.markets));
    return {
      games: games.length,
      bestAngles: markets.filter((market) => market.grade === "Best Angle").length,
      leans: markets.filter((market) => market.grade === "Lean").length,
    };
  }, []);

  useEffect(() => {
    if (!open) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") setOpen(false);
      if (event.key === "ArrowLeft") setSelectedGameId(games[nextIndex(selectedIndex, -1)].id);
      if (event.key === "ArrowRight") setSelectedGameId(games[nextIndex(selectedIndex, 1)].id);
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [open, selectedIndex]);

  function selectGame(gameId: string) {
    setSelectedGameId(gameId);
    setReaderMode("full");
  }

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="inline-flex items-center justify-center rounded-lg border border-white/15 bg-white/[0.05] px-7 py-3.5 text-sm font-bold text-white transition hover:border-violet-400/50 hover:bg-white/[0.08] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-violet-300"
      >
        Preview Dashboard
      </button>

      {open ? (
        <div
          className="fixed inset-0 z-50 overflow-y-auto bg-black/90 px-3 py-4 backdrop-blur-md sm:px-6 sm:py-8"
          role="dialog"
          aria-modal="true"
          aria-labelledby="dashboard-preview-title"
        >
          <div className="mx-auto max-w-[1500px]">
            <div className="mb-3 flex items-center justify-between gap-3">
              <div>
                <p className="text-[10px] font-black uppercase tracking-[0.2em] text-emerald-300">
                  Product preview
                </p>
                <h2 id="dashboard-preview-title" className="mt-1 text-xl font-black tracking-tight text-white sm:text-2xl">
                  Daily Edge reader
                </h2>
                <p className="mt-1 text-xs text-gray-400">
                  Click markets, slate cards, and arrows just like the member reader.
                </p>
              </div>
              <button
                type="button"
                onClick={() => setOpen(false)}
                className="inline-flex items-center justify-center rounded-lg border border-white/15 bg-white/[0.08] px-4 py-2 text-sm font-bold text-white transition hover:bg-white/[0.12] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-violet-300"
              >
                Close
              </button>
            </div>

            <div className="overflow-hidden rounded-2xl border border-violet-400/35 bg-[#07060f] shadow-[0_0_90px_rgba(124,58,237,0.22)]">
              <div className="border-b border-white/8 bg-[#0b0a14] px-5 py-4 sm:px-7">
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <div className="flex flex-wrap items-center gap-3">
                    <p className="text-[11px] font-black uppercase tracking-[0.22em] text-violet-200">
                      Selected Edge
                    </p>
                    <p className="hidden text-sm text-gray-500 sm:block">
                      Click any game below - or use ← → - to update this read.
                    </p>
                  </div>
                  <button
                    type="button"
                    onClick={() => setReaderMode((mode) => (mode === "full" ? "compact" : "full"))}
                    className="rounded-full border border-violet-300/35 bg-violet-400/10 px-4 py-2 text-xs font-black uppercase tracking-[0.16em] text-violet-100 transition hover:bg-violet-400/16"
                  >
                    {readerMode === "full" ? "Collapse Read ↑" : "Expand Full Read ↓"}
                  </button>
                </div>

                <div className="mt-5 flex flex-wrap items-center justify-between gap-4">
                  <div className="flex flex-wrap items-center gap-3">
                    <h3 className="text-2xl font-black tracking-tight text-white">
                      {selectedGame.away} <span className="text-gray-500">@</span> {selectedGame.home}
                    </h3>
                    <span className="rounded-md bg-white/[0.04] px-2 py-1 text-[10px] font-black uppercase tracking-[0.18em] text-gray-400">
                      Action
                    </span>
                    <span className={`rounded-md border px-3 py-1 text-[11px] font-black uppercase tracking-[0.16em] ${gradeTone(activeMarket.grade)}`}>
                      {gradeIcon(activeMarket.grade)} {activeMarket.grade}
                    </span>
                    <span className="text-sm font-semibold text-gray-500">{selectedGame.time}</span>
                  </div>
                  <div className="flex items-center gap-2">
                    <button
                      type="button"
                      onClick={() => setSelectedGameId(games[nextIndex(selectedIndex, -1)].id)}
                      className="h-10 w-10 rounded-full border border-violet-300/30 bg-violet-400/10 text-lg font-black text-violet-100 transition hover:bg-violet-400/18"
                      aria-label="Previous game"
                    >
                      ‹
                    </button>
                    <span className="min-w-14 text-center text-sm font-bold text-gray-400">
                      {selectedIndex + 1} / {games.length}
                    </span>
                    <button
                      type="button"
                      onClick={() => setSelectedGameId(games[nextIndex(selectedIndex, 1)].id)}
                      className="h-10 w-10 rounded-full border border-violet-300/30 bg-violet-400/10 text-lg font-black text-violet-100 transition hover:bg-violet-400/18"
                      aria-label="Next game"
                    >
                      ›
                    </button>
                  </div>
                </div>

                <div className="mt-5 grid gap-3 md:grid-cols-3">
                  {marketOrder.map((marketKey) => {
                    const market = selectedGame.markets[marketKey];
                    const active = selectedMarket === marketKey;
                    return (
                      <button
                        key={market.key}
                        type="button"
                        onClick={() => setSelectedMarket(market.key)}
                        className={`rounded-lg border p-4 text-left transition ${
                          active
                            ? "border-violet-300/50 bg-violet-500/18 shadow-[0_0_26px_rgba(139,92,246,0.16)]"
                            : "border-white/10 bg-white/[0.03] hover:border-violet-300/30 hover:bg-white/[0.05]"
                        }`}
                      >
                        <div className="flex items-start justify-between gap-3">
                          <p className="text-[11px] font-black uppercase tracking-[0.18em] text-gray-500">{market.label}</p>
                          <span className={`rounded-full border px-2 py-1 text-[10px] font-black ${gradeTone(market.grade)}`}>
                            {gradeIcon(market.grade)}
                          </span>
                        </div>
                        <div className="mt-4 flex items-end justify-between gap-3">
                          <div>
                            <p className="text-xl font-black text-white">{market.pick}</p>
                            <p className="mt-1 text-xs font-bold text-gray-500">{market.edge}</p>
                          </div>
                          <p className="text-lg font-bold text-gray-300">{market.probability}</p>
                        </div>
                      </button>
                    );
                  })}
                </div>
              </div>

              {readerMode === "full" ? (
                <div className="grid gap-0 lg:grid-cols-[1fr_1.42fr_1fr]">
                  <section className="border-b border-white/8 p-5 sm:p-7 lg:border-b-0 lg:border-r">
                    <SectionTitle title="Quick Read" accent="emerald" />
                    <div className="mt-5 rounded-xl border border-white/10 bg-white/[0.035] p-5">
                      <p className="text-[11px] font-black uppercase tracking-[0.18em] text-violet-200">Quick Read</p>
                      <div className="mt-5 flex items-center gap-3">
                        <div className="h-12 w-12 rounded-full border border-orange-300/25 bg-orange-300/10" />
                        <p className="text-lg font-black text-white">
                          {selectedGame.away} <span className="mx-2 text-gray-500">@</span> {selectedGame.home}
                        </p>
                        <div className="h-12 w-12 rounded-full border border-sky-300/25 bg-sky-300/10" />
                      </div>
                      <p className="mt-4 text-sm font-bold text-gray-400">{selectedGame.starters}</p>
                      <div className="mt-5 rounded-lg border border-white/8 bg-black/20 p-4">
                        <p className="text-[10px] font-black uppercase tracking-[0.16em] text-gray-500">Projected</p>
                        <p className="mt-2 text-2xl font-black text-white">{selectedGame.scoreProjection}</p>
                      </div>
                      <div className="mt-5 flex items-center justify-between gap-3">
                        <div>
                          <p className="text-3xl font-black text-white">{activeMarket.pick}</p>
                          <p className="mt-2 text-xs font-black uppercase tracking-[0.16em] text-gray-500">
                            Win prob <span className="text-white">{activeMarket.modelProbability}</span> · Edge{" "}
                            <span className="text-emerald-300">{activeMarket.edge}</span>
                          </p>
                          <p className="mt-2 text-xs font-black uppercase tracking-[0.16em] text-gray-500">
                            Rec <span className="text-emerald-300">{activeMarket.probability.replace("%", "")}</span> ·{" "}
                            {activeMarket.price} · {activeMarket.label}
                          </p>
                        </div>
                        <div className="grid h-18 w-18 place-items-center rounded-full border-4 border-violet-400/70 text-xl font-black text-white">
                          {activeMarket.probability.replace("%", "")}
                        </div>
                      </div>
                      <div className="mt-5 rounded-lg border border-white/8 bg-black/18 p-4">
                        <p className="text-sm leading-relaxed text-gray-200">{activeMarket.quickRead}</p>
                        <p className="mt-3 text-sm leading-relaxed text-yellow-200">⚠ {activeMarket.riskCopy}</p>
                      </div>
                      <div className="mt-5">
                        <p className="text-[10px] font-black uppercase tracking-[0.18em] text-gray-500">Play Grade</p>
                        <p className={`mt-2 text-2xl font-black ${activeMarket.grade === "Best Angle" ? "text-emerald-300" : "text-white"}`}>
                          {gradeIcon(activeMarket.grade)} {activeMarket.grade}
                        </p>
                      </div>
                    </div>
                  </section>

                  <section className="border-b border-white/8 p-5 sm:p-7 lg:border-b-0 lg:border-r">
                    <SectionTitle title="Supporting Evidence" accent="violet" />
                    <div className="mt-5">
                      <p className="text-[11px] font-black uppercase tracking-[0.18em] text-gray-400">
                        Edge Stack · {activeMarket.label}
                      </p>
                      <div className="mt-3 rounded-xl border border-white/10 bg-white/[0.035] p-5">
                        <MetricRow label="Projection" detail="model probability" value={activeMarket.modelProbability} />
                        <MetricRow label="Market" detail="market implied" value={activeMarket.marketProbability} />
                        <MetricRow label="Edge" detail="projection vs no-vig market" value={activeMarket.edge} highlight />
                      </div>
                    </div>

                    <TextBlock title="Supporting Evidence" body={activeMarket.supportCopy} />

                    <div className="mt-5 border-t border-white/8 pt-5">
                      <div className="flex items-center justify-between gap-3">
                        <p className="text-[11px] font-black uppercase tracking-[0.18em] text-gray-400">Book</p>
                        <p className="text-sm font-semibold text-gray-300">{activeMarket.book}</p>
                      </div>
                    </div>

                    <div className="mt-5 border-t border-white/8 pt-5">
                      <p className="text-[11px] font-black uppercase tracking-[0.18em] text-gray-400">Odds Move</p>
                      <div className="mt-3 grid grid-cols-[1fr_auto_1fr_auto_1fr] items-center gap-3">
                        <OddsPoint value={activeMarket.oddsMove.first} label="First" />
                        <span className="text-gray-500">→</span>
                        <OddsPoint value={activeMarket.oddsMove.move ?? activeMarket.oddsMove.current} label={activeMarket.oddsMove.move ? "Move" : "Current"} />
                        <span className="text-emerald-300">{movementIcon(activeMarket.oddsMove.direction)}</span>
                        <OddsPoint value={activeMarket.oddsMove.current} label="Current" align="right" />
                      </div>
                    </div>

                    <TextBlock title="Market Read" heading={activeMarket.marketReadTitle} body={activeMarket.marketRead} />

                    {activeMarket.consensus || activeMarket.sharp ? (
                      <div className="mt-5 border-t border-white/8 pt-5">
                        <p className="text-[11px] font-black uppercase tracking-[0.18em] text-gray-400">Market Pulse · Splits</p>
                        {activeMarket.consensus ? <SplitSection title="Consensus Splits" updated={activeMarket.consensus.updated} rows={activeMarket.consensus.rows} /> : null}
                        {activeMarket.sharp ? <SplitSection title="Sharp Book Splits" updated={activeMarket.sharp.updated} rows={activeMarket.sharp.rows} /> : null}
                      </div>
                    ) : null}
                  </section>

                  <section className="p-5 sm:p-7">
                    <SectionTitle title="Key Stats & Notes" accent="sky" />
                    <div className="mt-5 space-y-5">
                      {selectedGame.statRows.map((row) => (
                        <div key={row.label} className="border-b border-white/8 pb-4 last:border-b-0">
                          <div className="flex items-center justify-between gap-3">
                            <p className="text-[11px] font-black uppercase tracking-[0.18em] text-gray-400">{row.label}</p>
                            <p className="text-xs font-black text-emerald-300">{row.edge}</p>
                          </div>
                          <div className="mt-3 grid grid-cols-[auto_1fr] gap-x-4 gap-y-2 text-sm">
                            <p className="font-black text-emerald-300">{selectedGame.away}</p>
                            <p className="text-right font-bold text-gray-200">{row.away}</p>
                            <p className="font-black text-gray-300">{selectedGame.home}</p>
                            <p className="text-right font-bold text-gray-400">{row.home}</p>
                          </div>
                        </div>
                      ))}
                      <div>
                        <p className="text-[11px] font-black uppercase tracking-[0.18em] text-gray-400">Market Notes</p>
                        <div className="mt-3 grid grid-cols-[52px_1fr] gap-3 text-sm leading-relaxed">
                          <p className="font-black uppercase tracking-[0.12em] text-gray-500">Why</p>
                          <p className="text-gray-300">{activeMarket.whyCopy}</p>
                          <p className="font-black uppercase tracking-[0.12em] text-yellow-300">Risk</p>
                          <p className="text-gray-300">{activeMarket.riskCopy}</p>
                        </div>
                      </div>
                    </div>
                  </section>
                </div>
              ) : (
                <div className="grid gap-4 p-5 sm:grid-cols-3 sm:p-7">
                  <CompactPanel title="Quick Read" body={activeMarket.quickRead} />
                  <CompactPanel title="Market Read" heading={activeMarket.marketReadTitle} body={activeMarket.marketRead} />
                  <CompactPanel title="Supporting Evidence" body={activeMarket.supportCopy} />
                </div>
              )}

              <div className="border-t border-white/8 bg-[#080711] p-5 sm:p-7">
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <div>
                    <p className="text-[11px] font-black uppercase tracking-[0.18em] text-gray-400">Slate Board</p>
                    <p className="mt-1 text-sm text-gray-500">Click a game to update the selected reader.</p>
                  </div>
                  <div className="flex flex-wrap gap-2 text-xs font-black">
                    <span className="rounded-full bg-white/[0.06] px-3 py-2 text-gray-300">{slateCounts.games} games</span>
                    <span className="rounded-full bg-emerald-300/10 px-3 py-2 text-emerald-200">{slateCounts.bestAngles} Best Angles</span>
                    <span className="rounded-full bg-sky-300/10 px-3 py-2 text-sky-200">{slateCounts.leans} Leans</span>
                  </div>
                </div>
                <div className="mt-4 grid gap-3 md:grid-cols-3">
                  {games.map((game) => {
                    const active = game.id === selectedGame.id;
                    const featured = active
                      ? game.markets[selectedMarket]
                      : game.markets.moneyline.grade === "Best Angle"
                        ? game.markets.moneyline
                        : game.markets.total;
                    return (
                      <button
                        key={game.id}
                        type="button"
                        onClick={() => selectGame(game.id)}
                        className={`rounded-xl border p-4 text-left transition ${
                          active
                            ? "border-violet-300/45 bg-violet-500/14"
                            : "border-white/10 bg-white/[0.03] hover:border-violet-300/30 hover:bg-white/[0.05]"
                        }`}
                      >
                        <div className="flex items-start justify-between gap-3">
                          <div>
                            <p className="text-[11px] font-black uppercase tracking-[0.14em] text-gray-500">
                              {game.away} @ {game.home}
                            </p>
                            <p className="mt-2 text-2xl font-black text-white">{featured.pick}</p>
                          </div>
                          <span className={`rounded-full border px-3 py-1 text-[10px] font-black uppercase tracking-[0.12em] ${gradeTone(featured.grade)}`}>
                            {featured.grade}
                          </span>
                        </div>
                        <p className="mt-3 text-sm font-bold text-gray-400">
                          {featured.probability} · {featured.edge} · {featured.price}
                        </p>
                        <p className="mt-3 text-xs text-gray-500">{game.scoreProjection}</p>
                      </button>
                    );
                  })}
                </div>
              </div>
            </div>
          </div>
        </div>
      ) : null}
    </>
  );
}

function SectionTitle({ title, accent }: { title: string; accent: "emerald" | "violet" | "sky" }) {
  const color = accent === "emerald" ? "bg-emerald-400" : accent === "sky" ? "bg-sky-400" : "bg-violet-400";
  return (
    <div className="flex items-center gap-3 border-b border-white/8 pb-3">
      <span className={`h-6 w-1 rounded-full ${color}`} />
      <p className="text-[12px] font-black uppercase tracking-[0.22em] text-gray-200">{title}</p>
    </div>
  );
}

function MetricRow({ label, detail, value, highlight = false }: { label: string; detail: string; value: string; highlight?: boolean }) {
  return (
    <div className="grid grid-cols-[120px_1fr_auto] items-center gap-3 border-b border-white/8 py-3 first:pt-0 last:border-b-0 last:pb-0">
      <p className="text-[11px] font-black uppercase tracking-[0.16em] text-gray-300">{label}</p>
      <p className="text-xs text-gray-500">{detail}</p>
      <p className={`text-lg font-black ${highlight ? "rounded-full bg-emerald-300/12 px-3 py-1 text-emerald-200" : "text-white"}`}>
        {value}
      </p>
    </div>
  );
}

function TextBlock({ title, heading, body }: { title: string; heading?: string; body: string }) {
  return (
    <div className="mt-5 border-t border-white/8 pt-5">
      <p className="text-[11px] font-black uppercase tracking-[0.18em] text-gray-400">{title}</p>
      <p className="mt-3 text-sm leading-relaxed text-gray-300">
        {heading ? <span className="font-bold text-white">{heading} · </span> : null}
        {body}
      </p>
    </div>
  );
}

function OddsPoint({ value, label, align = "left" }: { value: string; label: string; align?: "left" | "right" }) {
  return (
    <div className={align === "right" ? "text-right" : "text-left"}>
      <p className="text-xl font-black text-white">{value}</p>
      <p className="mt-1 text-[10px] font-black uppercase tracking-[0.16em] text-gray-500">{label}</p>
    </div>
  );
}

function SplitSection({ title, updated, rows }: { title: string; updated: string; rows: SplitRow[] }) {
  return (
    <div className="mt-5">
      <div className="flex items-center justify-between gap-3">
        <p className="text-[11px] font-black uppercase tracking-[0.18em] text-gray-200">{title}</p>
        <p className="text-xs text-gray-500">Last updated {updated}</p>
      </div>
      <div className="mt-3 space-y-4">
        {rows.map((row) => (
          <div key={`${title}-${row.team}`}>
            <p className="text-sm font-black uppercase tracking-[0.14em] text-gray-200">{row.team}</p>
            <SplitBar label="Money" value={row.money} />
            <SplitBar label="Bets" value={row.bets} />
          </div>
        ))}
      </div>
    </div>
  );
}

function SplitBar({ label, value }: { label: string; value: number }) {
  return (
    <div className="mt-2 grid grid-cols-[62px_1fr_42px] items-center gap-3">
      <p className="text-[10px] font-black uppercase tracking-[0.16em] text-gray-500">{label}</p>
      <div className="h-2 overflow-hidden rounded-full bg-white/[0.06]">
        <div className="h-full rounded-full bg-violet-400" style={{ width: `${value}%` }} />
      </div>
      <p className="text-right text-sm font-black text-gray-300">{value}%</p>
    </div>
  );
}

function CompactPanel({ title, heading, body }: { title: string; heading?: string; body: string }) {
  return (
    <div className="rounded-xl border border-white/10 bg-white/[0.035] p-5">
      <p className="text-[11px] font-black uppercase tracking-[0.18em] text-violet-200">{title}</p>
      <p className="mt-3 text-sm leading-relaxed text-gray-300">
        {heading ? <span className="font-bold text-white">{heading} · </span> : null}
        {body}
      </p>
    </div>
  );
}
