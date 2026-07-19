"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import {
  PROP_GRADES,
  getPropGradeColor,
  getPropGradeLabel,
  type PropGrade,
} from "@/lib/mlb/props/propGrades";
import ProductTeamBadge from "@/app/lab/components/daily-edge/ProductTeamBadge";
import { teamPrimaryColor } from "@/app/lab/components/daily-edge/teamColors";
import { SportIcon } from "@/app/lab/components/SportIcon";
import type { Sport } from "@/lib/types/domain/Sport";
import {
  PROJECTION_SIDE_CONTRADICTION,
  checkProjectionSideIntegrity,
} from "@/lib/mlb/props/projectionSideIntegrity";
import type {
  PlayerBatterPitcherHistoryEvidence,
  PlayerPitchArsenalEvidence,
  PlayerPitchMixMatchupEvidence,
  PlayerPropEnvironmentEvidence,
  PlayerPropOpponentProfile,
  PlayerPropRecentForm,
  RankedResearchMetric,
} from "@/lib/mlb/props/researchEvidence";
import { assessPropPrice } from "@/lib/mlb/props/pricePolicy";

export type {
  PlayerBatterPitcherHistoryEvidence,
  PlayerPitchArsenalEvidence,
  PlayerPitchMixMatchupEvidence,
  PlayerPropEnvironmentEvidence,
  PlayerPropOpponentProfile,
  PlayerPropRecentForm,
} from "@/lib/mlb/props/researchEvidence";

type SortKey = "signal" | "ev" | "edge" | "probability" | "confidence" | "start" | "player" | "market" | "book" | "updated";
type PriceMode = "best" | "all";
type LineMode = "main" | "all";
type MarketFilter = string;
type MarketFamilyFilter = "all" | "pitcher" | "batter";
type RadarItem = { row: PlayerPropPreviewRow; label: string; note: string };
type DashboardMode = "preview" | "live-preview" | "admin" | "member" | "member-disabled";
const RADAR_ITEM_LIMIT = 6;

export type PlayerPropOddsMovement = {
  openingLine: number;
  openingOdds: number;
  openingTimestamp: string;
  openingSource: "balldontlie_opening" | "first_tracked_snapshot";
  previousLine: number;
  previousOdds: number;
  previousTimestamp: string;
  currentLine: number;
  currentOdds: number;
  currentTimestamp: string;
  lineDelta: number;
  impliedProbabilityDelta: number;
  hasMoved: boolean;
};

type SlateMatchup = {
  awayTeam: string;
  homeTeam: string;
  gameStartTime: string;
  awayProbablePitcher?: string | null;
  homeProbablePitcher?: string | null;
  starterStatus: "confirmed" | "partial" | "pending";
};

export type PlayerPropPreviewRow = {
  id: string;
  researchKey?: string;
  lockStatus?: {
    status: "locked";
    lockedAt: string;
  } | null;
  player: string;
  headshotUrl?: string | null;
  team: string;
  opponent: string;
  homeAway: string;
  gameStartTime: string;
  market: string;
  marketLabel: string;
  marketFamily: "pitcher" | "batter" | "milestone";
  marketGroup: "Pitcher Strikeouts" | "Batter Strikeouts" | "Outs" | "Hits/Bases" | "Power" | "Walks" | "Runs/RBI" | "Speed" | "Research";
  side: "over" | "under";
  line: number;
  odds: number;
  book: string;
  modelProbability: number | null;
  independentProbability: number | null;
  marketProbability: number | null;
  finalProbability: number | null;
  shrinkageWeight: number;
  modelEdge: number | null;
  expectedValue: number | null;
  fairOdds: number | null;
  units: number;
  confidence: number;
  confidenceBucket: "high" | "medium" | "low";
  playGrade: PropGrade;
  source: string;
  lastUpdated: string;
  projection: number;
  projectionSource?: "model" | "recent_form";
  overProbability: number | null;
  underProbability: number | null;
  lineupStatus?: {
    status: "confirmed" | "posted" | "pending" | "not_in_lineup";
    battingOrder: number | null;
    position: string | null;
    source: string;
    asOfTimestamp: string;
  } | null;
  providerIds?: {
    gameId: string;
    bdlGameId: string | null;
    bdlPropId?: string | null;
    bdlPlayerId: number | null;
    mlbStatsPlayerId: string | null;
  };
  oddsMovement?: PlayerPropOddsMovement | null;
  keyFeatures: string[];
  missingFeatures: string[];
  modelInputWarnings?: string[];
  marketContext?: string[];
  recentForm?: PlayerPropRecentForm | null;
  opponentProfile?: PlayerPropOpponentProfile | null;
  pitchArsenal?: PlayerPitchArsenalEvidence | null;
  pitchMatchup?: PlayerPitchMixMatchupEvidence | null;
  matchupHistory?: PlayerBatterPitcherHistoryEvidence | null;
  environment?: PlayerPropEnvironmentEvidence | null;
  reasonCodes: string[];
  oddsSanity: string[];
  settlementStatus: string;
  clvStatus: string;
};

export type PlayerPropsDashboardData = {
  date: string;
  lastUpdated: string;
  slate?: {
    practice: boolean;
    contextStatus: "available" | "partial" | "unavailable";
    nextCheckLabel?: string;
    matchups: SlateMatchup[];
  };
  providerStatus: {
    selectedOddsSource: string;
    sharpApi: string;
    bdl: string;
    publicDisplayEnabled: boolean;
    paperPersistenceEnabled: boolean;
    writesToSupabase: boolean;
  };
  summary: {
    gamesWithProps: number;
    scoredProps: number;
    recommendations: number;
    leans: number;
    watchlist: number;
    noPlay: number;
    pendingData: number;
    researchOnly: number;
    booksCovered: number;
    marketsAvailable: number;
    averageDataConfidence: number;
  };
  props: PlayerPropPreviewRow[];
  research?: Record<string, {
    recentForm: PlayerPropRecentForm | null;
    opponentProfile: PlayerPropOpponentProfile | null;
    pitchArsenal: PlayerPitchArsenalEvidence | null;
    pitchMatchup: PlayerPitchMixMatchupEvidence | null;
    matchupHistory: PlayerBatterPitcherHistoryEvidence | null;
    environment: PlayerPropEnvironmentEvidence | null;
  }>;
};

const MARKET_CODES: Record<string, string> = {
  pitcher_strikeouts: "K",
  pitcher_outs: "OUTS",
  pitcher_hits_allowed: "H",
  pitcher_walks: "BB",
  pitcher_earned_runs: "ER",
  pitcher_record_a_win: "W",
  batter_strikeouts: "K",
  batter_hits: "H",
  batter_total_bases: "TB",
  batter_home_runs: "HR",
  batter_rbis: "RBI",
  batter_runs_scored: "R",
  batter_stolen_bases: "SB",
  batter_walks: "BB",
  batter_hits_runs_rbis: "H+R+RBI",
  batter_singles: "1B",
  batter_doubles: "2B",
  batter_triples: "3B",
  first_home_run: "1st HR",
};

const QUICK_MARKETS = [
  { id: "pitcher_strikeouts", label: "Pitcher Ks" },
  { id: "batter_strikeouts", label: "Batter Ks" },
  { id: "pitcher_outs", label: "Outs" },
  { id: "batter_hits", label: "Hits" },
  { id: "batter_total_bases", label: "Total Bases" },
  { id: "batter_home_runs", label: "Home Runs" },
  { id: "batter_rbis", label: "RBIs" },
  { id: "walks", label: "Walks" },
  { id: "batter_stolen_bases", label: "Stolen Bases" },
] as const;

const MEMBER_HIDDEN_MARKETS = new Set(["first_home_run", "pitcher_record_a_win"]);

const MARKET_FILTER_LABELS: Record<string, string> = {
  all: "All markets",
  pitcher_strikeouts: "Pitcher Ks",
  pitcher_outs: "Pitcher Outs",
  pitcher_earned_runs: "Pitcher Runs",
  pitcher_hits_allowed: "Pitcher Hits",
  pitcher_walks: "Pitcher Walks",
  batter_hits: "Hits",
  batter_total_bases: "Total Bases",
  batter_strikeouts: "Batter Ks",
  batter_walks: "Batter Walks",
  batter_singles: "Singles",
  batter_doubles: "Doubles",
  batter_home_runs: "Home Runs",
  batter_rbis: "RBIs",
  batter_runs_scored: "Runs",
  batter_hits_runs_rbis: "H+R+RBI",
  batter_stolen_bases: "Stolen Bases",
  batter_triples: "Triples",
};

const MARKET_FILTERS: Array<{ id: MarketFilter; label: string }> = [
  { id: "pitcher_strikeouts", label: MARKET_FILTER_LABELS.pitcher_strikeouts },
  { id: "pitcher_outs", label: MARKET_FILTER_LABELS.pitcher_outs },
  { id: "pitcher_earned_runs", label: MARKET_FILTER_LABELS.pitcher_earned_runs },
  { id: "pitcher_hits_allowed", label: MARKET_FILTER_LABELS.pitcher_hits_allowed },
  { id: "pitcher_walks", label: MARKET_FILTER_LABELS.pitcher_walks },
  { id: "batter_hits", label: MARKET_FILTER_LABELS.batter_hits },
  { id: "batter_total_bases", label: MARKET_FILTER_LABELS.batter_total_bases },
  { id: "batter_strikeouts", label: MARKET_FILTER_LABELS.batter_strikeouts },
  { id: "batter_walks", label: MARKET_FILTER_LABELS.batter_walks },
  { id: "batter_singles", label: MARKET_FILTER_LABELS.batter_singles },
  { id: "batter_doubles", label: MARKET_FILTER_LABELS.batter_doubles },
  { id: "batter_home_runs", label: MARKET_FILTER_LABELS.batter_home_runs },
  { id: "batter_rbis", label: MARKET_FILTER_LABELS.batter_rbis },
  { id: "batter_runs_scored", label: MARKET_FILTER_LABELS.batter_runs_scored },
  { id: "batter_hits_runs_rbis", label: MARKET_FILTER_LABELS.batter_hits_runs_rbis },
  { id: "batter_stolen_bases", label: MARKET_FILTER_LABELS.batter_stolen_bases },
  { id: "batter_triples", label: MARKET_FILTER_LABELS.batter_triples },
];

const MARKET_FAMILY_FILTERS: Array<{ id: MarketFamilyFilter; label: string }> = [
  { id: "all", label: "All markets" },
  { id: "pitcher", label: "Pitcher props" },
  { id: "batter", label: "Batter props" },
];

export function PlayerPropsDashboard({ data: initialData, mode = "preview", initialSelectedId = null }: { data: PlayerPropsDashboardData; mode?: DashboardMode; initialSelectedId?: string | null }) {
  const [fullData, setFullData] = useState<PlayerPropsDashboardData | null>(null);
  const data = fullData ?? initialData;
  const [search, setSearch] = useState("");
  const [selectedGame, setSelectedGame] = useState("all");
  const [grade, setGrade] = useState<PropGrade | "all">("all");
  const [marketFamilyFilter, setMarketFamilyFilter] = useState<MarketFamilyFilter>("all");
  const [marketFilter, setMarketFilter] = useState<MarketFilter>("all");
  const [book, setBook] = useState("all");
  const [team, setTeam] = useState("all");
  const [confidence, setConfidence] = useState("all");
  const [evRange, setEvRange] = useState("all");
  const [edgeRange, setEdgeRange] = useState("all");
  const [oddsRange, setOddsRange] = useState("all");
  const [startRange, setStartRange] = useState("all");
  const [sort, setSort] = useState<SortKey>("signal");
  const [priceMode, setPriceMode] = useState<PriceMode>("best");
  const [lineMode, setLineMode] = useState<LineMode>("main");
  const [hideResearch, setHideResearch] = useState(false);
  const [selectedId, setSelectedId] = useState<string | null>(initialSelectedId);
  const [loadedResearch, setLoadedResearch] = useState<NonNullable<PlayerPropsDashboardData["research"]>>({});
  const [researchLoadingPlayerId, setResearchLoadingPlayerId] = useState<string | null>(null);
  const requestedResearchPlayers = useRef(new Set<string>());

  useEffect(() => {
    if (mode !== "member" || fullData) return;
    const controller = new AbortController();
    fetch("/api/mlb/props/picks?full=true", { signal: controller.signal })
      .then(async (response) => response.ok ? response.json() : null)
      .then((payload: { board?: PlayerPropsDashboardData } | null) => {
        if (payload?.board) setFullData(payload.board);
      })
      .catch(() => undefined);
    return () => controller.abort();
  }, [fullData, mode]);

  const availableResearch = useMemo(() => ({ ...(data.research ?? {}), ...loadedResearch }), [data.research, loadedResearch]);
  const hydratedProps = useMemo(() => data.props.map((row) => enforcePreviewIntegrity(hydrateResearchEvidence(row, availableResearch))), [availableResearch, data.props]);
  const displayProps = useMemo(() => hydratedProps.filter((row) => mode === "admin" || isMemberVisibleMarket(row)), [hydratedProps, mode]);
  const displayData = useMemo(() => ({ ...data, summary: summarizeRows(displayProps), props: displayProps }), [data, displayProps]);
  const books = useMemo(() => unique(displayProps.map((row) => row.book)), [displayProps]);
  const teams = useMemo(() => unique(displayProps.flatMap((row) => [row.team, row.opponent])), [displayProps]);
  const marketFilters = useMemo(() => {
    if (marketFamilyFilter === "all") return [];
    const available = new Set(displayProps.filter((row) => row.marketFamily === marketFamilyFilter).map((row) => row.market));
    return MARKET_FILTERS.filter((filter) => available.has(filter.id));
  }, [displayProps, marketFamilyFilter]);
  const gradeOptions = useMemo(() => {
    const available = new Set(displayProps.map((row) => row.playGrade));
    return PROP_GRADES
      .filter((value) => available.has(value))
      .map((value) => ({ value, label: getPropGradeLabel(value) }));
  }, [displayProps]);
  const players = useMemo(() => unique(displayProps.map((row) => row.player)), [displayProps]);
  const matchups = data.slate?.matchups.length ? data.slate.matchups : deriveMatchups(displayProps);

  const filteredRows = useMemo(() => {
    const query = search.trim().toLowerCase();
    let next = displayProps.filter((row) => {
      if (grade !== "all" && row.playGrade !== grade) return false;
      if (selectedGame !== "all" && gameKeyForRow(row) !== selectedGame) return false;
      if (marketFamilyFilter !== "all" && row.marketFamily !== marketFamilyFilter) return false;
      if (marketFilter !== "all" && row.market !== marketFilter) return false;
      if (book !== "all" && row.book !== book) return false;
      if (team !== "all" && row.team !== team && row.opponent !== team) return false;
      if (confidence !== "all" && row.confidenceBucket !== confidence) return false;
      if (hideResearch && row.playGrade === "RESEARCH") return false;
      if (!matchesMinimum(row.expectedValue, evRange) || !matchesMinimum(row.modelEdge, edgeRange)) return false;
      if (oddsRange === "favorite" && row.odds >= 0) return false;
      if (oddsRange === "plus" && row.odds <= 0) return false;
      if (oddsRange === "short" && (row.odds < -130 || row.odds > 130)) return false;
      const startHour = new Date(row.gameStartTime).getHours();
      if (startRange === "early" && startHour >= 20) return false;
      if (startRange === "late" && startHour < 20) return false;
      return !query || [row.player, row.team, row.opponent, row.marketLabel, row.marketGroup, rowMarketFilterLabel(row), row.book]
        .some((value) => value.toLowerCase().includes(query));
    });
    if (lineMode === "main") next = selectPrimaryPropLines(next);
    if (priceMode === "best") next = dedupeBestPrices(next);
    return [...next].sort(sortRows(sort));
  }, [book, confidence, displayProps, edgeRange, evRange, grade, hideResearch, lineMode, marketFamilyFilter, marketFilter, oddsRange, priceMode, search, selectedGame, sort, startRange, team]);

  const selected = selectedId ? displayProps.find((row) => row.id === selectedId) ?? null : null;
  const selectedPlayer = players.find((player) => player.toLowerCase() === search.trim().toLowerCase()) ?? null;
  const isSearching = search.trim().length > 0;
  const activeFilterCount = [selectedGame, grade, marketFamilyFilter, marketFilter, book, team, confidence, evRange, edgeRange, oddsRange, startRange]
    .filter((value) => value !== "all").length + (hideResearch ? 1 : 0) + (lineMode === "all" ? 1 : 0);

  const clearFilters = () => {
    setSelectedGame("all");
    setGrade("all");
    setMarketFamilyFilter("all");
    setMarketFilter("all");
    setBook("all");
    setTeam("all");
    setConfidence("all");
    setEvRange("all");
    setEdgeRange("all");
    setOddsRange("all");
    setStartRange("all");
    setHideResearch(false);
    setLineMode("main");
  };

  useEffect(() => {
    if (mode !== "member" || !selectedId) return;
    const row = data.props.find((item) => item.id === selectedId);
    if (!row?.researchKey || availableResearch[row.researchKey]) return;
    const playerId = row.providerIds?.mlbStatsPlayerId ?? row.providerIds?.bdlPlayerId?.toString() ?? row.id;
    if (requestedResearchPlayers.current.has(playerId)) return;
    requestedResearchPlayers.current.add(playerId);
    const controller = new AbortController();
    setResearchLoadingPlayerId(playerId);
    // Player research is repaired independently from the immutable board. Do
    // not reuse an older private response after a shard republish.
    fetch(`/api/mlb/props/player/${encodeURIComponent(playerId)}`, {
      signal: controller.signal,
      cache: "no-store",
    })
      .then(async (response) => {
        if (!response.ok) throw new Error(`Player research request failed with ${response.status}`);
        return response.json() as Promise<{ research?: PlayerPropsDashboardData["research"] }>;
      })
      .then((payload) => {
        if (payload.research) setLoadedResearch((current) => ({ ...current, ...payload.research }));
      })
      .catch(() => {
        requestedResearchPlayers.current.delete(playerId);
      })
      .finally(() => setResearchLoadingPlayerId((current) => current === playerId ? null : current));
    return () => controller.abort();
  }, [availableResearch, data.props, mode, selectedId]);

  if (displayProps.length === 0) {
    return <PendingPropsState data={data} mode={mode} matchups={matchups} />;
  }

  return (
    <div className="w-full pb-8">
      <PropLeagueRail />
      {mode === "preview" ? <PreviewDataNotice /> : null}
      {mode === "live-preview" ? <LivePreviewDataNotice /> : null}
      <PropsSlateHeader data={displayData} mode={mode} matchups={matchups} selectedGame={selectedGame} onSelectGame={setSelectedGame} />
      {mode === "admin" ? <ProviderHealthStrip data={displayData} matchups={matchups} /> : null}
      {!isSearching ? <TodayRadar rows={displayProps} onSelect={setSelectedId} /> : null}

      <section data-product-zone="research-entry" className="z-30 -mx-4 border-y border-gray-800 bg-[#07090d]/95 px-4 py-4 shadow-[0_12px_30px_rgba(0,0,0,0.3)] backdrop-blur sm:sticky sm:top-16 sm:-mx-6 sm:px-6 lg:-mx-8 lg:px-8">
        <div className="flex flex-col gap-3 lg:flex-row lg:items-center">
          <div className="shrink-0 lg:w-40"><p className="text-[10px] font-black uppercase text-violet-300">Research workspace</p><h2 className="mt-1 text-lg font-black text-white">Explore the board</h2></div>
          <label className="relative block min-w-0 flex-1">
            <span className="sr-only">Search player props</span>
            <span aria-hidden="true" className="pointer-events-none absolute inset-y-0 left-3 flex items-center text-sm text-gray-600">⌕</span>
            <input type="search" list="mlb-props-players" value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Search a player, team, market, or sportsbook" className="h-11 w-full rounded-md border border-gray-700 bg-gray-950 pl-9 pr-3 text-sm text-white outline-none placeholder:text-gray-600 focus:border-violet-400" />
            <datalist id="mlb-props-players">{players.map((player) => <option key={player} value={player} />)}</datalist>
          </label>
          <p className="shrink-0 text-xs text-gray-500"><strong className="text-gray-200">{filteredRows.length}</strong> options shown · {players.length} players priced</p>
        </div>
        <div className="mt-3 flex gap-2 overflow-x-auto pb-1" aria-label="Market groups">
          {MARKET_FAMILY_FILTERS.map((filter) => <MarketFilterButton key={filter.id} label={filter.label} active={marketFamilyFilter === filter.id} onClick={() => { setMarketFamilyFilter(filter.id); setMarketFilter("all"); }} />)}
        </div>
        {marketFamilyFilter !== "all" && marketFilters.length ? <div className="mt-2 flex gap-2 overflow-x-auto pb-1" aria-label="Specific market filters">
          <MarketFilterButton label={marketFamilyFilter === "pitcher" ? "All pitcher props" : "All batter props"} active={marketFilter === "all"} onClick={() => setMarketFilter("all")} />
          {marketFilters.map((filter) => <MarketFilterButton key={filter.id} label={filter.label} active={marketFilter === filter.id} onClick={() => setMarketFilter(filter.id)} />)}
        </div> : null}
        <div data-product-zone="board-controls" className="mt-3 border-t border-gray-800 pt-3">
          <div className="flex flex-wrap items-center gap-2">
          <FilterSelect label="Model signal" value={grade} onChange={(value) => setGrade(value as PropGrade | "all")} options={gradeOptions} includeAll />
          <FilterSelect label="Team / game" value={team} onChange={setTeam} options={teams} includeAll />
          <FilterSelect label="Book" value={book} onChange={setBook} options={books} includeAll />
          <FilterSelect label="Sort" value={sort} onChange={(value) => setSort(value as SortKey)} options={[
            { value: "signal", label: "Signal first" }, { value: "player", label: "Player A–Z" }, { value: "market", label: "Market" }, { value: "start", label: "Start time" },
            { value: "ev", label: "Highest EV" }, { value: "edge", label: "Highest model edge" }, { value: "probability", label: "Model probability" },
            { value: "confidence", label: "Evidence strength" }, { value: "book", label: "Book" }, { value: "updated", label: "Last updated" },
          ]} />
          <LineModeControl value={lineMode} onChange={setLineMode} />
          <PriceModeControl value={priceMode} onChange={setPriceMode} />
          {activeFilterCount > 0 ? <button type="button" onClick={clearFilters} className="h-9 px-2 text-xs font-bold text-sky-300 hover:text-white">Clear {activeFilterCount}</button> : null}
          </div>
          <details className="group mt-2"><summary className="flex h-8 w-fit cursor-pointer list-none items-center gap-2 text-xs font-bold text-gray-500 hover:text-white">More filters <span className="transition-transform group-open:rotate-180">⌄</span></summary><div className="mt-2 flex flex-wrap items-center gap-2">
            <FilterSelect label="Evidence strength" value={confidence} onChange={setConfidence} options={["high", "medium", "low"]} includeAll />
            <FilterSelect label="EV range" value={evRange} onChange={setEvRange} options={[{ value: "0", label: "EV 0%+" }, { value: "0.05", label: "EV 5%+" }, { value: "0.10", label: "EV 10%+" }]} includeAll />
            <FilterSelect label="Model-edge range" value={edgeRange} onChange={setEdgeRange} options={[{ value: "0", label: "Edge 0%+" }, { value: "0.03", label: "Edge 3%+" }, { value: "0.05", label: "Edge 5%+" }]} includeAll />
            <FilterSelect label="Odds range" value={oddsRange} onChange={setOddsRange} options={[{ value: "favorite", label: "Favorites" }, { value: "short", label: "-130 to +130" }, { value: "plus", label: "Plus money" }]} includeAll />
            <FilterSelect label="Start time" value={startRange} onChange={setStartRange} options={[{ value: "early", label: "Before 8 PM" }, { value: "late", label: "8 PM or later" }]} includeAll />
            <ToggleControl label="Hide Research" checked={hideResearch} onChange={setHideResearch} />
          </div></details>
        </div>
      </section>

      {selectedPlayer ? <PlayerView rows={filteredRows} player={selectedPlayer} selectedId={selectedId} onSelect={setSelectedId} onClear={() => setSearch("")} /> : <>
      <FullBoardView rows={filteredRows} totalCount={dedupeBestPrices(displayProps).length} priceMode={priceMode} selectedId={selectedId} onSelect={setSelectedId} />
      </>}
      {!isSearching ? <PlayerDirectory rows={displayProps} onSelectPlayer={setSearch} /> : null}
      {selected && researchLoadingPlayerId ? <p className="mt-3 text-xs text-violet-200">Loading verified player research…</p> : null}
      {selected ? <PropDetailDrawer row={selected} comparisons={displayProps.filter((row) => sameProp(row, selected))} onClose={() => setSelectedId(null)} showDiagnostics={mode === "admin"} /> : null}
    </div>
  );
}

