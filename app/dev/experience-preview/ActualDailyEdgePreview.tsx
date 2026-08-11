"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import type { DailyEdgeGameDto, DailyEdgeResponse, MarketEdgeDto } from "@/app/lab/lib/labTypes";
import type { MarketSplitDisplaySection } from "@/lib/types/domain/RecommendationDecision";
import type { Sport } from "@/lib/types/domain/Sport";
import { currentSlateDate } from "@/lib/dates/slateDate";
import { keyStatIsTwoSided } from "@/lib/services/keyStatsFormatter";
import type {
  DailyEdgeGameAvailability,
  DailyEdgeTeamAvailability,
} from "@/lib/services/dailyEdge/gameAvailability";
import SportSelector from "@/app/lab/components/SportSelector";
import { LockBadge } from "@/app/lab/components/daily-edge/LockBadge";
import {
  DAILY_EDGE_SPORT_AVAILABILITY,
  DAILY_EDGE_SPORT_KEYS,
} from "@/app/lab/lib/dailyEdgeSports";
import {
  buildReaderUrl,
  isMarketKey,
  primaryMarket,
  resolveInitialReaderSelection,
  type MarketKey,
} from "./readerState";
import {
  displayedConsensusSection,
  splitLeanStrength,
  splitSectionSignal,
} from "@/app/lab/lib/marketPulsePresentation";
import { firstInningSupportTone } from "@/app/lab/lib/firstInningPresentation";

type DeepView = "case" | "market" | "matchup" | "trend" | "model";

export type PreviewHistoryPoint = {
  date: string | null;
  opponent: string;
  runsFor: number;
  runsAgainst: number;
  totalRuns: number;
  firstInningRuns: number | null;
  won: boolean;
};

export type PreviewHistoryByTeam = Record<string, PreviewHistoryPoint[]>;

export type PreviewPitcherFirstInningPoint = { date: string; runsAllowed: number };
export type PreviewPitcherFirstInningSide = { name: string; points: PreviewPitcherFirstInningPoint[] } | null;
export type PreviewPitcherFirstInningByGame = Record<string, { away: PreviewPitcherFirstInningSide; home: PreviewPitcherFirstInningSide }>;
export type PreviewAvailabilityByGame = Record<string, DailyEdgeGameAvailability>;

const MARKET_LABEL: Record<MarketKey, string> = {
  moneyline: "Moneyline",
  total: "Total",
  first_inning: "1st Inning",
};

const MLB_TEAM_THEME: Record<string, { primary: string; secondary: string }> = {
  ARI: { primary: "#A71930", secondary: "#E3D4AD" }, ATL: { primary: "#CE1141", secondary: "#13274F" }, BAL: { primary: "#DF4601", secondary: "#000000" },
  BOS: { primary: "#BD3039", secondary: "#0C2340" }, CHC: { primary: "#0E3386", secondary: "#CC3433" }, CWS: { primary: "#27251F", secondary: "#C4CED4" },
  CIN: { primary: "#C6011F", secondary: "#000000" }, CLE: { primary: "#E31937", secondary: "#00385D" }, COL: { primary: "#33006F", secondary: "#C4CED4" },
  DET: { primary: "#0C2340", secondary: "#FA4616" }, HOU: { primary: "#002D62", secondary: "#EB6E1F" }, KC: { primary: "#004687", secondary: "#BD9B60" },
  LAA: { primary: "#BA0021", secondary: "#003263" }, LAD: { primary: "#005A9C", secondary: "#EF3E42" }, MIA: { primary: "#00A3E0", secondary: "#EF3340" },
  MIL: { primary: "#12284B", secondary: "#FFC52F" }, MIN: { primary: "#002B5C", secondary: "#D31145" }, NYM: { primary: "#002D72", secondary: "#FF5910" },
  NYY: { primary: "#0C2340", secondary: "#C4CED4" }, ATH: { primary: "#003831", secondary: "#EFB21E" }, PHI: { primary: "#E81828", secondary: "#002D72" },
  PIT: { primary: "#27251F", secondary: "#FDB827" }, SD: { primary: "#2F241D", secondary: "#FFC425" }, SF: { primary: "#FD5A1E", secondary: "#27251F" },
  SEA: { primary: "#0C2C56", secondary: "#005C5C" }, STL: { primary: "#C41E3A", secondary: "#0C2340" }, TB: { primary: "#092C5C", secondary: "#8FBCE6" },
  TEX: { primary: "#003278", secondary: "#C0111F" }, TOR: { primary: "#134A8E", secondary: "#E8291C" }, WSH: { primary: "#AB0003", secondary: "#14225A" },
};

const MLB_TEAM_ID: Record<string, number> = {
  ARI: 109, ATL: 144, BAL: 110, BOS: 111, CHC: 112, CWS: 145, CIN: 113, CLE: 114, COL: 115, DET: 116,
  HOU: 117, KC: 118, LAA: 108, LAD: 119, MIA: 146, MIL: 158, MIN: 142, NYM: 121, NYY: 147, ATH: 133,
  PHI: 143, PIT: 134, SD: 135, SEA: 136, SF: 137, STL: 138, TB: 139, TEX: 140, TOR: 141, WSH: 120,
};

const MLB_TEAM_ACCENT: Record<string, string> = {
  ARI: "#E3D4AD", ATL: "#F23D64", BAL: "#FF6A13", BOS: "#F04A54", CHC: "#4F83E3", CWS: "#C4CED4", CIN: "#F02A43", CLE: "#F13A52",
  COL: "#A78BFA", DET: "#FA6A32", HOU: "#FF7A22", KC: "#D5AD63", LAA: "#F22D4F", LAD: "#4DA3E3", MIA: "#27C4F4", MIL: "#FFC52F",
  MIN: "#E23A5F", NYM: "#FF6A1A", NYY: "#C4CED4", ATH: "#F5C242", PHI: "#F03A47", PIT: "#FDB827", SD: "#FFC425", SEA: "#2BC4B6",
  SF: "#FF6A2A", STL: "#E33852", TB: "#8FBCE6", TEX: "#F03A4F", TOR: "#4F8DE3", WSH: "#E23B47",
};

export default function ActualDailyEdgePreview({
  snapshot,
  history,
  pitcherFirstInningHistory,
  sport,
  freshContractRead,
  reviewMode = true,
  embeddedSample = false,
}: {
  snapshot: DailyEdgeResponse;
  history: PreviewHistoryByTeam;
  pitcherFirstInningHistory: PreviewPitcherFirstInningByGame;
  sport: Sport;
  freshContractRead: boolean;
  reviewMode?: boolean;
  embeddedSample?: boolean;
}) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const displaySnapshot = useMemo(() => normalizeCandidatePicks(snapshot, sport), [snapshot, sport]);
  const requestedGameId = searchParams.get("game");
  const requestedMarket = searchParams.get("market");
  const initialSelection = resolveInitialReaderSelection(displaySnapshot.games, requestedGameId, requestedMarket);
  const initialReaderRequested = Boolean(
    requestedGameId &&
    displaySnapshot.games.some((candidate) => candidate.id === requestedGameId) &&
    isMarketKey(requestedMarket),
  );
  const initialGame = displaySnapshot.games.find((candidate) => candidate.id === initialSelection.gameId);
  const initialMarket = initialReaderRequested || !initialGame ? initialSelection.market : primaryMarket(initialGame);
  const [gameId, setGameId] = useState(initialSelection.gameId);
  const [marketKey, setMarketKey] = useState<MarketKey>(initialMarket);
  const [readerOpen, setReaderOpen] = useState(initialReaderRequested);
  const [deepOpen, setDeepOpen] = useState(false);
  const [deepView, setDeepView] = useState<DeepView>("case");
  const [sample, setSample] = useState<5 | 10>(10);
  const [mobileSheetOpen, setMobileSheetOpen] = useState(initialReaderRequested);
  const [availability, setAvailability] = useState<PreviewAvailabilityByGame>({});
  const readerRef = useRef<HTMLDivElement>(null);

  function switchSport(next: Sport) {
    if (embeddedSample) return;
    setReaderOpen(false);
    setMobileSheetOpen(false);
    const params = new URLSearchParams(searchParams.toString());
    params.set("sport", next);
    params.delete("game");
    params.delete("market");
    // A normal sport switch must show that sport's canonical current slate.
    // Keep the date explicit for active models: the founder hub also prefetches
    // historical representative links, and a date-less client navigation can
    // otherwise reuse that prefetched payload until a hard reload.
    if (next === "mlb" || next === "wnba") {
      params.set("date", currentSlateDate(next));
      params.set("fresh", "1");
    } else {
      params.delete("date");
      params.delete("fresh");
    }
    router.replace(`${pathname}?${params.toString()}`, { scroll: false });
  }

  const game = useMemo(
    () => displaySnapshot.games.find((candidate) => candidate.id === gameId) ?? displaySnapshot.games[0],
    [displaySnapshot.games, gameId],
  );

  useEffect(() => {
    if (!mobileSheetOpen) return;
    function closeOnEscape(event: KeyboardEvent) {
      if (event.key === "Escape") setMobileSheetOpen(false);
    }
    const phoneViewport = window.matchMedia("(max-width: 639px)");
    function closeWhenLeavingPhoneViewport(event: MediaQueryListEvent) {
      if (!event.matches) setMobileSheetOpen(false);
    }
    document.addEventListener("keydown", closeOnEscape);
    phoneViewport.addEventListener("change", closeWhenLeavingPhoneViewport);
    return () => {
      document.removeEventListener("keydown", closeOnEscape);
      phoneViewport.removeEventListener("change", closeWhenLeavingPhoneViewport);
    };
  }, [mobileSheetOpen]);

  useEffect(() => {
    if (embeddedSample || (sport !== "mlb" && sport !== "wnba") || displaySnapshot.games.length === 0) return;
    const controller = new AbortController();
    const params = new URLSearchParams({ sport, date: displaySnapshot.date });
    for (const matchup of displaySnapshot.games) {
      params.append("game", `${matchup.id}|${matchup.awayTeam}|${matchup.homeTeam}`);
    }
    fetch(`/api/lab/daily-edge-availability?${params.toString()}`, { signal: controller.signal })
      .then((response) => response.ok ? response.json() : null)
      .then((body: { reports?: PreviewAvailabilityByGame } | null) => {
        if (body?.reports) setAvailability(body.reports);
      })
      .catch(() => {
        // Availability is supplementary and fail-closed. The core reader must
        // remain usable through provider, network, and authentication errors.
      });
    return () => controller.abort();
  }, [displaySnapshot.date, displaySnapshot.games, embeddedSample, sport]);

  if (!game) {
    return <div className="space-y-5 pb-16"><SlateHeader snapshot={displaySnapshot} sport={sport} onSportChange={switchSport} /><EmptyPreview snapshot={displaySnapshot} sport={sport} /></div>;
  }

  const market = game.markets[marketKey];

  function isMobileViewport(): boolean {
    return window.matchMedia("(max-width: 639px)").matches;
  }

  function scrollReaderIntoView() {
    window.requestAnimationFrame(() => {
      readerRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
    });
  }

  function selectGame(next: DailyEdgeGameDto, nextMarket: MarketKey = primaryMarket(next)) {
    setGameId(next.id);
    setMarketKey(nextMarket);
    setReaderOpen(true);
    setDeepOpen(false);
    setDeepView("case");
    if (!embeddedSample) replaceReaderUrl(sport, next.id, nextMarket);
    if (isMobileViewport()) setMobileSheetOpen(true);
    else scrollReaderIntoView();
  }

  function selectMarket(nextMarket: MarketKey) {
    setMarketKey(nextMarket);
    setDeepOpen(false);
    if (!embeddedSample) replaceReaderUrl(sport, game.id, nextMarket);
  }

  function selectAdjacentGame(direction: -1 | 1) {
    const index = displaySnapshot.games.findIndex((candidate) => candidate.id === game.id);
    const next = displaySnapshot.games[index + direction];
    if (!next) return;
    setGameId(next.id);
    setDeepOpen(false);
    setDeepView("case");
    replaceReaderUrl(sport, next.id, marketKey);
  }

  function collapseReader() {
    setReaderOpen(false);
    setMobileSheetOpen(false);
    setDeepOpen(false);
    const params = new URLSearchParams(window.location.search);
    params.delete("game");
    params.delete("market");
    if (!embeddedSample) window.history.replaceState(null, "", `${window.location.pathname}?${params.toString()}`);
  }

  return (
    <div className="space-y-5 pb-16">
      <SlateHeader snapshot={displaySnapshot} sport={sport} onSportChange={switchSport} sample={embeddedSample} />

      <div ref={readerRef} className="hidden scroll-mt-4 sm:block">
        {readerOpen ? <div>
          <ReaderSurface game={game} market={market} marketKey={marketKey} sport={sport} history={history} pitcherFirstInningHistory={pitcherFirstInningHistory} availability={availability[game.id] ?? null} sample={sample} setSample={setSample} deepOpen={deepOpen} setDeepOpen={setDeepOpen} deepView={deepView} setDeepView={setDeepView} setMarket={selectMarket} onCollapse={collapseReader} index={displaySnapshot.games.indexOf(game)} total={displaySnapshot.games.length} />
        </div> : <CollapsedReader game={game} market={market} marketKey={marketKey} sport={sport} onOpen={() => selectGame(game, marketKey)} onOpenMarket={(nextMarket) => selectGame(game, nextMarket)} index={displaySnapshot.games.indexOf(game)} total={displaySnapshot.games.length} />}
      </div>

      <EdgeBoard games={displaySnapshot.games} sport={sport} activeId={game.id} activeMarket={marketKey} selectGame={selectGame} />

      {mobileSheetOpen ? (
        <MobileReaderSheet game={game} market={market} marketKey={marketKey} sport={sport} history={history} pitcherFirstInningHistory={pitcherFirstInningHistory} availability={availability[game.id] ?? null} sample={sample} setSample={setSample} deepOpen={deepOpen} setDeepOpen={setDeepOpen} deepView={deepView} setDeepView={setDeepView} setMarket={selectMarket} onClose={collapseReader} onPrev={displaySnapshot.games.indexOf(game) > 0 ? () => selectAdjacentGame(-1) : null} onNext={displaySnapshot.games.indexOf(game) < displaySnapshot.games.length - 1 ? () => selectAdjacentGame(1) : null} index={displaySnapshot.games.indexOf(game)} total={displaySnapshot.games.length} />
      ) : null}

      {reviewMode ? <p className="text-center text-[10px] font-semibold uppercase tracking-[0.14em] text-gray-700">
        Development-only read · {freshContractRead ? "fresh read-only contract assembly" : "real stored snapshot"} and completed-game history · no writers or refresh jobs invoked
      </p> : null}
    </div>
  );
}

function normalizeCandidatePicks(snapshot: DailyEdgeResponse, sport: Sport): DailyEdgeResponse {
  if (sport !== "soccer" && sport !== "ucl") return snapshot;
  return {
    ...snapshot,
    games: snapshot.games.map((game) => ({
      ...game,
      markets: {
        ...game.markets,
        moneyline: { ...game.markets.moneyline, pick: normalizeSoccerPick(game.markets.moneyline.pick, game) },
        total: { ...game.markets.total, pick: normalizeSoccerSide(game.markets.total.pick) },
        first_inning: { ...game.markets.first_inning, pick: normalizeSoccerSide(game.markets.first_inning.pick) },
      },
    })),
  };
}

function normalizeSoccerPick(pick: string | null, game: DailyEdgeGameDto): string | null {
  const normalized = pick?.trim().toLowerCase();
  if (normalized === "home") return game.homeTeam;
  if (normalized === "away") return game.awayTeam;
  if (normalized === "draw") return "Draw";
  return normalizeSoccerSide(pick);
}

function normalizeSoccerSide(pick: string | null): string | null {
  if (!pick) return pick;
  return pick.replace(/^over\b/i, "Over").replace(/^under\b/i, "Under").replace(/^yes$/i, "Yes").replace(/^no$/i, "No");
}

type ReaderSurfaceProps = {
  game: DailyEdgeGameDto;
  market: MarketEdgeDto;
  marketKey: MarketKey;
  sport: Sport;
  history: PreviewHistoryByTeam;
  pitcherFirstInningHistory: PreviewPitcherFirstInningByGame;
  availability: DailyEdgeGameAvailability | null;
  sample: 5 | 10;
  setSample: (sample: 5 | 10) => void;
  deepOpen: boolean;
  setDeepOpen: (open: boolean) => void;
  deepView: DeepView;
  setDeepView: (view: DeepView) => void;
  setMarket: (market: MarketKey) => void;
  onCollapse?: () => void;
  index: number;
  total: number;
};

function CollapsedReader({ game, market, marketKey, sport, onOpen, onOpenMarket, index, total }: { game: DailyEdgeGameDto; market: MarketEdgeDto; marketKey: MarketKey; sport: Sport; onOpen: () => void; onOpenMarket: (market: MarketKey) => void; index: number; total: number }) {
  return (
    <section aria-label="Selected Edge collapsed reader" className="overflow-hidden rounded-2xl border border-violet-400/35 bg-gradient-to-b from-violet-500/[0.06] via-[#100e18] to-[#0d0c13] shadow-[0_12px_42px_-24px_rgba(124,58,237,0.75),inset_0_1px_0_rgba(255,255,255,0.04)]">
      <div className="border-b border-white/[0.07] px-4 py-3 sm:px-5">
        <div className="flex items-center justify-between gap-3">
          <div className="flex min-w-0 items-center gap-2">
            <span className="h-4 w-1 shrink-0 rounded-full bg-violet-400" />
            <p className="shrink-0 text-[9px] font-black uppercase tracking-[0.2em] text-violet-200">Selected Edge</p>
            <span className="hidden truncate text-[9px] text-gray-500 sm:inline">Compact read · click any game or market below to open the full reader.</span>
          </div>
          <button type="button" onClick={onOpen} aria-label="Expand full read" className="shrink-0 rounded-full border border-violet-400/45 bg-violet-500/[0.15] px-3 py-1.5 text-[8px] font-black uppercase tracking-[0.13em] text-violet-100 transition hover:border-violet-300/70 hover:bg-violet-500/[0.25]">Expand full read ↓</button>
        </div>
        <div className="mt-3 flex flex-wrap items-center gap-2">
          <div className="flex items-center gap-2">
            <TeamLogo src={game.awayTeamLogo} label={game.awayTeam} />
            <strong className="text-sm text-white">{game.awayTeam}</strong>
            <span className="text-[9px] text-gray-700">@</span>
            <strong className="text-sm text-white">{game.homeTeam}</strong>
            <TeamLogo src={game.homeTeamLogo} label={game.homeTeam} />
          </div>
          <VerdictBadge market={market} />
          <span className="text-[9px] text-gray-600">{game.gameTime}</span>
          <LockBadge lockState={game.lockState} lockedAt={game.lockedAt} scheduledLockAt={game.scheduledLockAt} className="font-black uppercase tracking-wider text-emerald-300" />
          <span className="ml-auto text-[8px] font-black uppercase tracking-wider text-gray-600">{index + 1} / {total}</span>
        </div>
      </div>
      <MarketStrip game={game} sport={sport} active={marketKey} setActive={onOpenMarket} />
      <button type="button" onClick={onOpen} className="grid w-full gap-3 border-t border-white/[0.06] px-4 py-3 text-left transition hover:bg-white/[0.025] sm:grid-cols-[0.8fr_0.7fr_1.5fr] sm:px-5">
        <div>
          <p className="text-[7px] font-black uppercase tracking-[0.15em] text-gray-600">Pick</p>
          <div className="mt-1 flex items-baseline gap-2">
            <strong className="text-base font-black text-white">{displayPick(market, marketKey)}</strong>
            <span className="font-mono text-[10px] font-black text-gray-500">{formatAmerican(currentDisplayedPrice(market))}</span>
            {market.currentPriceSportsbook ? <span className="text-[7px] font-bold text-gray-600">{formatSportsbook(market.currentPriceSportsbook)}</span> : null}
          </div>
        </div>
        <div>
          <p className="text-[7px] font-black uppercase tracking-[0.15em] text-gray-600">Model</p>
          <strong className="mt-1 block text-base font-black text-white">{formatProbability(market.modelProb)}</strong>
        </div>
        <div className="min-w-0">
          <p className="text-[7px] font-black uppercase tracking-[0.15em] text-gray-600">Quick take</p>
          <p className="mt-1 line-clamp-2 text-[10px] leading-relaxed text-gray-400">{currentAwareGuidedGuide(market, game.decisionLine)}</p>
        </div>
      </button>
    </section>
  );
}

function ReaderSurface({ game, market, marketKey, sport, history, pitcherFirstInningHistory, availability, sample, setSample, deepOpen, setDeepOpen, deepView, setDeepView, setMarket, onCollapse, index, total }: ReaderSurfaceProps) {
  return (
    <section className="overflow-hidden rounded-2xl border border-violet-400/30 bg-[#100e18] shadow-[0_0_0_1px_rgba(124,58,237,0.10),0_24px_90px_-48px_rgba(124,58,237,0.95)]">
      <ReaderHeader game={game} market={market} onCollapse={onCollapse} index={index} total={total} />
      <MarketStrip game={game} sport={sport} active={marketKey} setActive={setMarket} />
      <ReaderEvidence game={game} market={market} marketKey={marketKey} sport={sport} history={history} pitcherFirstInningHistory={pitcherFirstInningHistory} availability={availability} sample={sample} />
      <DeepResearchToggle open={deepOpen} setOpen={setDeepOpen} market={market} marketKey={marketKey} game={game} />
      {deepOpen ? <DeepResearch game={game} market={market} marketKey={marketKey} sport={sport} history={history} sample={sample} setSample={setSample} view={deepView} setView={setDeepView} /> : null}
    </section>
  );
}