function PreviewDataNotice() {
  return <aside role="status" className="mb-5 border border-amber-400/40 bg-amber-400/[0.08] px-4 py-3 sm:px-5">
    <p className="text-[10px] font-black uppercase text-amber-300">Design preview · Simulated board</p>
    <p className="mt-1 max-w-4xl text-sm leading-6 text-amber-50/80">Lines, projections, grades, prices, and results on this page are static test data. They are not live, bettable, or sourced from today&apos;s BDL response.</p>
  </aside>;
}

function LivePreviewDataNotice() {
  return <aside role="status" className="mb-5 border border-emerald-400/35 bg-emerald-400/[0.07] px-4 py-3 sm:px-5">
    <p className="text-[10px] font-black uppercase text-emerald-300">Live internal preview</p>
    <p className="mt-1 max-w-4xl text-sm leading-6 text-emerald-50/80">Current sportsbook markets and official MLB research data from the latest private refresh. Public member access remains off.</p>
  </aside>;
}

function PropLeagueRail() {
  const leagues: Array<{ key: Sport; label: string }> = [
    { key: "mlb", label: "MLB" },
    { key: "nfl", label: "NFL" },
    { key: "cfb", label: "CFB" },
    { key: "nba", label: "NBA" },
    { key: "wnba", label: "WNBA" },
    { key: "cbb", label: "CBB" },
    { key: "nhl", label: "NHL" },
    { key: "soccer", label: "Soccer" },
  ];

  return <nav aria-label="Player props leagues" className="-mx-4 mb-5 border-y border-white/[0.05] bg-white/[0.015] px-4 py-2.5 sm:-mx-6 sm:px-6 lg:-mx-8 lg:px-8">
    <div className="flex gap-2 overflow-x-auto pb-1">
      {leagues.map((league) => {
        const active = league.key === "mlb";
        return <button key={league.key} type="button" disabled={!active} aria-current={active ? "page" : undefined} aria-label={active ? "MLB player props, active" : `${league.label} player props, coming soon`} className={`inline-flex min-w-[112px] shrink-0 items-center gap-2.5 rounded-lg border px-3 py-2 text-left ${active ? "border-violet-400/55 bg-violet-500/[0.14]" : "cursor-not-allowed border-white/[0.06] bg-white/[0.02] opacity-65"}`}>
          <span className={`inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-full ${active ? "bg-violet-500/[0.22] ring-1 ring-violet-400/40" : "bg-white/[0.04] ring-1 ring-white/[0.06]"}`}><SportIcon sport={league.key} active={active} /></span>
          <span className="min-w-0"><strong className={`block text-[11px] uppercase ${active ? "text-white" : "text-gray-300"}`}>{league.label}</strong><span className={`mt-0.5 block text-[9px] ${active ? "text-emerald-300" : "text-gray-500"}`}>{active ? "Active" : "Coming soon"}</span></span>
        </button>;
      })}
    </div>
  </nav>;
}

function PropsSlateHeader({ data, mode, matchups, selectedGame, onSelectGame }: { data: PlayerPropsDashboardData; mode: DashboardMode; matchups: SlateMatchup[]; selectedGame: string; onSelectGame: (value: string) => void }) {
  const uniqueProps = dedupeBestPrices(data.props);
  const playerCount = unique(data.props.map((row) => row.player)).length;
  const navigableMatchups = data.props.length
    ? matchups.filter((matchup) => data.props.some((row) => gameKeyForRow(row) === gameKeyForMatchup(matchup)))
    : matchups;
  const isPreview = mode === "preview";
  const isLivePreview = mode === "live-preview";
  return <header data-product-zone="slate-intelligence" className="border-b border-gray-800 pb-6">
    <div className="flex flex-wrap items-end justify-between gap-3">
      <div>{mode === "admin" ? <span className="mb-2 inline-flex rounded border border-violet-400/30 px-2 py-1 text-[10px] font-black uppercase text-violet-200">Admin review</span> : isLivePreview ? <span className="mb-2 inline-flex rounded border border-emerald-400/30 px-2 py-1 text-[10px] font-black uppercase text-emerald-200">Live data preview</span> : isPreview ? <span className="mb-2 inline-flex rounded border border-amber-400/30 px-2 py-1 text-[10px] font-black uppercase text-amber-200">Simulated data</span> : null}<p className="text-[11px] font-bold text-emerald-300">MLB · {formatSlateDate(data.date)}</p><h1 className="mt-1 text-2xl font-black text-white sm:text-3xl">Prop Researcher</h1></div>
      <p className="pb-1 text-xs text-gray-500">{isPreview ? "Fixture timestamp" : "Updated"} {formatTime(data.lastUpdated)}</p>
    </div>
    <div className="mt-5 grid grid-cols-2 gap-px overflow-hidden rounded-lg border border-gray-800 bg-gray-800 sm:grid-cols-4">
      <SlateMetric label={data.summary.gamesWithProps === 1 ? "Game with props" : "Games with props"} value={String(data.summary.gamesWithProps)} />
      <SlateMetric label="Players priced" value={String(playerCount)} />
      <SlateMetric label={isPreview ? "Sample options" : "Prop options"} value={String(uniqueProps.length)} />
      <SlateMetric label={isPreview ? "Sample books" : "Sportsbooks"} value={String(data.summary.booksCovered)} />
    </div>
    {navigableMatchups.length ? <SlateGameNavigator data={data} matchups={navigableMatchups} selectedGame={selectedGame} onSelectGame={onSelectGame} isPreview={isPreview} /> : null}
  </header>;
}

function SlateMetric({ label, value }: { label: string; value: string }) {
  return <div className="bg-[#0d1015] px-4 py-3"><strong className="block text-xl font-black tabular-nums text-white">{value}</strong><span className="mt-0.5 block text-[9px] font-bold uppercase text-gray-600">{label}</span></div>;
}

function SlateGameNavigator({ data, matchups, selectedGame, onSelectGame, isPreview }: { data: PlayerPropsDashboardData; matchups: SlateMatchup[]; selectedGame: string; onSelectGame: (value: string) => void; isPreview: boolean }) {
  return <div className="mt-3">
    <div className="mb-2 flex items-center justify-between gap-3"><p className="text-[9px] font-black uppercase text-gray-600">{matchups.length === 1 ? "Today’s matchup" : "Filter by game"}</p>{selectedGame !== "all" && matchups.length > 1 ? <button type="button" onClick={() => onSelectGame("all")} className="text-[10px] font-bold text-sky-300 hover:text-white">Show full slate</button> : null}</div>
    <div className="flex gap-2 overflow-x-auto pb-1" aria-label="Slate games">
      {matchups.length > 1 ? <button type="button" onClick={() => onSelectGame("all")} aria-pressed={selectedGame === "all"} className={`w-[180px] shrink-0 rounded-lg border px-4 py-3 text-left ${selectedGame === "all" ? "border-sky-400 bg-sky-400/[0.08]" : "border-gray-800 bg-[#0d1015] hover:border-gray-700"}`}><span className="text-[10px] font-black uppercase text-gray-500">Full slate</span><strong className="mt-1 block text-base text-white">All {matchups.length} games</strong><span className="mt-1 block text-[10px] text-gray-600">{dedupeBestPrices(data.props).length} prop options</span></button> : null}
      {matchups.map((matchup) => {
        const key = gameKeyForMatchup(matchup);
        const gameRows = data.props.filter((row) => gameKeyForRow(row) === key);
        const gameProps = dedupeBestPrices(gameRows).length;
        const gamePlayers = unique(gameRows.map((row) => row.player)).length;
        const gameBooks = unique(gameRows.map((row) => row.book)).length;
        const active = selectedGame === key || (matchups.length === 1 && selectedGame === "all");
        return <button key={key} type="button" onClick={() => onSelectGame(matchups.length === 1 ? "all" : key)} aria-pressed={active} className={`w-[330px] shrink-0 rounded-lg border p-3 text-left ${active ? "border-sky-400/70 bg-sky-400/[0.07]" : "border-gray-800 bg-[#0d1015] hover:border-gray-700"}`}>
          <span className="flex items-center gap-2"><ProductTeamBadge abbreviation={matchup.awayTeam} size={28} /><strong className="text-sm text-white">{matchup.awayTeam}</strong><span className="text-[9px] font-bold text-gray-600">AT</span><ProductTeamBadge abbreviation={matchup.homeTeam} size={28} /><strong className="text-sm text-white">{matchup.homeTeam}</strong><span className="ml-auto text-xs font-black text-white">{formatTime(matchup.gameStartTime)}</span></span>
          <span className="mt-3 block truncate border-t border-gray-800 pt-2 text-[10px] text-gray-500">{matchup.awayProbablePitcher ?? "Starter TBD"} <span className="text-gray-700">vs</span> {matchup.homeProbablePitcher ?? "Starter TBD"}</span>
          <span className="mt-1 block text-[10px] text-gray-600">{gamePlayers} players · {gameProps} {isPreview ? "sample options" : "prop options"} · {gameBooks} books</span>
        </button>;
      })}
    </div>
  </div>;
}

function ProviderHealthStrip({ data, matchups }: { data: PlayerPropsDashboardData; matchups: SlateMatchup[] }) {
  const starters = matchups.every((item) => item.starterStatus === "confirmed") ? "Confirmed" : matchups.some((item) => item.starterStatus === "partial") ? "Partial" : "Projected";
  const context = data.slate?.contextStatus ?? "unavailable";
  const items: Array<[string, string, "good" | "warn" | "bad"]> = [
    ["BDL odds", humanStatus(data.providerStatus.bdl), data.providerStatus.bdl.includes("flow") ? "good" : "warn"],
    ["Sharp audit", humanStatus(data.providerStatus.sharpApi), data.providerStatus.sharpApi.includes("no_player") ? "warn" : "good"],
    ["Splits/context", context, context === "available" ? "good" : "warn"],
    ["Probable starters", starters, starters === "Confirmed" ? "good" : "warn"],
  ];
  const healthy = items.filter(([, , tone]) => tone === "good").length;
  return <section aria-label="Provider Health" className="border-b border-gray-900"><details className="group"><summary className="flex cursor-pointer list-none items-center justify-between py-3 text-xs"><span className="flex items-center gap-2 font-bold text-gray-400"><span className="h-2 w-2 rounded-full bg-amber-400" />Data status</span><span className="text-gray-600">{healthy} ready · {items.length - healthy} partial <span className="ml-2 inline-block transition-transform group-open:rotate-180">⌄</span></span></summary><div className="grid grid-cols-2 gap-x-6 gap-y-3 pb-4 lg:grid-cols-4">{items.map(([label, value, tone]) => (
    <div key={label} className="flex min-w-0 items-center gap-2">
      <span className={`h-2 w-2 shrink-0 rounded-full ${tone === "good" ? "bg-emerald-400" : tone === "warn" ? "bg-amber-400" : "bg-rose-400"}`} />
      <div className="min-w-0"><p className="text-[10px] font-bold uppercase text-gray-500">{label}</p><p className="truncate text-xs font-semibold capitalize text-gray-200">{value}</p></div>
    </div>
  ))}</div></details></section>;
}

function MarketFilterButton({ label, active, onClick }: { label: string; active: boolean; onClick: () => void }) {
  return <button type="button" onClick={onClick} aria-pressed={active} className={`h-8 shrink-0 rounded-md border px-3 text-xs font-bold ${active ? "border-violet-400 bg-violet-500/15 text-violet-100" : "border-gray-800 bg-gray-950 text-gray-500 hover:border-gray-700 hover:text-white"}`}>{label}</button>;
}

function LineModeControl({ value, onChange }: { value: LineMode; onChange: (value: LineMode) => void }) {
  return <div className="grid h-9 grid-cols-2 rounded-md border border-gray-700 bg-gray-950 p-0.5" aria-label="Prop line coverage">
    <button type="button" onClick={() => onChange("main")} aria-pressed={value === "main"} className={`rounded px-3 text-[11px] font-bold ${value === "main" ? "bg-gray-700 text-white" : "text-gray-500 hover:text-white"}`}>Main lines</button>
    <button type="button" onClick={() => onChange("all")} aria-pressed={value === "all"} className={`rounded px-3 text-[11px] font-bold ${value === "all" ? "bg-gray-700 text-white" : "text-gray-500 hover:text-white"}`}>All lines</button>
  </div>;
}

function PriceModeControl({ value, onChange }: { value: PriceMode; onChange: (value: PriceMode) => void }) {
  return <div className="grid h-9 grid-cols-2 rounded-md border border-gray-700 bg-gray-950 p-0.5" aria-label="Sportsbook price coverage">
    <button type="button" onClick={() => onChange("best")} aria-pressed={value === "best"} className={`rounded px-3 text-[11px] font-bold ${value === "best" ? "bg-gray-700 text-white" : "text-gray-500 hover:text-white"}`}>Best odds</button>
    <button type="button" onClick={() => onChange("all")} aria-pressed={value === "all"} className={`rounded px-3 text-[11px] font-bold ${value === "all" ? "bg-gray-700 text-white" : "text-gray-500 hover:text-white"}`}>All prices</button>
  </div>;
}

function TodayRadar({ rows, onSelect }: { rows: PlayerPropPreviewRow[]; onSelect: (id: string) => void }) {
  const items = buildRadarItems(rows);
  return <section data-product-zone="today-radar" className="border-b border-gray-800 py-7">
    <div className="flex items-end justify-between gap-4"><div><p className="text-[10px] font-black uppercase text-emerald-300">Today&apos;s Radar</p><h2 className="mt-1 text-2xl font-black text-white">Top model predictions</h2></div><span className="text-xs text-gray-500">{items.length} reads</span></div>
    <div className="mt-4 flex snap-x gap-3 overflow-x-auto pb-2" aria-label="Top model prediction cards">{items.map((item) => <RadarCard key={`${item.label}-${item.row.id}`} item={item} onSelect={onSelect} />)}</div>
  </section>;
}