function ReaderEvidence({ game, market, marketKey, sport, history, pitcherFirstInningHistory, availability, sample }: Pick<ReaderSurfaceProps, "game" | "market" | "marketKey" | "sport" | "history" | "pitcherFirstInningHistory" | "availability" | "sample">) {
  const firstInningMode = marketKey === "first_inning" && sport === "mlb";
  return (
    <>
      <div className="grid lg:grid-cols-[1fr_1.28fr_1fr] xl:grid-cols-[1.08fr_1.34fr_1.08fr]">
        <QuickRead game={game} market={market} marketKey={marketKey} sport={sport} />
        {firstInningMode ? <FirstInningIntelligence market={market} /> : <IntegratedEvidence market={market} availability={availability} />}
        <KeyStats game={game} market={market} marketKey={marketKey} history={history} sample={sample} sport={sport} />
      </div>
      {firstInningMode ? <FirstInningRecentContext game={game} history={history} pitcherHistory={pitcherFirstInningHistory[game.id] ?? null} sample={sample} pick={market.pick} /> : null}
    </>
  );
}

function MobileReaderSheet({ onClose, onPrev, onNext, ...reader }: ReaderSurfaceProps & { onClose: () => void; onPrev: (() => void) | null; onNext: (() => void) | null }) {
  useEffect(() => {
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = previousOverflow;
    };
  }, []);

  return (
    <div className="fixed inset-0 z-50 sm:hidden" role="dialog" aria-modal="true" aria-label={`${reader.game.awayTeam} at ${reader.game.homeTeam} analysis`}>
      <div className="absolute inset-0 bg-black/75 backdrop-blur-sm" onClick={onClose} aria-hidden="true" />
      <div className="absolute inset-x-0 bottom-0 top-12 flex flex-col overflow-hidden rounded-t-2xl border-t border-violet-400/35 bg-[#0a0910] shadow-[0_-24px_80px_-35px_rgba(124,58,237,0.85)]">
        <div className="shrink-0 border-b border-white/[0.07] bg-[#100e18] px-3 pb-2 pt-3">
          <div className="flex items-center justify-between gap-3">
            <div className="flex min-w-0 items-center gap-2"><TeamLogo src={reader.game.awayTeamLogo} label={reader.game.awayTeam} /><span className="text-sm font-black text-white">{reader.game.awayTeam}</span><span className="text-[9px] text-gray-700">@</span><span className="text-sm font-black text-white">{reader.game.homeTeam}</span><TeamLogo src={reader.game.homeTeamLogo} label={reader.game.homeTeam} /><span className="truncate text-[9px] text-gray-600">{reader.game.gameTime}</span><LockBadge lockState={reader.game.lockState} lockedAt={reader.game.lockedAt} scheduledLockAt={reader.game.scheduledLockAt} className="font-black uppercase tracking-wider text-emerald-300" /></div>
            <button type="button" onClick={onClose} aria-label="Close reader" className="inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-lg border border-white/[0.08] bg-white/[0.035] text-xl text-gray-300 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-violet-300">×</button>
          </div>
          <div className="mt-2 flex items-center justify-between gap-2">
            <button type="button" onClick={onPrev ?? undefined} disabled={onPrev === null} className="rounded-full border border-violet-400/25 px-3 py-1.5 text-[10px] font-black uppercase tracking-wider text-violet-100 disabled:border-white/[0.05] disabled:text-gray-700">← Prev</button>
            <span className="text-[9px] font-black uppercase tracking-wider text-gray-500">Game {reader.index + 1} of {reader.total}</span>
            <button type="button" onClick={onNext ?? undefined} disabled={onNext === null} className="rounded-full border border-violet-400/25 px-3 py-1.5 text-[10px] font-black uppercase tracking-wider text-violet-100 disabled:border-white/[0.05] disabled:text-gray-700">Next →</button>
          </div>
        </div>
        <div className="shrink-0"><MarketStrip game={reader.game} sport={reader.sport} active={reader.marketKey} setActive={reader.setMarket} /></div>
        <div className="flex-1 overflow-y-auto overscroll-contain pb-[env(safe-area-inset-bottom)]">
          <ReaderEvidence game={reader.game} market={reader.market} marketKey={reader.marketKey} sport={reader.sport} history={reader.history} pitcherFirstInningHistory={reader.pitcherFirstInningHistory} availability={reader.availability} sample={reader.sample} />
          <DeepResearchToggle open={reader.deepOpen} setOpen={reader.setDeepOpen} market={reader.market} marketKey={reader.marketKey} game={reader.game} />
          {reader.deepOpen ? <DeepResearch game={reader.game} market={reader.market} marketKey={reader.marketKey} sport={reader.sport} history={reader.history} sample={reader.sample} setSample={reader.setSample} view={reader.deepView} setView={reader.setDeepView} /> : null}
        </div>
      </div>
    </div>
  );
}

function replaceReaderUrl(sport: Sport, gameId: string, market: MarketKey) {
  window.history.replaceState(
    null,
    "",
    buildReaderUrl(window.location.pathname, window.location.search, sport, gameId, market),
  );
}

function SlateHeader({ snapshot, sport, onSportChange, sample = false }: { snapshot: DailyEdgeResponse; sport: Sport; onSportChange: (sport: Sport) => void; sample?: boolean }) {
  return (
    <div>
      <div className="flex flex-col gap-2 px-1 sm:flex-row sm:items-end sm:justify-between">
        <div><p className="text-[9px] font-black uppercase tracking-[0.2em] text-violet-300">OddSphere · {sportLabel(sport)}</p><h1 className="mt-1 text-2xl font-black tracking-tight text-white sm:text-3xl">Daily Edge</h1><p className="mt-1 text-xs text-gray-500">{sample ? "Sample slate" : snapshot.date} · {snapshot.games.length} {sportLabel(sport)} {snapshot.games.length === 1 ? "game" : "games"}{sample ? " · Interactive product preview" : ` · updated ${formatTimestamp(snapshot.as_of)}`}</p></div>
        <p className="text-[8px] font-semibold uppercase tracking-[0.12em] text-gray-600"><span className="text-gray-400">Update rhythm</span> · hourly board · separate market feeds · minute lock checks</p>
      </div>
      <div className="mt-5"><SportSelector active={sport} onChange={onSportChange} sports={DAILY_EDGE_SPORT_KEYS} showCounts={false} showPendingState availability={DAILY_EDGE_SPORT_AVAILABILITY} /></div>
    </div>
  );
}

function ReaderHeader({ game, market, onCollapse, index, total }: { game: DailyEdgeGameDto; market: MarketEdgeDto; onCollapse?: () => void; index: number; total: number }) {
  return (
    <div className="flex flex-col gap-3 border-b border-white/[0.07] px-4 py-4 sm:flex-row sm:items-center sm:justify-between sm:px-5">
      <div>
        <div className="flex items-center gap-2"><span className="h-4 w-1 rounded-full bg-violet-400" /><p className="text-[9px] font-black uppercase tracking-[0.2em] text-gray-300">Selected Edge</p><span className="hidden text-[10px] text-gray-600 sm:inline">One read first. Complete evidence when you ask for it.</span></div>
        <div className="mt-3 flex flex-wrap items-center gap-2">
          <h2 className="text-lg font-black tracking-tight text-white sm:text-xl">{game.awayTeam} <span className="text-gray-600">@</span> {game.homeTeam}</h2>
          <VerdictBadge market={market} />
          <span className="text-[10px] text-gray-600">{game.gameTime}</span>
          <LockBadge lockState={game.lockState} lockedAt={game.lockedAt} scheduledLockAt={game.scheduledLockAt} className="font-black uppercase tracking-wider text-emerald-300" />
        </div>
      </div>
      <div className="flex items-center gap-3"><span className="text-[9px] font-black uppercase tracking-wider text-gray-700">{index + 1} / {total}</span>{onCollapse ? <button type="button" onClick={onCollapse} aria-label="Collapse reader" className="rounded-full border border-violet-400/45 bg-violet-500/[0.14] px-3 py-1.5 text-[8px] font-black uppercase tracking-[0.13em] text-violet-100 transition hover:border-violet-300/70 hover:bg-violet-500/[0.24]">Collapse read ↑</button> : null}</div>
    </div>
  );
}

function MarketStrip({ game, sport, active, setActive }: { game: DailyEdgeGameDto; sport: Sport; active: MarketKey; setActive: (key: MarketKey) => void }) {
  const keys: MarketKey[] = ["moneyline", "total", "first_inning"];
  return (
    <div role="tablist" aria-label="Prediction category" className="grid grid-cols-3 gap-1.5 border-b border-white/[0.07] bg-black/15 p-2 sm:gap-2 sm:p-4">
      {keys.map((key) => {
        const market = game.markets[key];
        const selected = active === key;
        const pulse = sourceCoherentMarketPulse(market, resolveCoherentMovement(market));
        return (
          <button key={key} type="button" role="tab" aria-selected={selected} onClick={() => setActive(key)} className={`min-w-0 rounded-lg border px-2 py-2.5 text-left transition sm:rounded-xl sm:px-4 sm:py-3 ${selected ? "border-violet-400/55 bg-gradient-to-br from-violet-500/25 to-violet-900/10 shadow-[0_0_22px_-12px_rgba(124,58,237,0.9)]" : "border-white/[0.07] bg-white/[0.025] hover:border-violet-400/25"}`}>
            <div className="flex min-w-0 items-center justify-between gap-1"><span className={`truncate text-[7px] font-black uppercase tracking-[0.08em] sm:text-[9px] sm:tracking-[0.15em] ${selected ? "text-violet-200" : "text-gray-600"}`}>{marketLabelFor(key, sport)}</span><span className="shrink-0 text-[8px] font-black text-gray-500 sm:text-[9px]">{formatProbability(market.modelProb)}</span></div>
            <div className="mt-1.5 flex min-w-0 items-center justify-between gap-1 sm:mt-2 sm:gap-2"><span className="truncate text-xs font-black text-white sm:text-base">{displayPick(market, key)}</span><VerdictGlyph market={market} /></div>
            <p className={`mt-1 hidden truncate text-[9px] sm:block ${selected ? "text-violet-200/65" : "text-gray-700"}`}>{pulse.chip}</p>
          </button>
        );
      })}
    </div>
  );
}

function QuickRead({ game, market, marketKey, sport }: { game: DailyEdgeGameDto; market: MarketEdgeDto; marketKey: MarketKey; sport: Sport }) {
  const fiProjection = market.keyStats.find((stat) => /projected.*(?:first|1st).*inning/i.test(stat.label));
  const fiProjectionValue = fiProjection?.homeValue ?? fiProjection?.awayValue ?? "Unavailable";
  const probabilityGap = displayedProbabilityGap(market);
  return (
    <div className="h-full border-b border-white/[0.07] p-4 sm:p-5 lg:border-b-0 lg:border-r xl:p-6">
      <SectionHeading tone="emerald">Quick Read</SectionHeading>
      <div className="mt-4 rounded-xl border border-white/[0.07] bg-white/[0.025] p-4">
        <QuickMatchupIdentity game={game} sport={sport} />
        {marketKey === "first_inning" && sport === "mlb" ? <div className="mt-4 rounded-lg border border-sky-400/15 bg-sky-400/[0.04] p-3"><div className="flex items-center justify-between gap-3"><div><p className="text-[8px] font-black uppercase tracking-[0.15em] text-sky-200">First-inning projection</p><p className="mt-1 text-xl font-black text-white">{fiProjectionValue}</p></div><div className="text-right"><p className="text-[7px] font-black uppercase tracking-wider text-gray-600">Decision line</p><p className="mt-1 font-mono text-sm font-black text-gray-300">0.5 runs</p></div></div><p className="mt-2 text-[9px] leading-relaxed text-gray-500">Opening-frame projection replaces the less relevant full-game score in this market view.</p></div> : <div className="mt-4 rounded-lg border border-white/[0.06] bg-black/25 p-3"><p className="text-[8px] font-black uppercase tracking-[0.15em] text-gray-600">Projected score</p><div className="mt-2 flex items-center justify-between text-sm font-black text-white"><span>{game.awayTeam} <strong className="ml-1 text-xl">{formatNumber(game.projected.away)}</strong></span><span className="text-gray-700">—</span><span><strong className="mr-1 text-xl">{formatNumber(game.projected.home)}</strong> {game.homeTeam}</span></div></div>}
        <div className="mt-4">
          <p className="text-[8px] font-black uppercase tracking-[0.16em] text-gray-600">OddSphere read</p>
          <div className="mt-1 flex items-end justify-between gap-3"><p className="text-2xl font-black tracking-tight text-white">{market.pick ?? "Held"}</p><span className="text-right"><span className="block font-mono text-base font-black text-gray-200">{formatAmerican(currentDisplayedPrice(market))}</span>{market.currentPriceSportsbook ? <span className="block text-[7px] font-bold text-gray-600">{formatSportsbook(market.currentPriceSportsbook)}</span> : null}</span></div>
          <p className="mt-1 text-[10px] text-gray-500">Model <span className="font-black text-gray-200">{formatProbability(market.modelProb)}</span> · publish-time market <span className="font-black text-gray-200">{formatMarketProbability(market)}</span></p>
          {(probabilityGap !== null || market.recommendationConfidence !== null) ? <p className="mt-1 text-[9px] text-gray-600">Publish-time gap <span className="font-black text-gray-300">{probabilityGap === null ? "—" : `${probabilityGap > 0 ? "+" : ""}${probabilityGap.toFixed(1)} pp`}</span> · actionability <span className="font-black text-gray-300">{market.recommendationConfidence === null || market.recommendationConfidence === undefined ? "—" : `${market.recommendationConfidence.toFixed(0)}/100`}</span></p> : null}
        </div>
        <div className="mt-4 rounded-lg border border-violet-400/15 bg-violet-500/[0.05] p-3"><p className="text-xs leading-relaxed text-gray-300">{currentAwareGuidedGuide(market, market.whyLine)}</p><p className="mt-2 text-[10px] leading-relaxed text-amber-200/70"><span className="font-black text-amber-300">Where it gets less clean:</span> {displayRiskLine(market)}</p></div>
      </div>
      <div className="mt-4"><p className="text-[8px] font-black uppercase tracking-[0.16em] text-gray-600">Play grade</p><div className="mt-2"><VerdictBadge market={market} large /></div><GradeScale market={market} /></div>
      <DecisionMetricGrid market={market} />
    </div>
  );
}

function QuickMatchupIdentity({ game, sport }: { game: DailyEdgeGameDto; sport: Sport }) {
  const side = (team: string, logo: string | null, starter: DailyEdgeGameDto["awayStarter"]) => <div className="min-w-0 rounded-lg border border-white/[0.08] bg-black/25 p-3"><div className="flex items-center gap-2"><TeamLogo key={team} src={logo} label={team} /><p className="text-base font-black tracking-tight text-white">{team}</p></div>{sport === "mlb" ? <div className="mt-3 border-t border-white/[0.07] pt-2"><p className="text-[7px] font-black uppercase tracking-[0.15em] text-gray-600">Probable starter</p><p className="mt-1 truncate text-[12px] font-black text-gray-100">{starter?.name ?? "Starter TBD"}</p><span className="mt-1 inline-flex rounded border border-gray-700 bg-gray-800/60 px-1.5 py-0.5 text-[7px] font-black uppercase tracking-wider text-gray-400">{starter?.throws ? `${starter.throws}HP` : "Hand unknown"}</span></div> : <p className="mt-3 border-t border-white/[0.07] pt-2 text-[8px] font-bold uppercase tracking-[0.14em] text-gray-600">{sportLabel(sport)} matchup</p>}</div>;
  return <div><div className="mb-2 flex items-center justify-between"><p className="text-[8px] font-black uppercase tracking-[0.16em] text-emerald-200">Matchup</p><span className="text-[8px] font-black text-gray-600">{game.awayTeam} @ {game.homeTeam}</span></div><div className="grid grid-cols-[1fr_auto_1fr] items-stretch gap-2">{side(game.awayTeam, game.awayTeamLogo, game.awayStarter)}<span className="self-center text-[9px] font-black text-gray-700">AT</span>{side(game.homeTeam, game.homeTeamLogo, game.homeStarter)}</div></div>;
}

function IntegratedEvidence({ market, availability }: { market: MarketEdgeDto; availability: DailyEdgeGameAvailability | null }) {
  return (
    <div className="border-b border-white/[0.07] p-4 sm:p-5 lg:border-b-0 lg:border-r">
      <SectionHeading tone="violet">Market Intelligence</SectionHeading>
      <div className="mt-4 space-y-3">
        <CompactMarketPulse market={market} showSplits />
        {availability ? <AvailabilityContext report={availability} market={market} /> : null}
      </div>
    </div>
  );
}

function FirstInningIntelligence({ market }: { market: MarketEdgeDto }) {
  const projectionStat = market.keyStats.find((stat) => /projected.*(?:first|1st).*inning/i.test(stat.label));
  const projectionDisplay = projectionStat?.homeValue ?? projectionStat?.awayValue ?? "Not available";
  const projection = Number.parseFloat(projectionDisplay.replace(/[^\d.-]/g, ""));
  const gap = Number.isFinite(projection) ? projection - 0.5 : null;
  const board = market.fiMarketBoard ?? null;
  return <div className="h-full border-b border-white/[0.07] p-4 sm:p-5 lg:border-b-0 lg:border-r"><SectionHeading tone="violet">First-Inning Intelligence</SectionHeading><div className="mt-4 space-y-3"><CompactMarketPulse market={market} /><section className="rounded-xl border border-violet-400/20 bg-gradient-to-br from-violet-500/[0.08] to-black/20 p-4"><div className="flex flex-wrap items-start justify-between gap-3"><div><p className="text-[8px] font-black uppercase tracking-[0.16em] text-violet-200">Opening-frame decision</p><p className="mt-1 text-lg font-black text-white">{market.pick ?? "No FI side"}</p><p className="mt-1 text-[9px] text-gray-500">Model {formatProbability(market.modelProb)} · current {formatAmerican(currentDisplayedPrice(market))}{market.currentPriceSportsbook ? ` · ${formatSportsbook(market.currentPriceSportsbook)}` : ""}</p></div><VerdictBadge market={market} /></div><div className="mt-4 grid grid-cols-3 gap-2"><ProofCell label="Projected FI runs" value={projectionDisplay} note="Combined" tone="violet" /><ProofCell label="Decision line" value="0.5" note="One run decides" tone="gray" /><ProofCell label="Projection gap" value={gap === null ? "—" : `${gap > 0 ? "+" : ""}${gap.toFixed(2)}`} note={gap === null ? "Unavailable" : gap < 0 ? "Below line" : "Above line"} tone={gap !== null && ((gap < 0 && /NRFI|under/i.test(market.pick ?? "")) || (gap > 0 && /YRFI|over/i.test(market.pick ?? ""))) ? "emerald" : "gray"} /></div></section><FirstInningBoard board={board} /></div></div>;
}

function FirstInningRecentContext({ game, history, pitcherHistory, sample, pick }: { game: DailyEdgeGameDto; history: PreviewHistoryByTeam; pitcherHistory: { away: PreviewPitcherFirstInningSide; home: PreviewPitcherFirstInningSide } | null; sample: 5 | 10; pick: string | null }) {
  const awayHistory = (history[game.awayTeam] ?? []).slice(0, sample).filter((row) => row.firstInningRuns !== null);
  const homeHistory = (history[game.homeTeam] ?? []).slice(0, sample).filter((row) => row.firstInningRuns !== null);
  return <section className="border-t border-white/[0.07] bg-black/10 p-4 sm:p-5 xl:p-6"><div className="flex flex-wrap items-center justify-between gap-3"><div><SectionHeading tone="violet">Recent Opening-Frame Context</SectionHeading><p className="mt-2 text-[10px] text-gray-500">Each team&rsquo;s completed-game results paired with its probable starter</p></div><span className="shrink-0 rounded-full border border-white/[0.08] px-3 py-1.5 text-[9px] font-black text-gray-400">Actual L{sample}</span></div><div className="mt-5 grid gap-4 lg:grid-cols-2"><FirstInningEvidenceSide team={game.awayTeam} rows={awayHistory} starter={pitcherHistory?.away ?? null} sample={sample} pick={pick} /><FirstInningEvidenceSide team={game.homeTeam} rows={homeHistory} starter={pitcherHistory?.home ?? null} sample={sample} pick={pick} /></div><p className="mt-4 text-[9px] leading-relaxed text-gray-500">Green results support the displayed NRFI/YRFI read. Team results use combined first-inning scoring. Starter results show whether that starter&rsquo;s team allowed a first-inning run in games he started; they are context, not pitcher earned-run attribution.</p></section>;
}

function FirstInningBoard({ board }: { board: MarketEdgeDto["fiMarketBoard"] | undefined | null }) {
  if (!board) return <Unavailable label="A two-sided first-inning market board is not available in this snapshot." />;
  const side = (label: "YRFI" | "NRFI", current: number | null, open: number | null, previous: number | null) => <div className="rounded-lg border border-white/[0.08] bg-black/25 p-3"><div className="flex items-center justify-between gap-2"><p className="text-[9px] font-black text-gray-200">{label}</p><p className="font-mono text-sm font-black text-white">{formatAmerican(current)}</p></div><div className="mt-2 flex items-center gap-2 text-[7px] font-bold uppercase tracking-wider text-gray-600"><span>Open {formatAmerican(open)}</span><span>→</span>{previous !== null && previous !== open && previous !== current ? <><span>Prev {formatAmerican(previous)}</span><span>→</span></> : null}<span className="text-gray-400">Current {formatAmerican(current)}</span></div></div>;
  return <section className="rounded-xl border border-white/[0.09] bg-black/20 p-4"><div className="flex items-center justify-between gap-2"><div><p className="text-[8px] font-black uppercase tracking-[0.15em] text-gray-300">Two-sided FI price board</p><p className="mt-0.5 text-[7px] text-gray-600">Both outcomes shown; selected-side price is not treated as a public split</p></div><span className="text-[7px] font-black uppercase tracking-wider text-gray-600">{formatFiSource(board.source)}</span></div><div className="mt-3 grid gap-2 sm:grid-cols-2 lg:grid-cols-1 xl:grid-cols-2">{side("YRFI", board.yrfiAmerican, board.yrfiOpenAmerican ?? null, board.yrfiPreviousAmerican ?? null)}{side("NRFI", board.nrfiAmerican, board.nrfiOpenAmerican ?? null, board.nrfiPreviousAmerican ?? null)}</div></section>;
}

function formatFiSource(source: string | null): string {
  if (!source) return "Source unavailable";
  const normalized = source.replace(/^fi_market_ok_/i, "").replaceAll("_", " ").trim().toLowerCase();
  if (normalized === "ballybet") return "Bally Bet";
  if (normalized === "draftkings") return "DraftKings";
  if (normalized === "fanduel") return "FanDuel";
  if (normalized === "hardrock") return "Hard Rock";
  return normalized.replace(/\b\w/g, (character) => character.toUpperCase());
}

function FirstInningEvidenceSide({ team, rows, starter, sample, pick }: { team: string; rows: PreviewHistoryPoint[]; starter: PreviewPitcherFirstInningSide; sample: 5 | 10; pick: string | null }) {
  const scorelessCount = rows.filter((row) => row.firstInningRuns === 0).length;
  const scoringCount = rows.length - scorelessCount;
  const supportsYrfi = /yrfi/i.test(pick ?? "");
  const supportsNrfi = /nrfi/i.test(pick ?? "");
  const hasDirectionalPick = supportsYrfi || supportsNrfi;
  const supportingCount = supportsYrfi ? scoringCount : scorelessCount;
  const opposingCount = supportsYrfi ? scorelessCount : scoringCount;
  const supportingLabel = supportsYrfi ? "Games with 1+ first-inning run" : "Games with a scoreless first";
  const opposingLabel = supportsYrfi ? "Games with a scoreless first" : "Games with 1+ first-inning run";
  const chronologicalOutcomes = [...rows].reverse().map((row) => supportsYrfi ? (row.firstInningRuns ?? 0) > 0 : row.firstInningRuns === 0);
  const average = rows.length > 0 ? rows.reduce((sum, row) => sum + (row.firstInningRuns ?? 0), 0) / rows.length : null;
  const teamTone = hasDirectionalPick ? firstInningSupportTone(supportingCount, rows.length) : "neutral";
  const teamToneClass = teamTone === "support"
    ? "border-emerald-400/25 bg-emerald-400/[0.045]"
    : teamTone === "challenge"
      ? "border-rose-400/20 bg-rose-500/[0.035]"
      : "border-white/[0.10] bg-white/[0.025]";
  return (
    <div className={`rounded-xl border p-4 xl:p-5 ${teamToneClass}`}>
      <div className="flex items-center justify-between gap-3"><div className="flex items-center gap-2"><span className="text-base font-black text-white">{team}</span>{hasDirectionalPick && teamTone !== "neutral" ? <span className={`rounded-full border px-2 py-0.5 text-[7px] font-black uppercase tracking-wider ${teamTone === "support" ? "border-emerald-400/25 bg-emerald-400/[0.08] text-emerald-200" : "border-rose-400/20 bg-rose-400/[0.07] text-rose-200"}`}>{teamTone === "support" ? `Recent context aligns with ${pick}` : `Recent context opposes ${pick}`}</span> : null}</div><span className="text-[9px] font-black uppercase tracking-wider text-gray-500">Team · {rows.length} games</span></div>
      <div className="mt-4 grid gap-3 xl:grid-cols-2">
        <div className="rounded-lg border border-white/[0.07] bg-black/20 p-4">
          <div className="flex items-end justify-between gap-3"><div><p className={`font-mono text-3xl font-black ${hasDirectionalPick ? "text-emerald-300" : "text-sky-200"}`}>{rows.length === 0 ? "—" : `${supportingCount}/${rows.length}`}</p><p className="mt-1 text-[9px] font-black uppercase tracking-wider text-gray-300">{supportingLabel}</p></div><div className="text-right"><p className={`font-mono text-xl font-black ${hasDirectionalPick ? "text-rose-300" : "text-gray-300"}`}>{rows.length === 0 ? "—" : `${opposingCount}/${rows.length}`}</p><p className="mt-1 text-[8px] text-gray-500">{opposingLabel}</p></div></div>
          {rows.length > 0 ? <div className="mt-4"><SampleTally outcomes={chronologicalOutcomes} color="#34d399" hitLabel={supportsYrfi ? "1+ first-inning run" : "Scoreless first inning"} missLabel={supportsYrfi ? "Scoreless first inning" : "1+ first-inning run"} neutral={!hasDirectionalPick} /></div> : null}
          {rows.length > 0 ? <p className="mt-2 text-[8px] leading-relaxed text-gray-500">Each tile is one completed game. Oldest → newest · {hasDirectionalPick ? `green = supports ${pick} · red = opposes ${pick}` : "blue/gray = result context"}.</p> : <p className="mt-2 text-[8px] text-gray-500">No completed first-inning team sample is available.</p>}
          <div className="mt-4 flex items-center justify-between border-t border-white/[0.07] pt-3"><span className="text-[9px] text-gray-500">Avg first-inning runs</span><strong className="font-mono text-base text-gray-100">{average === null ? "—" : average.toFixed(1)}</strong></div>
        </div>
        <PitcherFirstInningRate starter={starter} sample={sample} pick={pick} />
      </div>
    </div>
  );
}

function PitcherFirstInningRate({ starter, sample, pick }: { starter: PreviewPitcherFirstInningSide; sample: 5 | 10; pick: string | null }) {
  const points = (starter?.points ?? []).slice(0, sample);
  const scorelessStarts = points.filter((point) => point.runsAllowed === 0).length;
  const average = points.length > 0 ? points.reduce((sum, point) => sum + point.runsAllowed, 0) / points.length : null;
  if (points.length === 0) return <div className="rounded-lg border border-dashed border-gray-700 bg-black/20 p-4"><p className="text-[8px] font-black uppercase tracking-[0.14em] text-sky-300">Starter opening frames</p><p className="mt-1 text-sm font-black text-white">{starter?.name ?? "Starter unavailable"}</p><p className="mt-3 text-[10px] font-black text-gray-300">No verified recent sample</p><p className="mt-1.5 text-[9px] leading-relaxed text-gray-500">{starter?.name ? `No completed starter games were linked to ${starter.name} in this snapshot. This is a data-availability gap, not a 0% result.` : "The probable starter was not available, so starter-specific first-inning history cannot be shown."}</p></div>;
  const supportsYrfi = /yrfi/i.test(pick ?? "");
  const supportsNrfi = /nrfi/i.test(pick ?? "");
  const hasDirectionalPick = supportsYrfi || supportsNrfi;
  const supportingStarts = supportsYrfi ? points.length - scorelessStarts : scorelessStarts;
  const tone = hasDirectionalPick ? firstInningSupportTone(supportingStarts, points.length) : "neutral";
  const toneClass = tone === "support" ? "border-emerald-400/25 bg-emerald-400/[0.045]" : tone === "challenge" ? "border-rose-400/20 bg-rose-500/[0.035]" : "border-sky-400/15 bg-sky-400/[0.035]";
  const primaryCount = supportsYrfi ? points.length - scorelessStarts : scorelessStarts;
  const primaryLabel = supportsYrfi ? "Starts with 1+ first-inning run allowed" : "Starts with no first-inning run allowed";
  return <div className={`rounded-lg border p-4 ${toneClass}`}><div className="flex items-start justify-between gap-2"><div><p className="text-[8px] font-black uppercase tracking-[0.14em] text-sky-300">Starter opening frames</p><p className="mt-1 text-sm font-black text-white">{starter?.name ?? "Starter unavailable"}</p></div>{hasDirectionalPick && tone !== "neutral" ? <span className={`rounded-full border px-2 py-0.5 text-[7px] font-black uppercase tracking-wider ${tone === "support" ? "border-emerald-400/25 bg-emerald-400/[0.08] text-emerald-200" : "border-rose-400/20 bg-rose-400/[0.07] text-rose-200"}`}>{tone === "support" ? `Recent context aligns with ${pick}` : `Recent context opposes ${pick}`}</span> : null}</div><div className="mt-3 flex items-end justify-between gap-3"><div><p className={`font-mono text-xl font-black ${tone === "support" ? "text-emerald-300" : tone === "challenge" ? "text-rose-300" : "text-white"}`}>{primaryCount}/{points.length}</p><p className="mt-0.5 text-[8px] text-gray-500">{primaryLabel}</p></div><div className="text-right"><p className="font-mono text-sm font-black text-gray-200">{average === null ? "—" : average.toFixed(2)}</p><p className="mt-0.5 text-[8px] text-gray-500">Avg FI runs allowed</p></div></div><p className="mt-3 border-t border-white/[0.07] pt-3 text-[9px] leading-relaxed text-gray-500">{primaryCount} of {points.length} recent starts aligned with {pick ?? "the displayed FI read"}. This is recent-result context, not the model grade itself, and each starter is evaluated against the prediction independently.</p></div>;
}

function DecisionMetricGrid({ market }: { market: MarketEdgeDto }) {
  const probabilityGap = displayedProbabilityGap(market);
  return <div className="mt-4"><p className="text-[8px] font-black uppercase tracking-[0.16em] text-gray-600">Decision metrics</p><div className="mt-2 grid grid-cols-2 gap-2"><ProofCell label="Model" value={formatProbability(market.modelProb)} note="OddSphere probability" tone="violet" /><ProofCell label="Market at publish" value={formatMarketProbability(market)} note={market.marketSource ? `${market.marketSource} · no-vig` : "Unavailable"} tone="gray" /><ProofCell label="Publish-time gap" value={probabilityGap === null ? "—" : `${probabilityGap > 0 ? "+" : ""}${probabilityGap.toFixed(1)} pp`} note="Displayed probability gap" tone={probabilityGap !== null && probabilityGap >= 1 ? "emerald" : "gray"} /><ProofCell label="Actionability" value={market.recommendationConfidence === null || market.recommendationConfidence === undefined ? "—" : `${market.recommendationConfidence.toFixed(0)}/100`} note="Recommendation confidence" tone="violet" /></div></div>;
}

function CompactMarketPulse({ market, showSplits = false }: { market: MarketEdgeDto; showSplits?: boolean }) {
  const movement = resolveCoherentMovement(market);
  const claimsDirectionalMove = market.marketReadV2?.movement?.directionRelativeToPick === "support" || market.marketReadV2?.movement?.directionRelativeToPick === "resistance";
  const movementClaimIsUnverified = claimsDirectionalMove && !movement.coherentTrail;
  const presentation = sourceCoherentMarketPulse(market, movement);
  const chip = movementClaimIsUnverified ? "Directional Move Unavailable" : presentation.chip;
  const detail = movementClaimIsUnverified ? "The current market is available, but this snapshot does not contain a continuous same-book trail that can support a directional movement claim." : presentation.detail;
  const tone = movementClaimIsUnverified ? "gray" : presentation.tone;
  const style = pulseToneStyle(tone);
  return (
    <div className={`rounded-xl border bg-gradient-to-r to-transparent p-4 ${style.container}`}>
      <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
        <div><div className="flex flex-wrap items-center gap-2"><p className={`text-[8px] font-black uppercase tracking-[0.18em] ${style.title}`}>OddSphere Market Pulse</p><span className={`rounded-full border px-2 py-0.5 text-[7px] font-black uppercase tracking-wider ${style.badge}`}>{style.label}</span></div><p className="mt-1 text-sm font-black text-white">{chip}</p></div>
        <span className="text-[8px] font-bold text-gray-600">Real market snapshot</span>
      </div>
      <p className="mt-3 text-[10px] leading-relaxed text-gray-400">{detail || "No additional market interpretation is available for this snapshot."}</p>
      {showSplits
        ? <CompactOddsMovement market={market} tone={tone} lineClass={style.line} />
        : <CompactFirstInningOddsMovement market={market} tone={tone} lineClass={style.line} />}
      {showSplits ? <DefaultSplitSummary market={market} /> : null}
    </div>
  );
}

function CompactFirstInningOddsMovement({ market, tone, lineClass }: { market: MarketEdgeDto; tone: "emerald" | "amber" | "gray"; lineClass: string }) {
  const board = market.fiMarketBoard ?? null;
  if (!board) {
    return <section className="mt-3 rounded-lg border border-white/[0.09] bg-black/25 p-3"><p className="text-[8px] font-black uppercase tracking-[0.15em] text-gray-300">First-inning odds</p><p className="mt-2 text-[8px] leading-relaxed text-gray-600">A verified two-sided NRFI/YRFI price board is unavailable in this snapshot.</p></section>;
  }
  const directionalPick = /^(NRFI|YRFI)$/i.test(market.pick?.trim() ?? "");
  const row = (label: "NRFI" | "YRFI", open: number | null, previous: number | null, current: number | null) => {
    const trail = [
      open === null ? null : { label: "Open", value: open },
      previous === null || previous === open || previous === current ? null : { label: "Prior observed", value: previous },
      current === null ? null : { label: "Current", value: current },
    ].filter((point): point is { label: string; value: number } => point !== null);
    const hasEarlierObservation = open !== null || (previous !== null && previous !== current);
    return <div className="rounded-lg border border-white/[0.08] bg-black/25 p-3"><div className="flex items-center justify-between gap-2"><p className="text-[9px] font-black text-gray-200">{label}</p><p className="font-mono text-sm font-black text-white">{formatAmerican(current)}</p></div>{trail.length > 0 ? <div className="mt-3 flex items-center gap-2">{trail.map((point, index) => <div key={`${label}-${point.label}`} className="contents">{index > 0 ? <div className={`h-px min-w-3 flex-1 bg-gradient-to-r ${lineClass}`} /> : null}<div className="min-w-0"><p className="text-[6px] font-black uppercase tracking-wider text-gray-600">{point.label}</p><p className={`mt-0.5 font-mono text-[11px] font-black ${point.label === "Current" && tone === "emerald" ? "text-emerald-300" : point.label === "Current" && tone === "amber" ? "text-amber-300" : "text-gray-200"}`}>{formatAmerican(point.value)}</p></div></div>)}</div> : <p className="mt-3 text-[8px] text-gray-600">No verified price is available for this side.</p>}{current !== null && !hasEarlierObservation ? <p className="mt-2 text-[7px] leading-relaxed text-gray-600">Current price only; an earlier same-book observation was not stored for this side.</p> : null}</div>;
  };
  return <section className="mt-3 rounded-lg border border-white/[0.09] bg-black/20 p-3"><div className="flex items-center justify-between gap-2"><div><p className="text-[8px] font-black uppercase tracking-[0.15em] text-gray-300">First-inning odds movement</p><p className="mt-0.5 text-[7px] font-semibold text-gray-600">NRFI and YRFI · {formatFiSource(board.source)} · {board.line === null ? "line unavailable" : `line ${formatNumber(board.line)}`}</p></div><span className="text-[7px] font-black uppercase tracking-wider text-gray-500">Two-sided market</span></div><div className="mt-3 grid gap-2 xl:grid-cols-2">{row("NRFI", board.nrfiOpenAmerican ?? null, board.nrfiPreviousAmerican ?? null, board.nrfiAmerican)}{row("YRFI", board.yrfiOpenAmerican ?? null, board.yrfiPreviousAmerican ?? null, board.yrfiAmerican)}</div><p className="mt-2 text-[7px] leading-relaxed text-gray-600">{directionalPick ? `Both outcomes are shown for context. Directional support for ${market.pick} is only claimed when its same-book price trail is verified.` : "Both outcomes are shown because a Toss-Up has no selected side. No directional movement claim is made without a verified selected-side trail."}</p></section>;
}

function CompactOddsMovement({ market, tone, lineClass }: { market: MarketEdgeDto; tone: "emerald" | "amber" | "gray"; lineClass: string }) {
  const movement = resolveCoherentMovement(market);
  const publishedIsVerified = market.oddspherePostedMatchesPick === true;
  const trackedBook = movement.sportsbook;
  const pickAlreadyIncludesLine = market.pick !== null && /(?:^|\s)[+-]?\d+(?:\.\d+)?(?:\s|$)/.test(market.pick);
  const trackedLine = movement.currentLine ?? market.line;
  const pickContext = market.pick && trackedLine !== null && !pickAlreadyIncludesLine ? `${market.pick} ${formatNumber(trackedLine)}` : market.pick;
  const context = [pickContext, trackedBook ? formatSportsbook(trackedBook) : null, movement.coherentTrail ? "same-book trail" : null].filter(Boolean).join(" · ");
  const evaluatedPrice = market.gradePriceAmerican ?? market.priceAmerican;
  const currentPrice = currentDisplayedPrice(market);
  const evaluationDiffers = evaluatedPrice !== null && currentPrice !== null && evaluatedPrice !== currentPrice;
  return <section className="mt-3 rounded-lg border border-white/[0.09] bg-black/25 p-3"><div className="flex items-center justify-between gap-2"><div><p className="text-[8px] font-black uppercase tracking-[0.15em] text-gray-300">Odds movement</p>{context ? <p className="mt-0.5 text-[7px] font-semibold text-gray-600">{context}</p> : null}</div><span className={`text-[7px] font-black uppercase tracking-wider ${tone === "emerald" ? "text-emerald-300" : tone === "amber" ? "text-amber-300" : "text-gray-500"}`}>{tone === "emerald" ? "Supporting" : tone === "amber" ? "Resisting" : "Neutral"}</span></div><div className="mt-3 grid grid-cols-[auto_1fr_auto_1fr_auto] items-center gap-2"><PricePoint label="First observed" value={formatAmerican(movement.open)} line={movement.openLine} /><div className={`h-px bg-gradient-to-r ${lineClass}`} /><PricePoint label="Prior observed" value={formatAmerican(movement.previous)} line={movement.previousLine} /><div className={`h-px bg-gradient-to-r ${lineClass}`} /><PricePoint label="Current" value={formatAmerican(movement.current)} line={movement.currentLine} tone={tone} /></div>{evaluationDiffers ? <p className="mt-2 text-[7px] leading-relaxed text-gray-600">Current quote {formatAmerican(currentPrice)}{market.currentPriceSportsbook ? ` at ${formatSportsbook(market.currentPriceSportsbook)}` : ""}; recommendation evaluated at {formatAmerican(evaluatedPrice)}. Live movement does not silently re-grade the pick.</p> : null}{movement.coherentTrail ? null : <p className="mt-2 text-[7px] leading-relaxed text-gray-600">Directional movement is unavailable because a continuous same-book trail could not be verified. The current price is shown for context only.</p>}{market.oddspherePostedAmerican != null && !publishedIsVerified ? <p className="mt-1 text-[7px] leading-relaxed text-gray-600">Published price omitted because its selected side was not explicitly verified.</p> : null}</section>;
}

function AvailabilityContext({ report, market }: { report: DailyEdgeGameAvailability; market: MarketEdgeDto }) {
  const players = report.teams.flatMap((team) => team.players);
  if (players.length === 0) return <Unavailable label="The external availability report returned no listed players; absence is not treated as confirmed availability." />;
  const relationship = availabilityMoveRelationship(report, market);
  const latestReport = latestAvailabilityReportTime(report);
  return <section className="rounded-xl border border-amber-300/20 bg-gradient-to-br from-amber-400/[0.07] to-black/20 p-4"><div className="flex items-start justify-between gap-3"><div><p className="text-[8px] font-black uppercase tracking-[0.16em] text-amber-200">Injuries &amp; Availability</p><p className="mt-1 text-[11px] font-black text-white">{report.sourceLabel}</p><p className="mt-1 text-[7px] text-gray-600">{latestReport ? `Latest listed update · ${formatAvailabilityTime(latestReport)}` : "Report time unavailable"}</p></div>{report.sourceUrl ? <a href={report.sourceUrl} target="_blank" rel="noreferrer" className="rounded-full border border-white/[0.10] px-2 py-1 text-[7px] font-black uppercase tracking-wider text-gray-400 hover:text-white">View source ↗</a> : <span className="rounded-full border border-white/[0.08] px-2 py-1 text-[7px] font-black uppercase tracking-wider text-gray-500">{report.source}</span>}</div><div className="mt-3 grid grid-cols-2 gap-2">{report.teams.map((team) => <div key={team.abbreviation} className="rounded-lg border border-white/[0.08] bg-black/25 px-3 py-2"><div className="flex items-center justify-between gap-2"><p className="text-[9px] font-black text-white">{team.abbreviation}</p><span className="text-[8px] font-black text-amber-200">{team.players.length} listed</span></div><p className="mt-1 truncate text-[7px] text-gray-600">{team.players.length > 0 ? team.players.map((player) => player.name).join(", ") : "No players listed"}</p></div>)}</div><p className="mt-3 text-[8px] leading-relaxed text-gray-500">{relationship}</p><details className="group mt-3 rounded-lg border border-white/[0.08] bg-black/20 px-3"><summary className="flex cursor-pointer list-none items-center justify-between py-2 text-[8px] font-black text-gray-300"><span>View {players.length} reported player{players.length === 1 ? "" : "s"}</span><span className="text-gray-600 transition-transform group-open:rotate-180">⌄</span></summary><div className="grid gap-2 border-t border-white/[0.06] py-3 sm:grid-cols-2 lg:grid-cols-1 xl:grid-cols-2">{report.teams.map((team) => <AvailabilityTeam key={team.abbreviation} team={team} />)}</div></details><p className="mt-3 text-[7px] leading-relaxed text-gray-600">This external report is explanatory context only. It does not change the displayed OddSphere prediction, grade, or stake, and an omitted player is not treated as confirmed available.</p></section>;
}

function AvailabilityTeam({ team }: { team: DailyEdgeTeamAvailability }) {
  return <div className="rounded-lg border border-white/[0.08] bg-black/25 p-3"><div className="flex items-center justify-between gap-2"><p className="text-[9px] font-black text-white">{team.abbreviation}</p><span className="text-[7px] font-bold text-gray-600">{team.players.length} listed</span></div>{team.players.length > 0 ? <div className="mt-2 space-y-2">{team.players.map((player) => <div key={`${player.name}-${player.reportedAt}`} className="border-t border-white/[0.06] pt-2 first:border-t-0 first:pt-0"><div className="flex items-start justify-between gap-2"><p className="text-[8px] font-black text-gray-200">{player.name}{player.position ? <span className="ml-1 font-semibold text-gray-600">{player.position}</span> : null}</p><span className="rounded-full border border-amber-400/20 bg-amber-400/[0.07] px-1.5 py-0.5 text-[6px] font-black uppercase text-amber-200">{player.status}</span></div><p className="mt-0.5 text-[7px] text-gray-600">{player.detail ?? "Reason unavailable"}{player.reportedAt ? ` · ${formatAvailabilityTime(player.reportedAt)}` : " · time unavailable"}</p></div>)}</div> : <p className="mt-2 text-[7px] text-gray-600">No listed players in this report.</p>}</div>;
}