function RadarCard({ item, onSelect }: { item: RadarItem; onSelect: (id: string) => void }) {
  const { row } = item;
  const teamColor = teamPrimaryColor(row.team, "mlb");
  const gradeColor = getPropGradeColor(row.playGrade);
  return <article className="relative h-full w-[min(84vw,340px)] shrink-0 snap-start overflow-hidden rounded-lg border bg-[#0e1218] lg:w-[360px]" style={{ borderColor: gradeColor.border, boxShadow: `0 0 0 1px ${gradeColor.border}22 inset`, background: `linear-gradient(180deg, ${gradeColor.background}, rgba(14, 18, 24, 0.98) 42%)` }}>
    <div className="absolute inset-x-0 top-0 h-0.5" style={{ backgroundColor: teamColor }} />
    <div className="absolute -right-8 top-12 opacity-[0.045]"><ProductTeamBadge abbreviation={row.team} size={150} /></div>
    <div className="relative p-4"><div className="flex items-start justify-between gap-3"><span className="text-[10px] font-black uppercase text-violet-300">{item.label}</span><PropGradeBadge grade={row.playGrade} compact /></div>
      <div className="mt-4 flex min-w-0 items-center gap-3"><PlayerAvatar player={row.player} team={row.team} headshotUrl={row.headshotUrl} /><div className="min-w-0"><h3 className="truncate text-base font-black text-white">{row.player}</h3><p className="truncate text-xs text-gray-500">{row.team} {row.homeAway === "home" ? "vs" : "@"} {row.opponent} · {row.marketLabel}</p></div></div>
      <div className="mt-5 grid grid-cols-[minmax(0,1fr)_auto] items-end gap-3"><div><p className="text-[9px] font-bold uppercase text-gray-600">Prediction</p><p className="mt-1 text-2xl font-black text-white">{row.side === "over" ? "Over" : "Under"} {row.line}</p></div><div className="text-right"><p className="text-[9px] font-bold uppercase text-gray-600">Best price</p><p className="mt-1 text-xl font-black text-white">{signed(row.odds)}</p><p className="text-[10px] text-gray-500">{row.book}</p></div></div>
      <div className="mt-4 border-y border-gray-800 py-3"><div className="flex items-center justify-between text-xs"><span className="text-gray-500">{row.projectionSource === "recent_form" ? "Recent avg" : "Projection"} <strong className="ml-1 text-white">{row.projection}</strong></span><span className="text-gray-500">Edge <strong className={(row.modelEdge ?? 0) > 0 ? "ml-1 text-emerald-300" : "ml-1 text-gray-300"}>{row.modelEdge === null ? "-" : pct(row.modelEdge, true)}</strong></span></div><p className="mt-2 text-xs leading-5 text-gray-400">{item.note}</p></div>
      <button type="button" onClick={() => onSelect(row.id)} className="mt-4 h-9 w-full rounded-md border border-gray-700 text-xs font-black text-gray-100 hover:border-violet-400 hover:bg-violet-500/10">Open Reader</button>
    </div>
  </article>;
}

function PlayerDirectory({ rows, onSelectPlayer }: { rows: PlayerPropPreviewRow[]; onSelectPlayer: (player: string) => void }) {
  const summaries = playerDirectorySummaries(rows);
  return <section data-product-zone="player-directory" className="border-b border-gray-800 py-6">
    <details className="group"><summary className="flex cursor-pointer list-none items-center justify-between gap-4"><div><p className="text-[10px] font-black uppercase text-violet-300">Browse players</p><h2 className="mt-1 text-base font-black text-white">{summaries.length} players with posted props</h2></div><span className="flex items-center gap-2 text-xs font-bold text-gray-500">Open directory <span className="transition-transform group-open:rotate-180">⌄</span></span></summary>
    <div className="mt-4 flex gap-2 overflow-x-auto pb-2">{summaries.map((item) => <button key={item.player} type="button" onClick={() => onSelectPlayer(item.player)} className="flex w-[250px] shrink-0 items-center gap-3 rounded-lg border border-gray-800 bg-gray-950 p-3 text-left hover:border-gray-700 hover:bg-gray-900"><PlayerAvatar player={item.player} team={item.team} headshotUrl={item.headshotUrl} compact /><span className="min-w-0 flex-1"><strong className="block truncate text-sm text-white">{item.player}</strong><span className="mt-0.5 block truncate text-[10px] text-gray-600">{item.team} · {item.markets} markets · {item.books} books</span></span><span className="text-sm text-violet-300">›</span></button>)}</div>
    </details>
  </section>;
}

export function PropResearchCockpit({ rows, allRows, search, quickMarket, selectedId, onQuickMarket, onResearchSelect, onOpenBreakdown }: { rows: PlayerPropPreviewRow[]; allRows: PlayerPropPreviewRow[]; search: string; quickMarket: string | null; selectedId: string | null; onQuickMarket: (value: string | null) => void; onResearchSelect: (id: string) => void; onOpenBreakdown: (id: string) => void }) {
  const query = search.trim().toLowerCase();
  const searchable = dedupeBestPrices(rows);
  const filtered = searchable.filter((row) => {
    const searchMatch = !query || [row.player, row.team, row.opponent, row.market, row.marketLabel, row.marketGroup, row.book]
      .some((value) => value.toLowerCase().includes(query));
    const marketMatch = !quickMarket || (quickMarket === "walks" ? row.market.endsWith("walks") : row.market === quickMarket);
    return searchMatch && marketMatch;
  });
  const matches = filtered.slice(0, 6);
  const selected = filtered.find((row) => row.id === selectedId) ?? searchable.find((row) => row.id === selectedId) ?? matches[0] ?? searchable[0] ?? null;
  const prices = selected ? allRows.filter((row) => sameProp(row, selected)).sort((a, b) => b.odds - a.odds) : [];
  const coveredBooks = unique(allRows.map((row) => row.book));
  return <section id="prop-research-cockpit" data-product-zone="research-cockpit" aria-label="Prop Research Cockpit" className="overflow-hidden rounded-lg border border-gray-800 bg-[#101319]">
    <div className="border-b border-gray-800 bg-[#151922] px-4 py-5 sm:px-6"><div className="flex items-end justify-between gap-4"><div><p className="text-[10px] font-black uppercase text-emerald-300">Player research</p><h2 className="mt-1 text-2xl font-black text-white">{search.trim() ? `Results for “${search.trim()}”` : "Market results"}</h2></div><span className="text-xs text-gray-500">{filtered.length} props</span></div>
    <div className="mt-3 flex gap-2 overflow-x-auto pb-1" aria-label="Quick market filters">{QUICK_MARKETS.map((item) => <button key={item.id} type="button" onClick={() => onQuickMarket(quickMarket === item.id ? null : item.id)} aria-pressed={quickMarket === item.id} className={`h-8 shrink-0 rounded border px-3 text-xs font-bold ${quickMarket === item.id ? "border-violet-400 bg-violet-500/15 text-violet-100" : "border-gray-700 bg-gray-950 text-gray-400 hover:text-white"}`}>{item.label}</button>)}</div>
    </div>
    {selected ? <><div className="flex gap-1 overflow-x-auto border-b border-gray-800 bg-black/20 px-3" data-research-module="selection-list">{matches.length ? matches.map((row) => <button key={row.id} type="button" onClick={() => onResearchSelect(row.id)} aria-pressed={selected.id === row.id} className={`min-w-[170px] border-b-2 px-3 py-3 text-left ${selected.id === row.id ? "border-emerald-400 bg-white/[0.03]" : "border-transparent"}`}><strong className="block truncate text-xs text-white">{row.player}</strong><span className="mt-0.5 block truncate text-[10px] text-gray-500">{row.marketLabel} · {signed(row.odds)}</span></button>) : <p className="px-4 py-6 text-center text-sm text-gray-500">No props match this search.</p>}</div>
      <div className="grid min-w-0 xl:grid-cols-[minmax(0,1fr)_300px]" data-research-module="player-market-snapshot">
        <div className="min-w-0 border-gray-800 p-4 sm:p-6 xl:border-r"><div className="flex flex-col gap-3 border-b border-gray-800 pb-5 sm:flex-row sm:items-end sm:justify-between"><div className="flex min-w-0 items-center gap-3"><PlayerAvatar player={selected.player} team={selected.team} headshotUrl={selected.headshotUrl} /><div className="min-w-0"><p className="text-[10px] font-black uppercase text-emerald-300">Selected prop</p><h3 className="mt-1 truncate text-2xl font-black text-white">{selected.player}</h3><p className="mt-1 text-sm text-gray-500">{selected.marketLabel} · {selected.team} {selected.homeAway === "home" ? "vs" : "@"} {selected.opponent}</p></div></div><div className="sm:text-right"><p className="text-3xl font-black text-white">{selected.side === "over" ? "Over" : "Under"} {selected.line}</p><p className="mt-1 text-xs font-black text-emerald-300">{selected.book} {signed(selected.odds)}</p></div></div><div className="mt-5" data-research-module="projection-vs-line"><ResearchModuleHeading title={selected.projectionSource === "recent_form" ? "Recent form vs line" : "The model case"} /><ProjectionVsLineVisual projection={selected.projection} line={selected.line} side={selected.side} label={selected.projectionSource === "recent_form" ? "Recent average" : "Projection"} /></div><details className="group mt-5 border-t border-gray-800 pt-4"><summary className="flex cursor-pointer list-none items-center justify-between text-xs font-black text-gray-300"><span>More model context</span><span className="text-gray-600 transition-transform group-open:rotate-180">⌄</span></summary><div className="mt-4" data-research-module="model-vs-market"><ResearchModuleHeading title="Model vs Market" /><ModelVsMarketVisual row={selected} /></div><MarketContextSummary row={selected} /></details></div>
        <div className="min-w-0 bg-black/20 p-4 sm:p-5"><div data-research-module="book-price-ladder"><ResearchModuleHeading title="Best available price" /><BookPriceLadder prices={prices} allBooks={coveredBooks} /></div><details className="group mt-5 border-t border-gray-800 pt-4"><summary className="flex cursor-pointer list-none items-center justify-between text-xs font-black text-gray-300"><span>Research signals</span><span className="text-gray-600 transition-transform group-open:rotate-180">⌄</span></summary><div className="mt-4" data-research-module="player-stat-snapshot"><ResearchModuleHeading title="Season baseline" /><PlayerStatSnapshot row={selected} /></div><FeatureConfidenceChecklist row={selected} /></details><button type="button" onClick={() => onOpenBreakdown(selected.id)} className="mt-5 h-11 w-full rounded-md bg-emerald-400 px-4 text-xs font-black text-black hover:bg-emerald-300">Open Full Breakdown</button></div>
      </div></> : <p className="py-8 text-center text-sm text-gray-500">No props are available for research.</p>}
  </section>;
}

function ResearchModuleHeading({ title }: { title: string }) {
  return <h3 className="mb-2 text-[10px] font-black uppercase text-gray-500">{title}</h3>;
}

function FeaturedPropCard({ row, onSelect }: { row: PlayerPropPreviewRow; onSelect: (id: string) => void }) {
  const best = row.playGrade === "BEST_ANGLE";
  return <article data-featured-card data-card-chip-count="2" className={`relative grid min-h-[420px] overflow-hidden rounded-lg border bg-[#101319] transition-colors sm:grid-cols-[220px_minmax(0,1fr)] ${best ? "border-emerald-500/35" : "border-sky-500/25"}`}>
    <PlayerEditorialVisual row={row} />
    <div className="flex min-w-0 flex-col p-5 sm:p-7"><div className="flex items-start justify-between gap-3"><div><p className="text-[10px] font-black uppercase text-emerald-300">OddSphere featured read</p><h3 className="mt-1 text-2xl font-black text-white">{row.player}</h3><p className="mt-1 text-xs text-gray-500">{row.team} {row.homeAway === "home" ? "vs" : "@"} {row.opponent} · {formatTime(row.gameStartTime)}</p></div><PropGradeBadge grade={row.playGrade} /></div>
    <p className="mt-8 text-[10px] font-black uppercase text-gray-600">{row.marketLabel}</p><p className="mt-1 text-4xl font-black leading-none text-white">{row.side === "over" ? "Over" : "Under"} {row.line}</p><p className="mt-2 text-sm font-semibold text-gray-300">{pickMarketLabel(row)} · <span className="font-black text-white">{row.book} {signed(row.odds)}</span> <span className="text-gray-600">best price</span></p>
    <div className="mt-6 grid grid-cols-3 border-y border-gray-800 py-4 text-xs font-bold tabular-nums"><span><span className="block text-[9px] uppercase text-gray-600">Model edge</span><strong className="mt-1 block text-lg text-emerald-300">{row.modelEdge === null ? "-" : pct(row.modelEdge, true)}</strong></span><span><span className="block text-[9px] uppercase text-gray-600">Expected value</span><strong className="mt-1 block text-lg text-emerald-300">{row.expectedValue === null ? "-" : pct(row.expectedValue, true)}</strong></span><span><span className="block text-[9px] uppercase text-gray-600">Evidence</span><strong className="mt-1 block text-lg capitalize text-white">{row.confidenceBucket}</strong></span></div>
    <p className="mt-5 text-sm leading-6 text-gray-300">{cardReason(row)}</p><footer className="mt-auto flex items-center justify-between gap-3 pt-6"><span className="text-[10px] text-gray-600">Updated {formatTime(row.lastUpdated)}</span><button type="button" onClick={() => onSelect(row.id)} className="h-10 rounded-md bg-white px-4 text-xs font-black text-black hover:bg-emerald-200">Open Reader</button></footer></div>
  </article>;
}

function FullBoardView({ rows, totalCount, priceMode, selectedId, onSelect }: { rows: PlayerPropPreviewRow[]; totalCount: number; priceMode: PriceMode; selectedId: string | null; onSelect: (id: string) => void }) {
  const pageSize = priceMode === "best" ? 40 : 75;
  const [visibleCount, setVisibleCount] = useState(pageSize);
  const visibleRows = rows.slice(0, visibleCount);
  const marketPairs = pairMarketRows(rows);
  const visiblePairs = marketPairs.slice(0, visibleCount);
  const visibleUnits = priceMode === "best" ? visiblePairs.length : visibleRows.length;
  const totalUnits = priceMode === "best" ? marketPairs.length : rows.length;
  return <div data-product-zone="full-board" className="pt-5">
    <div className="mb-3 flex items-end justify-between gap-4"><div><p className="text-[10px] font-black uppercase text-gray-500">Search results</p><h2 className="mt-1 text-xl font-black text-white">Prop Board</h2></div><p className="text-right text-xs text-gray-500"><strong className="text-gray-200">{priceMode === "best" ? marketPairs.length : rows.length}</strong> {priceMode === "best" ? "markets" : "sportsbook prices"} shown<br />{rows.length} filtered options · {totalCount} posted</p></div>
    {priceMode === "best" ? <><div className="hidden xl:block"><MarketPairTable pairs={visiblePairs} selectedId={selectedId ?? ""} onSelect={onSelect} /></div><div className="xl:hidden"><MarketPairCards pairs={visiblePairs} selectedId={selectedId ?? ""} onSelect={onSelect} /></div></> : <PropsTable rows={visibleRows} selectedId={selectedId ?? ""} onSelect={onSelect} />}
    {visibleUnits < totalUnits ? <div className="flex flex-col items-center border-x border-b border-gray-800 bg-gray-950 px-4 py-4 sm:flex-row sm:justify-between"><p className="text-xs text-gray-500">Showing {visibleUnits} of {totalUnits} {priceMode === "best" ? "markets" : "prices"}</p><button type="button" onClick={() => setVisibleCount((count) => Math.min(count + pageSize, totalUnits))} className="mt-3 h-9 rounded-md border border-gray-700 px-4 text-xs font-bold text-gray-200 hover:border-gray-500 hover:text-white sm:mt-0">Load more markets</button></div> : null}
    {!rows.length ? <EmptyBoard /> : null}
  </div>;
}

type MarketPair = {
  key: string;
  rows: PlayerPropPreviewRow[];
  primary: PlayerPropPreviewRow;
  over: PlayerPropPreviewRow | null;
  under: PlayerPropPreviewRow | null;
};

type ModelPrediction = {
  side: "over" | "under";
  row: PlayerPropPreviewRow;
  probability: number | null;
};

type MarketDirection = ModelPrediction & {
  kind: "prediction" | "projection";
};

function MarketPairTable({ pairs, selectedId, onSelect }: { pairs: MarketPair[]; selectedId: string; onSelect: (id: string) => void }) {
  if (!pairs.length) return null;
  const projectionLabel = pairs.every((pair) => pair.primary.projectionSource === "recent_form") ? "Recent avg" : "Projection";
  return <div className="overflow-hidden rounded-lg border border-gray-800 bg-gray-950">
    <div className="grid grid-cols-[1.15fr_0.95fr_0.42fr_0.5fr_0.78fr_1.18fr_1.18fr] gap-3 border-b border-gray-800 bg-black/40 px-3 py-2 text-[9px] font-bold uppercase text-gray-500"><span>Player</span><span>Market</span><span>Line</span><span>{projectionLabel}</span><span>Prediction</span><span>Over</span><span>Under</span></div>
    <div className="divide-y divide-gray-800">{pairs.map((pair) => {
      const direction = marketDirection(pair);
      const activeSide = direction?.side ?? null;
      return <div key={pair.key} className={`grid grid-cols-[1.15fr_0.95fr_0.42fr_0.5fr_0.78fr_1.18fr_1.18fr] items-center gap-3 px-3 py-2.5 ${pair.rows.some((row) => row.id === selectedId) ? "bg-violet-400/10" : "hover:bg-gray-900"}`}>
      <span className="flex min-w-0 items-center gap-2"><PlayerAvatar player={pair.primary.player} team={pair.primary.team} headshotUrl={pair.primary.headshotUrl} compact /><span className="min-w-0"><strong className="block truncate text-sm text-white">{pair.primary.player}</strong><span className="block truncate text-[10px] text-gray-600">{pair.primary.team} {pair.primary.homeAway === "home" ? "vs" : "@"} {pair.primary.opponent}</span>{pair.primary.lockStatus ? <LockStatusBadge lockedAt={pair.primary.lockStatus.lockedAt} compact /> : null}</span></span>
      <span className="truncate text-xs font-semibold text-gray-200">{pair.primary.marketLabel}</span>
      <strong className="text-xs tabular-nums text-white">{pair.primary.line}</strong>
      <span className="text-xs font-bold tabular-nums text-gray-300">{pair.primary.projection}</span>
      <ModelPredictionBadge direction={direction} />
      <MarketSideQuote row={pair.over} side="over" directionKind={activeSide === "over" ? direction?.kind ?? null : null} onSelect={onSelect} />
      <MarketSideQuote row={pair.under} side="under" directionKind={activeSide === "under" ? direction?.kind ?? null : null} onSelect={onSelect} />
    </div>})}</div>
  </div>;
}

function MarketPairCards({ pairs, selectedId, onSelect }: { pairs: MarketPair[]; selectedId: string; onSelect: (id: string) => void }) {
  if (!pairs.length) return null;
  return <div className="divide-y divide-gray-800 overflow-hidden rounded-lg border border-gray-800 bg-gray-950">{pairs.map((pair) => {
    const direction = marketDirection(pair);
    const activeSide = direction?.side ?? null;
    return <article key={pair.key} className={`p-4 ${pair.rows.some((row) => row.id === selectedId) ? "bg-violet-400/10" : ""}`}>
      <div className="flex min-w-0 items-start justify-between gap-3"><span className="flex min-w-0 items-center gap-3"><PlayerAvatar player={pair.primary.player} team={pair.primary.team} headshotUrl={pair.primary.headshotUrl} compact /><span className="min-w-0"><strong className="block truncate text-sm text-white">{pair.primary.player}</strong><span className="block truncate text-xs text-gray-500">{pair.primary.team} {pair.primary.homeAway === "home" ? "vs" : "@"} {pair.primary.opponent} · {pair.primary.marketLabel}</span></span></span><span className="flex shrink-0 flex-col items-end gap-1">{pair.primary.lockStatus ? <LockStatusBadge lockedAt={pair.primary.lockStatus.lockedAt} /> : null}<ModelPredictionBadge direction={direction} compact /></span></div>
      <div className="mt-3 flex items-center justify-between border-y border-gray-800 py-2 text-xs"><span className="text-gray-500">Line <strong className="ml-1 text-white">{pair.primary.line}</strong></span><span className="text-gray-500">{pair.primary.projectionSource === "recent_form" ? "Recent avg" : "Projection"} <strong className="ml-1 text-white">{pair.primary.projection}</strong></span></div>
      <div className="mt-3 grid grid-cols-2 gap-2"><MarketSideQuote row={pair.over} side="over" directionKind={activeSide === "over" ? direction?.kind ?? null : null} onSelect={onSelect} /><MarketSideQuote row={pair.under} side="under" directionKind={activeSide === "under" ? direction?.kind ?? null : null} onSelect={onSelect} /></div>
    </article>;
  })}</div>;
}

function MarketSideQuote({ row, side, directionKind, onSelect }: { row: PlayerPropPreviewRow | null; side: "over" | "under"; directionKind: MarketDirection["kind"] | null; onSelect: (id: string) => void }) {
  if (!row) return <span className="flex min-h-[72px] items-center justify-center rounded-md border border-dashed border-gray-800 bg-black/10 px-2 text-center text-[10px] font-semibold text-gray-600">{side === "over" ? "Over" : "Under"}<br />Not offered</span>;
  const signal = isPositiveSignal(row);
  const isActiveDirection = directionKind !== null;
  const color = isActiveDirection || signal ? getPropGradeColor(row.playGrade) : null;
  const predictionClass = isActiveDirection
    ? "shadow-[0_0_0_1px_rgba(255,255,255,0.04)_inset] hover:brightness-125"
    : signal
      ? ""
      : "border-gray-800 bg-black/20 hover:border-gray-700 hover:bg-gray-900";
  return <button type="button" onClick={() => onSelect(row.id)} className={`min-w-0 rounded-md border px-2.5 py-2 text-left ${predictionClass}`} style={color ? { borderColor: color.border, background: color.background } : undefined}><span className="flex items-center justify-between gap-2"><strong className="text-xs text-white">{side === "over" ? "O" : "U"} {row.line} · {signed(row.odds)}</strong><PropGradeBadge grade={row.playGrade} compact /></span><span className="mt-0.5 flex items-center justify-between gap-2"><span className="truncate text-[9px] text-gray-600">{row.book}</span>{directionKind ? <span className="shrink-0 text-[9px] font-black uppercase" style={color ? { color: color.text } : undefined}>{directionKind === "prediction" ? "Prediction" : "Projection"}</span> : signal ? <span className="shrink-0 text-[9px] font-black uppercase" style={color ? { color: color.text } : undefined}>{getPropGradeLabel(row.playGrade)}</span> : null}</span><span className="mt-1 flex items-center justify-between gap-2"><OddsMovementTag row={row} />{row.lockStatus ? <LockStatusBadge lockedAt={row.lockStatus.lockedAt} compact /> : null}</span></button>;
}

function LockStatusBadge({ lockedAt, compact = false }: { lockedAt: string; compact?: boolean }) {
  return <span className={`inline-flex w-fit items-center gap-1 rounded border border-gray-600 bg-gray-800/70 font-black uppercase text-gray-200 ${compact ? "px-1.5 py-0.5 text-[8px]" : "px-2 py-1 text-[9px]"}`} title={`Locked at ${formatTime(lockedAt)}`}>
    <span className="h-1.5 w-1.5 rounded-full bg-gray-400" />
    Locked <span className="hidden sm:inline">{formatTime(lockedAt)}</span>
  </span>;
}

function ModelPredictionBadge({ direction, compact = false }: { direction: MarketDirection | null; compact?: boolean }) {
  if (!direction) return <span className={`inline-flex shrink-0 flex-col rounded border border-gray-800 bg-black/20 ${compact ? "px-2 py-1" : "px-2.5 py-1.5"}`}><span className="text-[8px] font-black uppercase text-gray-600">Read</span><span className="text-[10px] font-black text-gray-400">Research</span></span>;
  const color = getPropGradeColor(direction.row.playGrade);
  const label = direction.kind === "prediction" ? "Prediction" : "Projection only";
  return <span className={`inline-flex shrink-0 flex-col rounded border shadow-[0_0_0_1px_rgba(255,255,255,0.04)_inset] ${compact ? "px-2 py-1" : "px-2.5 py-1.5"}`} style={{ borderColor: color.border, background: color.background }}><span className="text-[8px] font-black uppercase text-gray-500">{label}</span><span className={`${compact ? "text-[11px]" : "text-xs"} font-black`} style={{ color: color.text }}>{direction.side === "over" ? "Over" : "Under"}{direction.kind === "prediction" && direction.probability !== null ? ` · ${pct(direction.probability)}` : ""}</span></span>;
}

function InlineDirectionTag({ row, kind, inline = false }: { row: PlayerPropPreviewRow; kind: MarketDirection["kind"]; inline?: boolean }) {
  const color = getPropGradeColor(row.playGrade);
  return <span className={`${inline ? "mt-1 inline-flex" : "mt-1 flex w-fit"} rounded border px-1.5 py-0.5 text-[8px] font-black uppercase`} style={{ color: color.text, borderColor: color.border, background: color.background }}>{kind === "prediction" ? "Prediction" : "Projection"}</span>;
}

function ReaderDirectionTag({ row }: { row: PlayerPropPreviewRow }) {
  const direction = rowMarketDirection(row);
  if (!direction) return null;
  const color = getPropGradeColor(row.playGrade);
  return <p className="mt-3 inline-flex rounded border px-2 py-1 text-[10px] font-black uppercase" style={{ color: color.text, borderColor: color.border, background: color.background }}>{direction.kind === "prediction" ? "Prediction" : "Projection favors"}: {direction.side === "over" ? "Over" : "Under"}{direction.kind === "prediction" && direction.probability !== null ? ` · ${pct(direction.probability)}` : ""}</p>;
}

function marketDirection(pair: MarketPair): MarketDirection | null {
  const prediction = modelPrediction(pair);
  if (prediction) return { ...prediction, kind: "prediction" };
  const projection = projectionDirection(pair);
  return projection ? { ...projection, kind: "projection" } : null;
}

function modelPrediction(pair: MarketPair): ModelPrediction | null {
  const longshotValue = pair.rows
    .filter(isLongshotValueRow)
    .sort((a, b) => (b.expectedValue ?? Number.NEGATIVE_INFINITY) - (a.expectedValue ?? Number.NEGATIVE_INFINITY))[0];
  if (longshotValue) return {
    side: longshotValue.side,
    row: longshotValue,
    probability: longshotValue.finalProbability ?? longshotValue.modelProbability ?? null,
  };
  const signalPrediction = pair.rows
    .filter(isModelSignalSide)
    .sort((a, b) => modelSignalRank(b) - modelSignalRank(a))[0];
  if (signalPrediction) return {
    side: signalPrediction.side,
    row: signalPrediction,
    probability: signalPrediction.finalProbability ?? signalPrediction.modelProbability,
  };
  const modeled = pair.rows
    .filter((row) => row.modelProbability !== null && row.modelProbability >= 0.5)
    .sort((a, b) => (b.modelProbability ?? Number.NEGATIVE_INFINITY) - (a.modelProbability ?? Number.NEGATIVE_INFINITY))[0];
  if (modeled) return { side: modeled.side, row: modeled, probability: modeled.modelProbability };
  return null;
}

function projectionDirection(pair: MarketPair): ModelPrediction | null {
  const side = projectionSideFor(pair.primary);
  if (!side) return null;
  return { side, row: pair.rows.find((row) => row.side === side) ?? pair.primary, probability: null };
}

function rowMarketDirection(row: PlayerPropPreviewRow): MarketDirection | null {
  const predictionSide = rowPredictionSide(row);
  if (predictionSide) return { side: predictionSide, row, probability: rowPredictionProbability(row), kind: "prediction" };
  const projectionSide = projectionSideFor(row);
  return projectionSide ? { side: projectionSide, row, probability: null, kind: "projection" } : null;
}

function rowPredictionSide(row: PlayerPropPreviewRow): "over" | "under" | null {
  if (isLongshotValueRow(row)) return row.side;
  if (isModelSignalSide(row)) return row.side;
  if (row.modelProbability !== null && row.modelProbability >= 0.5) return row.side;
  return null;
}

function projectionSideFor(row: PlayerPropPreviewRow): "over" | "under" | null {
  if (row.projection === row.line) return null;
  return row.projection > row.line ? "over" : "under";
}

function rowPredictionProbability(row: PlayerPropPreviewRow): number | null {
  const side = rowPredictionSide(row);
  if (!side) return null;
  if (side === row.side) return row.finalProbability ?? row.modelProbability;
  if (side === "over") return row.overProbability ?? null;
  if (side === "under") return row.underProbability ?? null;
  return null;
}

function isRowDirectionSide(row: PlayerPropPreviewRow): MarketDirection["kind"] | null {
  const direction = rowMarketDirection(row);
  return direction?.side === row.side ? direction.kind : null;
}

function pairSignalRow(pair: MarketPair): PlayerPropPreviewRow | null {
  return pair.rows
    .filter(isPositiveSignal)
    .sort((a, b) => (b.modelEdge ?? 0) - (a.modelEdge ?? 0))[0] ?? null;
}

function isLongshotValueRow(row: PlayerPropPreviewRow): boolean {
  return row.reasonCodes.includes("LONGSHOT_VALUE_CONTEXT") && row.playGrade === "WATCHLIST";
}

function isModelSignalSide(row: PlayerPropPreviewRow): boolean {
  return row.playGrade === "BEST_ANGLE" || row.playGrade === "LEAN" || row.playGrade === "WATCHLIST";
}

function modelSignalRank(row: PlayerPropPreviewRow): number {
  const grade = row.playGrade === "BEST_ANGLE" ? 3 : row.playGrade === "LEAN" ? 2 : row.playGrade === "WATCHLIST" ? 1 : 0;
  return grade * 1_000_000 + (row.expectedValue ?? -1) * 10_000 + (row.modelEdge ?? -1) * 1_000 + (row.modelProbability ?? 0);
}

function isPositiveSignal(row: PlayerPropPreviewRow): boolean {
  return row.playGrade === "BEST_ANGLE" || row.playGrade === "LEAN";
}

export function PropsTable({ rows, selectedId, onSelect }: { rows: PlayerPropPreviewRow[]; selectedId: string; onSelect: (id: string) => void }) {
  if (!rows.length) return null;
  const projectionLabel = rows.every((row) => row.projectionSource === "recent_form") ? "Recent avg" : "Projection";
  return <div className="overflow-hidden rounded-lg border border-gray-800 bg-gray-950">
    <div className="grid grid-cols-[1.25fr_1.08fr_0.78fr_0.64fr_0.82fr_0.56fr_0.54fr_0.68fr_0.82fr_0.48fr] gap-2 border-b border-gray-800 bg-black/40 px-3 py-2 text-[9px] font-bold uppercase text-gray-500 max-xl:hidden">
      <span>Player</span><span>Market</span><span>Side / Line</span><span>{projectionLabel}</span><span>Book / Odds</span><span>Edge</span><span>EV</span><span>Evidence</span><span>Model Signal</span><span>Reader</span>
    </div>
    <div className="divide-y divide-gray-800">{rows.map((row) => <div key={row.id} className={`px-3 py-3 hover:bg-gray-900 ${selectedId === row.id ? "bg-violet-400/10" : ""}`}>
      <button type="button" onClick={() => onSelect(row.id)} className="hidden w-full grid-cols-[1.25fr_1.08fr_0.78fr_0.64fr_0.82fr_0.56fr_0.54fr_0.68fr_0.82fr_0.48fr] items-center gap-2 text-left xl:grid">
        <span className="flex min-w-0 items-center gap-2"><PlayerAvatar player={row.player} team={row.team} headshotUrl={row.headshotUrl} compact /><span className="min-w-0"><span className="block truncate text-sm font-bold text-white">{row.player}</span><span className="block truncate text-[10px] text-gray-600">{row.team} {row.homeAway === "home" ? "vs" : "@"} {row.opponent}</span></span></span>
        <span className="truncate text-xs font-semibold text-gray-200">{row.marketLabel}</span>
        <span className="text-xs font-bold text-white">{row.side === "over" ? "Over" : "Under"} {row.line}{isRowDirectionSide(row) ? <InlineDirectionTag row={row} kind={isRowDirectionSide(row) ?? "prediction"} /> : null}{row.lockStatus ? <LockStatusBadge lockedAt={row.lockStatus.lockedAt} compact /> : null}</span>
        <span className="text-xs font-bold tabular-nums text-gray-200">{row.projection}</span>
        <span className="text-xs text-gray-300">{row.book} <strong className="text-white">{signed(row.odds)}</strong><PriceBandTag odds={row.odds} /><OddsMovementTag row={row} /></span>
        <BoardMetric label="Edge" value={row.modelEdge === null ? "-" : pct(row.modelEdge, true)} positive={(row.modelEdge ?? 0) > 0} />
        <BoardMetric label="EV" value={row.expectedValue === null ? "-" : pct(row.expectedValue, true)} positive={(row.expectedValue ?? 0) > 0} />
        <span className="text-xs capitalize text-gray-300">{row.confidenceBucket}</span>
        <PropGradeBadge grade={row.playGrade} compact />
        <span className="text-[10px] font-bold text-violet-200">Open</span>
      </button>
      <button type="button" onClick={() => onSelect(row.id)} className="w-full text-left xl:hidden"><span className="flex items-start justify-between gap-3"><span className="flex min-w-0 items-center gap-3"><PlayerAvatar player={row.player} team={row.team} headshotUrl={row.headshotUrl} compact /><span className="min-w-0"><span className="block truncate text-sm font-bold text-white">{row.player}</span><span className="block truncate text-xs text-gray-500">{row.team} {row.homeAway === "home" ? "vs" : "@"} {row.opponent} · {row.marketLabel}</span></span></span><span className="flex shrink-0 flex-col items-end gap-1"><PropGradeBadge grade={row.playGrade} compact />{row.lockStatus ? <LockStatusBadge lockedAt={row.lockStatus.lockedAt} /> : null}</span></span><span className="mt-4 grid grid-cols-[minmax(0,1fr)_auto] items-end gap-3"><span><span className="block text-[9px] font-bold uppercase text-gray-600">Market line</span><strong className="mt-1 block text-xl text-white">{row.side === "over" ? "Over" : "Under"} {row.line}</strong>{isRowDirectionSide(row) ? <InlineDirectionTag row={row} kind={isRowDirectionSide(row) ?? "prediction"} inline /> : null}</span><span className="text-right"><span className="block text-[9px] font-bold uppercase text-gray-600">Price</span><strong className="mt-1 block text-lg text-white">{signed(row.odds)}</strong><span className="block text-[10px] text-gray-500">{row.book}</span><OddsMovementTag row={row} align="right" /></span></span><span className="mt-4 grid grid-cols-3 border-y border-gray-800 py-3"><CompactMetric label={row.projectionSource === "recent_form" ? "Recent avg" : "Projection"} value={String(row.projection)} /><CompactMetric label="Model edge" value={row.modelEdge === null ? "-" : pct(row.modelEdge, true)} positive /><CompactMetric label="Expected value" value={row.expectedValue === null ? "-" : pct(row.expectedValue, true)} positive /></span><span className="mt-3 flex h-9 items-center justify-center rounded-md border border-gray-700 text-xs font-bold text-gray-200">Open Reader</span></button>
    </div>)}</div>
  </div>;
}

function PlayerView({ rows, player, selectedId, onSelect, onClear }: { rows: PlayerPropPreviewRow[]; player: string; selectedId: string | null; onSelect: (id: string) => void; onClear: () => void }) {
  const marketRows = dedupeBestPrices(rows);
  const marketPairs = pairMarketRows(marketRows).sort((a, b) => a.primary.marketLabel.localeCompare(b.primary.marketLabel));
  const primary = marketPairs[0]?.primary ?? null;
  const pairedRows = marketPairs.flatMap((pair) => pair.rows);
  const topModelGap = pairedRows.length ? Math.max(...pairedRows.map((row) => row.modelEdge ?? 0)) : 0;
  const playerBooks = unique(marketRows.map((row) => row.book)).length;
  if (!primary) return <div className="mt-5"><EmptyBoard label={`No markets match for ${player}.`} /></div>;
  return <div data-product-zone="player-workspace" className="mt-5">
    <button type="button" onClick={onClear} className="mb-3 inline-flex h-8 items-center gap-2 text-xs font-bold text-gray-500 hover:text-white"><span aria-hidden="true">←</span> Clear player search</button>
    <header className="rounded-lg border border-gray-800 bg-[#0b0e14] p-5"><div className="flex flex-col gap-5 lg:flex-row lg:items-end lg:justify-between"><div className="flex items-center gap-4"><PlayerAvatar player={player} team={primary.team} headshotUrl={primary.headshotUrl} large /><div><p className="text-[11px] font-bold uppercase text-violet-300">Player workspace</p><h2 className="mt-1 text-2xl font-black text-white">{player}</h2><p className="mt-1 text-sm text-gray-400">{primary.team} {primary.homeAway === "home" ? "vs" : "@"} {primary.opponent} · {formatTime(primary.gameStartTime)}</p></div></div><div className="grid grid-cols-3 border-t border-gray-800 pt-4 lg:min-w-[360px] lg:border-l lg:border-t-0 lg:pl-5 lg:pt-0"><PlayerSummaryMetric label="Markets" value={String(marketPairs.length)} /><PlayerSummaryMetric label="Top model gap" value={pct(topModelGap, true)} /><PlayerSummaryMetric label="Books" value={String(playerBooks)} /></div></div></header>
    <div className="mt-3 divide-y divide-gray-800 overflow-hidden rounded-lg border border-gray-800 bg-gray-950">{marketPairs.map((pair) => {
      const direction = marketDirection(pair);
      const activeSide = direction?.side ?? null;
      const directionRow = direction?.row ?? pair.primary;
      return <article key={pair.key} className={`grid gap-3 p-4 ${pair.rows.some((row) => row.id === selectedId) ? "bg-violet-400/10" : "hover:bg-gray-900"} lg:grid-cols-[minmax(0,1.35fr)_minmax(0,1.1fr)_minmax(320px,1.25fr)] lg:items-center`}>
        <div className="flex min-w-0 items-center gap-2"><MarketChip row={pair.primary} /><span className="min-w-0"><strong className="block truncate text-sm text-white">{pair.primary.marketLabel}</strong><span className="block truncate text-xs text-gray-500">Line {pair.primary.line} · {pair.primary.projectionSource === "recent_form" ? "Recent avg" : "Projection"} {pair.primary.projection}</span>{pair.primary.lockStatus ? <LockStatusBadge lockedAt={pair.primary.lockStatus.lockedAt} compact /> : null}</span></div>
        <div className="min-w-0"><ModelPredictionBadge direction={direction} /><span className="mt-1.5 block truncate text-xs text-gray-400">{cardReason(directionRow)}</span></div>
        <div className="grid grid-cols-2 gap-2"><MarketSideQuote row={pair.over} side="over" directionKind={activeSide === "over" ? direction?.kind ?? null : null} onSelect={onSelect} /><MarketSideQuote row={pair.under} side="under" directionKind={activeSide === "under" ? direction?.kind ?? null : null} onSelect={onSelect} /></div>
      </article>;
    })}</div>
  </div>;
}

function PlayerSummaryMetric({ label, value }: { label: string; value: string }) {
  return <div className="border-r border-gray-800 px-3 last:border-r-0"><p className="text-[9px] font-bold uppercase text-gray-600">{label}</p><p className="mt-1 text-lg font-black tabular-nums text-white">{value}</p></div>;
}