function availabilityMoveRelationship(report: DailyEdgeGameAvailability, market: MarketEdgeDto): string {
  if (report.source === "Playbook") {
    return "This team injury report is current slate context. It does not establish that an absence caused the price move or that every listed player affects this matchup equally.";
  }
  const reportTimes = report.teams.flatMap((team) => team.players).map((player) => Date.parse(player.reportedAt ?? "")).filter(Number.isFinite);
  const moveTimes = (market.oddsTrail ?? []).map((stop) => Date.parse(stop.observedAt ?? "")).filter(Number.isFinite);
  if (reportTimes.length === 0 || moveTimes.length < 2) return "Listed availability belongs beside the market move, but the stored timestamps are not complete enough to claim what caused it.";
  const firstMove = Math.min(...moveTimes);
  const lastMove = Math.max(...moveTimes);
  const overlaps = reportTimes.some((time) => time >= firstMove && time <= lastMove);
  return overlaps
    ? "At least one availability update falls inside the tracked same-book movement window. That timing is relevant context, but it does not by itself prove causation."
    : "The report and market trail are both verified, but their stored timestamps do not establish that the listed availability caused this move.";
}

function formatAvailabilityTime(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "time unavailable";
  return new Intl.DateTimeFormat("en-US", { timeZone: "America/New_York", hour: "numeric", minute: "2-digit", timeZoneName: "short" }).format(date);
}

function latestAvailabilityReportTime(report: DailyEdgeGameAvailability): string | null {
  const times = report.teams
    .flatMap((team) => team.players)
    .map((player) => player.reportedAt)
    .filter((value): value is string => value !== null)
    .sort((a, b) => Date.parse(b) - Date.parse(a));
  return times[0] ?? report.reportUpdatedAt;
}

type OddsTrailStop = NonNullable<MarketEdgeDto["oddsTrail"]>[number];

function resolveCoherentMovement(market: MarketEdgeDto): { open: number | null; previous: number | null; current: number | null; openLine: number | null; previousLine: number | null; currentLine: number | null; sportsbook: string | null; coherentTrail: boolean } {
  const displayedPrice = currentDisplayedPrice(market);
  const displayedBook = currentDisplayedSportsbook(market);
  const trail = (market.oddsTrail ?? [])
    .filter((stop) => Number.isFinite(stop.american))
    .map((stop) =>
      stop.label === "current" &&
      (stop.sportsbook === "recommendation_snapshot" || !stop.sportsbook) &&
      displayedBook !== null &&
      displayedPrice === stop.american
        ? { ...stop, sportsbook: displayedBook }
        : stop
    );
  const groups = new Map<string, OddsTrailStop[]>();
  for (const stop of trail) {
    if (!stop.sportsbook || stop.sportsbook === "recommendation_snapshot" || stop.sportsbook === "locked_snapshot") continue;
    // oddsTrail is already scoped to the displayed market and picked side.
    // Group by book—not by point line—so a real same-book total/spread move
    // (for example 183.5 → 176.5) remains visible instead of being split into
    // unrelated one-point groups.
    const key = stop.sportsbook;
    const group = groups.get(key) ?? [];
    group.push(stop);
    groups.set(key, group);
  }
  const coherent = Array.from(groups.values())
    // A historical same-book sequence is not a current trail unless that
    // same book also owns the terminal current/locked endpoint. Without this
    // guard an older `move` row can be mislabeled "Current" simply because it
    // is the last observation available for that sportsbook.
    .filter((group) => group.length >= 2 && group.some((stop) => stop.label === "current" || stop.label === "locked"))
    .sort((a, b) => b.length - a.length)[0];
  if (coherent) {
    const first = coherent[0]!;
    const terminal = coherent[coherent.length - 1]!;
    // Prefer the latest genuinely different quote so Prior communicates a
    // movement rather than repeating Current. If the book has multiple timed
    // observations but the quote never changed, retain the latest observation
    // as Prior so the timestamped three-point history remains honest.
    let previous: OddsTrailStop | null = null;
    for (let index = coherent.length - 2; index > 0; index -= 1) {
      const candidate = coherent[index]!;
      if (candidate.american !== terminal.american || !sameTrackedLine(candidate.line, terminal.line)) {
        previous = candidate;
        break;
      }
    }
    if (previous === null && coherent.length > 2) previous = coherent[coherent.length - 2]!;
    return { open: first.american, previous: previous?.american ?? null, current: terminal.american, openLine: first.line, previousLine: previous?.line ?? null, currentLine: terminal.line ?? first.line, sportsbook: terminal.sportsbook, coherentTrail: true };
  }
  const canonical = market.marketReadV2?.movement;
  const canonicalLineIsStable = canonical !== null && canonical !== undefined && sameTrackedLine(canonical.firstTrackedLine, canonical.currentLine);
  return {
    open: canonicalLineIsStable ? canonical.firstTrackedPrice : null,
    previous: null,
    current: canonical?.currentPrice ?? currentDisplayedPrice(market),
    openLine: canonicalLineIsStable ? canonical.firstTrackedLine : null,
    previousLine: null,
    currentLine: canonical?.currentLine ?? market.line,
    sportsbook: null,
    coherentTrail: false,
  };
}

function formatSportsbook(value: string): string {
  const known: Record<string, string> = { fanduel: "FanDuel", draftkings: "DraftKings", betmgm: "BetMGM", hardrock: "Hard Rock", thescorebet: "theScore Bet", betonline: "BetOnline", ballybet: "Bally Bet", pinnacle: "Pinnacle", circa: "Circa", saba: "Saba" };
  return known[value.toLowerCase()] ?? value.replaceAll("_", " ").replace(/\b\w/g, (character) => character.toUpperCase());
}

function sameTrackedLine(first: number | null, current: number | null): boolean {
  if (first === null || current === null) return first === current;
  return Math.abs(first - current) < 0.001;
}

type MarketPulseTone = "emerald" | "amber" | "gray";
type CoherentMovement = ReturnType<typeof resolveCoherentMovement>;

function sourceCoherentMarketPulse(market: MarketEdgeDto, movement: CoherentMovement): { chip: string; detail: string; tone: MarketPulseTone } {
  const decision = market.recommendationDecision;
  // `publicSplits` is the display authority: response-time provider data on
  // open cards and the persisted recommendation snapshot after lock. The
  // pulse and the bars must describe the same coherent snapshot.
  const consensus = displayedConsensusSection(market);
  const sharp = decision?.sharpBookSplits ?? null;
  const consensusSignal = splitSectionSignal(consensus);
  const sharpSignal = splitSectionSignal(sharp);
  const consensusLeader = consensusSignal.direction;
  const sharpLeader = sharpSignal.direction;
  const splitConflict = splitSourcesConflict(consensus, sharp);
  const staleSplits = splitSectionIsStale(consensus) || splitSectionIsStale(sharp);
  const movementDirection = coherentMovementDirection(market, movement);
  const movementCopy = coherentMovementSummary(market, movement, movementDirection);
  const splitCopy = splitConflict && consensusLeader && sharpLeader
    ? `Public consensus money leans ${consensusLeader}, while the ${splitSectionIsStale(sharp) ? "older " : ""}sharp-book split snapshot leans ${sharpLeader}.`
    : null;
  const freshnessCopy = staleSplits ? "At least one displayed split source is stale, so it is historical context—not a current sharp-money claim." : null;

  if (splitConflict) {
    return {
      chip: "Split sources disagree",
      detail: [movementCopy, splitCopy, freshnessCopy].filter(Boolean).join(" "),
      tone: "gray",
    };
  }

  if (movementDirection === "support") {
    return { chip: "Price movement supports our side", detail: [movementCopy, freshnessCopy].filter(Boolean).join(" "), tone: "emerald" };
  }
  if (movementDirection === "resistance") {
    return { chip: "Price movement resists our side", detail: [movementCopy, freshnessCopy].filter(Boolean).join(" "), tone: "amber" };
  }

  if (consensusSignal.internallySplit || sharpSignal.internallySplit) {
    const sections = [
      consensusSignal.internallySplit && consensusSignal.moneyLeader && consensusSignal.ticketLeader
        ? `Public money leans ${consensusSignal.moneyLeader}, while public tickets lean ${consensusSignal.ticketLeader}.`
        : null,
      sharpSignal.internallySplit && sharpSignal.moneyLeader && sharpSignal.ticketLeader
        ? `Sharp-book money leans ${sharpSignal.moneyLeader}, while sharp-book tickets lean ${sharpSignal.ticketLeader}.`
        : null,
      !sharpSignal.internallySplit && sharpLeader
        ? `The sharp-book snapshot ${splitLeanStrength(sharp, market.pick ?? "") === "slight" ? "slightly " : ""}leans ${sharpLeader}.`
        : null,
    ];
    return {
      chip: consensusSignal.internallySplit ? "Public consensus is split" : "Sharp-book splits are mixed",
      detail: [movementCopy, ...sections, freshnessCopy].filter(Boolean).join(" "),
      tone: "gray",
    };
  }

  if (sharpLeader && market.pick && !splitSectionIsStale(sharp)) {
    const sharpSupports = sideMatchesPick(sharpLeader, market.pick);
    const strength = splitLeanStrength(sharp, market.pick);
    const slight = strength === "slight";
    return {
      chip: sharpSupports
        ? slight ? "Sharp-book splits slightly lean our side" : "Sharp-book splits support our side"
        : slight ? "Sharp-book splits slightly lean against our side" : "Sharp-book splits lean against our side",
      detail: [movementCopy, `The current sharp-book split snapshot ${slight ? "slightly " : ""}leans ${sharpLeader}.`].filter(Boolean).join(" "),
      tone: slight ? "gray" : sharpSupports ? "emerald" : "amber",
    };
  }

  const rawChip = market.marketReadV2?.label ?? decision?.resolvedMarketRead.label ?? market.marketInterpretation?.chipLabel ?? market.verdict.label;
  const rawDetail = market.marketReadV2?.explanation ?? decision?.resolvedMarketRead.copy ?? market.marketInterpretation?.detail?.[0] ?? market.riskLine;
  if (/sharp money/i.test(rawChip)) {
    const consensusSupports = consensusLeader && market.pick ? sideMatchesPick(consensusLeader, market.pick) : null;
    return {
      chip: consensusSupports === true ? "Consensus money split supports our side" : consensusSupports === false ? "Consensus money split leans against our side" : "Consensus split signal",
      detail: [movementCopy, rawDetail.replace(/sharp money/gi, "consensus money split"), freshnessCopy].filter(Boolean).join(" "),
      tone: consensusSupports === true ? "emerald" : consensusSupports === false ? "amber" : "gray",
    };
  }
  return {
    chip: rawChip,
    detail: [movementCopy, rawDetail, freshnessCopy].filter(Boolean).join(" "),
    tone: market.marketReadV2?.tone ?? decision?.resolvedMarketRead.tone ?? market.marketInterpretation?.chipTone ?? "gray",
  };
}

function currentAwareGuidedGuide(market: MarketEdgeDto, fallback: string): string {
  const guide = market.guidedGuide || fallback;
  if (!/market support is on the same side/i.test(guide)) return guide;
  const pulse = sourceCoherentMarketPulse(market, resolveCoherentMovement(market));
  if (pulse.tone === "emerald") return guide;
  const currentMarketCopy = pulse.tone === "amber"
    ? " Current market signals add resistance."
    : " Current market signals are mixed.";
  return guide.replace(/,?\s*and market support is on the same side\./i, ".") + currentMarketCopy;
}

function coherentMovementDirection(market: MarketEdgeDto, movement: CoherentMovement): "support" | "resistance" | "neutral" {
  if (!movement.coherentTrail || movement.open === null || movement.current === null) return "neutral";
  if (!sameTrackedLine(movement.openLine, movement.currentLine)) {
    const direction = market.marketReadV2?.movement?.directionRelativeToPick;
    return direction === "support" || direction === "resistance" ? direction : "neutral";
  }
  const impliedDelta = americanImpliedPct(movement.current) - americanImpliedPct(movement.open);
  if (Math.abs(impliedDelta) < 1.25) return "neutral";
  return impliedDelta > 0 ? "support" : "resistance";
}

function coherentMovementSummary(market: MarketEdgeDto, movement: CoherentMovement, direction: "support" | "resistance" | "neutral"): string | null {
  if (!movement.coherentTrail || movement.open === null || movement.current === null) return null;
  const book = movement.sportsbook ? `${formatSportsbook(movement.sportsbook)} ` : "The same-book trail ";
  if (
    movement.openLine !== null &&
    movement.currentLine !== null &&
    !sameTrackedLine(movement.openLine, movement.currentLine)
  ) {
    const directionCopy = direction === "neutral"
      ? "with no verified directional edge"
      : `${direction === "support" ? "toward" : "against"} our side`;
    return `${book}line moved from ${formatNumber(movement.openLine)} (${formatAmerican(movement.open)}) to ${formatNumber(movement.currentLine)} (${formatAmerican(movement.current)}), ${directionCopy}.`;
  }
  const line = movement.currentLine ?? market.line;
  const lineCopy = line === null ? "" : ` at ${formatNumber(line)}`;
  if (direction === "neutral") return `${book}moved from ${formatAmerican(movement.open)} to ${formatAmerican(movement.current)}${lineCopy}; effectively flat.`;
  return `${book}moved from ${formatAmerican(movement.open)} to ${formatAmerican(movement.current)}${lineCopy}, ${direction === "support" ? "toward" : "against"} our side.`;
}

function americanImpliedPct(value: number): number {
  return value < 0 ? (-value / (-value + 100)) * 100 : (100 / (value + 100)) * 100;
}

function DefaultSplitSummary({ market }: { market: MarketEdgeDto }) {
  const decision = market.recommendationDecision;
  const consensus = displayedConsensusSection(market);
  const sharp = decision?.sharpBookSplits ?? null;
  const displayedConflict = splitSourcesConflict(consensus, sharp);
  const conflictIsHistorical = displayedConflict && (splitSectionIsStale(consensus) || splitSectionIsStale(sharp));
  if (consensus === null && sharp === null) return <Unavailable label="Consensus and sharp-book split data are unavailable for this market." />;
  const hasSharpSource = sharp !== null;
  return (
    <div className="mt-3 border-t border-white/[0.06] pt-3">
      <div className="flex flex-wrap items-center justify-between gap-2"><div><p className="text-[8px] font-black uppercase tracking-[0.15em] text-gray-300">Market splits</p><p className="mt-0.5 text-[7px] text-gray-600">{hasSharpSource ? "Public consensus and sharp-book activity remain separate signals" : "Public consensus money and ticket distribution"}</p></div>{displayedConflict ? <span className="rounded-full border border-amber-400/25 bg-amber-400/[0.08] px-2 py-0.5 text-[7px] font-black uppercase tracking-wider text-amber-200">{conflictIsHistorical ? "Historical source conflict" : "Sources conflict"}</span> : null}</div>
      <div className="mt-2 grid gap-2">
        <SplitSourcePanel source="PUBLIC CONSENSUS" section={consensus} pick={market.pick} />
        {sharp ? <SplitSourcePanel source={sharp.label === "Sharp Book Signal" ? "SHARP BOOK SIGNAL" : "SHARP BOOK SPLITS"} section={sharp} pick={market.pick} /> : null}
      </div>
      {sharp?.rows.length ? <CrossSourceSplitRead consensus={consensus} sharp={sharp} /> : null}
    </div>
  );
}

function SplitSourcePanel({ source, section, pick }: { source: "PUBLIC CONSENSUS" | "SHARP BOOK SPLITS" | "SHARP BOOK SIGNAL"; section: MarketSplitDisplaySection | null; pick: string | null }) {
  const moneyLeader = splitLeader(section, "moneyPct");
  const ticketLeader = splitLeader(section, "betsPct");
  const isSharp = source !== "PUBLIC CONSENSUS";
  const stale = splitSectionIsStale(section);
  return <section className={`rounded-lg border p-3 ${isSharp ? "border-violet-400/20 bg-violet-500/[0.045]" : "border-white/[0.10] bg-black/20"}`}><div className="flex items-start justify-between gap-2"><div><div className="flex flex-wrap items-center gap-1.5"><p className={`text-[8px] font-black uppercase tracking-[0.14em] ${isSharp ? "text-violet-200" : "text-gray-300"}`}>{source}</p>{stale ? <span className="rounded-full border border-amber-400/20 bg-amber-400/[0.07] px-1.5 py-0.5 text-[6px] font-black uppercase tracking-wider text-amber-200">Stale snapshot</span> : null}</div><p className="mt-0.5 text-[7px] text-gray-600">{section?.lastUpdated ? formatTimestamp(section.lastUpdated) : section ? "Current snapshot" : "Unavailable"}</p></div>{moneyLeader ? <span className="rounded-full border border-white/[0.09] bg-black/20 px-2 py-0.5 text-[7px] font-black text-gray-300">Money → {moneyLeader}</span> : null}</div>{section?.rows.length ? <div className="mt-3 space-y-3">{section.rows.slice(0, 2).map((row) => <SplitSideCard key={`${source}-${row.side}`} label={row.label} moneyPct={row.moneyPct} betsPct={row.betsPct} isPick={sideMatchesPick(row.label, pick)} />)}</div> : section?.signal ? <p className="mt-3 text-[9px] leading-relaxed text-gray-400">{section.signal}</p> : null}{moneyLeader && ticketLeader && moneyLeader.toLowerCase() !== ticketLeader.toLowerCase() ? <p className="mt-3 border-t border-white/[0.06] pt-2 text-[8px] leading-relaxed text-amber-200/80">Money leans {moneyLeader}; ticket count leans {ticketLeader}.</p> : null}</section>;
}

function SplitSideCard({ label, moneyPct, betsPct, isPick }: { label: string; moneyPct: number | null; betsPct: number | null; isPick: boolean }) {
  return <div><div className="mb-1.5 flex items-center gap-1.5"><p className="text-[9px] font-black text-gray-200">{label}</p>{isPick ? <span className="rounded border border-violet-400/20 bg-violet-400/[0.07] px-1.5 py-0.5 text-[6px] font-black uppercase tracking-wider text-violet-200">Our read</span> : null}</div><div className="space-y-1.5"><SingleSplitBar label="Money" value={moneyPct} /><SingleSplitBar label="Tickets" value={betsPct} /></div></div>;
}

function SingleSplitBar({ label, value }: { label: "Money" | "Tickets"; value: number | null }) {
  const width = value === null ? 0 : Math.max(0, Math.min(100, value));
  const fill = label === "Money" ? "from-violet-700 to-violet-300" : "from-violet-900 to-violet-500";
  return <div className="grid grid-cols-[48px_1fr_38px] items-center gap-2.5"><span className="text-[8px] font-black uppercase tracking-wider text-gray-400">{label}</span><div className="relative h-4 overflow-hidden rounded-md border border-white/[0.08] bg-white/[0.07] shadow-inner"><span className={`absolute inset-y-0 left-0 rounded-[3px] bg-gradient-to-r ${fill} shadow-[0_0_12px_rgba(167,139,250,0.35)] transition-[width] duration-300`} style={{ width: `${width}%` }} /><span className="absolute inset-y-0 left-1/2 w-px bg-white/25" /><span className="absolute inset-y-0 left-1/4 w-px bg-white/[0.07]" /><span className="absolute inset-y-0 left-3/4 w-px bg-white/[0.07]" /></div><span className="text-right font-mono text-[10px] font-black text-white">{value === null ? "—" : `${Math.round(value)}%`}</span></div>;
}

function CrossSourceSplitRead({ consensus, sharp }: { consensus: MarketSplitDisplaySection | null; sharp: MarketSplitDisplaySection | null }) {
  const publicMoney = splitLeader(consensus, "moneyPct");
  const sharpMoney = splitLeader(sharp, "moneyPct");
  const publicTickets = splitLeader(consensus, "betsPct");
  const sharpTickets = splitLeader(sharp, "betsPct");
  if (!publicMoney && !sharpMoney && !publicTickets && !sharpTickets) return null;
  const moneyRead = publicMoney && sharpMoney ? publicMoney.toLowerCase() === sharpMoney.toLowerCase() ? `Money agrees on ${publicMoney}` : `Money: Public ${publicMoney} · Sharp ${sharpMoney}` : `Money: ${publicMoney ? `Public ${publicMoney}` : `Sharp ${sharpMoney}`}`;
  const ticketRead = publicTickets && sharpTickets ? publicTickets.toLowerCase() === sharpTickets.toLowerCase() ? `Tickets agree on ${publicTickets}` : `Tickets: Public ${publicTickets} · Sharp ${sharpTickets}` : `Tickets: ${publicTickets ? `Public ${publicTickets}` : `Sharp ${sharpTickets}`}`;
  const historical = splitSectionIsStale(consensus) || splitSectionIsStale(sharp);
  return <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 rounded-lg border border-white/[0.07] bg-black/15 px-3 py-2"><span className="text-[7px] font-black uppercase tracking-[0.14em] text-gray-500">{historical ? "Historical cross-source read" : "Cross-source read"}</span><span className="text-[8px] font-bold text-gray-300">{moneyRead}</span><span className="hidden h-3 w-px bg-white/10 sm:block" /><span className="text-[8px] font-bold text-gray-400">{ticketRead}</span></div>;
}

function splitSourcesConflict(consensus: MarketSplitDisplaySection | null, sharp: MarketSplitDisplaySection | null): boolean {
  const consensusLeader = splitSectionSignal(consensus).direction;
  const sharpLeader = splitSectionSignal(sharp).direction;
  return consensusLeader !== null && sharpLeader !== null && consensusLeader.toLowerCase() !== sharpLeader.toLowerCase();
}

function splitSectionIsStale(section: MarketSplitDisplaySection | null): boolean {
  if (!section) return false;
  if (section.rows.some((row) => row.isStale === true)) return true;
  const latest = section.lastUpdated ?? section.rows.map((row) => row.observedAt).filter((value): value is string => Boolean(value)).sort((a, b) => Date.parse(b) - Date.parse(a))[0] ?? null;
  if (!latest) return false;
  const observedAtMs = Date.parse(latest);
  return Number.isFinite(observedAtMs) && Date.now() - observedAtMs > 75 * 60 * 1000;
}