export function PropDetailDrawer({ row, comparisons, onClose, showDiagnostics = false }: { row: PlayerPropPreviewRow; comparisons: PlayerPropPreviewRow[]; onClose: () => void; showDiagnostics?: boolean }) {
  const prices = [...comparisons].sort((a, b) => b.odds - a.odds);
  return <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/80 sm:items-center sm:p-6" role="presentation" onMouseDown={(event) => { if (event.currentTarget === event.target) onClose(); }}>
    <aside role="dialog" aria-modal="true" aria-label={`${row.player} prop details`} className="h-[100dvh] w-full overflow-y-auto border-gray-800 bg-gray-950 shadow-2xl sm:max-h-[calc(100dvh-3rem)] sm:max-w-[980px] sm:rounded-lg sm:border">
      <div className="sticky top-0 z-10 flex items-center justify-between border-b border-gray-800 bg-gray-950/95 px-4 py-3 backdrop-blur sm:px-6"><div className="flex min-w-0 items-center gap-3"><PlayerAvatar player={row.player} team={row.team} headshotUrl={row.headshotUrl} compact /><div className="min-w-0"><p className="text-[10px] font-bold uppercase text-violet-300">Prop Reader</p><h2 className="truncate font-black text-white">{row.player}</h2></div></div><button type="button" onClick={onClose} aria-label="Close reader" className="flex h-9 w-9 items-center justify-center rounded-md border border-gray-700 text-lg text-gray-300 hover:border-gray-500 hover:text-white">×</button></div>
      <div className="grid min-w-0 gap-4 p-4 sm:p-6 lg:grid-cols-2">
        <div className="min-w-0 lg:col-span-2"><DrawerSection title="Prop Summary"><div className="flex items-start justify-between gap-3"><div className="min-w-0"><div className="flex min-w-0 items-center gap-2"><MarketChip row={row} /><span className="truncate text-sm text-gray-400">{row.marketLabel}</span>{row.lockStatus ? <LockStatusBadge lockedAt={row.lockStatus.lockedAt} /> : null}</div><p className="mt-3 text-2xl font-black text-white">{row.side === "over" ? "Over" : "Under"} {row.line}{" "}<span className={assessPropPrice(row.odds).signalEligible ? "text-emerald-300" : "text-sky-300"}>{signed(row.odds)}</span></p><p className="mt-1 text-xs text-gray-500">{row.team} {row.homeAway === "home" ? "vs" : "@"} {row.opponent} · {formatTime(row.gameStartTime)} · {row.book}</p><ReaderDirectionTag row={row} /></div><PropGradeBadge grade={row.playGrade} /></div><PriceContextLine odds={row.odds} /></DrawerSection></div>
        <div className="min-w-0 lg:col-span-2"><DrawerSection title="Reader Summary"><p className="max-w-3xl text-base font-semibold leading-7 text-gray-100">{propReaderSummary(row, prices)}</p><div className="mt-4 flex flex-wrap gap-x-5 gap-y-2 border-t border-gray-800 pt-3 text-xs"><span className="text-gray-500">Signal <strong className="ml-1 text-gray-200">{getPropGradeLabel(row.playGrade)}</strong></span><span className="text-gray-500">Evidence strength <strong className="ml-1 capitalize text-gray-200">{row.confidenceBucket}</strong></span><span className="text-gray-500">Updated <strong className="ml-1 text-gray-200">{formatTime(row.lastUpdated)}</strong></span>{row.lockStatus ? <span className="text-gray-500">Locked <strong className="ml-1 text-gray-200">{formatTime(row.lockStatus.lockedAt)}</strong></span> : null}</div></DrawerSection></div>
        <div className="min-w-0 lg:col-span-2"><DrawerSection title="Recent Form"><RecentFormPanel row={row} /></DrawerSection></div>
        <div className="min-w-0 lg:col-span-2"><DrawerSection title="Matchup Context">{row.marketFamily === "pitcher" ? <div className="grid min-w-0 overflow-hidden rounded-lg border border-gray-800 lg:grid-cols-2 lg:divide-x lg:divide-gray-800"><OpponentProfilePanel row={row} /><PitchArsenalPanel row={row} /></div> : <div className="space-y-3"><BatterPitcherHistoryPanel row={row} /><PitchMixMatchupPanel row={row} /></div>}</DrawerSection></div>
        <DrawerSection title="Model Comparison"><ModelVsMarketVisual row={row} /><div className="mt-3 grid grid-cols-3 gap-2"><Metric label="Model edge" value={row.modelEdge === null ? "-" : pct(row.modelEdge, true)} /><Metric label="Expected value" value={row.expectedValue === null ? "-" : pct(row.expectedValue, true)} /><Metric label="Fair price" value={row.fairOdds === null ? "-" : signed(row.fairOdds)} /></div></DrawerSection>
        <DrawerSection title="Projection vs Line"><ProjectionIntegrityNotice row={row} /><ProjectionVsLineVisual projection={row.projection} line={row.line} side={row.side} label={row.projectionSource === "recent_form" ? "Recent average" : "Projection"} /><div className="mt-3 grid grid-cols-2 gap-2"><Metric label="Over probability" value={row.overProbability === null ? "-" : pct(row.overProbability)} /><Metric label="Under probability" value={row.underProbability === null ? "-" : pct(row.underProbability)} /></div></DrawerSection>
        <DrawerSection title="Best Available Price"><BookPriceLadder prices={prices} allBooks={unique(comparisons.map((price) => price.book))} /></DrawerSection>
        <DrawerSection title="Odds Movement"><OddsMovementPanel row={row} /></DrawerSection>
        <DrawerSection title="Signal Context"><p className="text-sm leading-6 text-gray-200">{cardReason(row)}</p><p className="mt-3 text-xs leading-5 text-gray-500">{memberGradeDescription(row.playGrade)}</p></DrawerSection>
        <DrawerSection title="Evidence Strength"><ConfidenceMeter row={row} /><FeatureConfidenceChecklist row={row} /></DrawerSection>
        <DrawerSection title="What Could Change"><DetailList title="Still watching" items={row.missingFeatures.map(memberFeatureLabel)} empty="No major pregame questions are currently flagged." /></DrawerSection>
        <div className="min-w-0 lg:col-span-2"><DrawerSection title="Game Environment"><EnvironmentPanel row={row} /></DrawerSection></div>
        {showDiagnostics ? <div className="min-w-0 lg:col-span-2"><details className="group border-t border-violet-400/20 pt-4"><summary className="cursor-pointer text-xs font-black uppercase text-violet-300">Admin diagnostics</summary><div className="mt-4 grid gap-4 lg:grid-cols-2"><DrawerSection title="Reason Codes"><DetailList title="Raw flags" items={row.reasonCodes} mono /></DrawerSection><DrawerSection title="Feature Inputs"><DetailList title="Verified model inputs" items={row.keyFeatures} /></DrawerSection><DrawerSection title="Missing Features"><DetailList title="Unavailable inputs" items={row.missingFeatures} /><div className="mt-3 text-xs text-gray-500">Odds sanity: {row.oddsSanity.length ? row.oddsSanity.join(", ") : "Passed"}</div></DrawerSection><DrawerSection title="Model Diagnostics"><div className="grid grid-cols-2 gap-2"><Metric label="Independent probability" value={row.independentProbability === null ? "-" : pct(row.independentProbability)} /><Metric label="Market probability" value={row.marketProbability === null ? "-" : pct(row.marketProbability)} /><Metric label="Shrinkage weight" value={pct(row.shrinkageWeight)} /><Metric label="Settlement / CLV" value={`${sentenceCase(row.settlementStatus)} / ${sentenceCase(row.clvStatus)}`} /></div><p className="mt-3 text-xs text-gray-500">Source {row.source} · Updated {formatDateTime(row.lastUpdated)}</p></DrawerSection></div></details></div> : null}
      </div>
    </aside>
  </div>;
}

type RecentFormRange = "5" | "10" | "season";

function RecentFormPanel({ row }: { row: PlayerPropPreviewRow }) {
  const [range, setRange] = useState<RecentFormRange>("5");
  const evidence = row.recentForm;
  if (!evidence?.logs.length) {
    return <div data-visual="recent-form" data-state="unavailable" className="rounded-lg border border-dashed border-gray-700 bg-black/20 p-4"><p className="text-sm font-bold text-gray-300">Recent results are not verified for this player yet.</p><p className="mt-1 text-xs leading-5 text-gray-500">This section will populate from the official game log when the player identity is matched.</p></div>;
  }

  const orderedLogs = [...evidence.logs].sort((a, b) => b.date.localeCompare(a.date));
  const options: Array<{ value: RecentFormRange; label: string }> = [
    { value: "5", label: "L5" },
    { value: "10", label: "L10" },
    ...(evidence.coverage === "full_season" ? [{ value: "season" as const, label: "Season" }] : []),
  ];
  const activeRange = options.some((option) => option.value === range) ? range : "5";
  const sampleValues = recentFormSampleValues(evidence, activeRange, orderedLogs);
  const chartLimit = activeRange === "10" ? 10 : activeRange === "season" ? Math.min(10, orderedLogs.length) : 5;
  const logs = orderedLogs.slice(0, Math.min(chartLimit, orderedLogs.length));
  const outcomes = sampleValues.map((value) => propResult(value, row.line, row.side));
  const chartOutcomes = logs.map((log) => propResult(log.value, row.line, row.side));
  const hits = outcomes.filter((outcome) => outcome === "hit").length;
  const pushes = outcomes.filter((outcome) => outcome === "push").length;
  const hitRate = sampleValues.length ? hits / sampleValues.length : 0;
  const average = sampleValues.reduce((sum, value) => sum + value, 0) / Math.max(1, sampleValues.length);
  const opponentLogs = orderedLogs.filter((log) => log.opponent === row.opponent);
  const opponentHits = opponentLogs.filter((log) => propResult(log.value, row.line, row.side) === "hit").length;
  const maxValue = Math.max(row.line * 1.2, ...logs.map((log) => log.value), 1);
  const linePosition = Math.max(0, Math.min(100, (row.line / maxValue) * 100));
  const minChartWidth = Math.max(420, logs.length * 58);
  const sampleNote = sampleValues.length > logs.length
    ? activeRange === "season" ? "Bars show latest 10; season summary uses full sample." : `Bars show latest ${logs.length}; summary uses selected sample.`
    : null;

  return <div data-visual="recent-form" data-state="available" className="overflow-hidden rounded-lg border border-gray-800 bg-black/20">
    <div className="flex flex-col gap-4 border-b border-gray-800 p-4 sm:flex-row sm:items-start sm:justify-between">
      <div><p className="text-[10px] font-black uppercase text-gray-500">{sentenceCase(row.side)} {row.line} hit rate</p><div className="mt-1 flex items-baseline gap-2"><strong className="text-3xl font-black tabular-nums text-white">{hits}/{sampleValues.length}</strong><span className="text-sm font-bold text-emerald-300">{pct(hitRate)}</span></div><p className="mt-1 text-xs text-gray-500">{evidence.statLabel} across the selected {evidence.sampleLabel}</p></div>
      <div role="group" aria-label="Recent form sample" className="inline-flex w-fit rounded-md border border-gray-700 bg-gray-950 p-1">{options.map((option) => <button key={option.value} type="button" onClick={() => setRange(option.value)} aria-pressed={activeRange === option.value} className={`h-8 rounded px-3 text-xs font-black ${activeRange === option.value ? "bg-gray-200 text-gray-950" : "text-gray-500 hover:text-white"}`}>{option.label}</button>)}</div>
    </div>
    <div className="grid grid-cols-2 gap-px border-b border-gray-800 bg-gray-800 sm:grid-cols-4"><RecentFormMetric label="Average" value={average.toFixed(1)} /><RecentFormMetric label="Current line" value={String(row.line)} /><RecentFormMetric label={`Vs ${row.opponent}`} value={opponentLogs.length ? `${opponentHits}/${opponentLogs.length}` : "No sample"} /><RecentFormMetric label="Pushes" value={String(pushes)} /></div>
    <div className="overflow-x-auto px-3 pb-3 pt-5">
      <div style={{ minWidth: minChartWidth }}>
        <div className="relative h-32 border-b border-gray-800">
          <span className="absolute inset-x-0 z-[1] border-t border-dashed border-sky-400/70" style={{ bottom: `${linePosition}%` }} />
          <div className="absolute inset-0 flex items-end justify-around gap-2 px-2">{logs.map((log, index) => {
            const outcome = chartOutcomes[index];
            const height = Math.max(4, (log.value / maxValue) * 100);
            return <div key={log.gameId} className="flex h-full w-12 shrink-0 items-end justify-center"><span title={`${formatGameLogDate(log.date)} ${log.homeAway === "home" ? "vs" : "at"} ${log.opponent}: ${log.value} ${evidence.statLabel.toLowerCase()}${log.secondaryLabel ? `, ${log.secondaryLabel}` : ""}`} className={`relative z-[2] block w-7 rounded-t-sm ${outcome === "hit" ? "bg-emerald-400" : outcome === "push" ? "bg-sky-400" : "bg-gray-600"}`} style={{ height: `${height}%` }}><strong className="absolute -top-5 left-1/2 -translate-x-1/2 text-[10px] tabular-nums text-gray-200">{log.value}</strong></span></div>;
          })}</div>
        </div>
        <div className="flex justify-around gap-2 px-2 pt-2">{logs.map((log) => <div key={log.gameId} className="w-12 shrink-0 text-center"><p className="text-[9px] font-bold text-gray-400">{formatGameLogDate(log.date)}</p><p className="mt-0.5 truncate text-[9px] text-gray-600">{log.homeAway === "home" ? "vs" : "@"} {log.opponent}</p></div>)}</div>
      </div>
    </div>
    <div className="flex flex-wrap items-center justify-between gap-2 border-t border-gray-800 px-4 py-2 text-[10px] text-gray-600"><span><span className="mr-2 inline-block h-2 w-2 bg-emerald-400" />Selected side hit <span className="ml-3 mr-2 inline-block h-2 w-2 bg-gray-600" />Did not hit</span><span>{sampleNote ? `${sampleNote} ` : ""}{evidence.source} · through {formatGameLogDate(orderedLogs[0].date)}</span></div>
  </div>;
}

function recentFormSampleValues(evidence: PlayerPropRecentForm, range: RecentFormRange, orderedLogs: PlayerPropRecentForm["logs"]): number[] {
  const fallbackLimit = range === "season" ? orderedLogs.length : Number(range);
  const fallback = orderedLogs.slice(0, fallbackLimit).map((log) => log.value);
  const sample = range === "season" ? evidence.samples?.season
    : range === "10" ? evidence.samples?.last10
      : evidence.samples?.last5;
  return sample?.values?.length ? sample.values : fallback;
}

function RecentFormMetric({ label, value }: { label: string; value: string }) {
  return <div className="bg-gray-950 p-3"><p className="text-[9px] font-bold uppercase text-gray-600">{label}</p><p className="mt-1 text-sm font-black tabular-nums text-gray-200">{value}</p></div>;
}

function OpponentProfilePanel({ row }: { row: PlayerPropPreviewRow }) {
  const profile = row.opponentProfile;
  if (!profile) return <ResearchModulePending title={`${row.opponent} offense`} note="Season opponent tendencies will appear when the team profile is verified." />;
  const metrics = [
    { label: "K rate", metric: profile.strikeoutRate, value: researchPct(profile.strikeoutRate.value) },
    { label: "BB rate", metric: profile.walkRate, value: researchPct(profile.walkRate.value) },
    { label: "Average", metric: profile.battingAverage, value: decimalStat(profile.battingAverage.value) },
    { label: "OPS", metric: profile.ops, value: decimalStat(profile.ops.value) },
  ];
  return <div data-research-module="opponent-profile" data-state="available" className="min-w-0 bg-black/20 p-4 sm:p-5">
    <div className="flex items-start justify-between gap-3"><div className="flex items-center gap-3"><ProductTeamBadge abbreviation={profile.teamAbbreviation} size={38} /><div><p className="text-sm font-black text-white">{profile.teamAbbreviation} offense</p><p className="mt-0.5 text-[10px] text-gray-500">{profile.plateAppearances.toLocaleString()} PA · {profile.gamesPlayed ?? "-"} games</p></div></div><span className="rounded border border-sky-500/25 bg-sky-500/5 px-2 py-1 text-[9px] font-bold text-sky-200">Season</span></div>
    <p className="mt-4 text-sm font-semibold leading-6 text-gray-200">{profile.summary}</p>
    <div className="mt-4 grid grid-cols-2 gap-px overflow-hidden rounded-md bg-gray-800">{metrics.map((item) => <OpponentMetric key={item.label} label={item.label} value={item.value} metric={item.metric} />)}</div>
    <ResearchSource source={profile.source} asOfTimestamp={profile.asOfTimestamp} note="Ranks are calculated across MLB; No. 1 is the highest rate." />
  </div>;
}

function OpponentMetric({ label, value, metric }: { label: string; value: string; metric: RankedResearchMetric }) {
  return <div className="bg-gray-950 p-3"><div className="flex items-start justify-between gap-2"><div><p className="text-[9px] font-bold uppercase text-gray-600">{label}</p><p className="mt-1 text-lg font-black tabular-nums text-gray-100">{value}</p></div><span className="text-[10px] font-bold tabular-nums text-gray-400">{metric.rank ? `#${metric.rank}` : "-"}</span></div><p className="mt-1 text-[9px] text-gray-600">MLB avg {metric.leagueAverage === null ? "-" : label === "Average" || label === "OPS" ? decimalStat(metric.leagueAverage) : researchPct(metric.leagueAverage)}</p></div>;
}

function PitchArsenalPanel({ row }: { row: PlayerPropPreviewRow }) {
  const arsenal = row.pitchArsenal;
  if (!arsenal?.pitches.length) return <ResearchModulePending title={`${row.player} arsenal`} note="Pitch usage and swing-and-miss results will appear when the player match is verified." />;
  const primary = arsenal.pitches[0];
  const bestWhiff = [...arsenal.pitches].filter((pitch) => pitch.whiffPercent !== null).sort((a, b) => (b.whiffPercent ?? 0) - (a.whiffPercent ?? 0))[0] ?? null;
  return <div data-research-module="pitch-arsenal" data-state="available" className="min-w-0 border-t border-gray-800 bg-black/20 p-4 sm:p-5 lg:border-t-0">
    <div className="flex items-start justify-between gap-3"><div><p className="text-sm font-black text-white">Pitch arsenal</p><p className="mt-0.5 text-[10px] text-gray-500">{arsenal.throws ? `${arsenal.throws === "R" ? "Right" : "Left"}-handed` : "Handedness unavailable"} · {arsenal.pitchesTracked.toLocaleString()} pitches</p></div><span className="rounded border border-violet-500/25 bg-violet-500/5 px-2 py-1 text-[9px] font-bold text-violet-200">{arsenal.pitches.length} pitches</span></div>
    <div className="mt-4 space-y-3">{arsenal.pitches.map((pitch) => <div key={pitch.code} className="grid grid-cols-[minmax(0,1fr)_48px_48px] items-center gap-3"><div className="min-w-0"><div className="flex items-center justify-between gap-2"><span className="truncate text-xs font-bold text-gray-200">{pitch.name}</span><span className="text-[9px] text-gray-600">{pitch.code}</span></div><div className="mt-1.5 h-1.5 overflow-hidden rounded-full bg-gray-800"><span className="block h-full rounded-full bg-violet-400" style={{ width: `${Math.min(100, pitch.usagePercent)}%` }} /></div></div><div className="text-right"><p className="text-[9px] text-gray-600">Usage</p><p className="text-xs font-black tabular-nums text-gray-200">{pitch.usagePercent.toFixed(1)}%</p></div><div className="text-right"><p className="text-[9px] text-gray-600">Whiff</p><p className="text-xs font-black tabular-nums text-gray-200">{pitch.whiffPercent === null ? "-" : `${pitch.whiffPercent.toFixed(1)}%`}</p></div></div>)}</div>
    <p className="mt-4 border-t border-gray-800 pt-3 text-xs leading-5 text-gray-400">Primary pitch: <strong className="text-gray-200">{primary.name} ({primary.usagePercent.toFixed(1)}%)</strong>{bestWhiff ? <> · Best whiff rate: <strong className="text-gray-200">{bestWhiff.name} ({bestWhiff.whiffPercent?.toFixed(1)}%)</strong></> : null}</p>
    <ResearchSource source={arsenal.source} asOfTimestamp={arsenal.asOfTimestamp} note={`Through ${formatGameLogDate(arsenal.lastGameDate)} · research context only`} />
  </div>;
}