function splitLeader(section: MarketSplitDisplaySection | null, valueKey: "moneyPct" | "betsPct"): string | null {
  if (!section) return null;
  return section.rows.filter((row) => row[valueKey] !== null).sort((a, b) => (b[valueKey] ?? 0) - (a[valueKey] ?? 0))[0]?.label ?? null;
}

function RelevantTrend({ game, market, marketKey, history, sample, setSample }: { game: DailyEdgeGameDto; market: MarketEdgeDto; marketKey: MarketKey; history: PreviewHistoryByTeam; sample: 5 | 10; setSample: (sample: 5 | 10) => void }) {
  const away = (history[game.awayTeam] ?? []).slice(0, sample).reverse();
  const home = (history[game.homeTeam] ?? []).slice(0, sample).reverse();
  const rows = mergeHistory(away, home, marketKey);
  const threshold = marketKey === "total" ? market.line : marketKey === "first_inning" ? 0.5 : null;
  const title = marketKey === "moneyline" ? "Recent game results" : marketKey === "total" ? "Recent game totals" : "Recent first-inning scoring";
  const interpretation = recentTrendInterpretation(away, home, marketKey, market, game.awayTeam, game.homeTeam);
  return (
    <div>
      <div className="flex flex-wrap items-center justify-between gap-3"><div><p className="text-[8px] font-black uppercase tracking-[0.16em] text-sky-200">Relevant trends</p><p className="mt-1 text-xs font-black text-gray-300">{title}</p><p className="mt-1 text-[8px] text-gray-600">Past results are context—not standalone proof of today&rsquo;s edge.</p></div><div className="inline-flex rounded-lg border border-gray-800 bg-black/25 p-1">{([5, 10] as const).map((value) => <button key={value} type="button" onClick={() => setSample(value)} className={`rounded-md px-3 py-1.5 text-[8px] font-black ${sample === value ? "bg-violet-500/20 text-violet-200" : "text-gray-600"}`}>L{value}</button>)}</div></div>
      <section className="mt-4 rounded-xl border border-sky-400/15 bg-sky-400/[0.035] p-4"><p className="text-[8px] font-black uppercase tracking-[0.15em] text-sky-200">What the recent sample says</p><p className="mt-2 text-[11px] leading-relaxed text-gray-300">{interpretation}</p></section>
      {rows.length > 0 ? <MarketSpecificTrend rows={rows} threshold={threshold} away={game.awayTeam} home={game.homeTeam} marketKey={marketKey} pick={market.pick} /> : <p className="mt-4 rounded-lg border border-gray-800 bg-black/20 p-4 text-[10px] text-gray-600">Completed-game history is unavailable for one or both teams.</p>}
    </div>
  );
}

function MarketSpecificTrend({ rows, threshold, away, home, marketKey, pick }: { rows: Array<{ away: number; home: number }>; threshold: number | null; away: string; home: string; marketKey: MarketKey; pick: string | null }) {
  if (marketKey === "moneyline") return <BinaryResultRows rows={rows} away={away} home={home} mode="moneyline" pick={pick} />;
  if (marketKey === "first_inning") return <BinaryResultRows rows={rows} away={away} home={home} mode="first_inning" pick={pick} />;
  return <TotalResultRows rows={rows} line={threshold} away={away} home={home} />;
}

function BinaryResultRows({ rows, away, home, mode, pick }: { rows: Array<{ away: number; home: number }>; away: string; home: string; mode: "moneyline" | "first_inning"; pick: string | null }) {
  const supportsYrfi = mode === "first_inning" && /yrfi/i.test(pick ?? "");
  const supportsNrfi = mode === "first_inning" && /nrfi/i.test(pick ?? "");
  const hasDirectionalFiPick = supportsYrfi || supportsNrfi;
  const supportsRead = (value: number) => mode === "moneyline" ? value > 0 : supportsNrfi ? value === 0 : value > 0;
  const renderRow = (team: string, key: "away" | "home") => {
    const hits = rows.filter((row) => supportsRead(row[key])).length;
    return <div className="grid grid-cols-[42px_1fr_auto] items-center gap-2"><span className="text-[9px] font-black text-gray-400">{team}</span><div className="flex gap-1">{rows.map((row, index) => { const hit = supportsRead(row[key]); const rawRun = row[key] > 0; const directionalStyle = hit ? "border-emerald-300/30 bg-emerald-400/20 text-emerald-200" : "border-rose-300/25 bg-rose-500/15 text-rose-200"; const neutralStyle = rawRun ? "border-sky-300/30 bg-sky-400/20 text-sky-200" : "border-gray-500/30 bg-gray-600/20 text-gray-300"; return <span key={index} title={`${team}: ${mode === "moneyline" ? (hit ? "win" : "loss") : (rawRun ? "1+ run in first" : "scoreless first")}${hasDirectionalFiPick ? ` · ${hit ? "supports" : "challenges"} ${pick}` : ""}`} className={`flex h-7 min-w-6 flex-1 items-center justify-center rounded border text-[8px] font-black ${mode === "first_inning" && !hasDirectionalFiPick ? neutralStyle : directionalStyle}`}>{mode === "moneyline" ? (hit ? "W" : "L") : (rawRun ? "1+" : "0")}</span>; })}</div><span className="w-10 text-right text-[8px] font-black text-gray-400">{mode === "moneyline" ? `${hits}-${rows.length - hits}` : `${hits}/${rows.length}`}</span></div>;
  };
  const legend = mode === "moneyline"
    ? "green = win · red = loss"
    : hasDirectionalFiPick
      ? `green = supports ${pick} · red = challenges ${pick}`
      : "blue = 1+ run · gray = scoreless first";
  return <div className="mt-4 space-y-2">{renderRow(away, "away")}{renderRow(home, "home")}<p className="text-right text-[8px] text-gray-600">Oldest → newest · {legend}</p></div>;
}

function TotalResultRows({ rows, line, away, home }: { rows: Array<{ away: number; home: number }>; line: number | null; away: string; home: string }) {
  const renderRow = (team: string, key: "away" | "home") => {
    const overs = line === null ? 0 : rows.filter((row) => row[key] > line).length;
    const unders = line === null ? 0 : rows.filter((row) => row[key] < line).length;
    const pushes = line === null ? 0 : rows.length - overs - unders;
    return <div className="grid grid-cols-[42px_1fr_auto] items-center gap-2"><span className="text-[9px] font-black text-gray-300">{team}</span><div className="flex gap-1">{rows.map((row, index) => { const value = row[key]; const result = line === null ? "—" : value > line ? "O" : value < line ? "U" : "P"; const style = result === "O" ? "border-violet-400/35 bg-violet-400/15 text-violet-200" : result === "U" ? "border-sky-400/35 bg-sky-400/15 text-sky-200" : "border-gray-600 bg-gray-700/50 text-gray-300"; return <span key={index} title={`${team}: ${value} total runs`} className={`${index < rows.length - 5 ? "hidden sm:flex" : "flex"} h-9 min-w-7 flex-1 flex-col items-center justify-center rounded border ${style}`}><strong className="text-[8px] leading-none">{result}</strong><span className="mt-1 font-mono text-[7px] leading-none opacity-80">{value}</span></span>; })}</div><span className="w-14 text-right text-[8px] font-black text-gray-500">{line === null ? "No line" : `${overs}O · ${unders}U${pushes ? ` · ${pushes}P` : ""}`}</span></div>;
  };
  return <div className="mt-4 space-y-2">{renderRow(away, "away")}{renderRow(home, "home")}<p className="text-right text-[8px] text-gray-600">Oldest → newest · O/U compares each completed-game total with today&rsquo;s {line ?? "unavailable"} line</p></div>;
}

type HistoryComparison = {
  label: string;
  awayValue: number;
  homeValue: number;
  awayDisplay: string;
  homeDisplay: string;
  kind: "rate" | "record" | "average";
  context?: string;
  advantage?: "higher" | "lower";
  supportLabel?: string;
  selectedSide?: "away" | "home" | null;
  awaySampleSize?: number;
  homeSampleSize?: number;
  awayOutcomes?: boolean[];
  homeOutcomes?: boolean[];
};

function HistoryStatSummary({ game, market, marketKey, history, sample, sport }: { game: DailyEdgeGameDto; market: MarketEdgeDto; marketKey: MarketKey; history: PreviewHistoryByTeam; sample: 5 | 10; sport: Sport }) {
  const away = (history[game.awayTeam] ?? []).slice(0, sample);
  const home = (history[game.homeTeam] ?? []).slice(0, sample);
  if (away.length === 0 || home.length === 0) return null;
  const average = (rows: PreviewHistoryPoint[], select: (row: PreviewHistoryPoint) => number) => rows.reduce((sum, row) => sum + select(row), 0) / rows.length;
  const rate = (rows: PreviewHistoryPoint[], test: (row: PreviewHistoryPoint) => boolean) => (rows.filter(test).length / rows.length) * 100;
  const scoringNoun = sport === "soccer" || sport === "nhl" ? "goals" : sport === "nba" || sport === "wnba" ? "points" : "runs";
  const normalizedPick = market.pick?.toLowerCase() ?? "";
  const selectedSide = sideMatchesPick(game.awayTeam, market.pick) ? "away" as const : sideMatchesPick(game.homeTeam, market.pick) ? "home" as const : null;
  let comparisons: HistoryComparison[];
  if (marketKey === "moneyline") {
    const awayWins = away.filter((row) => row.won).length;
    const homeWins = home.filter((row) => row.won).length;
    comparisons = [
      { label: `Recent record · L${sample}`, awayValue: rate(away, (row) => row.won), homeValue: rate(home, (row) => row.won), awayDisplay: `${awayWins}-${away.length - awayWins}`, homeDisplay: `${homeWins}-${home.length - homeWins}`, kind: "record", context: "Completed-game wins and losses", advantage: "higher", supportLabel: `Supports ${market.pick ?? "moneyline read"}`, selectedSide, awaySampleSize: away.length, homeSampleSize: home.length, awayOutcomes: [...away].reverse().map((row) => row.won), homeOutcomes: [...home].reverse().map((row) => row.won) },
      { label: `Avg ${scoringNoun} scored`, awayValue: average(away, (row) => row.runsFor), homeValue: average(home, (row) => row.runsFor), awayDisplay: average(away, (row) => row.runsFor).toFixed(1), homeDisplay: average(home, (row) => row.runsFor).toFixed(1), kind: "average", advantage: "higher", supportLabel: `Supports ${market.pick ?? "moneyline read"}`, selectedSide },
      { label: `Avg ${scoringNoun} allowed`, awayValue: average(away, (row) => row.runsAgainst), homeValue: average(home, (row) => row.runsAgainst), awayDisplay: average(away, (row) => row.runsAgainst).toFixed(1), homeDisplay: average(home, (row) => row.runsAgainst).toFixed(1), kind: "average", context: "Lower is better defensively", advantage: "lower", supportLabel: `Supports ${market.pick ?? "moneyline read"}`, selectedSide },
    ];
  } else if (marketKey === "total") {
    const line = market.line;
    const totalSupportsOver = normalizedPick.includes("over");
    const totalSupportsUnder = normalizedPick.includes("under");
    const totalDirection = totalSupportsOver ? "higher" as const : totalSupportsUnder ? "lower" as const : undefined;
    const totalTest = (row: PreviewHistoryPoint) => totalSupportsUnder ? row.totalRuns < (line ?? 8.5) : row.totalRuns > (line ?? 8.5);
    const totalLabel = totalSupportsUnder ? `Games below ${line ?? 8.5}` : `Games above ${line ?? 8.5}`;
    comparisons = [
      { label: `Avg game total · L${sample}`, awayValue: average(away, (row) => row.totalRuns), homeValue: average(home, (row) => row.totalRuns), awayDisplay: average(away, (row) => row.totalRuns).toFixed(1), homeDisplay: average(home, (row) => row.totalRuns).toFixed(1), kind: "average", advantage: totalDirection, supportLabel: totalDirection ? `More supportive of ${market.pick}` : undefined },
      { label: totalLabel, awayValue: rate(away, totalTest), homeValue: rate(home, totalTest), awayDisplay: `${rate(away, totalTest).toFixed(0)}%`, homeDisplay: `${rate(home, totalTest).toFixed(0)}%`, kind: "rate", context: `Green = game supported ${market.pick ?? "today's total read"} · oldest → newest`, advantage: "higher", supportLabel: totalDirection ? `More supportive of ${market.pick}` : undefined, awaySampleSize: away.length, homeSampleSize: home.length, awayOutcomes: [...away].reverse().map(totalTest), homeOutcomes: [...home].reverse().map(totalTest) },
      { label: `Avg ${scoringNoun} scored`, awayValue: average(away, (row) => row.runsFor), homeValue: average(home, (row) => row.runsFor), awayDisplay: average(away, (row) => row.runsFor).toFixed(1), homeDisplay: average(home, (row) => row.runsFor).toFixed(1), kind: "average", advantage: totalDirection, supportLabel: totalDirection ? `More supportive of ${market.pick}` : undefined },
    ];
  } else {
    const awayFirst = away.filter((row) => row.firstInningRuns !== null);
    const homeFirst = home.filter((row) => row.firstInningRuns !== null);
    if (awayFirst.length === 0 || homeFirst.length === 0) return null;
    const supportsYrfi = normalizedPick.includes("yrfi");
    const supportsNrfi = normalizedPick.includes("nrfi");
    const fiTest = (row: PreviewHistoryPoint) => supportsYrfi ? (row.firstInningRuns ?? 0) > 0 : row.firstInningRuns === 0;
    const fiDirection = supportsYrfi ? "higher" as const : supportsNrfi ? "lower" as const : undefined;
    comparisons = [
      { label: supportsYrfi ? `First inning with 1+ run · L${sample}` : `Scoreless first · L${sample}`, awayValue: rate(awayFirst, fiTest), homeValue: rate(homeFirst, fiTest), awayDisplay: `${rate(awayFirst, fiTest).toFixed(0)}%`, homeDisplay: `${rate(homeFirst, fiTest).toFixed(0)}%`, kind: "rate", context: `${supportsYrfi || supportsNrfi ? `Green = game supported ${market.pick}` : "Result context"} · oldest → newest`, advantage: "higher", supportLabel: supportsYrfi || supportsNrfi ? `More supportive of ${market.pick}` : undefined, awaySampleSize: awayFirst.length, homeSampleSize: homeFirst.length, awayOutcomes: [...awayFirst].reverse().map(fiTest), homeOutcomes: [...homeFirst].reverse().map(fiTest) },
      { label: "Avg first-inning runs", awayValue: average(awayFirst, (row) => row.firstInningRuns ?? 0), homeValue: average(homeFirst, (row) => row.firstInningRuns ?? 0), awayDisplay: average(awayFirst, (row) => row.firstInningRuns ?? 0).toFixed(1), homeDisplay: average(homeFirst, (row) => row.firstInningRuns ?? 0).toFixed(1), kind: "average", context: "Combined opening-frame scoring", advantage: fiDirection, supportLabel: fiDirection ? `More supportive of ${market.pick}` : undefined },
    ];
  }
  return <div className="mt-4 rounded-xl border border-white/[0.10] bg-black/20 p-4"><div className="flex items-center justify-between gap-2"><p className="text-[9px] font-black uppercase tracking-[0.15em] text-gray-200">Recent team context</p><span className="text-[8px] font-semibold text-gray-500">Actual completed games</span></div><div className="mt-4 space-y-4">{comparisons.map((comparison) => <StatComparison key={comparison.label} comparison={comparison} away={game.awayTeam} home={game.homeTeam} />)}</div></div>;
}

function StatComparison({ comparison, away, home }: { comparison: HistoryComparison; away: string; home: string }) {
  if (comparison.kind === "rate") return <RateComparison comparison={comparison} away={away} home={home} />;
  if (comparison.kind === "record") return <RecordComparison comparison={comparison} away={away} home={home} />;
  return <AverageComparison comparison={comparison} away={away} home={home} />;
}

function comparisonSignal(comparison: HistoryComparison): { support: "away" | "home" | null; risk: "away" | "home" | null; label: string | null } {
  if (!comparison.advantage || !comparison.supportLabel) return { support: null, risk: null, label: null };
  const difference = comparison.awayValue - comparison.homeValue;
  if (Math.abs(difference) < 0.05) return { support: null, risk: null, label: "Even" };
  const directionalSide = comparison.advantage === "higher"
    ? difference > 0 ? "away" : "home"
    : difference < 0 ? "away" : "home";
  if (!comparison.selectedSide) return { support: directionalSide, risk: null, label: comparison.supportLabel };
  if (directionalSide === comparison.selectedSide) return { support: directionalSide, risk: null, label: comparison.supportLabel };
  return { support: null, risk: directionalSide, label: `Challenges ${comparison.supportLabel.replace(/^Supports\s+/i, "")}` };
}

function RecordComparison({ comparison, away, home }: { comparison: HistoryComparison; away: string; home: string }) {
  const signal = comparisonSignal(comparison);
  const side = (team: string, display: string, value: number, opponentValue: number, outcomes: boolean[] | undefined) => {
    const sideKey = team === away ? "away" : "home";
    const supportive = signal.support === sideKey;
    const challenging = signal.risk === sideKey;
    return <div className={`min-w-0 rounded-xl border p-3 ${supportive ? "border-emerald-400/25 bg-emerald-400/[0.055]" : challenging ? "border-amber-400/25 bg-amber-400/[0.045]" : "border-white/[0.08] bg-white/[0.025]"}`}><div className="flex items-start justify-between gap-2"><div className="min-w-0"><div className="flex flex-wrap items-center gap-1.5"><i className="h-2 w-2 shrink-0 rounded-full" style={{ backgroundColor: teamAccent(team) }} /><span className="text-[10px] font-black text-gray-200">{team}</span>{supportive || challenging ? <span className={`rounded-full border px-1.5 py-0.5 text-[7px] font-black uppercase tracking-wider ${supportive ? "border-emerald-400/20 bg-emerald-400/[0.08] text-emerald-200" : "border-amber-400/20 bg-amber-400/[0.08] text-amber-200"}`}>{signal.label}</span> : null}</div><p className="mt-1 text-[8px] text-gray-500">{value.toFixed(0)}% of completed games</p></div><strong className="shrink-0 whitespace-nowrap font-mono text-base font-black text-white">{display}</strong></div><div className="mt-3"><SampleTally outcomes={outcomes ?? []} color={teamAccent(team)} hitLabel="Win" missLabel="Loss" /></div></div>;
  };
  return <section><ComparisonHeading comparison={comparison} /><div className="grid gap-2 sm:grid-cols-2">{side(away, comparison.awayDisplay, comparison.awayValue, comparison.homeValue, comparison.awayOutcomes)}{side(home, comparison.homeDisplay, comparison.homeValue, comparison.awayValue, comparison.homeOutcomes)}</div><p className="mt-1.5 text-right text-[7px] font-semibold text-gray-600">Oldest → newest · green = win · red = loss</p></section>;
}

function AverageComparison({ comparison, away, home }: { comparison: HistoryComparison; away: string; home: string }) {
  const difference = Math.abs(comparison.awayValue - comparison.homeValue);
  const signal = comparisonSignal(comparison);
  const supportiveTeam = signal.support === "away" ? away : signal.support === "home" ? home : null;
  const challengingTeam = signal.risk === "away" ? away : signal.risk === "home" ? home : null;
  const higherTeam = comparison.awayValue > comparison.homeValue ? away : comparison.homeValue > comparison.awayValue ? home : null;
  const summary = difference < 0.05
    ? "Even across the recent sample"
    : supportiveTeam
      ? comparison.selectedSide
        ? `${supportiveTeam}'s recent sample supports ${comparison.supportLabel?.replace(/^Supports\s+/i, "") ?? "the read"}`
        : `${supportiveTeam} is more supportive of ${comparison.supportLabel?.replace(/^More supportive of\s+/i, "").replace(/^Supports\s+/i, "") ?? "the read"} in this comparison`
      : challengingTeam
        ? `${challengingTeam}'s recent sample challenges ${comparison.supportLabel?.replace(/^Supports\s+/i, "") ?? "the read"}`
      : `${higherTeam ?? "The teams"} is ${difference.toFixed(1)} higher in the recent sample`;
  const side = (team: string, display: string, value: number, opponentValue: number) => {
    void value; void opponentValue;
    const sideKey = team === away ? "away" : "home";
    const supportive = signal.support === sideKey;
    const challenging = signal.risk === sideKey;
    return <div className={`relative min-w-0 overflow-hidden rounded-xl border px-3 py-3 ${supportive ? "border-emerald-400/25 bg-emerald-400/[0.045]" : challenging ? "border-amber-400/25 bg-amber-400/[0.045]" : "border-white/[0.08] bg-black/20"}`}><span className="absolute inset-x-0 top-0 h-0.5" style={{ backgroundColor: teamAccent(team) }} /><div className="flex min-w-0 items-start justify-between gap-2"><div className="min-w-0"><div className="flex min-w-0 flex-wrap items-center gap-1.5"><i className="h-2 w-2 shrink-0 rounded-full" style={{ backgroundColor: teamAccent(team) }} /><span className="truncate text-[10px] font-black text-gray-200">{team}</span>{supportive || challenging ? <span className={`rounded-full border px-1.5 py-0.5 text-[7px] font-black uppercase tracking-wider ${supportive ? "border-emerald-400/20 bg-emerald-400/[0.08] text-emerald-200" : "border-amber-400/20 bg-amber-400/[0.08] text-amber-200"}`}>{signal.label}</span> : null}</div><p className="mt-1 text-[8px] font-semibold text-gray-500">Recent-game average</p></div><strong className="max-w-[55%] shrink-0 overflow-hidden text-ellipsis whitespace-nowrap font-mono text-xl font-black leading-none text-white sm:text-2xl">{display}</strong></div></div>;
  };
  return <section><ComparisonHeading comparison={comparison} /><div className="grid min-w-0 gap-2 sm:grid-cols-2">{side(away, comparison.awayDisplay, comparison.awayValue, comparison.homeValue)}{side(home, comparison.homeDisplay, comparison.homeValue, comparison.awayValue)}</div><div className="mt-2 flex items-center justify-center gap-2 rounded-lg border border-white/[0.06] bg-white/[0.02] px-3 py-2 text-center"><span className="h-1.5 w-1.5 shrink-0 rounded-full bg-violet-300" /><p className="text-[8px] font-bold text-gray-400">{summary}</p></div></section>;
}

function ComparisonHeading({ comparison }: { comparison: HistoryComparison }) {
  return <div className="mb-2 flex flex-wrap items-end justify-between gap-x-3 gap-y-1"><p className="text-[9px] font-black text-gray-300">{comparison.label}</p>{comparison.context ? <span className="text-[8px] font-semibold text-gray-500">{comparison.context}</span> : null}</div>;
}

function RateComparison({ comparison, away, home }: { comparison: HistoryComparison; away: string; home: string }) {
  const row = (team: string, value: number, total: number | undefined, outcomes: boolean[] | undefined) => {
    const sampleSize = total ?? 10;
    const hits = Math.round(value / 100 * sampleSize);
    const displayedOutcomes = outcomes ?? Array.from({ length: sampleSize }, (_, index) => index < hits);
    return <div className="grid grid-cols-[36px_1fr_auto] items-center gap-2"><span className="text-[8px] font-black text-gray-300">{team}</span><SampleTally outcomes={displayedOutcomes} color={teamAccent(team)} /><span className="text-right font-mono text-[9px] font-black text-white">{hits}/{sampleSize}</span></div>;
  };
  const legend = comparison.context ?? (comparison.label.startsWith("Scoreless first")
    ? "Green = scoreless first · red = 1+ run"
    : "Green = result supports the displayed read · red = it does not");
  return <div><ComparisonHeading comparison={comparison} /><div className="space-y-2">{row(away, comparison.awayValue, comparison.awaySampleSize, comparison.awayOutcomes)}{row(home, comparison.homeValue, comparison.homeSampleSize, comparison.homeOutcomes)}</div><p className="mt-1.5 text-right text-[7px] font-semibold text-gray-600">{legend}</p></div>;
}

function SampleTally({ outcomes, color: _color, hitLabel = "Hit", missLabel = "Miss", neutral = false }: { outcomes: boolean[]; color: string; hitLabel?: string; missLabel?: string; neutral?: boolean }) {
  void _color;
  return <div className="grid gap-1.5" style={{ gridTemplateColumns: `repeat(${Math.max(1, outcomes.length)}, minmax(0, 1fr))` }}>{outcomes.map((hit, index) => <span key={index} title={`Game ${index + 1}: ${hit ? hitLabel : missLabel}`} aria-label={`Game ${index + 1}: ${hit ? hitLabel : missLabel}`} className={`h-4 rounded-[4px] border shadow-[inset_0_1px_0_rgba(255,255,255,0.10)] ${neutral ? hit ? "border-sky-300/30 bg-sky-400/65" : "border-gray-500/30 bg-gray-600/55" : hit ? "border-emerald-300/35 bg-emerald-400/80" : "border-rose-300/30 bg-rose-500/65"}`} />)}</div>;
}

function KeyStats({ game, market, marketKey, history, sample, sport }: { game: DailyEdgeGameDto; market: MarketEdgeDto; marketKey: MarketKey; history: PreviewHistoryByTeam; sample: 5 | 10; sport: Sport }) {
  return (
    <div className="h-full p-4 sm:p-5 xl:p-6">
      <SectionHeading tone="sky">Key Stats & Notes</SectionHeading>
      <div className="mt-4">
        <div className="flex items-center justify-between gap-2"><p className="text-[8px] font-black uppercase tracking-[0.17em] text-sky-200">{market.keyStats.length > 0 ? "Prediction drivers" : "Decision snapshot"}</p><span className="text-[7px] font-semibold text-gray-600">{market.keyStats.length > 0 ? `All ${market.keyStats.length} available` : "Core model output"}</span></div>
        {market.keyStats.length > 0 ? <div className="mt-2 space-y-2">{market.keyStats.map((stat) => <PredictionDriverCard key={`${stat.label}-${stat.awayValue}-${stat.homeValue}`} stat={stat} away={game.awayTeam} home={game.homeTeam} awayStarter={game.awayStarter?.name ?? null} homeStarter={game.homeStarter?.name ?? null} marketKey={marketKey} pick={market.pick} />)}</div> : <CoreDecisionSnapshot game={game} market={market} marketKey={marketKey} />}
      </div>
      {marketKey === "first_inning" && sport === "mlb" ? null : <HistoryStatSummary game={game} market={market} marketKey={marketKey} history={history} sample={sample} sport={sport} />}
      <div className="mt-5 border-t border-white/[0.06] pt-4"><p className="text-[8px] font-black uppercase tracking-[0.17em] text-gray-600">OddSphere notes</p><Note label="Why" text={market.whyLine} tone="positive" /><Note label="Risk" text={displayRiskLine(market)} tone="risk" /><Note label="Data" text={coverageSentence(market)} tone="neutral" /></div>
    </div>
  );
}

function CoreDecisionSnapshot({ game, market, marketKey }: { game: DailyEdgeGameDto; market: MarketEdgeDto; marketKey: MarketKey }) {
  const projectedTotal = game.projected.away + game.projected.home;
  const projectedMargin = Math.abs(game.projected.home - game.projected.away);
  const projectedLeader = game.projected.home === game.projected.away ? "Even" : game.projected.home > game.projected.away ? game.homeTeam : game.awayTeam;
  const marketNumber = marketKey === "moneyline"
    ? formatAmerican(currentDisplayedPrice(market))
    : market.line === null ? "—" : formatNumber(market.line);
  return <div className="mt-2 grid grid-cols-2 gap-2"><ProofCell label="Projected score" value={`${game.awayTeam} ${formatNumber(game.projected.away)} · ${game.homeTeam} ${formatNumber(game.projected.home)}`} note="Model output" tone="violet" /><ProofCell label="Projected total" value={formatNumber(projectedTotal)} note="Combined scoring" tone="violet" /><ProofCell label="Projected margin" value={projectedLeader === "Even" ? "Even" : `${projectedLeader} by ${formatNumber(projectedMargin)}`} note="Model output" tone="gray" /><ProofCell label={marketKey === "moneyline" ? "Current price" : "Market line"} value={marketNumber} note={marketKey === "moneyline" && market.currentPriceSportsbook ? formatSportsbook(market.currentPriceSportsbook) : market.marketSource ?? "Source unavailable"} tone="gray" /></div>;
}

function PredictionDriverCard({ stat, away, home, awayStarter, homeStarter, marketKey, pick }: { stat: MarketEdgeDto["keyStats"][number]; away: string; home: string; awayStarter: string | null; homeStarter: string | null; marketKey: MarketKey; pick: string | null }) {
  const category = driverCategory(stat.label);
  const context = driverContext(stat.label, marketKey, pick);
  const isPitching = category === "Pitching";
  const twoSided = keyStatIsTwoSided(stat.label, stat.awayValue, stat.homeValue);
  const signal = contextualDriverSignal({ label: stat.label, awayValue: stat.awayValue, homeValue: stat.homeValue, away, home, marketKey, pick });
  const teamValue = (side: "away" | "home", team: string, person: string | null, value: string | null) => { const supports = signal?.support === side; const challenges = signal?.risk === side; return <div className={`rounded-lg border px-3 py-2 ${supports ? "border-emerald-400/30 bg-emerald-400/[0.07]" : challenges ? "border-amber-400/25 bg-amber-400/[0.055]" : "border-white/[0.07] bg-black/25"}`}><div className="flex items-center gap-1.5"><span className="h-1.5 w-1.5 rounded-full" style={{ backgroundColor: teamAccent(team) }} /><span className={`text-[8px] font-black ${supports ? "text-emerald-200" : challenges ? "text-amber-200" : "text-gray-400"}`}>{team}</span></div>{isPitching && person ? <p className={`mt-1 truncate text-[9px] font-black ${supports ? "text-emerald-100" : challenges ? "text-amber-100" : "text-gray-100"}`}>{person}</p> : null}<p className={`${isPitching && person ? "mt-0.5" : "mt-1"} text-sm font-black ${supports ? "text-emerald-200" : challenges ? "text-amber-200" : "text-white"}`}>{value ?? "—"}</p></div>; };
  return <section className="rounded-xl border border-sky-400/20 bg-[#111723] p-3 shadow-[inset_0_1px_0_rgba(255,255,255,0.025)]"><div className="flex items-start justify-between gap-3"><div><span className="text-[7px] font-black uppercase tracking-[0.14em] text-sky-300">{category}</span><p className="mt-0.5 text-[10px] font-black text-gray-100">{stat.label}</p></div><div className="text-right"><span className="block text-[7px] font-bold uppercase tracking-wider text-gray-600">{stat.source.replaceAll("_", " ")}</span>{signal ? <span className={`mt-1 inline-flex rounded-full border px-2 py-0.5 text-[7px] font-black ${signal.support ? "border-emerald-400/25 bg-emerald-400/[0.08] text-emerald-200" : signal.risk ? "border-amber-400/25 bg-amber-400/[0.08] text-amber-200" : "border-gray-700 bg-gray-800/60 text-gray-500"}`}>{signal.label}</span> : null}</div></div>{twoSided ? <div className="mt-2 grid grid-cols-2 gap-2">{teamValue("away", away, awayStarter, stat.awayValue)}{teamValue("home", home, homeStarter, stat.homeValue)}</div> : <p className="mt-2 text-base font-black text-white">{stat.homeValue ?? stat.awayValue ?? "—"}</p>}<p className="mt-2 text-[8px] leading-relaxed text-gray-500">{context}</p></section>;
}

function DeepResearchToggle({ open, setOpen, market, marketKey, game }: { open: boolean; setOpen: (open: boolean) => void; market: MarketEdgeDto; marketKey: MarketKey; game: DailyEdgeGameDto }) {
  const supporting = market.keyStats.filter((stat) => contextualDriverSignal({ label: stat.label, awayValue: stat.awayValue, homeValue: stat.homeValue, away: game.awayTeam, home: game.homeTeam, marketKey, pick: market.pick })?.support).length;
  const conflict = splitSourcesConflict(displayedConsensusSection(market), market.recommendationDecision?.sharpBookSplits ?? null) || market.marketInterpretation?.chipTone === "amber";
  return <div className="border-t border-violet-400/15 bg-black/20 px-4 py-3 sm:px-5"><button type="button" onClick={() => setOpen(!open)} className="group flex w-full items-center justify-between gap-4 rounded-xl border border-violet-400/25 bg-gradient-to-r from-violet-500/[0.10] via-violet-500/[0.04] to-transparent px-4 py-3 text-left transition hover:border-violet-400/45"><div><div className="flex flex-wrap items-center gap-2"><p className="text-[9px] font-black uppercase tracking-[0.17em] text-violet-100">{open ? "Close full analysis" : "Explore the full analysis"}</p><span className="rounded-full border border-white/[0.08] bg-black/20 px-2 py-0.5 text-[7px] font-black uppercase tracking-wider text-gray-400">{market.keyStats.length > 0 ? `${market.keyStats.length} verified drivers` : "Core snapshot available"}</span>{conflict ? <span className="rounded-full border border-amber-400/20 bg-amber-400/[0.07] px-2 py-0.5 text-[7px] font-black uppercase tracking-wider text-amber-200">Market conflict to inspect</span> : supporting > 0 ? <span className="rounded-full border border-emerald-400/20 bg-emerald-400/[0.07] px-2 py-0.5 text-[7px] font-black uppercase tracking-wider text-emerald-200">{supporting} directional edge{supporting === 1 ? "" : "s"}</span> : null}</div><p className="mt-1 text-[10px] text-gray-400">The case, market evidence, matchup, relevant trends and model trust—in decision order.</p></div><span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full border border-violet-400/20 bg-violet-500/10 text-sm text-violet-200 transition group-hover:bg-violet-500/20">{open ? "↑" : "↓"}</span></button></div>;
}

function DeepResearch({ game, market, marketKey, sport, history, sample, setSample, view, setView }: { game: DailyEdgeGameDto; market: MarketEdgeDto; marketKey: MarketKey; sport: Sport; history: PreviewHistoryByTeam; sample: 5 | 10; setSample: (sample: 5 | 10) => void; view: DeepView; setView: (view: DeepView) => void }) {
  const views: Array<{ key: DeepView; label: string }> = [{ key: "case", label: "The Case" }, { key: "market", label: "Market Intelligence" }, { key: "matchup", label: "Matchup" }, { key: "trend", label: "Relevant Trends" }, { key: "model", label: "Model & Trust" }];
  return (
    <section className="border-t border-white/[0.07] bg-[#09080e] px-4 py-5 sm:px-5">
      <div className="flex max-w-full gap-1 overflow-x-auto rounded-lg border border-gray-800 bg-black/30 p-1">{views.map((item) => <button key={item.key} type="button" onClick={() => setView(item.key)} className={`min-w-max flex-1 rounded-md px-4 py-2 text-[8px] font-black uppercase tracking-[0.12em] ${view === item.key ? "bg-violet-500/15 text-violet-200 ring-1 ring-inset ring-violet-400/25" : "text-gray-600"}`}>{item.label}</button>)}</div>
      <div className="mt-4 rounded-xl border border-white/[0.07] bg-white/[0.02] p-4">
        {view === "case" && <CaseDeepDive game={game} market={market} marketKey={marketKey} />}
        {view === "trend" && <RelevantTrend game={game} market={market} marketKey={marketKey} history={history} sample={sample} setSample={setSample} />}
        {view === "market" && <MarketDeepDive market={market} />}
        {view === "matchup" && <MatchupDeepDive game={game} sport={sport} history={history} sample={sample} />}
        {view === "model" && <ModelDeepDive game={game} market={market} />}
      </div>
    </section>
  );
}

function CaseDeepDive({ game, market, marketKey }: { game: DailyEdgeGameDto; market: MarketEdgeDto; marketKey: MarketKey }) {
  const pulse = sourceCoherentMarketPulse(market, resolveCoherentMovement(market));
  const decisionCopy = pulse.detail || "Market confirmation is unavailable.";
  const primaryFactor = stripReasonPrefix(market.whyLine);
  const topDrivers = market.keyStats.slice(0, 3);
  return <div><div className="flex flex-col gap-3 border-b border-white/[0.07] pb-4 sm:flex-row sm:items-start sm:justify-between"><div><p className="text-[8px] font-black uppercase tracking-[0.17em] text-violet-200">The case for {market.pick ?? "this read"}</p><h3 className="mt-1 text-lg font-black tracking-tight text-white">Why it rates—and what could break it.</h3></div><VerdictBadge market={market} large /></div><div className="mt-4 grid gap-3 lg:grid-cols-2"><AnalysisCard label="Primary model factor" text={primaryFactor} /><section className="rounded-xl border border-amber-400/20 bg-amber-400/[0.045] p-4"><p className="text-[8px] font-black uppercase tracking-[0.15em] text-amber-200">Biggest watch-out</p><p className="mt-2 text-[11px] leading-relaxed text-gray-300">{stripRiskPrefix(market.riskLine)}</p></section></div><section className="mt-4 rounded-xl border border-violet-400/15 bg-violet-500/[0.035] p-4"><div className="flex flex-wrap items-center justify-between gap-2"><p className="text-[8px] font-black uppercase tracking-[0.15em] text-violet-200">Market verdict</p><span className={`rounded-full border px-2 py-0.5 text-[7px] font-black uppercase tracking-wider ${pulse.tone === "emerald" ? "border-emerald-400/20 bg-emerald-400/[0.07] text-emerald-200" : pulse.tone === "amber" ? "border-amber-400/20 bg-amber-400/[0.07] text-amber-200" : "border-gray-700 bg-gray-800/60 text-gray-400"}`}>{pulse.chip}</span></div><p className="mt-2 text-[11px] leading-relaxed text-gray-300">{decisionCopy}</p></section><div className="mt-5"><div className="flex items-end justify-between gap-2"><div><p className="text-[8px] font-black uppercase tracking-[0.16em] text-sky-200">Verified evidence</p><p className="mt-1 text-[9px] text-gray-600">The most relevant formatted rows supplied with this market snapshot.</p></div><span className="text-[8px] font-black text-gray-600">{topDrivers.length} shown</span></div>{topDrivers.length > 0 ? <div className="mt-3 grid gap-2 lg:grid-cols-3">{topDrivers.map((stat) => <PredictionDriverCard key={`${stat.label}-${stat.awayValue}-${stat.homeValue}`} stat={stat} away={game.awayTeam} home={game.homeTeam} awayStarter={game.awayStarter?.name ?? null} homeStarter={game.homeStarter?.name ?? null} marketKey={marketKey} pick={market.pick} />)}</div> : <Unavailable label="No formatted evidence rows are available for this market snapshot." />}</div></div>;
}

function MarketDeepDive({ market }: { market: MarketEdgeDto }) {
  return (
    <div>
      <div className="flex flex-col gap-2 border-b border-white/[0.07] pb-4 sm:flex-row sm:items-end sm:justify-between"><div><p className="text-[8px] font-black uppercase tracking-[0.17em] text-violet-200">Market intelligence</p><h3 className="mt-1 text-lg font-black tracking-tight text-white">How price and bettors reacted.</h3></div><span className="text-[8px] font-bold text-gray-600">Source · {market.marketSource ?? "Unavailable"}</span></div>
      <section className="mt-4 rounded-xl border border-white/[0.08] bg-white/[0.015] p-4"><p className="text-[9px] font-black uppercase tracking-[0.16em] text-violet-200">Observed price history</p><div className="grid gap-3 lg:grid-cols-[0.8fr_1.2fr]"><PriceStops market={market} />{(market.oddsTrail?.length ?? 0) > 0 ? <div className="mt-3 space-y-2">{market.oddsTrail?.map((point, index) => <div key={`${point.observedAt}-${index}`} className="grid grid-cols-[1fr_auto_auto] gap-3 rounded-lg border border-white/[0.08] bg-black/25 px-3 py-2 text-[9px]"><span className="text-gray-500">{point.observedAt ? formatTimestamp(point.observedAt) : point.label}</span><span className="font-black text-gray-200">{formatAmerican(point.american)}</span><span className="w-20 truncate text-right text-gray-600">{point.sportsbook ?? point.source}</span></div>)}</div> : <Unavailable label="No persisted price trail for this market." />}</div></section>
      <DefaultSplitSummary market={market} />
      <div className="mt-4 grid gap-2 sm:grid-cols-2 lg:grid-cols-4"><InfoCard label="Current price" value={`${formatAmerican(currentDisplayedPrice(market))}${market.currentPriceSportsbook ? ` · ${formatSportsbook(market.currentPriceSportsbook)}` : ""}`} /><InfoCard label="Market probability" value={formatMarketProbability(market)} /><InfoCard label="Market EV" value={market.pinnacleEvPct === null ? "Unavailable" : `${market.pinnacleEvPct > 0 ? "+" : ""}${market.pinnacleEvPct.toFixed(1)}%`} /><InfoCard label="Data quality" value={market.marketDataQuality.replaceAll("_", " ")} /></div>
      {(market.modelTotal !== null || market.marketTotal !== null || market.fiMarketBoard) ? <div className="mt-3 grid gap-2 sm:grid-cols-3">{market.modelTotal !== null ? <InfoCard label="Projected total" value={market.modelTotal.toFixed(1)} /> : null}{market.marketTotal !== null ? <InfoCard label="Market total" value={market.marketTotal.toFixed(1)} /> : null}{market.fiMarketBoard ? <InfoCard label="First-inning board" value={`NRFI ${formatAmerican(market.fiMarketBoard.nrfiAmerican)} · YRFI ${formatAmerican(market.fiMarketBoard.yrfiAmerican)}`} /> : null}</div> : null}
    </div>
  );
}

function MatchupDeepDive({ game, sport, history, sample }: { game: DailyEdgeGameDto; sport: Sport; history: PreviewHistoryByTeam; sample: 5 | 10 }) {
  const allStats = dedupeStats(["moneyline", "total", "first_inning"].flatMap((key) => game.markets[key as MarketKey].keyStats));
  const pitcherStats = allStats.filter((stat) => /starter|pitcher|whip|era|fip/i.test(stat.label));
  const contextStats = allStats.filter((stat) => !pitcherStats.includes(stat));
  return <div><div className="border-b border-white/[0.07] pb-4"><p className="text-[8px] font-black uppercase tracking-[0.17em] text-violet-200">Matchup</p><h3 className="mt-1 text-lg font-black tracking-tight text-white">The matchup factors behind the numbers.</h3><p className="mt-1 text-[9px] text-gray-600">Relevant evidence is gathered across every displayed market so changing tabs never hides useful context.</p></div>{sport === "mlb" ? <div className="mt-4 grid gap-3 sm:grid-cols-2"><StarterDetailCard team={game.awayTeam} logo={game.awayTeamLogo} starter={game.awayStarter} stats={pitcherStats} side="away" /><StarterDetailCard team={game.homeTeam} logo={game.homeTeamLogo} starter={game.homeStarter} stats={pitcherStats} side="home" /></div> : null}<div className="mt-5"><p className="text-[9px] font-black uppercase tracking-[0.16em] text-violet-200">{sport === "mlb" ? "Bullpen, lineup and environment" : "Team form and game environment"}</p>{contextStats.length > 0 ? <div className="mt-2 grid gap-2 sm:grid-cols-2 lg:grid-cols-3">{contextStats.map((stat) => <DetailedStatCard key={stat.label} stat={stat} away={game.awayTeam} home={game.homeTeam} />)}</div> : <Unavailable label="No additional matchup rows are available across this game snapshot." />}</div><CrossMarketMatchup game={game} sport={sport} history={history} sample={sample} />{sport === "mlb" ? <CoverageGap text="This preview only presents fields already supplied by the read-only snapshot. Pitch mix, K-BB%, xFIP/SIERA, platoon hitting, bullpen workload and confirmed park/weather detail should be added only after the coverage audit verifies their freshness and availability." /> : null}</div>;
}