function BatterPitcherHistoryPanel({ row }: { row: PlayerPropPreviewRow }) {
  const history = row.matchupHistory;
  if (!history) {
    return <div data-research-module="batter-pitcher-history" className="overflow-hidden rounded-lg border border-gray-800"><ResearchModulePending title="Direct matchup history" note="Official batter-versus-pitcher totals are loading for this probable matchup." /></div>;
  }
  if (history.status === "no_history") {
    return <div data-research-module="batter-pitcher-history" data-state="no-history" className="rounded-lg border border-gray-800 bg-black/20 p-4 sm:p-5"><div className="flex flex-wrap items-start justify-between gap-3"><div><p className="text-sm font-black text-white">{history.hitterName} vs {history.pitcherName}</p><p className="mt-1 text-xs text-gray-500">No prior MLB plate appearances</p></div><span className="rounded border border-gray-700 px-2 py-1 text-[9px] font-bold text-gray-400">Career matchup</span></div><p className="mt-3 text-xs leading-5 text-gray-500">There is no direct history to evaluate yet. The pitch-mix profile below provides the broader matchup context.</p><ResearchSource source={history.source} asOfTimestamp={history.asOfTimestamp} note="Research context only" /></div>;
  }
  const metrics = [
    { label: "Hits", value: `${history.hits}/${history.atBats}` },
    { label: "AVG", value: decimalStat(history.battingAverage) },
    { label: "OPS", value: decimalStat(history.ops) },
    { label: "K / BB", value: `${history.strikeouts} / ${history.walks}` },
    { label: "HR", value: String(history.homeRuns) },
    { label: "Total bases", value: String(history.totalBases) },
  ];
  return <div data-research-module="batter-pitcher-history" data-state="available" className="overflow-hidden rounded-lg border border-gray-800 bg-black/20">
    <div className="flex flex-wrap items-start justify-between gap-3 p-4 sm:p-5"><div><p className="text-sm font-black text-white">{history.hitterName} vs {history.pitcherName}</p><p className="mt-1 text-xs text-gray-500">Career MLB matchup · {history.plateAppearances} PA across {history.gamesPlayed} {history.gamesPlayed === 1 ? "game" : "games"}</p></div><span className="rounded border border-sky-500/25 bg-sky-500/5 px-2 py-1 text-[9px] font-bold text-sky-200">Direct history</span></div>
    <div className="grid grid-cols-2 gap-px border-y border-gray-800 bg-gray-800 sm:grid-cols-3">{metrics.map((metric) => <div key={metric.label} className="bg-gray-950 p-3"><p className="text-[9px] font-bold uppercase text-gray-600">{metric.label}</p><p className="mt-1 text-lg font-black tabular-nums text-gray-100">{metric.value}</p></div>)}</div>
    <div className="px-4 pb-4 sm:px-5"><ResearchSource source={history.source} asOfTimestamp={history.asOfTimestamp} note={`${history.pitchesSeen} pitches · small-sample research only`} /></div>
  </div>;
}

function PitchMixMatchupPanel({ row }: { row: PlayerPropPreviewRow }) {
  const matchup = row.pitchMatchup;
  if (!matchup?.pitches.length) {
    return <div data-research-module="pitch-mix-matchup" className="overflow-hidden rounded-lg border border-gray-800"><ResearchModulePending title="Pitch-mix matchup" note="The opposing starter's arsenal will be matched to this hitter's pitch-type results when both player identities are confirmed." /></div>;
  }
  const metrics = [
    { label: "xwOBA", value: decimalStat(matchup.weighted.xwoba) },
    { label: "Average", value: decimalStat(matchup.weighted.battingAverage) },
    { label: "Slugging", value: decimalStat(matchup.weighted.slugging) },
    { label: "Whiff", value: matchup.weighted.whiffPercent === null ? "-" : `${matchup.weighted.whiffPercent.toFixed(1)}%` },
  ];
  return <div data-research-module="pitch-mix-matchup" data-state={matchup.coverageStatus} className="overflow-hidden rounded-lg border border-gray-800 bg-black/20">
    <div className="grid gap-5 p-4 sm:p-5 lg:grid-cols-[minmax(0,1fr)_300px]">
      <div className="min-w-0"><div className="flex flex-wrap items-start justify-between gap-3"><div><p className="text-sm font-black text-white">{matchup.hitterName} vs {matchup.pitcherName}&apos;s pitch mix</p><p className="mt-1 text-[10px] text-gray-500">{handednessLabel(matchup.hitterBats, "bats")} vs {handednessLabel(matchup.pitcherThrows, "throws")} · season pitch-type results</p></div><span className={`rounded border px-2 py-1 text-[9px] font-bold ${matchup.coverageStatus === "available" ? "border-emerald-500/25 bg-emerald-500/5 text-emerald-200" : "border-amber-500/25 bg-amber-500/5 text-amber-200"}`}>{matchup.pitchMixCoveragePercent.toFixed(0)}% mix covered</span></div>
        <p className="mt-4 text-sm font-semibold leading-6 text-gray-200">{matchup.summary}</p>
        <div className="mt-4 space-y-3">{matchup.pitches.map((pitch) => <div key={pitch.code} className="grid grid-cols-[minmax(0,1fr)_54px_54px_54px] items-center gap-2"><div className="min-w-0"><div className="flex items-center justify-between gap-2"><span className="truncate text-xs font-bold text-gray-200">{pitch.name}</span><span className="text-[9px] text-gray-600">{pitch.code}</span></div><div className="mt-1.5 h-1.5 overflow-hidden rounded-full bg-gray-800"><span className="block h-full rounded-full bg-sky-400" style={{ width: `${Math.min(100, pitch.pitcherUsagePercent)}%` }} /></div></div><PitchMixCell label="Usage" value={`${pitch.pitcherUsagePercent.toFixed(1)}%`} /><PitchMixCell label="xwOBA" value={decimalStat(pitch.xwoba)} /><PitchMixCell label="Seen" value={String(pitch.hitterPitchCount)} /></div>)}</div>
      </div>
      <div className="min-w-0 border-t border-gray-800 pt-4 lg:border-l lg:border-t-0 lg:pl-5 lg:pt-0"><p className="text-[9px] font-bold uppercase text-gray-600">Usage-weighted hitter profile</p><div className="mt-3 grid grid-cols-2 gap-px overflow-hidden rounded-md bg-gray-800">{metrics.map((metric) => <div key={metric.label} className="bg-gray-950 p-3"><p className="text-[9px] font-bold uppercase text-gray-600">{metric.label}</p><p className="mt-1 text-lg font-black tabular-nums text-gray-100">{metric.value}</p></div>)}</div><p className="mt-4 text-xs leading-5 text-gray-500">Based on {matchup.hitterPitchesSeen.toLocaleString()} pitches seen across {matchup.matchedPitchTypes} matched pitch types. This is pitch-mix research, not direct career batter-versus-pitcher history.</p></div>
    </div>
    <div className="border-t border-gray-800 px-4 pb-4 sm:px-5"><ResearchSource source={matchup.source} asOfTimestamp={matchup.asOfTimestamp} note={`Through ${formatGameLogDate(matchup.lastGameDate)} · research context only`} /></div>
  </div>;
}

function PitchMixCell({ label, value }: { label: string; value: string }) {
  return <div className="text-right"><p className="text-[9px] text-gray-600">{label}</p><p className="text-xs font-black tabular-nums text-gray-200">{value}</p></div>;
}

function EnvironmentPanel({ row }: { row: PlayerPropPreviewRow }) {
  const evidence = row.environment;
  const venue = evidence?.venue ?? "Venue TBD";
  return <div data-research-module="game-environment" data-state={evidence ? "available" : "pending"} className="grid overflow-hidden rounded-lg border border-gray-800 bg-gray-800 md:grid-cols-3">
    <EnvironmentItem label="Venue" value={venue} detail={evidence ? roofStatusLabel(evidence.roofStatus) : "Schedule details will appear here."} status={evidence?.venue ? "available" : "pending"} />
    <EnvironmentItem label="Park profile" value={evidence?.park.status === "available" ? parkProfileLabel(evidence.park.runFactor) : "Park check"} detail={evidence?.park.status === "available" ? `HR factor ${factorLabel(evidence.park.homeRunFactor)} · K factor ${factorLabel(evidence.park.strikeoutFactor)}` : "Verified run and home-run factors will appear here."} status={evidence?.park.status ?? "pending"} />
    <EnvironmentItem label="Game-time forecast" value={weatherHeadline(evidence)} detail={weatherDetail(evidence)} status={evidence?.weather.status ?? "pending"} />
  </div>;
}

function EnvironmentItem({ label, value, detail, status }: { label: string; value: string; detail: string; status: "available" | "pending" | "unavailable" }) {
  return <div className="bg-gray-950 p-4"><div className="flex items-center justify-between gap-2"><p className="text-[9px] font-bold uppercase text-gray-600">{label}</p><span className={`h-1.5 w-1.5 rounded-full ${status === "available" ? "bg-emerald-400" : "bg-gray-600"}`} /></div><p className="mt-2 text-sm font-black text-gray-200">{value}</p><p className="mt-1 text-xs leading-5 text-gray-500">{detail}</p></div>;
}

function ResearchModulePending({ title, note }: { title: string; note: string }) {
  return <div data-state="pending" className="flex min-h-56 flex-col justify-center bg-black/20 p-5"><p className="text-sm font-black text-gray-300">{title}</p><p className="mt-2 max-w-sm text-xs leading-5 text-gray-500">{note}</p><span className="mt-4 w-fit rounded border border-gray-700 px-2 py-1 text-[9px] font-bold text-gray-500">Research check</span></div>;
}

function ResearchSource({ source, asOfTimestamp, note }: { source: string; asOfTimestamp: string; note: string }) {
  return <div className="mt-4 flex flex-wrap items-center justify-between gap-2 border-t border-gray-800 pt-3 text-[9px] text-gray-600"><span>{source} · updated {formatTime(asOfTimestamp)}</span><span>{note}</span></div>;
}

function propResult(value: number, line: number, side: "over" | "under"): "hit" | "miss" | "push" {
  if (value === line) return "push";
  return side === "over" ? (value > line ? "hit" : "miss") : value < line ? "hit" : "miss";
}

export function ModelVsMarketVisual({ row }: { row: PlayerPropPreviewRow }) {
  const model = row.finalProbability;
  const market = row.marketProbability;
  return <div data-visual="model-vs-market" className="rounded-lg border border-gray-800 bg-black/20 p-3"><div className="space-y-3"><ProbabilityBar label="OddSphere estimate" value={model} tone="model" /><ProbabilityBar label="Market implied" value={market} tone="market" /></div><div className="mt-3 flex items-center justify-between border-t border-gray-800 pt-3 text-xs"><span className="text-gray-500">Model difference</span><strong className={(row.modelEdge ?? 0) > 0 ? "text-emerald-300" : "text-gray-300"}>{row.modelEdge === null ? "-" : pct(row.modelEdge, true)}</strong></div></div>;
}

function ProbabilityBar({ label, value, tone }: { label: string; value: number | null; tone: "model" | "market" }) {
  return <div><div className="flex items-center justify-between text-xs"><span className="text-gray-400">{label}</span><strong className="tabular-nums text-white">{value === null ? "Unavailable" : pct(value)}</strong></div><div className="mt-1.5 h-2 overflow-hidden rounded-full bg-gray-800">{value !== null ? <span className={`block h-full rounded-full ${tone === "model" ? "bg-violet-400" : "bg-sky-400"}`} style={{ width: `${Math.round(clamp01(value) * 100)}%` }} /> : null}</div></div>;
}

export function ProjectionVsLineVisual({ projection, line, side, label = "Projection" }: { projection: number; line: number; side: "over" | "under"; label?: string }) {
  const low = Math.max(0, Math.min(projection, line) * 0.75);
  const high = Math.max(projection, line) * 1.25 || 1;
  const position = (value: number) => `${Math.max(3, Math.min(97, ((value - low) / (high - low)) * 100))}%`;
  const projectionDirection = projection === line ? "On the line" : `Projection favors ${projection > line ? "Over" : "Under"}`;
  return <div data-visual="projection-vs-line" data-projection={projection} data-line={line} data-side={side} className="rounded-lg border border-gray-800 bg-black/20 p-3"><div className="flex items-center justify-between gap-3 text-xs"><span className="text-gray-500">{label} <strong className="ml-1 text-white">{projection}</strong></span><span className="font-bold text-sky-300">{projectionDirection}</span><span className="text-gray-500">Line <strong className="ml-1 text-white">{line}</strong></span></div><div className="relative mt-5 h-2 rounded-full bg-gray-800"><span className="absolute inset-y-0 rounded-full bg-sky-400/25" style={{ left: position(Math.min(line, projection)), right: `${100 - Number.parseFloat(position(Math.max(line, projection)))}%` }} /><span className="absolute -top-1.5 h-5 w-0.5 bg-white" style={{ left: position(line) }} /><span className="absolute -top-1 h-4 w-4 -translate-x-1/2 rounded-full border-2 border-gray-950 bg-sky-400" style={{ left: position(projection) }} /></div><div className="mt-4 flex justify-between text-[9px] text-gray-600"><span>{low.toFixed(1)}</span><span>{high.toFixed(1)}</span></div></div>;
}

function ProjectionIntegrityNotice({ row }: { row: PlayerPropPreviewRow }) {
  if (isProjectionSideCoherent(row)) return null;
  const projectionSide = row.projection > row.line ? "Over" : "Under";
  const predictionSide = rowPredictionSide(row);
  return <div className="mb-3 rounded-md border border-gray-700 bg-white/[0.03] p-3"><p className="text-xs font-bold text-gray-200">Projection favors {projectionSide}</p><p className="mt-1 text-xs leading-5 text-gray-500">{predictionSide ? `Final prediction: ${predictionSide === "over" ? "Over" : "Under"}. ` : ""}Price and matchup context can move the final read away from the raw projection.</p></div>;
}

export function BookPriceLadder({ prices, allBooks = [] }: { prices: PlayerPropPreviewRow[]; allBooks?: string[] }) {
  const availableBooks = new Set(prices.map((price) => price.book));
  const unavailableBooks = allBooks.filter((book) => !availableBooks.has(book));
  return <div data-visual="book-price-ladder" className="overflow-hidden rounded-lg border border-gray-800">{prices.length ? prices.map((price, index) => { const stale = price.reasonCodes.some((code) => code.includes("STALE")) || price.oddsSanity.some((flag) => flag.includes("STALE")); const assessment = assessPropPrice(price.odds); return <div key={price.id} className={`flex items-center justify-between border-b border-gray-800 px-3 py-2.5 last:border-b-0 ${index === 0 ? "bg-emerald-500/5" : ""}`}><div className="flex items-center gap-2"><BookChip book={price.book} />{index === 0 ? <span className="text-[10px] font-bold uppercase text-emerald-300">Best price</span> : null}{stale ? <span className="text-[10px] font-bold uppercase text-amber-300">Refreshing</span> : null}{assessment.label ? <span className="text-[9px] font-bold text-sky-300">{assessment.label}</span> : null}</div><span className="text-right"><strong className="block font-black tabular-nums text-white">{signed(price.odds)}</strong><span className="block text-[9px] tabular-nums text-gray-600">{assessment.impliedProbability === null ? "Reviewing" : `${pct(assessment.impliedProbability)} implied`}</span></span></div>; }) : <p className="p-3 text-xs text-gray-500">Book prices are not available yet.</p>}{unavailableBooks.length ? <div className="flex flex-wrap items-center gap-2 border-t border-gray-800 px-3 py-2" data-book-availability="unavailable"><span className="text-[9px] font-bold uppercase text-gray-600">More books</span>{unavailableBooks.map((book) => <span key={book} className="opacity-35"><BookChip book={book} /></span>)}</div> : null}<p className="border-t border-gray-800 px-3 py-2 text-[10px] text-gray-600">{prices.length > 1 ? `${prices.length} prices compared` : "Best available price shown"}</p></div>;
}

function PriceContextLine({ odds }: { odds: number }) {
  const assessment = assessPropPrice(odds);
  if (assessment.impliedProbability === null) return <p className="mt-4 border-t border-gray-800 pt-3 text-xs text-amber-200">This price is being reviewed and cannot produce a model signal.</p>;
  const payout = odds < 0
    ? `$${money(assessment.riskToWin100)} risk wins $100 profit`
    : `$100 risk wins $${money(assessment.profitOn100)} profit`;
  return <div className="mt-4 flex flex-wrap items-center gap-x-4 gap-y-1 border-t border-gray-800 pt-3 text-xs"><span className="text-gray-500">Implied probability <strong className="ml-1 text-gray-200">{pct(assessment.impliedProbability)}</strong></span><span className="text-gray-500">{payout}</span>{!assessment.signalEligible ? <span className="font-bold text-sky-300">Comparison only at this price</span> : null}</div>;
}

function PriceBandTag({ odds }: { odds: number }) {
  const label = assessPropPrice(odds).label;
  return label ? <span className="ml-1.5 text-[9px] font-bold text-sky-300">{label}</span> : null;
}

export function PlayerStatSnapshot({ row }: { row: PlayerPropPreviewRow }) {
  const stat = playerStatDescriptor(row);
  return <div data-visual="player-stat-snapshot" data-stat-available={stat.feature ? "true" : "false"} className="rounded-lg border border-gray-800 bg-black/20 p-3"><div><p className="text-xs text-gray-500">{stat.label}</p><p className={`mt-1 text-sm font-black ${stat.feature ? "text-emerald-300" : "text-gray-400"}`}>{stat.feature ? "Included in this projection" : "More data coming"}</p></div><p className="mt-2 text-xs leading-5 text-gray-500">{stat.feature ? memberFeatureLabel(stat.feature) : "This supporting trend is not available for today’s projection."}</p></div>;
}

function MarketContextSummary({ row }: { row: PlayerPropPreviewRow }) {
  const used = `${row.keyFeatures.join(" ")} ${(row.marketContext ?? []).join(" ")}`.toLowerCase();
  const items = [
    { label: "Probable", value: used.includes("starter") ? "Verified" : "Projected" },
    { label: "Odds", value: row.oddsSanity.length ? "Review" : "Fresh" },
    { label: "Season stat", value: playerStatDescriptor(row).feature ? "Available" : "Unavailable" },
    { label: "Lineup", value: lineupDisplayStatus(row.lineupStatus?.status) },
  ];
  return <div data-research-module="market-context" className="mt-4 border-t border-gray-800 pt-4"><div className="flex flex-wrap gap-x-5 gap-y-2">{items.map((item) => <span key={item.label} className="text-xs"><span className="text-gray-600">{item.label}</span> <strong className="ml-1 text-gray-300">{item.value}</strong></span>)}</div><p className="mt-2 text-xs leading-5 text-gray-600">Additional matchup and market-movement trends will appear here when available.</p></div>;
}

function playerStatDescriptor(row: PlayerPropPreviewRow): { label: string; feature: string | null; missing: string } {
  const labels: Record<string, string> = {
    pitcher_strikeouts: "Strikeout trend",
    pitcher_outs: "Workload trend",
    pitcher_hits_allowed: "Hits allowed trend",
    pitcher_walks: "Walk trend",
    batter_hits: "Hitting trend",
    batter_total_bases: "Total-base trend",
    batter_home_runs: "Power trend",
    batter_rbis: "Run-production opportunity",
    batter_runs_scored: "Run-scoring opportunity",
  };
  const label = labels[row.market] ?? "Market-relevant season stat";
  const feature = row.keyFeatures.find((item) => /(season|rate|baseline|per start|\/ip|\/pa|\/ab|proxy)/i.test(item)) ?? null;
  return { label, feature, missing: `No verified ${label.toLowerCase()} is exposed by this preview row.` };
}

function ConfidenceMeter({ row }: { row: PlayerPropPreviewRow }) {
  const explanation = row.confidenceBucket === "high" ? "Most required player, price, and matchup inputs are available." : row.confidenceBucket === "medium" ? "Core inputs are available, with some pregame context still developing." : "Several supporting inputs may still change before first pitch.";
  return <div data-visual="confidence-meter" className="rounded-lg border border-gray-800 bg-black/20 p-3"><div className="flex items-center justify-between"><span className="text-xs text-gray-500">Evidence strength</span><strong className="capitalize text-white">{row.confidenceBucket}</strong></div><div className="mt-2 h-2 overflow-hidden rounded-full bg-gray-800"><span className={`block h-full rounded-full ${row.confidenceBucket === "high" ? "bg-emerald-400" : row.confidenceBucket === "medium" ? "bg-sky-400" : "bg-amber-400"}`} style={{ width: `${Math.round(row.confidence * 100)}%` }} /></div><p className="mt-2 text-xs leading-5 text-gray-500">{explanation}</p></div>;
}

export function FeatureConfidenceChecklist({ row }: { row: PlayerPropPreviewRow }) {
  const used = row.keyFeatures.join(" ").toLowerCase();
  const missing = row.missingFeatures.join(" ").toLowerCase();
  const items = [
    featureState("Player", Boolean(row.player && row.team && row.opponent), false),
    featureState("Price", row.marketProbability !== null && row.oddsSanity.length === 0, row.marketProbability === null),
    featureState("Lineup", Boolean(row.lineupStatus && row.lineupStatus.status !== "not_in_lineup"), row.lineupStatus?.status === "not_in_lineup" || /(starter|lineup)/.test(missing)),
    featureState("Form", /(season|stats|rate|baseline|recent|start|game log)/.test(used), /(stats|rate|logs|contact)/.test(missing)),
    featureState("Matchup", (row.marketContext?.length ?? 0) > 0, row.missingFeatures.length > 0),
  ];
  return <div data-visual="feature-confidence-checklist" className="mt-3 grid grid-cols-2 gap-2 sm:grid-cols-5">{items.map((item) => <div key={item.label} className="rounded-md border border-gray-800 bg-gray-900/50 p-2 text-center"><span className={`mx-auto block h-2 w-2 rounded-full ${item.status === "ready" ? "bg-emerald-400" : item.status === "partial" ? "bg-amber-400" : "bg-gray-600"}`} /><span className="mt-1.5 block text-[9px] font-bold uppercase text-gray-400">{item.label}</span><span className="mt-0.5 block text-[9px] text-gray-600">{item.status === "ready" ? "Included" : item.status === "partial" ? "Watching" : "Limited"}</span></div>)}</div>;
}

function featureState(label: string, available: boolean, incomplete: boolean): { label: string; status: "ready" | "partial" | "missing" } {
  return { label, status: available ? "ready" : incomplete ? "partial" : "missing" };
}

function DrawerSection({ title, children }: { title: string; children: React.ReactNode }) {
  return <section className="min-w-0"><h3 className="mb-3 border-b border-gray-800 pb-2 text-xs font-black uppercase text-gray-400">{title}</h3>{children}</section>;
}

function PendingPropsState({ data, mode, matchups }: { data: PlayerPropsDashboardData; mode: DashboardMode; matchups: SlateMatchup[] }) {
  const probablePitcherStatus = matchups.length > 0 && matchups.every((item) => item.starterStatus === "confirmed")
    ? "Confirmed"
    : matchups.some((item) => item.starterStatus !== "pending")
      ? "Partially confirmed"
      : "Projected";
  return <div className="w-full pb-8"><PropLeagueRail />{mode === "live-preview" ? <LivePreviewDataNotice /> : null}<PropsSlateHeader data={data} mode={mode} matchups={matchups} selectedGame="all" onSelectGame={() => undefined} />{mode === "admin" ? <ProviderHealthStrip data={data} matchups={matchups} /> : null}<section className="mt-7 border-y border-gray-800 py-8 sm:py-10"><span className="inline-flex rounded border border-gray-600 px-2.5 py-1 text-[11px] font-bold text-gray-300">Markets opening soon</span><h2 className="mt-4 text-2xl font-black text-white">Player prop lines have not posted yet.</h2><p className="mt-2 max-w-2xl text-sm leading-6 text-gray-400">Today’s board will populate automatically as sportsbooks publish their first prices.</p><div className="mt-6 grid gap-px overflow-hidden rounded-lg border border-gray-800 bg-gray-800 md:grid-cols-3"><div className="bg-gray-950 p-4"><p className="text-[10px] font-bold uppercase text-gray-600">Games scheduled</p><p className="mt-2 text-lg font-black text-white">{matchups.length}</p></div><div className="bg-gray-950 p-4"><p className="text-[10px] font-bold uppercase text-gray-600">Probable pitchers</p><p className="mt-2 text-sm font-semibold text-gray-200">{probablePitcherStatus}</p></div><div className="bg-gray-950 p-4"><p className="text-[10px] font-bold uppercase text-gray-600">Next update</p><p className="mt-2 text-sm font-semibold text-gray-200">{data.slate?.nextCheckLabel ?? "When player markets open"}</p></div></div></section></div>;
}

export function PropGradeBadge({ grade, compact = false }: { grade: PropGrade; compact?: boolean }) {
  const color = getPropGradeColor(grade);
  return <span className={`inline-flex shrink-0 items-center rounded border font-bold ${compact ? "px-2 py-1 text-[9px]" : "px-2.5 py-1 text-[10px]"}`} style={{ color: color.text, borderColor: color.border, background: color.background }}>{getPropGradeLabel(grade)}</span>;
}

export function PropRecommendationCard({ row }: { row: PlayerPropPreviewRow }) {
  return <FeaturedPropCard row={row} onSelect={() => undefined} />;
}

export function PropDataQualityBadge({ label, tone = "neutral" }: { label: string; tone?: "good" | "warn" | "bad" | "neutral" }) {
  const color = tone === "good" ? "border-emerald-500/50 text-emerald-200" : tone === "bad" ? "border-rose-500/50 text-rose-200" : tone === "warn" ? "border-amber-500/50 text-amber-200" : "border-gray-700 text-gray-300";
  return <span className={`rounded border bg-gray-950 px-2.5 py-1 ${color}`}>{label}</span>;
}

export function PropSourceBadge({ label }: { label: string }) {
  return <span className="rounded border border-sky-500/40 bg-sky-500/10 px-2.5 py-1 text-sky-100">{label}</span>;
}

export function PropConfidenceBadge({ row }: { row: PlayerPropPreviewRow }) {
  return <PropGradeBadge grade={row.playGrade} />;
}

function TeamChip({ team }: { team: string }) {
  return <ProductTeamBadge abbreviation={team} size={36} showLabel />;
}

function TeamAbbreviationChip({ team }: { team: string }) {
  return <span className="inline-flex h-6 min-w-8 shrink-0 items-center justify-center rounded border border-gray-700 bg-gray-900 px-1.5 text-[9px] font-black text-gray-300">{team}</span>;
}

function PlayerEditorialVisual({ row, compact = false }: { row: PlayerPropPreviewRow; compact?: boolean }) {
  const [imageFailed, setImageFailed] = useState(false);
  const teamColor = teamPrimaryColor(row.team, "mlb");
  const safeLocalHeadshot = row.headshotUrl?.startsWith("/") ? row.headshotUrl : null;
  const projectionDelta = row.projection - row.line;
  const projectionLabel = row.projectionSource === "recent_form" ? "Recent-game average" : "OddSphere projection";
  return <div data-player-visual data-photo-ready={safeLocalHeadshot ? "true" : "false"} className={`relative flex min-h-[190px] overflow-hidden ${compact ? "xl:min-h-full" : "sm:min-h-full"}`} style={{ backgroundColor: `${teamColor}24` }}><div className="absolute inset-y-0 left-0 w-1.5" style={{ backgroundColor: teamColor }} /><div className="absolute inset-0 opacity-[0.06]" style={{ backgroundImage: "linear-gradient(rgba(255,255,255,.6) 1px, transparent 1px), linear-gradient(90deg, rgba(255,255,255,.6) 1px, transparent 1px)", backgroundSize: "28px 28px" }} /><div className="absolute -right-10 -top-6 opacity-[0.08]"><ProductTeamBadge abbreviation={row.team} size={190} /></div>{safeLocalHeadshot && !imageFailed ? <img src={safeLocalHeadshot} alt={row.player} onError={() => setImageFailed(true)} className="absolute inset-0 h-full w-full object-cover object-top" /> : <div className="relative z-[1] flex w-full flex-col justify-center px-6"><span className="inline-flex w-fit rounded-md bg-black/35 p-2 ring-1 ring-white/10"><ProductTeamBadge abbreviation={row.team} size={compact ? 34 : 42} /></span><p className="mt-6 text-[9px] font-black uppercase text-white/45">{projectionLabel}</p><strong className="mt-1 text-5xl font-black tabular-nums text-white">{row.projection}</strong><div className="mt-3 border-t border-white/15 pt-3"><p className="text-xs font-bold text-white/80">Line {row.line}</p><p className="mt-1 text-[10px] text-emerald-300">{Math.abs(projectionDelta).toFixed(1)} {projectionDelta >= 0 ? "above" : "below"} the line</p></div></div>}<div className="absolute inset-x-0 bottom-0 z-[2] flex items-center justify-between bg-black/55 px-4 py-2 text-[9px] font-black uppercase text-white/60"><span>{MARKET_CODES[row.market] ?? row.marketGroup}</span><span>{row.team} · {row.homeAway === "home" ? "Home" : "Away"}</span></div></div>;
}

export function PlayerAvatar({ player, team, headshotUrl, compact = false, large = false }: { player: string; team: string; headshotUrl?: string | null; compact?: boolean; large?: boolean }) {
  const [imageFailed, setImageFailed] = useState(false);
  const teamColor = teamPrimaryColor(team, "mlb");
  const size = large ? "h-16 w-16 text-lg" : compact ? "h-9 w-9 text-[10px]" : "h-11 w-11 text-xs";
  const logoSize = large ? 24 : compact ? 16 : 18;
  const safeLocalHeadshot = headshotUrl?.startsWith("/") ? headshotUrl : null;
  return <span className="relative inline-flex shrink-0" aria-label={`${player}, ${team}`}><span className={`inline-flex items-center justify-center overflow-hidden rounded-full border-2 bg-gray-950 ring-2 ring-gray-950 ${size}`} style={{ borderColor: teamColor, boxShadow: `inset 0 0 0 1px ${teamColor}33` }}>{safeLocalHeadshot && !imageFailed ? <img src={safeLocalHeadshot} alt="" className="h-full w-full object-cover" onError={() => setImageFailed(true)} /> : <ProductTeamBadge abbreviation={team} size={large ? 36 : compact ? 24 : 28} />}</span>{safeLocalHeadshot && !imageFailed ? <span className="absolute -bottom-1 -right-1 rounded-full bg-gray-950 ring-2 ring-gray-950"><ProductTeamBadge abbreviation={team} size={logoSize} /></span> : null}</span>;
}

function MarketChip({ row }: { row: PlayerPropPreviewRow }) {
  return <span className="inline-flex h-7 min-w-8 shrink-0 items-center justify-center rounded border border-gray-700 bg-gray-900 px-1.5 text-[9px] font-black text-gray-200">{MARKET_CODES[row.market] ?? row.marketGroup.slice(0, 4).toUpperCase()}</span>;
}

function BookChip({ book }: { book: string }) {
  const abbreviations: Record<string, string> = { DraftKings: "DK", FanDuel: "FD", BetMGM: "MGM", Caesars: "CZR", "Hard Rock": "HR" };
  return <span className="inline-flex h-6 items-center rounded border border-gray-700 bg-gray-900 px-2 text-[9px] font-black uppercase text-gray-300">{abbreviations[book] ?? book.slice(0, 4)}</span>;
}

function ToggleControl({ label, checked, onChange }: { label: string; checked: boolean; onChange: (checked: boolean) => void }) {
  return <label className="flex h-9 cursor-pointer items-center gap-2 rounded-md border border-gray-700 px-2.5 text-[11px] font-semibold text-gray-300"><input type="checkbox" checked={checked} onChange={(event) => onChange(event.target.checked)} className="accent-violet-500" />{label}</label>;
}

function FilterSelect({ label, value, onChange, options, includeAll = false }: { label: string; value: string; onChange: (value: string) => void; options: ReadonlyArray<string | { value: string; label: string }>; includeAll?: boolean }) {
  return <label className="min-w-0"><span className="sr-only">{label}</span><select aria-label={label} value={value} onChange={(event) => onChange(event.target.value)} className="h-9 max-w-[180px] rounded-md border border-gray-700 bg-gray-950 px-2 text-xs font-semibold text-gray-200 outline-none focus:border-violet-400">{includeAll ? <option value="all">All {label.toLowerCase()}</option> : null}{options.map((option) => { const item = typeof option === "string" ? { value: option, label: option } : option; return <option key={item.value} value={item.value}>{item.label}</option>; })}</select></label>;
}

function CompactMetric({ label, value, positive = false }: { label: string; value: string; positive?: boolean }) {
  return <div className="min-w-0"><p className="text-[9px] font-bold uppercase text-gray-600">{label}</p><p className={`mt-1 truncate text-xs font-black tabular-nums ${positive && value !== "-" ? "text-emerald-300" : "text-gray-200"}`}>{value}</p></div>;
}

function BoardMetric({ label, value, positive = false }: { label: string; value: string; positive?: boolean }) {
  return <span className={`text-xs font-semibold tabular-nums ${positive ? "text-emerald-300" : "text-gray-300"}`}><span className="mr-1 text-gray-600 xl:hidden">{label}</span>{value}</span>;
}

function OddsMovementTag({ row, align = "left" }: { row: PlayerPropPreviewRow; align?: "left" | "right" }) {
  const movement = row.oddsMovement;
  if (!movement?.hasMoved) return null;
  const color = getPropGradeColor(row.playGrade);
  const label = movement.lineDelta !== 0
    ? `Open ${movement.openingLine}`
    : `Open ${signed(movement.openingOdds)}`;
  return <span className={`mt-1 block text-[9px] font-bold ${align === "right" ? "text-right" : "text-left"}`} style={{ color: color.text }}>{label}</span>;
}

function OddsMovementPanel({ row }: { row: PlayerPropPreviewRow }) {
  const movement = row.oddsMovement;
  if (!movement) return <div className="rounded-lg border border-dashed border-gray-700 bg-black/20 p-4"><p className="text-sm font-bold text-gray-300">Movement starts with the first verified price.</p><p className="mt-1 text-xs leading-5 text-gray-500">Opening and current prices will appear together once the market history is available.</p></div>;
  const color = getPropGradeColor(row.playGrade);
  const probabilityShift = movement.impliedProbabilityDelta * 100;
  const sourceLabel = movement.openingSource === "balldontlie_opening" ? "Sportsbook opening feed" : "First OddSphere snapshot";
  return <div className="overflow-hidden rounded-lg border border-gray-800 bg-black/20">
    <div className="grid grid-cols-2 gap-px bg-gray-800">
      <div className="bg-gray-950 p-4"><p className="text-[9px] font-bold uppercase text-gray-600">Opening</p><p className="mt-1 text-lg font-black text-white">{row.side === "over" ? "Over" : "Under"} {movement.openingLine}</p><p className="mt-0.5 text-sm font-bold text-gray-300">{signed(movement.openingOdds)}</p><p className="mt-2 text-[9px] text-gray-600">{formatDateTime(movement.openingTimestamp)}</p></div>
      <div className="p-4" style={{ background: color.background }}><p className="text-[9px] font-bold uppercase text-gray-500">Current</p><p className="mt-1 text-lg font-black text-white">{row.side === "over" ? "Over" : "Under"} {movement.currentLine}</p><p className="mt-0.5 text-sm font-bold" style={{ color: color.text }}>{signed(movement.currentOdds)}</p><p className="mt-2 text-[9px] text-gray-600">{formatDateTime(movement.currentTimestamp)}</p></div>
    </div>
    <div className="p-4"><p className="text-xs font-semibold" style={{ color: movement.hasMoved ? color.text : undefined }}>{movement.hasMoved ? `${movement.lineDelta === 0 ? "Price changed" : `Line changed by ${signedDecimal(movement.lineDelta)}`} · implied probability ${probabilityShift >= 0 ? "+" : ""}${probabilityShift.toFixed(1)} pts` : "No change from the opening quote"}</p><p className="mt-1 text-[10px] text-gray-600">{sourceLabel} · {row.book}</p></div>
  </div>;
}

function Metric({ label, value }: { label: string; value: string }) {
  return <div className="rounded-md border border-gray-800 bg-black/20 p-2.5"><p className="text-[9px] font-bold uppercase text-gray-500">{label}</p><p className="mt-1 text-sm font-bold tabular-nums text-gray-100">{value}</p></div>;
}

function DetailList({ title, items, mono = false, empty = "None" }: { title: string; items: string[]; mono?: boolean; empty?: string }) {
  return <div><p className="mb-2 text-[9px] font-bold uppercase text-gray-500">{title}</p>{items.length ? <div className="flex flex-wrap gap-1.5">{items.map((item) => <span key={item} className={`rounded border border-gray-800 bg-gray-900 px-2 py-1 text-xs text-gray-300 ${mono ? "font-mono" : ""}`}>{item}</span>)}</div> : <p className="text-xs text-gray-500">{empty}</p>}</div>;
}

function EmptyBoard({ label = "No props match these controls." }: { label?: string }) {
  return <div className="rounded-lg border border-gray-800 bg-gray-950 p-8 text-center"><p className="font-bold text-gray-200">{label}</p><p className="mt-1 text-sm text-gray-500">Adjust the active filters or search query.</p></div>;
}

export function selectPrimaryPropLines(rows: PlayerPropPreviewRow[]): PlayerPropPreviewRow[] {
  const groups = new Map<string, Map<number, PlayerPropPreviewRow[]>>();
  for (const row of rows) {
    const key = `${row.player}|${row.team}|${row.opponent}|${row.gameStartTime}|${row.market}`;
    const lines = groups.get(key) ?? new Map<number, PlayerPropPreviewRow[]>();
    lines.set(row.line, [...(lines.get(row.line) ?? []), row]);
    groups.set(key, lines);
  }
  const selectedLines = new Map<string, number>();
  for (const [key, lines] of groups) {
    const ranked = [...lines.entries()].map(([line, lineRows]) => ({
      line,
      sides: new Set(lineRows.map((row) => row.side)).size,
      books: new Set(lineRows.map((row) => row.book)).size,
      balance: lineRows.reduce((sum, row) => sum + Math.abs((assessPropPrice(row.odds).impliedProbability ?? 0.5) - 0.5), 0) / lineRows.length,
    })).sort((a, b) => b.sides - a.sides || b.books - a.books || a.balance - b.balance || a.line - b.line);
    selectedLines.set(key, ranked[0]?.line ?? 0);
  }
  return rows.filter((row) => {
    const key = `${row.player}|${row.team}|${row.opponent}|${row.gameStartTime}|${row.market}`;
    return selectedLines.get(key) === row.line;
  });
}

function pairMarketRows(rows: PlayerPropPreviewRow[]): MarketPair[] {
  const groups = new Map<string, PlayerPropPreviewRow[]>();
  for (const row of rows) {
    const key = `${row.player}|${row.team}|${row.opponent}|${row.gameStartTime}|${row.market}|${row.line}`;
    groups.set(key, [...(groups.get(key) ?? []), row]);
  }
  return [...groups.entries()].map(([key, pairRows]) => {
    const over = pairRows.find((row) => row.side === "over") ?? null;
    const under = pairRows.find((row) => row.side === "under") ?? null;
    return { key, rows: [over, under].filter((row): row is PlayerPropPreviewRow => row !== null), primary: over ?? under ?? pairRows[0], over, under };
  });
}

export function dedupeBestPrices(rows: PlayerPropPreviewRow[]): PlayerPropPreviewRow[] {
  const best = new Map<string, PlayerPropPreviewRow>();
  for (const row of rows) {
    const key = `${row.player}|${row.team}|${row.opponent}|${row.market}|${row.side}|${row.line}`;
    const current = best.get(key);
    if (!current || row.odds > current.odds || (row.odds === current.odds && row.lastUpdated > current.lastUpdated)) best.set(key, row);
  }
  return [...best.values()];
}