function CrossMarketMatchup({ game, sport, history, sample }: { game: DailyEdgeGameDto; sport: Sport; history: PreviewHistoryByTeam; sample: 5 | 10 }) {
  const away = (history[game.awayTeam] ?? []).slice(0, sample);
  const home = (history[game.homeTeam] ?? []).slice(0, sample);
  if (away.length === 0 || home.length === 0) return null;
  const avg = (rows: PreviewHistoryPoint[], select: (row: PreviewHistoryPoint) => number) => rows.reduce((sum, row) => sum + select(row), 0) / rows.length;
  const nrfiRate = (rows: PreviewHistoryPoint[]) => { const known = rows.filter((row) => row.firstInningRuns !== null); return known.length === 0 ? null : (known.filter((row) => row.firstInningRuns === 0).length / known.length) * 100; };
  const cards = [
    { label: "Recent scoring margin", market: "Moneyline", away: avg(away, (row) => row.runsFor - row.runsAgainst), home: avg(home, (row) => row.runsFor - row.runsAgainst), format: (value: number | null) => value === null ? "—" : `${value > 0 ? "+" : ""}${value.toFixed(1)}` },
    { label: "Average game total", market: "Total", away: avg(away, (row) => row.totalRuns), home: avg(home, (row) => row.totalRuns), format: (value: number | null) => value === null ? "—" : value.toFixed(1) },
    ...(sport === "mlb" ? [{ label: "Scoreless first rate", market: "1st Inning", away: nrfiRate(away), home: nrfiRate(home), format: (value: number | null) => value === null ? "—" : `${value.toFixed(0)}%` }] : []),
  ];
  return <section className="mt-5"><div className="flex flex-wrap items-end justify-between gap-2"><div><p className="text-[9px] font-black uppercase tracking-[0.16em] text-violet-200">Cross-market matchup context</p><p className="mt-1 text-[8px] text-gray-600">L{sample} completed games · context, not model proof</p></div></div><div className="mt-2 grid gap-2 sm:grid-cols-3">{cards.map((card) => <div key={card.label} className="rounded-lg border border-white/[0.08] bg-black/25 p-3"><span className="text-[7px] font-black uppercase tracking-wider text-violet-300">{card.market}</span><p className="mt-1 text-[9px] font-black text-gray-300">{card.label}</p><div className="mt-3 space-y-1.5"><MetricPair team={game.awayTeam} value={card.format(card.away)} /><MetricPair team={game.homeTeam} value={card.format(card.home)} /></div></div>)}</div></section>;
}

function MetricPair({ team, value }: { team: string; value: string }) {
  return <div className="flex items-center justify-between gap-2"><span className="flex items-center gap-1.5 text-[8px] font-black text-gray-400"><i className="h-1.5 w-1.5 rounded-full" style={{ backgroundColor: teamAccent(team) }} />{team}</span><strong className="font-mono text-[10px] text-white">{value}</strong></div>;
}

function ModelDeepDive({ game, market }: { game: DailyEdgeGameDto; market: MarketEdgeDto }) {
  const coverage = [{ label: "Prediction drivers", value: `${market.keyStats.length}` }, { label: "Split sources", value: `${Number(Boolean(market.recommendationDecision?.consensusSplits)) + Number(Boolean(market.recommendationDecision?.sharpBookSplits))}/2` }, { label: "Price observations", value: `${market.oddsTrail?.length ?? 0}` }, { label: "Market quality", value: market.marketDataQuality.replaceAll("_", " ") }];
  const probabilityGap = displayedProbabilityGap(market);
  return <div><div className="border-b border-white/[0.07] pb-4"><p className="text-[8px] font-black uppercase tracking-[0.17em] text-violet-200">Model & trust</p><h3 className="mt-1 text-lg font-black tracking-tight text-white">What OddSphere measured—and how complete the read is.</h3></div><div className="mt-4 grid gap-3 lg:grid-cols-2"><AnalysisCard label="Model take" text={game.breakdown.modelBreakdown ?? "No generated model breakdown is available for this snapshot."} /><AnalysisCard label="Market interpretation" text={game.breakdown.sharpRead.sentence} /></div><div className="mt-5"><p className="text-[8px] font-black uppercase tracking-[0.16em] text-gray-400">Decision math at publication</p><div className="mt-2 grid gap-2 sm:grid-cols-2 lg:grid-cols-4"><InfoCard label="Model probability" value={formatProbability(market.modelProb)} /><InfoCard label="Publish-time market" value={formatMarketProbability(market)} /><InfoCard label="Publish-time gap" value={probabilityGap === null ? "Unavailable" : `${probabilityGap > 0 ? "+" : ""}${probabilityGap.toFixed(1)} pp`} /><InfoCard label="Actionability" value={market.recommendationConfidence === null || market.recommendationConfidence === undefined ? "Unavailable" : `${market.recommendationConfidence.toFixed(0)}/100`} /></div><p className="mt-2 text-[8px] leading-relaxed text-gray-600">The latest observed price is shown separately in Market Intelligence and may move after this model comparison was published.</p></div><section className="mt-5 rounded-xl border border-white/[0.08] bg-black/20 p-4"><div className="flex flex-wrap items-end justify-between gap-2"><div><p className="text-[8px] font-black uppercase tracking-[0.16em] text-sky-200">Coverage & provenance</p><p className="mt-1 text-[9px] text-gray-600">Honest visibility into what this read can actually support.</p></div><span className="text-[8px] font-bold text-gray-600">Market source · {market.marketSource ?? "Unavailable"}</span></div><div className="mt-3 grid grid-cols-2 gap-2 lg:grid-cols-4">{coverage.map((item) => <div key={item.label} className="rounded-lg border border-white/[0.06] bg-white/[0.02] p-3"><p className="text-[7px] font-black uppercase tracking-wider text-gray-600">{item.label}</p><p className="mt-1 text-xs font-black capitalize text-gray-200">{item.value}</p></div>)}</div></section>{market.reviewFlags.length > 0 ? <div className="mt-4"><p className="text-[8px] font-black uppercase tracking-wider text-amber-200">Factors that affected the final grade</p><div className="mt-2 flex flex-wrap gap-2">{market.reviewFlags.map((flag) => <span key={flag} className="rounded-full border border-amber-400/25 bg-amber-400/[0.08] px-2.5 py-1 text-[8px] font-black uppercase tracking-wider text-amber-200">{flag.replaceAll("_", " ")}</span>)}</div></div> : null}<details className="mt-5 rounded-lg border border-gray-800 bg-black/20"><summary className="cursor-pointer px-4 py-3 text-[8px] font-black uppercase tracking-[0.14em] text-gray-500">Technical review trail</summary><div className="grid gap-2 border-t border-gray-800 p-3 sm:grid-cols-3"><InfoCard label="Reviewer action" value={market.reviewActionSummary.replaceAll("_", " ")} /><InfoCard label="Raw grade" value={market.rawGrade?.replaceAll("_", " ") ?? "Unavailable"} /><InfoCard label="Final grade" value={market.finalGrade?.replaceAll("_", " ") ?? market.verdict.label} /></div></details></div>;
}

function PriceStops({ market }: { market: MarketEdgeDto }) {
  const stops = [
    { label: "Open", value: market.lineOpenAmerican },
    { label: "First published", value: market.oddspherePostedAmerican ?? null },
    { label: "Current", value: currentDisplayedPrice(market) },
    { label: "Locked", value: market.lockedLineAmerican ?? null },
  ];
  return <div className="mt-3 grid grid-cols-2 gap-2 sm:grid-cols-4 lg:grid-cols-2">{stops.map((stop) => <div key={stop.label} className="rounded-lg border border-white/[0.08] bg-black/25 px-3 py-2"><p className="text-[7px] font-black uppercase tracking-wider text-gray-600">{stop.label}</p><p className="mt-1 font-mono text-xs font-black text-gray-200">{formatAmerican(stop.value)}</p></div>)}</div>;
}

function StarterDetailCard({ team, logo, starter, stats, side }: { team: string; logo: string | null; starter: DailyEdgeGameDto["awayStarter"]; stats: MarketEdgeDto["keyStats"]; side: "away" | "home" }) {
  return <section className="rounded-xl border border-white/[0.10] bg-[#12111b] p-4"><div className="flex items-center gap-3"><TeamLogo src={logo} label={team} /><div><p className="text-[8px] font-black uppercase tracking-[0.14em] text-gray-500">{team} probable starter</p><p className="mt-0.5 text-sm font-black text-white">{starter?.name ?? "Starter TBD"}</p><p className="text-[9px] font-semibold text-gray-500">{starter?.throws ? `${starter.throws}HP` : "Handedness unavailable"}</p></div></div><div className="mt-4 border-t border-white/[0.07] pt-3">{stats.length > 0 ? <div className="grid gap-2">{stats.map((stat) => <div key={stat.label} className="flex items-center justify-between gap-3"><span className="text-[8px] font-bold uppercase tracking-wider text-gray-500">{stat.label}</span><span className="text-xs font-black text-gray-200">{side === "away" ? stat.awayValue ?? "—" : stat.homeValue ?? "—"}</span></div>)}</div> : <p className="text-[9px] text-gray-600">No pitcher-stat row is available for this selected market.</p>}</div></section>;
}

function DetailedStatCard({ stat, away, home }: { stat: MarketEdgeDto["keyStats"][number]; away: string; home: string }) {
  const twoSided = stat.awayValue !== null && stat.homeValue !== null;
  return <div className="rounded-lg border border-white/[0.08] bg-black/25 p-3"><p className="text-[8px] font-black uppercase tracking-[0.12em] text-gray-500">{stat.label}</p>{twoSided ? <div className="mt-2 space-y-1"><div className="flex justify-between gap-3 text-[10px]"><span className="font-black text-gray-400">{away}</span><span className="font-black text-gray-200">{stat.awayValue}</span></div><div className="flex justify-between gap-3 text-[10px]"><span className="font-black text-gray-400">{home}</span><span className="font-black text-gray-200">{stat.homeValue}</span></div></div> : <p className="mt-2 text-xs font-black text-gray-200">{stat.homeValue ?? stat.awayValue ?? "—"}</p>}<p className="mt-2 text-[7px] font-bold uppercase tracking-wider text-gray-700">{stat.source.replaceAll("_", " ")}</p></div>;
}

function AnalysisCard({ label, text }: { label: string; text: string }) {
  return <section className="rounded-xl border border-violet-400/20 bg-violet-500/[0.05] p-4"><p className="text-[8px] font-black uppercase tracking-[0.15em] text-violet-200">{label}</p><p className="mt-2 text-[11px] leading-relaxed text-gray-300">{text}</p></section>;
}

type BoardFilter = "all" | "best_angle" | "lean" | "watchlist" | "caution";

function EdgeBoard({ games, sport, activeId, activeMarket, selectGame }: { games: DailyEdgeGameDto[]; sport: Sport; activeId: string; activeMarket: MarketKey; selectGame: (game: DailyEdgeGameDto, market?: MarketKey) => void }) {
  const [filter, setFilter] = useState<BoardFilter>("all");
  const [focus, setFocus] = useState<MarketKey | null>(null);
  const filters: Array<{ key: BoardFilter; label: string }> = [{ key: "all", label: "All" }, { key: "best_angle", label: "Best Angle" }, { key: "lean", label: "Lean" }, { key: "watchlist", label: "Watchlist" }, { key: "caution", label: "Caution" }];
  const marketKeys: MarketKey[] = focus ? [focus] : ["moneyline", "total", "first_inning"];
  const count = (key: BoardFilter) => key === "all" ? games.length : games.filter((game) => marketKeys.some((marketKey) => game.markets[marketKey].verdict.key === key)).length;
  const visibleGames = filter === "all" ? games : games.filter((game) => marketKeys.some((marketKey) => game.markets[marketKey].verdict.key === filter));
  const marketFilters: Array<{ key: MarketKey | null; label: string }> = [{ key: null, label: "Best market" }, { key: "moneyline", label: "Moneyline" }, { key: "total", label: "Totals" }, { key: "first_inning", label: marketLabelFor("first_inning", sport) }];
  return <section><div className="mb-3 rounded-xl border border-white/[0.07] bg-white/[0.02] p-3"><div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between"><div className="flex items-baseline gap-2"><span className="h-3.5 w-1 rounded-full bg-violet-400/65" /><h2 className="text-[10px] font-black uppercase tracking-[0.18em] text-violet-200">Slate Board</h2><span className="text-[11px] text-gray-600">·</span><span className="text-[11px] text-gray-400">{games.length} {games.length === 1 ? "game" : "games"}</span></div><div className="flex gap-1.5 overflow-x-auto pb-1">{marketFilters.map((item) => <button key={item.key ?? "best"} type="button" onClick={() => setFocus(item.key)} aria-pressed={focus === item.key} className={`whitespace-nowrap rounded-md border px-2.5 py-1.5 text-[8px] font-black uppercase tracking-wider ${focus === item.key ? "border-white/20 bg-white/[0.09] text-white" : "border-white/[0.06] text-gray-500"}`}>{item.label}</button>)}</div></div><div className="mt-3 flex gap-1.5 overflow-x-auto border-t border-white/[0.05] pt-3">{filters.map((item) => { const total = count(item.key); const active = filter === item.key; const disabled = item.key !== "all" && total === 0; return <button key={item.key} type="button" disabled={disabled} onClick={() => setFilter(item.key)} className={`inline-flex items-center gap-1.5 whitespace-nowrap rounded-full border px-2.5 py-1 text-[9px] font-black uppercase tracking-wider ${active ? "border-violet-400/55 bg-violet-500/[0.18] text-white" : disabled ? "border-white/[0.04] text-gray-800" : "border-white/[0.08] bg-white/[0.03] text-gray-400 hover:border-white/[0.16]"}`}>{item.label}<span className={active ? "text-violet-200" : "text-gray-600"}>{total}</span></button>; })}</div></div><div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">{visibleGames.map((game) => <BoardGameCard key={game.id} game={game} sport={sport} headlineMarket={focus ?? primaryMarket(game)} active={activeId === game.id} activeMarket={activeId === game.id ? activeMarket : null} selectGame={selectGame} />)}</div></section>;
}

function BoardGameCard({ game, sport, headlineMarket, active, activeMarket, selectGame }: { game: DailyEdgeGameDto; sport: Sport; headlineMarket: MarketKey; active: boolean; activeMarket: MarketKey | null; selectGame: (game: DailyEdgeGameDto, market?: MarketKey) => void }) {
  const headlineKey = headlineMarket;
  const headlineMarketData = game.markets[headlineKey];
  const headline = {
    ...headlineMarketData,
    priceAmerican: currentDisplayedPrice(headlineMarketData),
  };
  const marketKeys: MarketKey[] = ["moneyline", "total", "first_inning"];
  return (
    <article
      role="button"
      tabIndex={0}
      data-game-id={game.id}
      aria-pressed={active}
      onClick={() => selectGame(game, headlineKey)}
      onKeyDown={(event) => {
        if (event.key === "Enter" || event.key === " ") {
          event.preventDefault();
          selectGame(game, headlineKey);
        }
      }}
      className={`group relative flex h-full cursor-pointer flex-col overflow-hidden rounded-xl border bg-[#0D0D14] shadow-[0_4px_16px_-6px_rgba(0,0,0,0.55),inset_0_1px_0_rgba(255,255,255,0.05)] transition ${active ? "border-white/35 outline outline-2 outline-violet-400/25 outline-offset-2" : boardCardBorder(headline.verdict.key)}`}
    >
      <div className="h-[3px] w-full shrink-0" style={{ background: `linear-gradient(to right, ${teamTheme(game.awayTeam).primary} 0%, ${teamTheme(game.awayTeam).primary} 28%, rgba(255,255,255,0.06) 50%, ${teamTheme(game.homeTeam).primary} 72%, ${teamTheme(game.homeTeam).primary} 100%)` }} />
      <div className="flex flex-1 flex-col p-5 sm:p-6">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex min-w-0 items-center gap-2.5">
            <TeamLogo src={game.awayTeamLogo} label={game.awayTeam} />
            <span className="text-base font-black text-white">{game.awayTeam}</span>
            <span className="text-[11px] text-gray-700">@</span>
            <span className="text-base font-black text-white">{game.homeTeam}</span>
            <TeamLogo src={game.homeTeamLogo} label={game.homeTeam} />
          </div>
          <div className="flex flex-wrap items-center justify-end gap-2">
            <VerdictBadge market={headline} large />
            <span className="text-[10px] text-gray-500">{game.gameTime}</span>
            <LockBadge lockState={game.lockState} lockedAt={game.lockedAt} scheduledLockAt={game.scheduledLockAt} className="font-black uppercase tracking-wider text-emerald-300" />
          </div>
        </div>
        <div className="mt-5 flex flex-wrap items-baseline gap-2">
          <span className="text-[30px] font-black leading-none tracking-tight text-white sm:text-[34px]">{displayPick(headline, headlineKey)}</span>
          <span className="text-[10px] font-black uppercase tracking-wider text-gray-500">{marketLabelFor(headlineKey, sport)}</span>
          <span className="text-[15px] font-black text-gray-200">{formatProbability(headline.modelProb)}</span>
          <span className="font-mono text-[12px] font-bold text-gray-500">{formatAmerican(headline.priceAmerican)}</span>
        </div>
        <p className="mt-3 line-clamp-2 text-[12px] leading-relaxed text-gray-400">{currentAwareGuidedGuide(headline, game.decisionLine)}</p>
        <div className="mt-3 flex items-baseline gap-2">
          <span className="text-[9px] font-black uppercase tracking-wider text-gray-600">Proj</span>
          <span className="text-[12px] text-gray-400">{game.awayTeam} <strong className="text-[13px] text-white">{formatNumber(game.projected.away)}</strong> <span className="mx-1 text-gray-700">·</span> {game.homeTeam} <strong className="text-[13px] text-white">{formatNumber(game.projected.home)}</strong></span>
        </div>
        <div className="mt-auto pt-3">
          <div className="flex items-center justify-between gap-1 overflow-hidden text-[9px] font-black uppercase tracking-[0.06em]">
            {marketKeys.map((key, index) => {
              const item = game.markets[key];
              return <span key={key} className="inline-flex min-w-0 items-center gap-1">{index > 0 ? <span className="mr-1 text-gray-700">·</span> : null}<span className="text-gray-600">{marketShortLabelFor(key, sport)}</span><span className={boardVerdictText(item.verdict.key)}>{verdictSymbol(item.verdict.key)} {item.verdict.label}</span></span>;
            })}
          </div>
          <div className="mt-4 grid grid-cols-3 gap-2">
            {marketKeys.map((key) => {
              const item = game.markets[key];
              const selected = active && activeMarket === key;
              return <button key={key} type="button" data-market={key} onClick={(event) => { event.stopPropagation(); selectGame(game, key); }} className={`min-h-[70px] rounded-lg border px-3 py-3 text-left transition sm:min-h-[76px] sm:px-3.5 ${boardMarketPill(item.verdict.key)} ${selected ? "ring-2 ring-white/45 ring-offset-1 ring-offset-[#0D0D14]" : ""}`}><span className={`block text-[9.5px] font-black uppercase tracking-[0.1em] ${boardVerdictText(item.verdict.key)}`}>{marketShortLabelFor(key, sport)}</span><span className="mt-1.5 block truncate text-[14px] font-black text-gray-100 sm:text-[15px]">{displayPick(item, key)}</span></button>;
            })}
          </div>
          <div className="mt-2 flex min-h-3 justify-end"><span className={`text-[8px] font-black uppercase tracking-[0.1em] ${active ? "text-gray-300" : "text-violet-200/60"}`}>{active ? "Open in reader ↑" : "View breakdown ↑"}</span></div>
        </div>
      </div>
    </article>
  );
}

function boardCardBorder(verdict: string): string {
  if (verdict === "best_angle") return "border-emerald-500/25 hover:border-emerald-400/45";
  if (verdict === "lean") return "border-sky-500/20 hover:border-sky-400/40";
  if (verdict === "watchlist") return "border-indigo-500/15 hover:border-indigo-400/35";
  if (verdict === "caution") return "border-amber-500/20 hover:border-amber-400/40";
  return "border-white/[0.06] hover:border-white/[0.12]";
}

function boardMarketPill(verdict: string): string {
  if (verdict === "best_angle") return "border-emerald-500/25 bg-emerald-500/[0.07]";
  if (verdict === "lean") return "border-sky-500/25 bg-sky-500/[0.06]";
  if (verdict === "watchlist") return "border-indigo-500/20 bg-indigo-500/[0.05]";
  if (verdict === "caution") return "border-amber-500/25 bg-amber-500/[0.06]";
  return "border-white/[0.07] bg-white/[0.025]";
}

function boardVerdictText(verdict: string): string {
  if (verdict === "best_angle") return "text-emerald-300";
  if (verdict === "lean") return "text-sky-300";
  if (verdict === "watchlist") return "text-indigo-300";
  if (verdict === "caution") return "text-amber-300";
  return "text-gray-600";
}

function EmptyPreview({ snapshot, sport }: { snapshot: DailyEdgeResponse; sport: Sport }) {
  return <section className="rounded-2xl border border-violet-400/15 bg-gradient-to-br from-violet-500/[0.05] to-gray-950/60 p-10 text-center"><span className="inline-flex rounded-full border border-violet-400/20 bg-violet-400/[0.06] px-3 py-1 text-[8px] font-black uppercase tracking-wider text-violet-200">Model available</span><p className="mt-4 text-[9px] font-black uppercase tracking-wider text-gray-500">{sportLabel(sport)} · Daily Edge · {snapshot.requested_date ?? snapshot.date}</p><h2 className="mt-2 text-2xl font-black text-white">No {sportLabel(sport)} games today</h2><p className="mx-auto mt-2 max-w-xl text-sm leading-relaxed text-gray-500">The {sportLabel(sport)} model remains part of OddSphere. There is no current slate to analyze, so the board correctly stays empty instead of showing games from an older date.</p></section>;
}

function SectionHeading({ tone, children }: { tone: "emerald" | "violet" | "sky"; children: React.ReactNode }) {
  const color = tone === "emerald" ? "bg-emerald-400 text-emerald-200" : tone === "violet" ? "bg-violet-400 text-violet-200" : "bg-sky-400 text-sky-200";
  const [bar, text] = color.split(" ");
  return <div className="flex items-center gap-2 border-b border-white/[0.06] pb-3"><span className={`h-4 w-1 rounded-full ${bar}`} /><h3 className={`text-[9px] font-black uppercase tracking-[0.2em] ${text}`}>{children}</h3></div>;
}

function ProofCell({ label, value, note, tone }: { label: string; value: string; note: string; tone: "violet" | "gray" | "emerald" }) {
  const style = tone === "violet" ? "border-violet-400/20 bg-violet-400/[0.05] text-violet-200" : tone === "emerald" ? "border-emerald-400/20 bg-emerald-400/[0.05] text-emerald-200" : "border-gray-800 bg-black/20 text-gray-300";
  return <div className={`rounded-lg border p-3 ${style}`}><p className="text-[7px] font-black uppercase tracking-wider opacity-55">{label}</p><p className="mt-1 text-sm font-black">{value}</p><p className="mt-1 truncate text-[8px] text-gray-600">{note}</p></div>;
}

function PricePoint({ label, value, line = null, tone = "gray" }: { label: string; value: string; line?: number | null; tone?: "emerald" | "amber" | "gray" }) {
  const color = tone === "emerald" ? "text-emerald-300" : tone === "amber" ? "text-amber-300" : "text-gray-300";
  return <div><p className="text-[7px] font-black uppercase tracking-[0.14em] text-gray-700">{label}</p><p className={`mt-1 font-mono text-sm font-black ${color}`}>{value}</p>{line !== null ? <p className="mt-0.5 text-[7px] font-bold text-gray-600">Line {formatNumber(line)}</p> : null}</div>;
}

function Note({ label, text, tone }: { label: string; text: string; tone: "positive" | "risk" | "neutral" }) {
  const style = tone === "positive" ? "text-emerald-300" : tone === "risk" ? "text-amber-300" : "text-sky-300";
  return <div className="mt-3 grid grid-cols-[42px_1fr] gap-2"><span className={`text-[8px] font-black uppercase tracking-[0.12em] ${style}`}>{label}</span><p className="text-[10px] leading-relaxed text-gray-500">{text || "Unavailable"}</p></div>;
}

function InfoCard({ label, value }: { label: string; value: string }) {
  return <div className="rounded-lg border border-white/[0.06] bg-black/20 p-3"><p className="text-[8px] font-black uppercase tracking-[0.12em] text-gray-700">{label}</p><p className="mt-2 text-xs font-black capitalize text-gray-300">{value}</p></div>;
}

function Unavailable({ label }: { label: string }) {
  return <p className="mt-3 rounded-lg border border-gray-800 bg-black/20 p-4 text-[10px] leading-relaxed text-gray-600">{label}</p>;
}

function CoverageGap({ text }: { text: string }) {
  return <div className="mt-4 rounded-lg border border-amber-400/15 bg-amber-400/[0.04] p-3 text-[9px] leading-relaxed text-amber-200/55"><span className="font-black text-amber-300">Coverage gap:</span> {text}</div>;
}

function TeamLogo({ src, label }: { src: string | null; label: string }) {
  // The response owns team identity. Several WNBA abbreviations overlap MLB
  // (ATL, CHI, SEA, TOR), so an MLB-first fallback silently replaced correct
  // WNBA assets in the candidate reader. Legacy MLB rows still contain the
  // retired mlbstatic.com `*-72.png` URLs, which now return 404. Replace only
  // that known MLB format (or a blank value) with the working ESPN team mark
  // used by the previous product surface; valid league-owned assets stay put.
  const suppliedSrc = src?.trim() || null;
  const resolvedSrc = !suppliedSrc || suppliedSrc.includes("mlbstatic.com/team-logos/")
    ? mlbLogoUrl(label)
    : suppliedSrc;
  const [imageFailed, setImageFailed] = useState(!resolvedSrc);
  const theme = teamTheme(label);
  const accent = teamAccent(label);
  return (
    <span className="relative inline-flex h-10 w-10 shrink-0 items-center justify-center overflow-hidden rounded-lg border bg-[#f7f8fb] text-[7px] font-black shadow-[0_4px_14px_rgba(0,0,0,0.28)]" style={{ borderColor: `${accent}99`, color: theme.primary }}>
      <span className="relative z-10 tracking-tight">{label.slice(0, 3)}</span>
      {resolvedSrc && !imageFailed ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={resolvedSrc}
          alt=""
          onError={() => setImageFailed(true)}
          className="absolute inset-0 z-20 h-full w-full bg-[#f7f8fb] object-contain p-0.5"
        />
      ) : null}
      <span className="absolute inset-x-0 bottom-0 z-30 h-1" style={{ backgroundColor: accent }} />
    </span>
  );
}

function VerdictBadge({ market, large = false }: { market: MarketEdgeDto; large?: boolean }) {
  const style = verdictStyle(market.verdict.key);
  return <span className={`inline-flex w-fit items-center gap-1.5 rounded-full border font-black uppercase tracking-[0.12em] ${style} ${large ? "px-3 py-1.5 text-[10px]" : "px-2.5 py-1 text-[8px]"}`}>{verdictSymbol(market.verdict.key)} {market.verdict.label}</span>;
}

function VerdictGlyph({ market }: { market: MarketEdgeDto }) {
  return <span className={verdictStyle(market.verdict.key).split(" ").find((part) => part.startsWith("text-")) ?? "text-gray-500"}>{verdictSymbol(market.verdict.key)}</span>;
}

function GradeScale({ market }: { market: MarketEdgeDto }) {
  const grades = ["no_play", "caution", "watchlist", "lean", "best_angle"];
  const index = Math.max(0, grades.indexOf(market.verdict.key));
  const activeColor = gradeScaleColor(market.verdict.key);
  return <div className="mt-3"><div className="flex gap-1.5">{grades.map((grade, gradeIndex) => <span key={grade} className={`h-1.5 flex-1 rounded-full ${gradeIndex <= index ? activeColor : "bg-gray-800"}`} />)}</div><div className="mt-2 flex justify-between text-[7px] font-black uppercase tracking-[0.08em] text-gray-700"><span>No play</span><span>Lean</span><span>Best</span></div></div>;
}

function gradeScaleColor(key: string): string {
  if (key === "best_angle") return "bg-emerald-400";
  if (key === "lean") return "bg-sky-400";
  if (key === "watchlist") return "bg-indigo-400";
  if (key === "caution") return "bg-amber-400";
  return "bg-gray-500";
}

function sportLabel(sport: Sport): string {
  const labels: Record<Sport, string> = { mlb: "MLB", nba: "NBA", wnba: "WNBA", nfl: "NFL", cbb: "CBB", cfb: "CFB", nhl: "NHL", soccer: "World Cup", ucl: "UCL" };
  return labels[sport];
}

function marketLabelFor(key: MarketKey, sport: Sport): string {
  if (key === "first_inning" && (sport === "nba" || sport === "wnba")) return "Spread";
  if (key === "first_inning" && sport === "nhl") return "Puck Line";
  if (key === "first_inning" && sport === "soccer") return "Both Teams To Score";
  if (key === "moneyline" && sport === "soccer") return "Match Result";
  return MARKET_LABEL[key];
}

function marketShortLabelFor(key: MarketKey, sport: Sport): string {
  if (key === "moneyline") return "ML";
  if (key === "total") return "Total";
  if (sport === "nba" || sport === "wnba") return "Sprd";
  if (sport === "nhl") return "PL";
  if (sport === "soccer") return "BTTS";
  return "1st";
}

function mergeHistory(away: PreviewHistoryPoint[], home: PreviewHistoryPoint[], marketKey: MarketKey): Array<{ away: number; home: number }> {
  const count = Math.min(away.length, home.length);
  return Array.from({ length: count }, (_, index) => ({
    away: marketKey === "moneyline" ? (away[index].won ? 1 : 0) : marketKey === "total" ? away[index].totalRuns : away[index].firstInningRuns ?? 0,
    home: marketKey === "moneyline" ? (home[index].won ? 1 : 0) : marketKey === "total" ? home[index].totalRuns : home[index].firstInningRuns ?? 0,
  }));
}

function displayPick(market: MarketEdgeDto, key: MarketKey): string {
  if (!market.pick) return market.held ? "Held" : "—";
  if (key === "total" && market.line !== null && !/\d/.test(market.pick)) return `${market.pick} ${market.line}`;
  return market.pick;
}

function driverCategory(label: string): string {
  if (/starter|pitcher|era|whip|fip/i.test(label)) return "Pitching";
  if (/bullpen/i.test(label)) return "Bullpen";
  if (/lineup|ops|top-of-order/i.test(label)) return "Lineup matchup";
  if (/park|weather|wind/i.test(label)) return "Environment";
  if (/projected|projection/i.test(label)) return "Model projection";
  return "Matchup factor";
}

function driverContext(label: string, marketKey: MarketKey, pick: string | null): string {
  const normalizedPick = pick?.toLowerCase() ?? "";
  if (/era|whip|fip/i.test(label)) {
    if (marketKey === "first_inning") return normalizedPick.includes("yrfi") ? "Higher opening-frame run-allowed values support YRFI; lower values support NRFI." : normalizedPick.includes("nrfi") ? "Lower opening-frame run-allowed values support NRFI; higher values support YRFI." : "Opening-frame run-prevention comparison; no side is highlighted for a neutral read.";
    if (marketKey === "total") return normalizedPick.includes("over") ? "Higher run-allowed values are more supportive of the Over." : normalizedPick.includes("under") ? "Lower run-allowed values are more supportive of the Under." : "Run-prevention profile shown as neutral matchup context.";
    return `Lower run-prevention values support ${pick ?? "the selected moneyline side"} only when they belong to the selected team.`;
  }
  if (/bullpen/i.test(label)) return marketKey === "total" ? `Bullpen quality is interpreted in the direction of ${pick ?? "the displayed total"}, not as a generic winner.` : "Late-inning run prevention is highlighted only when it supports the displayed pick.";
  if (/lineup.*starter|ops|top-of-order/i.test(label)) {
    if (marketKey === "first_inning") return normalizedPick.includes("yrfi") ? "Higher early-order offense is more supportive of YRFI." : normalizedPick.includes("nrfi") ? "Lower early-order offense is more supportive of NRFI." : "Early-order offense is shown as neutral matchup context.";
    if (marketKey === "total") return normalizedPick.includes("over") ? "Higher lineup offense is more supportive of the Over." : normalizedPick.includes("under") ? "Lower lineup offense is more supportive of the Under." : "Lineup offense is shown as neutral matchup context.";
    return `Higher lineup offense supports ${pick ?? "the selected moneyline side"} only when it belongs to the selected team.`;
  }
  if (/park/i.test(label)) return "Expected scoring influence from the ballpark.";
  if (/weather|wind/i.test(label)) return "Expected scoring influence from current weather conditions.";
  if (/first-inning/i.test(label)) return "Direct context for the NRFI/YRFI prediction category.";
  return "Verified input or context surfaced by the Daily Edge snapshot.";
}

function contextualDriverSignal({ label, awayValue, homeValue, away, home, marketKey, pick }: { label: string; awayValue: string | null; homeValue: string | null; away: string; home: string; marketKey: MarketKey; pick: string | null }): { support: "away" | "home" | null; risk: "away" | "home" | null; label: string } | null {
  if (awayValue === null || homeValue === null) return null;
  if (!pick || /toss.?up|held/i.test(pick)) return null;
  const isRunPrevention = /era|whip|fip|runs allowed/i.test(label);
  const isOffense = /ops|lineup vs starter|top.of.order/i.test(label);
  const isBullpenQuality = /bullpen|quality/i.test(label);
  if (!isRunPrevention && !isOffense && !isBullpenQuality) return null;
  const parse = (value: string) => {
    if (/no .*sample|unavailable|^—$/i.test(value)) return null;
    if (/league average/i.test(value)) return 0;
    const relative = value.match(/([+-]?\d+(?:\.\d+)?)%\s+(better|stronger|worse|weaker)/i);
    if (relative) return Number(relative[1]) * (/worse|weaker/i.test(relative[2]) ? -1 : 1);
    const numeric = Number.parseFloat(value.replace(/[^\d.+-]/g, ""));
    return Number.isFinite(numeric) ? numeric : null;
  };
  const awayNumber = parse(awayValue);
  const homeNumber = parse(homeValue);
  if (awayNumber === null || homeNumber === null) return null;
  const rawDiff = awayNumber - homeNumber;
  const abs = Math.abs(rawDiff);
  const thresholds = /ops/i.test(label) ? [0.02, 0.05] : /whip/i.test(label) ? [0.05, 0.15] : /era|fip/i.test(label) ? [0.2, 0.5] : [3, 7];
  if (abs < thresholds[0]) return { support: null, risk: null, label: "Even for this read" };

  const normalizedPick = pick.toLowerCase();
  let higherSupports: boolean;
  if (marketKey === "moneyline") {
    higherSupports = !isRunPrevention;
    if (isBullpenQuality) higherSupports = true;
  } else if (marketKey === "total") {
    const over = normalizedPick.includes("over");
    const under = normalizedPick.includes("under");
    if (!over && !under) return null;
    higherSupports = isBullpenQuality ? under : over;
  } else {
    const nrfi = normalizedPick.includes("nrfi");
    const yrfi = normalizedPick.includes("yrfi");
    if (!nrfi && !yrfi) return null;
    higherSupports = isBullpenQuality ? nrfi : yrfi;
  }

  const directionalSide: "away" | "home" = higherSupports
    ? rawDiff > 0 ? "away" : "home"
    : rawDiff < 0 ? "away" : "home";
  const strength = abs >= thresholds[1] ? "clear" : "slight";

  if (marketKey !== "moneyline") {
    return { support: directionalSide, risk: null, label: `${directionalSide === "away" ? away : home} ${strength} support for ${pick}` };
  }

  const selectedSide = sideMatchesPick(away, pick) ? "away" : sideMatchesPick(home, pick) ? "home" : null;
  if (!selectedSide) return null;
  if (directionalSide === selectedSide) {
    return { support: selectedSide, risk: null, label: `Supports ${pick}` };
  }
  return { support: null, risk: directionalSide, label: `Challenges ${pick}` };
}

function coverageSentence(market: MarketEdgeDto): string {
  const pieces = [
    `${market.keyStats.length} key stats`,
    `${market.publicSplits.length} split sides`,
    `${market.oddsTrail?.length ?? 0} price observations`,
  ];
  if (market.marketFairProb === null && market.marketImpliedPct === null) pieces.push("market probability unavailable");
  return pieces.join(" · ");
}

function stripRiskPrefix(value: string): string {
  return value
    .replace(/^where it gets less clean:\s*/i, "")
    .replace(/^risk:\s*/i, "");
}

function stripReasonPrefix(value: string): string {
  const stripped = value
    .replace(/^why:\s*/i, "")
    .replace(/^primary driver:\s*/i, "");
  return stripped.length > 0 ? `${stripped.charAt(0).toUpperCase()}${stripped.slice(1)}` : "Unavailable";
}

function dedupeStats(stats: MarketEdgeDto["keyStats"]): MarketEdgeDto["keyStats"] {
  const seen = new Set<string>();
  return stats.filter((stat) => {
    const key = stat.label.trim().toLowerCase();
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function recentTrendInterpretation(away: PreviewHistoryPoint[], home: PreviewHistoryPoint[], marketKey: MarketKey, market: MarketEdgeDto, awayTeam: string, homeTeam: string): string {
  if (away.length === 0 || home.length === 0) return "A comparable recent sample is unavailable for one or both teams.";
  if (marketKey === "moneyline") {
    const awayWins = away.filter((row) => row.won).length;
    const homeWins = home.filter((row) => row.won).length;
    return `${awayTeam} won ${awayWins} of ${away.length}; ${homeTeam} won ${homeWins} of ${home.length}. This is form context for the ${market.pick ?? "moneyline"} read, not a substitute for today’s price and matchup.`;
  }
  if (marketKey === "total") {
    const line = market.line;
    if (line === null) return "The current total line is unavailable, so recent games cannot be compared honestly with today’s number.";
    const awayOvers = away.filter((row) => row.totalRuns > line).length;
    const homeOvers = home.filter((row) => row.totalRuns > line).length;
    return `${awayTeam} games finished above ${line} in ${awayOvers} of ${away.length}; ${homeTeam} games did so in ${homeOvers} of ${home.length}. The tiles below show every result behind those rates.`;
  }
  const awayKnown = away.filter((row) => row.firstInningRuns !== null);
  const homeKnown = home.filter((row) => row.firstInningRuns !== null);
  const awayScoreless = awayKnown.filter((row) => row.firstInningRuns === 0).length;
  const homeScoreless = homeKnown.filter((row) => row.firstInningRuns === 0).length;
  return `${awayTeam} had a scoreless first in ${awayScoreless} of ${awayKnown.length || 0}; ${homeTeam} did so in ${homeScoreless} of ${homeKnown.length || 0}. Use this as matchup context alongside starters and the first-inning market price.`;
}

function displayedProbabilityGap(market: MarketEdgeDto): number | null {
  if (market.modelProb === null || market.marketImpliedPct === null) return null;
  const modelPct = market.modelProb <= 1 ? market.modelProb * 100 : market.modelProb;
  return +(modelPct - market.marketImpliedPct).toFixed(1);
}

function displayRiskLine(market: MarketEdgeDto): string {
  const risk = stripRiskPrefix(market.guidedWatchOut || market.riskLine);
  if (!risk.trim()) return "No additional risk note is available for this snapshot.";
  if (/model favors .* by [-+]?\d+(?:\.\d+)?\s*pp/i.test(risk)) {
    return "The publish-time model comparison and latest observed price should be judged separately before acting.";
  }
  return risk;
}

function formatProbability(value: number | null): string {
  if (value === null || !Number.isFinite(value)) return "—";
  return `${(value <= 1 ? value * 100 : value).toFixed(1)}%`;
}

function formatMarketProbability(market: MarketEdgeDto): string {
  if (market.marketImpliedPct !== null) return `${market.marketImpliedPct.toFixed(1)}%`;
  return formatProbability(market.marketFairProb);
}

function currentDisplayedPrice(market: MarketEdgeDto): number | null {
  if (market.currentPriceAmerican !== null && market.currentPriceAmerican !== undefined) {
    return market.currentPriceAmerican;
  }
  if (market.bestAvailablePriceAmerican !== null && market.bestAvailablePriceAmerican !== undefined) {
    return market.bestAvailablePriceAmerican;
  }
  if (/NRFI|under/i.test(market.pick ?? "") && market.fiMarketBoard?.nrfiAmerican != null) {
    return market.fiMarketBoard.nrfiAmerican;
  }
  if (/YRFI|over/i.test(market.pick ?? "") && market.fiMarketBoard?.yrfiAmerican != null) {
    return market.fiMarketBoard.yrfiAmerican;
  }
  return market.priceAmerican;
}

function currentDisplayedSportsbook(market: MarketEdgeDto): string | null {
  if (market.currentPriceSportsbook) return market.currentPriceSportsbook;
  if (market.bestAvailableSportsbook) return market.bestAvailableSportsbook;
  const fiSource = market.fiMarketBoard?.source?.match(/^fi_market_ok_(.+)$/i)?.[1];
  return fiSource?.replaceAll(" ", "_").toLowerCase() ?? null;
}

function formatAmerican(value: number | null): string {
  if (value === null || !Number.isFinite(value)) return "—";
  return value > 0 ? `+${value}` : `${value}`;
}

function formatNumber(value: number): string {
  return Number.isFinite(value) ? value.toFixed(1) : "—";
}

function formatTimestamp(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit", timeZone: "America/New_York" }).format(date);
}

function sideMatchesPick(label: string, pick: string | null): boolean {
  if (!pick) return false;
  const normalizedLabel = label.toLowerCase();
  const normalizedPick = pick.toLowerCase();
  return normalizedLabel === normalizedPick || normalizedLabel.includes(normalizedPick) || normalizedPick.includes(normalizedLabel);
}

function teamTheme(team: string): { primary: string; secondary: string } {
  return MLB_TEAM_THEME[team.toUpperCase()] ?? { primary: "#6D28D9", secondary: "#38BDF8" };
}

function teamAccent(team: string): string {
  return MLB_TEAM_ACCENT[team.toUpperCase()] ?? "#A78BFA";
}

function mlbLogoUrl(team: string): string | null {
  const normalized = team.toUpperCase();
  if (!MLB_TEAM_ID[normalized]) return null;
  const slug = normalized === "CWS" ? "chw" : normalized === "ATH" ? "oak" : normalized.toLowerCase();
  return `https://a.espncdn.com/i/teamlogos/mlb/500/${slug}.png`;
}

function pulseToneStyle(tone: "emerald" | "amber" | "gray") {
  if (tone === "emerald") return { container: "border-emerald-400/25 from-emerald-500/[0.08]", title: "text-emerald-200", badge: "border-emerald-400/20 bg-emerald-400/[0.06] text-emerald-300", label: "Market supporting read", line: "from-gray-700 via-emerald-500/60 to-emerald-400" };
  if (tone === "amber") return { container: "border-amber-400/25 from-amber-500/[0.08]", title: "text-amber-200", badge: "border-amber-400/20 bg-amber-400/[0.06] text-amber-300", label: "Market resisting read", line: "from-gray-700 via-amber-500/60 to-amber-400" };
  return { container: "border-violet-400/20 from-violet-500/[0.07]", title: "text-violet-200", badge: "border-gray-600/30 bg-gray-500/[0.06] text-gray-400", label: "Market mixed / neutral", line: "from-gray-700 via-violet-500/50 to-gray-500" };
}

function verdictStyle(key: string): string {
  if (key === "best_angle") return "border-emerald-400/30 bg-emerald-400/[0.09] text-emerald-300";
  if (key === "lean") return "border-sky-400/30 bg-sky-400/[0.09] text-sky-300";
  if (key === "watchlist") return "border-indigo-400/25 bg-indigo-400/[0.08] text-indigo-300";
  if (key === "caution") return "border-amber-400/30 bg-amber-400/[0.09] text-amber-300";
  return "border-gray-700 bg-gray-800/40 text-gray-500";
}

function verdictSymbol(key: string): string {
  if (key === "best_angle") return "★";
  if (key === "lean") return "↗";
  if (key === "caution") return "△";
  return "○";
}