function buildRadarItems(rows: PlayerPropPreviewRow[]): RadarItem[] {
  const uniqueRows = dedupeBestPrices(rows).filter(isRadarEligible);
  const signalRows = uniqueRows.filter(isPositiveSignal);
  const primaryRows = signalRows.length ? signalRows : uniqueRows.filter((row) => row.playGrade === "WATCHLIST");
  const items: RadarItem[] = [];
  const used = new Set<string>();
  const keyFor = (row: PlayerPropPreviewRow) => `${row.player}|${row.market}|${row.side}|${row.line}`;
  const add = (row: PlayerPropPreviewRow | undefined, label: string, note: string) => {
    if (!row || used.has(keyFor(row))) return;
    used.add(keyFor(row));
    items.push({ row, label, note });
  };

  const projectionGap = [...primaryRows]
    .filter((row) => row.projectionSource !== "recent_form" && isProjectionSideCoherent(row))
    .sort((a, b) => Math.abs(b.projection - b.line) - Math.abs(a.projection - a.line))[0];
  if (projectionGap) {
    const delta = projectionGap.projection - projectionGap.line;
    add(projectionGap, "Projection gap", `The model sits ${Math.abs(delta).toFixed(1)} ${delta >= 0 ? "above" : "below"} the current line.`);
  }

  const priceGroups = new Map<string, PlayerPropPreviewRow[]>();
  for (const row of rows.filter(isRadarEligible)) {
    if (signalRows.length && !signalRows.some((signal) => keyFor(signal) === keyFor(row))) continue;
    const key = keyFor(row);
    priceGroups.set(key, [...(priceGroups.get(key) ?? []), row]);
  }
  const widestPriceGroup = [...priceGroups.values()]
    .filter((group) => group.length > 1)
    .sort((a, b) => (Math.max(...b.map((row) => row.odds)) - Math.min(...b.map((row) => row.odds))) - (Math.max(...a.map((row) => row.odds)) - Math.min(...a.map((row) => row.odds))))[0];
  if (widestPriceGroup) {
    const best = [...widestPriceGroup].sort((a, b) => b.odds - a.odds)[0];
    const highestOdds = Math.max(...widestPriceGroup.map((row) => row.odds));
    const lowestOdds = Math.min(...widestPriceGroup.map((row) => row.odds));
    add(best, "Book spread", `Available prices range from ${signed(lowestOdds)} to ${signed(highestOdds)} across ${widestPriceGroup.length} sportsbooks.`);
  }

  const contextWatch = items.length < 2 && signalRows.length < RADAR_ITEM_LIMIT ? uniqueRows.find((row) => row.playGrade === "WATCHLIST") : null;
  if (contextWatch) {
    const missing = contextWatch.missingFeatures[0] ? memberFeatureLabel(contextWatch.missingFeatures[0]) : "additional pregame context";
    add(contextWatch, "Context watch", `The current read is waiting on ${missing.toLowerCase()}.`);
  }

  const modelRows = signalRows.length ? signalRows : uniqueRows.filter((row) => row.playGrade === "WATCHLIST");
  for (const row of [...modelRows].sort((a, b) => Math.abs(b.modelEdge ?? 0) - Math.abs(a.modelEdge ?? 0))) {
    if (items.length >= RADAR_ITEM_LIMIT) break;
    add(row, "Model signal", `${getPropGradeLabel(row.playGrade)} · ${sentenceCase(row.confidenceBucket)} evidence strength at the current price.`);
  }
  return items.slice(0, RADAR_ITEM_LIMIT);
}

function isRadarEligible(row: PlayerPropPreviewRow): boolean {
  const price = assessPropPrice(row.odds);
  return price.signalEligible
    && row.odds >= -250
    && row.playGrade !== "NO_PLAY"
    && row.playGrade !== "PENDING_DATA"
    && row.playGrade !== "RESEARCH";
}

function playerDirectorySummaries(rows: PlayerPropPreviewRow[]): Array<{ player: string; team: string; headshotUrl?: string | null; markets: number; books: number }> {
  const summaries = new Map<string, { player: string; team: string; headshotUrl?: string | null; markets: Set<string>; books: Set<string> }>();
  for (const row of rows) {
    const current = summaries.get(row.player) ?? { player: row.player, team: row.team, headshotUrl: row.headshotUrl, markets: new Set<string>(), books: new Set<string>() };
    current.markets.add(row.market);
    current.books.add(row.book);
    summaries.set(row.player, current);
  }
  return [...summaries.values()].map((item) => ({ ...item, markets: item.markets.size, books: item.books.size })).sort((a, b) => a.player.localeCompare(b.player));
}

function sameProp(a: PlayerPropPreviewRow, b: PlayerPropPreviewRow): boolean {
  return a.player === b.player && a.market === b.market && a.side === b.side && a.line === b.line;
}

function deriveMatchups(rows: PlayerPropPreviewRow[]): SlateMatchup[] {
  const found = new Map<string, SlateMatchup>();
  for (const row of rows) {
    const awayTeam = row.homeAway === "away" ? row.team : row.opponent;
    const homeTeam = row.homeAway === "home" ? row.team : row.opponent;
    const key = `${awayTeam}|${homeTeam}|${row.gameStartTime}`;
    if (!found.has(key)) found.set(key, { awayTeam, homeTeam, gameStartTime: row.gameStartTime, starterStatus: "pending" });
  }
  return [...found.values()];
}

function gameKeyForMatchup(matchup: SlateMatchup): string {
  return `${matchup.awayTeam}|${matchup.homeTeam}|${matchup.gameStartTime}`;
}

function gameKeyForRow(row: PlayerPropPreviewRow): string {
  const awayTeam = row.homeAway === "away" ? row.team : row.opponent;
  const homeTeam = row.homeAway === "home" ? row.team : row.opponent;
  return `${awayTeam}|${homeTeam}|${row.gameStartTime}`;
}

function sortRows(sort: SortKey): (a: PlayerPropPreviewRow, b: PlayerPropPreviewRow) => number {
  if (sort === "signal") return (a, b) => signalSortRank(a) - signalSortRank(b)
    || (b.expectedValue ?? -Infinity) - (a.expectedValue ?? -Infinity)
    || (b.modelEdge ?? -Infinity) - (a.modelEdge ?? -Infinity)
    || a.player.localeCompare(b.player);
  if (sort === "ev") return (a, b) => (b.expectedValue ?? -Infinity) - (a.expectedValue ?? -Infinity);
  if (sort === "edge") return (a, b) => (b.modelEdge ?? -Infinity) - (a.modelEdge ?? -Infinity);
  if (sort === "probability") return (a, b) => (b.finalProbability ?? -Infinity) - (a.finalProbability ?? -Infinity);
  if (sort === "confidence") return (a, b) => b.confidence - a.confidence;
  if (sort === "start") return (a, b) => a.gameStartTime.localeCompare(b.gameStartTime);
  if (sort === "player") return (a, b) => a.player.localeCompare(b.player);
  if (sort === "market") return (a, b) => a.marketLabel.localeCompare(b.marketLabel);
  if (sort === "book") return (a, b) => a.book.localeCompare(b.book);
  return (a, b) => b.lastUpdated.localeCompare(a.lastUpdated);
}

function signalSortRank(row: PlayerPropPreviewRow): number {
  if (row.playGrade === "BEST_ANGLE") return 0;
  if (row.playGrade === "LEAN") return 1;
  if (row.playGrade === "WATCHLIST") return 2;
  if (row.playGrade === "NO_PLAY") return 3;
  if (row.playGrade === "PENDING_DATA") return 4;
  return 5;
}

function unique(values: string[]): string[] {
  return [...new Set(values)].sort((a, b) => a.localeCompare(b));
}

function matchesMinimum(value: number | null, range: string): boolean {
  return range === "all" || (value !== null && value >= Number(range));
}

function clamp01(value: number): number {
  return Math.max(0, Math.min(1, value));
}

function pct(value: number, signedValue = false): string {
  const formatted = `${(value * 100).toFixed(1)}%`;
  return signedValue && value > 0 ? `+${formatted}` : formatted;
}

function researchPct(value: number | null): string {
  return value === null ? "-" : `${(value * 100).toFixed(1)}%`;
}

function decimalStat(value: number | null): string {
  return value === null ? "-" : value.toFixed(3).replace(/^0/, "");
}

function factorLabel(value: number | null): string {
  return value === null ? "-" : String(Math.round(value));
}

function parkProfileLabel(runFactor: number | null): string {
  if (runFactor === null) return "Profile available";
  if (runFactor >= 103) return "Hitter-friendly";
  if (runFactor <= 97) return "Pitcher-friendly";
  return "Near neutral";
}

function roofStatusLabel(status: PlayerPropEnvironmentEvidence["roofStatus"]): string {
  if (status === "dome") return "Controlled indoor environment";
  if (status === "retractable") return "Retractable roof";
  if (status === "outdoor") return "Outdoor ballpark";
  return "Roof info unavailable";
}

function handednessLabel(value: "L" | "R" | "S" | null, action: "bats" | "throws"): string {
  if (value === "S") return "Switch hitter";
  if (value === "L") return action === "bats" ? "Bats left" : "Throws left";
  if (value === "R") return action === "bats" ? "Bats right" : "Throws right";
  return action === "bats" ? "Batting side unavailable" : "Throwing hand unavailable";
}

function weatherHeadline(evidence: PlayerPropEnvironmentEvidence | null | undefined): string {
  if (!evidence || evidence.weather.status !== "available") return "Forecast check";
  const parts = [
    evidence.weather.temperatureF === null ? null : `${Math.round(evidence.weather.temperatureF)}°F`,
    evidence.weather.conditions,
  ].filter((value): value is string => Boolean(value));
  return parts.join(" · ") || "Forecast available";
}

function weatherDetail(evidence: PlayerPropEnvironmentEvidence | null | undefined): string {
  if (!evidence || evidence.weather.status !== "available") return "Verified game-time conditions will appear here.";
  const wind = evidence.weather.windSpeedMph === null
    ? null
    : `${Math.round(evidence.weather.windSpeedMph)} mph${evidence.weather.windDirection ? ` ${evidence.weather.windDirection}` : ""}`;
  const rain = evidence.weather.precipitationProbability === null
    ? null
    : `${Math.round(evidence.weather.precipitationProbability)}% precipitation`;
  return [wind, rain, evidence.weather.source].filter((value): value is string => Boolean(value)).join(" · ") || "Game-time forecast available.";
}

function signed(value: number): string {
  return value > 0 ? `+${value}` : String(value);
}

function signedDecimal(value: number): string {
  return `${value > 0 ? "+" : ""}${Number.isInteger(value) ? value : value.toFixed(1)}`;
}

function formatDateTime(value: string): string {
  return new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" }).format(new Date(value));
}

function formatSlateDate(value: string): string {
  return new Intl.DateTimeFormat("en-US", { weekday: "long", month: "long", day: "numeric" }).format(new Date(`${value}T12:00:00`));
}

function formatTime(value: string): string {
  return new Intl.DateTimeFormat("en-US", { hour: "numeric", minute: "2-digit" }).format(new Date(value));
}

function formatGameLogDate(value: string): string {
  return new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", timeZone: "UTC" }).format(new Date(`${value}T12:00:00.000Z`));
}

function sentenceCase(value: string): string {
  const clean = value.replace(/_/g, " ").toLowerCase();
  return clean ? clean[0].toUpperCase() + clean.slice(1) : clean;
}

function lineupDisplayStatus(status: NonNullable<PlayerPropPreviewRow["lineupStatus"]>["status"] | undefined): string {
  if (status === "confirmed") return "Confirmed";
  if (status === "posted") return "Posted";
  if (status === "not_in_lineup") return "Not listed";
  return "Projected";
}

function isMemberVisibleMarket(row: PlayerPropPreviewRow): boolean {
  return !MEMBER_HIDDEN_MARKETS.has(row.market);
}

function summarizeRows(rows: PlayerPropPreviewRow[]): PlayerPropsDashboardData["summary"] {
  const grades = (grade: PropGrade) => rows.filter((row) => row.playGrade === grade).length;
  const averageDataConfidence = rows.length
    ? rows.reduce((sum, row) => sum + row.confidence, 0) / rows.length
    : 0;
  return {
    gamesWithProps: unique(rows.map(gameKeyForRow)).length,
    scoredProps: rows.filter((row) => row.projectionSource === "model").length,
    recommendations: grades("BEST_ANGLE"),
    leans: grades("LEAN"),
    watchlist: grades("WATCHLIST"),
    noPlay: grades("NO_PLAY"),
    pendingData: grades("PENDING_DATA"),
    researchOnly: grades("RESEARCH"),
    booksCovered: unique(rows.map((row) => row.book)).length,
    marketsAvailable: unique(rows.map((row) => row.market)).length,
    averageDataConfidence,
  };
}

function rowMarketFilter(row: PlayerPropPreviewRow): MarketFilter {
  return row.market;
}

function rowMarketFilterLabel(row: PlayerPropPreviewRow): string {
  return MARKET_FILTER_LABELS[rowMarketFilter(row)] ?? row.marketLabel;
}

function humanStatus(value: string): string {
  return value.replace(/_/g, " ");
}

function memberReason(value: string): string {
  const labels: Record<string, string> = {
    HIGH_EV: "Strong model value",
    BATTER_CONTEXT_INSUFFICIENT: "More matchup context needed",
    LINEUP_CONTEXT_INSUFFICIENT: "Projected lineup context",
    LOW_DATA_CONFIDENCE: "Limited supporting data",
    STOLEN_BASE_CONTEXT_INSUFFICIENT: "More stolen-base context needed",
    LONGSHOT_VALUE_CONTEXT: "Longshot value context",
    STALE_BDL_ODDS: "Price refresh in progress",
    FIRST_HR_FIELD_MODEL_NOT_PROMOTED: "Research market only",
    MILESTONE_MODEL_NOT_PROMOTED: "Research market only",
    PITCHER_WIN_CONTEXT_INSUFFICIENT: "More win context needed",
    MODEL_CONTEXT_NOT_INTEGRATED: "Model context is still being integrated",
  };
  return labels[value] ?? sentenceCase(value)
    .replace(/\bBdl\b/gi, "")
    .replace(/model not promoted/gi, "research market only")
    .replace(/\s+/g, " ")
    .trim();
}

function memberFeatureLabel(value: string): string {
  return sentenceCase(value
    .replace(/^BDL\s+/i, "")
    .replace(/^MLB Stats\s+/i, "")
    .replace(/verified fixture field/gi, "verified")
    .replace(/confirmed fixture state/gi, "confirmed")
    .replace(/\bfixture\b/gi, "")
    .replace(/\s+/g, " ")
    .trim())
    .replace(/\bK\/?IP\b/gi, "strikeout rate")
    .replace(/\bBB\/?IP\b/gi, "walk rate")
    .replace(/\bH\/?IP\b/gi, "hits allowed rate")
    .replace(/\bPA\b/gi, "plate appearances")
    .replace(/\bIP\b/gi, "innings")
    .replace(/\bproxy\b/gi, "trend")
    .replace(/\bbaseline\b/gi, "season trend")
    .replace(/opponent K profile/gi, "opponent strikeout profile")
    .replace(/recent start logs/gi, "recent starts");
}

function memberGradeDescription(grade: PropGrade): string {
  if (grade === "BEST_ANGLE") return "The model's strongest current alignment between projection, market price, and available data.";
  if (grade === "LEAN") return "A positive model difference that is more sensitive to the available price.";
  if (grade === "WATCHLIST") return "An interesting read that still depends on additional confirmation.";
  if (grade === "NO_PLAY") return "The model does not show a meaningful advantage at the current line.";
  if (grade === "PENDING_DATA") return "A core model or market input needs a fresh check.";
  return "Available for research with projection, price, and context, but not strong enough for a graded signal.";
}

function propReaderSummary(row: PlayerPropPreviewRow, prices: PlayerPropPreviewRow[]): string {
  const bestPrice = prices[0] ?? row;
  const delta = row.projection - row.line;
  const direction = delta >= 0 ? "above" : "below";
  const selectedSide = row.side === "over" ? "over" : "under";
  const integrity = row.projectionSource === "recent_form"
    ? "Recent results add context; they are not a standalone prediction."
    : isProjectionSideCoherent(row)
      ? `That projection supports the ${selectedSide} side currently shown.`
      : "The final prediction also weighs price, market, and matchup context.";
  const probability = row.finalProbability === null
    ? "A probability-backed OddSphere prediction is not available for this side yet, so this remains a projection-led research view."
    : row.marketProbability === null
      ? `OddSphere estimates the selected side at ${pct(row.finalProbability)}; a comparable market probability is not available.`
      : `OddSphere estimates the selected side at ${pct(row.finalProbability)}, compared with ${pct(row.marketProbability)} implied by the market.`;
  const price = prices.length > 1
    ? `${bestPrice.book} currently offers the best of ${prices.length} available prices: ${signed(bestPrice.odds)}.`
    : `${bestPrice.book} currently lists ${signed(bestPrice.odds)}.`;
  const pricePolicy = assessPropPrice(bestPrice.odds).signalEligible
    ? ""
    : " The quote remains visible for comparison but is not eligible for a positive signal.";
  const longshotContext = row.reasonCodes.includes("LONGSHOT_VALUE_CONTEXT")
    ? " This is a rare-event market, so the read is about price versus estimated chance, not the event being more likely than not."
    : "";
  const estimateLabel = row.projectionSource === "recent_form" ? "recent-game average" : "projection";
  return `${row.player}'s ${row.projection} ${estimateLabel} sits ${Math.abs(delta).toFixed(1)} ${direction} the ${row.line} line. ${integrity} ${probability} ${price}${pricePolicy}${longshotContext}`;
}

function cardReason(row: PlayerPropPreviewRow): string {
  if (!assessPropPrice(row.odds).signalEligible) return "This price remains visible for comparison but is not eligible for a positive signal.";
  if (row.reasonCodes.includes("LONGSHOT_VALUE_CONTEXT")) return "Longshot watch: the model price is better than the market, but this remains a rare-event prop.";
  if (!isProjectionSideCoherent(row)) return "The final prediction weighs projection, price, and matchup context together.";
  const feature = (row.keyFeatures[0] ? memberFeatureLabel(row.keyFeatures[0]) : "Verified inputs")
    .replace(/\bk\b/g, "K")
    .replace(/bb\/ip/gi, "BB/IP")
    .replace(/er\/ip/gi, "ER/IP");
  if (feature.toLowerCase() === "starter confirmed") return `Starter confirmed and ${projectionReasonLabel(row)} clears the market line.`;
  if (row.playGrade === "LEAN") return shortenReason(`The projection is supported by ${feature.toLowerCase()} but remains sensitive to the current price.`);
  return shortenReason(`The projection is supported by ${feature.toLowerCase()}.`);
}

function shortenReason(value: string): string {
  if (value.length <= 90) return value;
  const shortened = value.slice(0, 87).replace(/\s+\S*$/, "");
  return `${shortened}.`;
}

function pickMarketLabel(row: PlayerPropPreviewRow): string {
  return row.marketLabel.replace(/^(Pitcher|Batter)\s+/i, "");
}

function projectionReasonLabel(row: PlayerPropPreviewRow): string {
  if (row.market === "pitcher_strikeouts") return "K projection";
  if (row.market === "pitcher_outs") return "workload projection";
  return `${pickMarketLabel(row).toLowerCase()} projection`;
}

function isProjectionSideCoherent(row: PlayerPropPreviewRow): boolean {
  if (row.projectionSource === "recent_form") return true;
  return checkProjectionSideIntegrity({ side: row.side, line: row.line, projection: row.projection }).status === "coherent";
}

function enforcePreviewIntegrity(row: PlayerPropPreviewRow): PlayerPropPreviewRow {
  const price = assessPropPrice(row.odds);
  if (!price.signalEligible) {
    return {
      ...row,
      playGrade: "RESEARCH",
      units: 0,
      reasonCodes: price.reasonCode
        ? [price.reasonCode, ...row.reasonCodes.filter((code) => code !== price.reasonCode)]
        : row.reasonCodes,
    };
  }
  if (isProjectionSideCoherent(row)) return row;
  const alreadyBlocked = row.playGrade === "NO_PLAY" || row.playGrade === "PENDING_DATA" || row.playGrade === "RESEARCH";
  return {
    ...row,
    playGrade: alreadyBlocked ? row.playGrade : "NO_PLAY",
    reasonCodes: [PROJECTION_SIDE_CONTRADICTION, ...row.reasonCodes.filter((code) => code !== PROJECTION_SIDE_CONTRADICTION)],
  };
}

function hydrateResearchEvidence(
  row: PlayerPropPreviewRow,
  research: PlayerPropsDashboardData["research"],
): PlayerPropPreviewRow {
  const evidence = row.researchKey ? research?.[row.researchKey] : null;
  return evidence ? { ...row, ...evidence } : row;
}

function money(value: number | null): string {
  if (value === null || !Number.isFinite(value)) return "-";
  return value.toLocaleString("en-US", { maximumFractionDigits: value >= 100 ? 0 : 2 });
}
