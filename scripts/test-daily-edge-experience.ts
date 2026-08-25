import type { DailyEdgeGameDto } from "../app/lab/lib/labTypes";
import { readFileSync } from "node:fs";
import {
  buildDailyEdgeReaderUrl,
  primaryDailyEdgeMarket,
  resolveInitialDailyEdgeReaderSelection,
} from "../app/lab/lib/dailyEdgeReaderState";
import {
  AVAILABLE_DAILY_EDGE_SPORTS,
  DAILY_EDGE_SPORT_AVAILABILITY,
  DAILY_EDGE_SPORTS,
  DAILY_EDGE_TOP_LEVEL_SPORT_KEYS,
} from "../app/lab/lib/dailyEdgeSports";
import { isDailyEdgeExperiencePreviewAvailable } from "../lib/config/dailyEdgeExperience";
import { __WNBA_AVAILABILITY_TEST__ } from "../lib/services/wnba/espnWnbaAvailability";
import { __MLB_AVAILABILITY_TEST__ } from "../lib/services/mlb/playbookMlbAvailability";
import { parseDailyEdgeAvailabilityMatchup } from "../lib/services/dailyEdge/availabilityRequest";
import { pitcherFirstInningPoint } from "../app/lab/lib/dailyEdgeFirstInningHistory";
import {
  DAILY_EDGE_WEEKLY_READER_LIFECYCLE_RELEASE,
  filterWeeklyReaderSnapshot,
  weeklyReaderGameIsVisible,
} from "../lib/services/dailyEdge/weeklyReaderLifecycle";
import { resolvePointLineMarketPulseMovement } from "../app/lab/lib/dailyEdgeMarketPulseMovement";
import { resolveDailyEdgeCurrentOnlyMovement } from "../app/lab/lib/dailyEdgeCurrentOnlyMovement";
import { marketSplitSectionIsStale } from "../app/lab/lib/dailyEdgeSplitFreshness";

const snapshotPrimerSource = readFileSync(
  "scripts/operator/prime-daily-edge-experience-snapshots.ts",
  "utf8",
);
const privateNavSource = readFileSync("app/lab/components/LabAppNav.tsx", "utf8");
const liveRefreshSource = readFileSync(
  "app/lab/daily-edge/DailyEdgeLiveRefresh.tsx",
  "utf8",
);
const candidateMemberPageSource = readFileSync(
  "app/lab/daily-edge/CandidateDailyEdgePage.tsx",
  "utf8",
);
const dailyEdgeRouteSource = readFileSync(
  "app/lab/daily-edge/page.tsx",
  "utf8",
);
const dailyEdgeApiSource = readFileSync(
  "app/api/lab/daily-edge/route.ts",
  "utf8",
);
const legacyDailyEdgeSource = readFileSync(
  "app/lab/components/daily-edge/DailyEdgeShell.tsx",
  "utf8",
);
const candidateDailyEdgeSource = readFileSync(
  "app/dev/experience-preview/ActualDailyEdgePreview.tsx",
  "utf8",
);

let passed = 0;
let failed = 0;

function check(label: string, condition: boolean) {
  if (condition) {
    passed += 1;
    console.log(`  ✓ ${label}`);
    return;
  }
  failed += 1;
  console.error(`  ✗ ${label}`);
}

function game(
  id: string,
  grades: [string, string, string],
): DailyEdgeGameDto {
  const market = (key: string) => ({ verdict: { key } });
  return {
    id,
    markets: {
      moneyline: market(grades[0]),
      total: market(grades[1]),
      first_inning: market(grades[2]),
    },
  } as unknown as DailyEdgeGameDto;
}

console.log("\n━━━ First-inning history identity ━━━");
check(
  "an away starter's runs allowed follow the opponent's first-inning score",
  pitcherFirstInningPoint({
    game_date: "2026-08-01",
    away_pitcher_id: 42,
    home_pitcher_id: 7,
    inning_scores: { away: [0], home: [2] },
  }, 42)?.runsAllowed === 2,
);
check(
  "the same pitcher is retained when a later start is at home",
  pitcherFirstInningPoint({
    game_date: "2026-08-06",
    away_pitcher_id: 7,
    home_pitcher_id: 42,
    inning_scores: { away: [1], home: [0] },
  }, 42)?.runsAllowed === 1,
);

console.log("\n━━━ Daily Edge experience gate ━━━");
check(
  "local development is available without a flag",
  isDailyEdgeExperiencePreviewAvailable({ NODE_ENV: "development" }),
);
check(
  "production mode fails closed without a flag",
  !isDailyEdgeExperiencePreviewAvailable({ NODE_ENV: "production" }),
);
check(
  "production mode opens only with the explicit server flag",
  isDailyEdgeExperiencePreviewAvailable({
    NODE_ENV: "production",
    DAILY_EDGE_EXPERIENCE_PREVIEW_ENABLED: "true",
  }),
);
check(
  "candidate slate cards reserve a consistent row for Play Grade and time",
  candidateDailyEdgeSource.includes('compactSoccer ? "grid gap-2" : "grid gap-3"') &&
    candidateDailyEdgeSource.includes('compactSoccer ? "min-h-6" : "min-h-8"') &&
    !candidateDailyEdgeSource.includes('className="flex flex-wrap items-center justify-between gap-3">\n          <div className="flex min-w-0 items-center gap-2.5"'),
);
check(
  "Daily Edge labels outcome confidence separately from the exact-price Bet grade",
  candidateDailyEdgeSource.includes("Outcome confidence") &&
    candidateDailyEdgeSource.includes(">Bet grade</p>") &&
    candidateDailyEdgeSource.includes("Bet grade · exact-price decision") &&
    candidateDailyEdgeSource.includes("Selected-outcome probability") &&
    !candidateDailyEdgeSource.includes(">Play grade</p>"),
);
check(
  "the shared reader explains that confidence cannot silently override price-sensitive grading",
  candidateDailyEdgeSource.includes("Outcome confidence is shown separately and does not override the Bet grade") &&
    candidateDailyEdgeSource.includes("neither is a guarantee or automatic parlay recommendation") &&
    candidateDailyEdgeSource.includes("recommendation evaluated at"),
);
check(
  "truth-like flag values do not accidentally open production",
  !isDailyEdgeExperiencePreviewAvailable({
    NODE_ENV: "production",
    DAILY_EDGE_EXPERIENCE_PREVIEW_ENABLED: "1",
  }),
);
check(
  "the private candidate switch also makes its underlying preview route available",
  isDailyEdgeExperiencePreviewAvailable({
    NODE_ENV: "production",
    DAILY_EDGE_EXPERIENCE_CANDIDATE_ENABLED: "true",
  }),
);
check(
  "cutover snapshot priming is dry-run by default and reuses the authoritative writer",
  snapshotPrimerSource.includes('process.argv.includes("--apply")') &&
    snapshotPrimerSource.includes('url.searchParams.set("snapshotBypass", "true")') &&
    snapshotPrimerSource.includes("refreshDailyEdgeResponseSnapshot") &&
    snapshotPrimerSource.includes("No snapshots were written"),
);
check(
  "cutover validation blocks wrong WNBA logos, mixed-book trails, and unsupported sharp sections",
  snapshotPrimerSource.includes('/teamlogos/wnba/') &&
    snapshotPrimerSource.includes("movement trail mixes sportsbooks") &&
    snapshotPrimerSource.includes("must not render unsupported sharp-book splits"),
);
check(
  "cutover validation runs the full MLB member tuple coherence audit",
  snapshotPrimerSource.includes("auditDailyEdgeResponseCoherence") &&
    snapshotPrimerSource.includes("violations.push(...auditDailyEdgeResponseCoherence(body)"),
);
check(
  "private Player Props navigation prefers the real read-only snapshot over fixture data",
  privateNavSource.includes('{ href: "/dev/mlb-props-preview", label: "Player Props"') &&
    !privateNavSource.includes('{ href: "/dev/mlb-props-preview?source=fixture", label: "Player Props"'),
);
check(
  "member Daily Edge refreshes while open and recovers on focus, reconnect, and back-forward restore",
  candidateMemberPageSource.includes("<DailyEdgeLiveRefresh />") &&
    liveRefreshSource.includes("router.refresh()") &&
    liveRefreshSource.includes('document.addEventListener("visibilitychange"') &&
    liveRefreshSource.includes('window.addEventListener("focus"') &&
    liveRefreshSource.includes('window.addEventListener("online"') &&
    liveRefreshSource.includes('window.addEventListener("pageshow"') &&
    liveRefreshSource.includes("window.clearInterval(interval)"),
);
check(
  "member Daily Edge is request-rendered so refreshes cannot reuse a deployment-time slate",
  dailyEdgeRouteSource.includes('import { connection } from "next/server"') &&
    dailyEdgeRouteSource.includes("await connection()") &&
    dailyEdgeRouteSource.indexOf("await connection()") <
      dailyEdgeRouteSource.indexOf("isDailyEdgeExperienceCandidateEnabled()"),
);
check(
  "source-aware loading protects current Sharp rows from the per-event history cap",
  dailyEdgeApiSource.includes("const [currentSharpResult, ...historyResults]") &&
    dailyEdgeApiSource.includes('.eq("provider", "sharpapi")') &&
    dailyEdgeApiSource.includes("[currentSharpResult, ...historyResults]"),
);

console.log("\n━━━ Reader selection contract ━━━");
const games = [
  game("game-a", ["lean", "best_angle", "no_play"]),
  game("game-b", ["watchlist", "caution", "lean"]),
];
check(
  "an exact board game and Total pill resolve to that reader state",
  JSON.stringify(resolveInitialDailyEdgeReaderSelection(games, "game-b", "total")) ===
    JSON.stringify({ gameId: "game-b", market: "total" }),
);
check(
  "an exact First Inning pill remains First Inning",
  resolveInitialDailyEdgeReaderSelection(games, "game-a", "first_inning").market ===
    "first_inning",
);
check(
  "an unknown game falls back to the first slate game",
  resolveInitialDailyEdgeReaderSelection(games, "missing", "moneyline").gameId ===
    "game-a",
);
check(
  "an invalid market fails closed to Moneyline",
  resolveInitialDailyEdgeReaderSelection(games, "game-a", "props").market ===
    "moneyline",
);
check(
  "the card headline selects the strongest graded market",
  primaryDailyEdgeMarket(games[0]) === "total",
);
check(
  "headline ranking does not mutate market priority across calls",
  primaryDailyEdgeMarket(games[1]) === "first_inning" &&
    primaryDailyEdgeMarket(games[0]) === "total",
);

console.log("\n━━━ URL-addressable reader state ━━━");
const url = buildDailyEdgeReaderUrl(
  "/dev/experience-preview",
  "?source=qa&sport=mlb",
  "wnba",
  "wnba-42",
  "first_inning",
);
const parsed = new URL(url, "http://localhost");
check("reader URL preserves unrelated QA parameters", parsed.searchParams.get("source") === "qa");
check("reader URL replaces the sport", parsed.searchParams.get("sport") === "wnba");
check("reader URL stores the exact game", parsed.searchParams.get("game") === "wnba-42");
check(
  "reader URL stores the exact market",
  parsed.searchParams.get("market") === "first_inning",
);

console.log("\n━━━ Cross-surface sport readiness registry ━━━");
check(
  "member-available Daily Edge models retain Soccer competitions without a separate UCL top-level pill",
  AVAILABLE_DAILY_EDGE_SPORTS.includes("soccer") &&
    AVAILABLE_DAILY_EDGE_SPORTS.includes("ucl") &&
    DAILY_EDGE_TOP_LEVEL_SPORT_KEYS.includes("soccer") &&
    !DAILY_EDGE_TOP_LEVEL_SPORT_KEYS.includes("ucl"),
);
check(
  "the top-level Soccer model is labeled and presented as active while EPL has a live slate",
  DAILY_EDGE_SPORTS.find((definition) => definition.key === "soccer")?.label === "Soccer" &&
    DAILY_EDGE_SPORT_AVAILABILITY.soccer?.statusLabel === "Active",
);
check(
  "the shared Soccer selector owns Premier League, Champions League, and World Cup navigation",
  candidateDailyEdgeSource.includes('labelOverrides={{ soccer: "Soccer" }}') &&
    candidateDailyEdgeSource.includes('label: "Premier League"') &&
    candidateDailyEdgeSource.includes('label: "Champions League"') &&
    candidateDailyEdgeSource.includes('label: "World Cup"'),
);
check(
  "all active models lead the top-level pill bar and NFL is active",
  DAILY_EDGE_TOP_LEVEL_SPORT_KEYS.slice(0, 4).join(",") === "mlb,wnba,soccer,nfl" &&
    DAILY_EDGE_SPORT_AVAILABILITY.nfl?.isLive === true &&
    DAILY_EDGE_SPORT_AVAILABILITY.nfl?.statusLabel === "Active",
);
check(
  "planned football and basketball models remain visible but unavailable",
  ["cfb", "cbb"].every(
    (key) =>
      DAILY_EDGE_SPORTS.find((definition) => definition.key === key)
        ?.memberAvailable === false,
  ),
);

console.log("\n━━━ Weekly member-board lifecycle ━━━");
const thursdayKickoff = { gameStartAt: "2026-08-21T00:00:00.000Z" };
const fridayKickoff = { gameStartAt: "2026-08-22T00:00:00.000Z" };
check(
  "the weekly reader lifecycle is explicitly released",
  DAILY_EDGE_WEEKLY_READER_LIFECYCLE_RELEASE === "daily_edge_weekly_reader_lifecycle_2026_08_24_r2",
);
check(
  "an NFL game stays visible throughout its Eastern game date",
  weeklyReaderGameIsVisible(thursdayKickoff, "nfl", new Date("2026-08-21T03:59:59.000Z")),
);
check(
  "an NFL game rolls off when Friday begins in the East",
  !weeklyReaderGameIsVisible(thursdayKickoff, "nfl", new Date("2026-08-21T04:00:00.000Z")),
);
check(
  "the EPL reader retains its existing 2 a.m. Eastern rollover",
  weeklyReaderGameIsVisible(thursdayKickoff, "soccer", new Date("2026-08-21T05:59:59.000Z")) &&
    !weeklyReaderGameIsVisible(thursdayKickoff, "soccer", new Date("2026-08-21T06:00:00.000Z")),
);
const weeklySnapshot = {
  games: [
    { id: "nfl-thursday", ...thursdayKickoff },
    { id: "nfl-friday", ...fridayKickoff },
    { id: "nfl-legacy", gameStartAt: null },
  ],
} as unknown as import("../app/lab/lib/labTypes").DailyEdgeResponse;
const filteredWeeklySnapshot = filterWeeklyReaderSnapshot(
  weeklySnapshot,
  "nfl",
  new Date("2026-08-21T12:00:00.000Z"),
);
check(
  "filtering removes only prior-date games and fails open for legacy timestamps",
  filteredWeeklySnapshot.games.map((row) => row.id).join(",") === "nfl-friday,nfl-legacy" &&
    weeklySnapshot.games.length === 3,
);
check(
  "an explicit EPL request can never fall through to the World Cup snapshot",
  candidateMemberPageSource.includes("else if (eplRequested && eplEnabled)") &&
    candidateMemberPageSource.includes("else if (eplRequested)") &&
    candidateMemberPageSource.includes("snapshot = emptyPreviewSnapshot(sport)") &&
    candidateMemberPageSource.includes('competition === "premier_league" && eplEnabled'),
);

console.log("\n━━━ Candidate presentation truthfulness ━━━");
const nflSplitCapturedAt = "2026-08-25T15:36:00.000Z";
const nflSplitSection = {
  label: "Consensus Splits" as const,
  rows: [{
    side: "home" as const,
    label: "SEA",
    moneyPct: 60,
    betsPct: 55,
    observedAt: nflSplitCapturedAt,
    staleAfterMinutes: 360,
  }],
  signal: null,
  lastUpdated: nflSplitCapturedAt,
};
check(
  "NFL split freshness honors its six-hour early-week collection contract",
  !marketSplitSectionIsStale(nflSplitSection, Date.parse("2026-08-25T17:36:00.000Z")),
);
check(
  "NFL split freshness becomes stale after its declared collection window",
  marketSplitSectionIsStale(nflSplitSection, Date.parse("2026-08-25T21:37:00.000Z")),
);
const candidateSource = readFileSync(
  "app/dev/experience-preview/ActualDailyEdgePreview.tsx",
  "utf8",
);
const candidatePageSource = readFileSync(
  "app/dev/experience-preview/page.tsx",
  "utf8",
);
const availabilityRouteSource = readFileSync(
  "app/api/lab/daily-edge-availability/route.ts",
  "utf8",
);
const mlbAvailabilitySource = readFileSync(
  "lib/services/mlb/playbookMlbAvailability.ts",
  "utf8",
);
const productNavSource = readFileSync(
  "app/lab/components/LabAppNav.tsx",
  "utf8",
);
check(
  "private review navigation cannot escape into live product routes",
  productNavSource.includes("PRIVATE_REVIEW_TABS") &&
    productNavSource.includes('{ href: "/dev/mlb-props-preview", label: "Player Props"') &&
    productNavSource.includes('/dev/tracking-preview') &&
    productNavSource.includes('isPrivatePreview ? "/dev/relaunch-review"'),
);
check(
  "candidate defaults to the member warm snapshot and isolates explicit fresh contract reads",
  candidatePageSource.includes('if (freshContractRead) params.set("snapshotBypass", "true")') &&
    candidatePageSource.includes("Normal preview traffic uses the same warm read path as the member board"),
);
check(
  "normal sport switching requests the current slate instead of silently substituting a historical review date",
  candidateSource.includes("A normal sport switch must show that sport's canonical current slate") &&
    candidateSource.includes('params.set("date", currentSlateDate(next))') &&
    !candidateSource.includes("DAILY_EDGE_REVIEW_SLATES[next]") &&
    candidateSource.includes('params.delete("game")') &&
    candidateSource.includes('params.delete("market")'),
);
check(
  "consensus-only markets do not render an empty sharp-book panel",
  candidateSource.includes("sharp ?? (sharpAvailability === null ? null") &&
    candidateSource.includes("{displayedSharp ? <SplitSourcePanel") &&
    !candidateSource.includes('<SplitSourcePanel source="SHARP BOOK SPLITS" section={sharp}'),
);
check(
  "cross-source split language is rendered only when sharp rows exist",
  candidateSource.includes("{displayedSharp?.rows.length ? <CrossSourceSplitRead"),
);
check(
  "Daily Edge preserves the live product hierarchy with a compact selected reader by default",
  candidateSource.includes("const [readerOpen, setReaderOpen] = useState(initialReaderRequested)") &&
    candidateSource.includes("function CollapsedReader") &&
    candidateSource.includes('aria-label="Selected Edge collapsed reader"') &&
    candidateSource.includes("Compact read · click any game or market below to open the full reader.") &&
    candidateSource.includes("initialReaderRequested || !initialGame ? initialSelection.market : primaryMarket(initialGame)") &&
    candidateSource.includes('activeId={game.id}'),
);
check(
  "a URL-restored mobile reader cannot lock desktop page scrolling",
  candidateSource.includes('const phoneViewport = window.matchMedia("(max-width: 639px)")') &&
    candidateSource.includes("if (phoneViewport.matches && previousOverflow === null)") &&
    candidateSource.includes("if (!phoneViewport.matches && previousOverflow !== null)") &&
    candidateSource.includes('phoneViewport.addEventListener("change", syncBodyScrollLock)') &&
    candidateSource.includes('phoneViewport.removeEventListener("change", syncBodyScrollLock)'),
);
check(
  "candidate visibly renders authoritative lock state on board and reader surfaces",
  candidateSource.includes('import { LockBadge }') &&
    candidateSource.includes("minute lock checks") &&
    (candidateSource.match(/<LockBadge/g) ?? []).length === 4,
);
check(
  "a game, market, or expand action opens the full reader and it can collapse again",
    candidateSource.includes("setReaderOpen(true)") &&
    candidateSource.includes("function collapseReader()") &&
    candidateSource.includes('aria-label="Expand full read"') &&
    candidateSource.includes('aria-label="Collapse reader"') &&
    candidateSource.includes("onClose={collapseReader}"),
);
check(
  "intentional game-and-market review links may still open the exact reader directly",
  candidateSource.includes("const initialReaderRequested = Boolean(") &&
    candidateSource.includes("displaySnapshot.games.some((candidate) => candidate.id === requestedGameId)") &&
    candidateSource.includes("isMarketKey(requestedMarket)") &&
    candidateSource.includes("useState(initialReaderRequested)"),
);
check(
  "available offseason models remain selectable but are not presented as active today",
  ["nba", "nhl", "ucl"].every(
    (sport) =>
      DAILY_EDGE_SPORT_AVAILABILITY[sport as keyof typeof DAILY_EDGE_SPORT_AVAILABILITY]
        ?.statusLabel === "No games today",
  ) &&
    candidateSource.includes("Model available") &&
    candidateSource.includes("instead of showing games from an older date"),
);
check(
  "MLB and WNBA availability load after the core reader and stay cached independently from prediction writes",
  candidateSource.includes("/api/lab/daily-edge-availability") &&
    candidateSource.includes("controller.abort()") &&
    availabilityRouteSource.includes("loadCachedMlbAvailability") &&
    availabilityRouteSource.includes("loadCachedWnbaAvailability") &&
    availabilityRouteSource.includes("revalidate: 15 * 60"),
);
check(
  "publish-time probability is not mislabeled as the latest market price",
  candidateSource.includes("publish-time market") &&
    candidateSource.includes("Market at publish") &&
    candidateSource.includes("latest observed price is shown separately"),
);
check(
  "displayed probability gap is derived from the displayed probability pair",
  candidateSource.includes("function displayedProbabilityGap") &&
    candidateSource.includes("modelPct - market.marketImpliedPct"),
);
check(
  "mixed-time generated price/edge sentences are withheld",
  !candidateSource.includes("recommendationDecision?.supportingEvidence") &&
    !candidateSource.includes("market.recommendationDecision?.supportingEvidence"),
);
check(
  "sport-specific recent context uses goals, points, or runs",
  candidateSource.includes('const scoringNoun = sport === "soccer"') &&
    candidateSource.includes('sport === "nba" || sport === "wnba" || sport === "nfl" || sport === "cfb" || sport === "cbb" ? "points" : "runs"'),
);
check(
  "MLB candidate uses the same established ESPN logo host as the current reader",
  candidateSource.includes("https://a.espncdn.com/i/teamlogos/mlb/500/"),
);
check(
  "authoritative sport-specific logos win over overlapping MLB abbreviations",
  candidateSource.includes("const suppliedSrc = src?.trim() || null") &&
    candidateSource.includes('suppliedSrc.includes("mlbstatic.com/team-logos/")') &&
    candidateSource.includes(": suppliedSrc") &&
    !candidateSource.includes("const resolvedSrc = mlbLogoUrl(label) ?? src"),
);
check(
  "odds movement explicitly renders a named same-book trail",
  candidateSource.includes('movement.coherentTrail ? "same-book trail"') &&
    candidateSource.includes("Group by book—not by point line"),
);
check(
  "each verified movement row labels favorable and adverse direction independently",
  candidateSource.includes("function movementRowDirection") &&
    candidateSource.includes('label: "Toward pick"') &&
    candidateSource.includes('label: "Against pick"') &&
    candidateSource.includes('label: "Slight toward"') &&
    candidateSource.includes('label: "Slight against"') &&
    candidateSource.includes("magnitude < 1.25") &&
    candidateSource.includes('tone: "red"') &&
    candidateSource.includes('tone: "teal"') &&
    candidateSource.includes('tone: "amber"') &&
    candidateSource.includes("text-red-300") &&
    candidateSource.includes("text-teal-300"),
);
check(
  "different primary and tracked-book prices are labeled instead of mixed",
  candidateSource.includes("displayedBook !== null") &&
    candidateSource.includes("displayedPrice === stop.american") &&
    candidateSource.includes(".filter((group) => group.length >= 2 && group.some"),
);
check(
  "soccer movement rows stay on one sportsbook without a secondary cross-book capture",
  candidateSource.includes('movement.coherentTrail ? "same-book trail"') &&
    !candidateSource.includes("Earlier market capture") &&
    !candidateSource.includes("Different book; not counted as"),
);
check(
  "total and spread summaries preserve both point lines instead of comparing unlike prices at one line",
  candidateSource.includes("line moved from ${formatNumber(movement.openLine)}") &&
    candidateSource.includes("to ${formatNumber(movement.currentLine)}"),
);
check(
  "MLB totals retain the opposing outcome at its own verified line without using it for grading",
  dailyEdgeApiSource.includes("opposingLinesCurrent: currentLinesByGameMarket.get(`${row.id}::total`) ?? []") &&
    dailyEdgeApiSource.includes("Presentation-only opposing outcome context must not disappear") &&
    candidateSource.includes("The available opposing outcome is shown at its own verified book and line") &&
    candidateSource.includes("not a two-sided fair-price pair or a grading input"),
);
check(
  "totals and WNBA spreads render the dedicated line tracker after price movement and before market splits",
  candidateSource.includes("function CompactPointLineMovement") &&
    candidateSource.includes('const isSpread = !isTotal && market.line !== null') &&
    candidateSource.includes('/(?:^|\\s)[+-]\\d+(?:\\.\\d+)?(?:\\s|$)/.test(market.pick ?? "")') &&
    candidateSource.includes('const marketLabel = isTotal ? "Total" : "Spread"') &&
    candidateSource.indexOf("<CompactOddsMovement market={market}") < candidateSource.indexOf("<CompactPointLineMovement market={market}") &&
    candidateSource.indexOf("<CompactPointLineMovement market={market}") < candidateSource.indexOf("<DefaultSplitSummary market={market}"),
);
const wnbaSpreadPointLinePulse = resolvePointLineMarketPulseMovement({
  pick: "POR +4.5",
  marketReadV2: {
    movement: {
      firstTrackedLine: 3.5,
      firstTrackedPrice: -104,
      currentLine: 4.5,
      currentPrice: -104,
      directionRelativeToPick: "support",
      observedAt: "2026-08-23T13:23:26.920Z",
    },
  },
  oddsTrail: [
    {
      american: -104,
      line: 4.5,
      observedAt: "2026-08-23T13:23:26.920Z",
      sportsbook: "fanduel",
      source: "current_line",
      label: "current",
    },
  ],
  lineTrail: [
    {
      american: -104,
      line: 3.5,
      observedAt: "2026-08-22T18:23:14.119Z",
      sportsbook: "fanduel",
      source: "line_history",
      label: "first",
    },
    {
      american: -104,
      line: 4.5,
      observedAt: "2026-08-23T13:23:26.920Z",
      sportsbook: "fanduel",
      source: "current_line",
      label: "current",
    },
  ],
} as unknown as DailyEdgeGameDto["markets"]["first_inning"]);
check(
  "Total/Spread Market Pulse prefers a canonical same-book point-line move over a current-only price trail",
  wnbaSpreadPointLinePulse?.coherentTrail === true &&
    wnbaSpreadPointLinePulse.openLine === 3.5 &&
    wnbaSpreadPointLinePulse.currentLine === 4.5 &&
    wnbaSpreadPointLinePulse.sportsbook === "fanduel" &&
    candidateDailyEdgeSource.includes("resolveMarketPulseMovement(market)") &&
    candidateDailyEdgeSource.includes("resolvePointLineMarketPulseMovement(market) ?? resolveCoherentMovement(market)"),
);
check(
  "Market Pulse keeps public consensus, sharp-book splits, and price movement source-coherent",
  candidateSource.includes("function sourceCoherentMarketPulse") &&
    candidateSource.includes("canonicalMatchesVisibleTrail") &&
    candidateSource.includes("isVerifiedFirstInningPriceBoard") &&
    candidateSource.includes("canonicalLineMatchesVisibleTrail") &&
    candidateSource.includes("canonical.firstTrackedPrice === movement.open") &&
    candidateSource.includes("canonical.currentPrice === movement.current") &&
    candidateSource.includes('chip: "Split sources disagree"') &&
    candidateSource.includes("Public consensus money leans") &&
    candidateSource.includes("sharp-book split snapshot leans") &&
    candidateSource.includes("effectively flat"),
);
check(
  "stale split snapshots cannot masquerade as current sharp-money evidence",
  candidateSource.includes("function splitSectionIsStale") &&
    candidateSource.includes("Stale snapshot") &&
    candidateSource.includes("historical context—not a current sharp-money claim") &&
    candidateSource.includes("Historical cross-source read"),
);
check(
  "legacy consensus divergence is relabeled instead of being shown as sharp money",
  candidateSource.includes('if (/sharp money/i.test(rawChip))') &&
    candidateSource.includes("Consensus money split leans against our side") &&
    candidateSource.includes('rawDetail.replace(/sharp money/gi, "consensus money split")'),
);
check(
  "unverified movement fails closed instead of implying validated endpoints",
  candidateSource.includes("this snapshot does not contain a continuous same-book trail that can support a directional movement claim") &&
    !candidateSource.includes("only validated market endpoints are shown"),
);
check(
  "current-only movement keeps the stored sportsbook price and line tuple intact",
  candidateSource.includes("resolveDailyEdgeCurrentOnlyMovement") &&
    !candidateSource.includes("current: canonical?.currentPrice ?? currentDisplayedPrice(market)"),
);
const currentOnlyTotalMovement = resolveDailyEdgeCurrentOnlyMovement({
  trail: [{
    american: -108,
    line: 8.5,
    observedAt: "2026-08-25T11:06:25.686Z",
    sportsbook: "onexbet",
    source: "current_line",
    label: "current",
  }],
  displayedPrice: -108,
  displayedBook: "onexbet",
  fallbackLine: 8.5,
});
check(
  "a current-only total cannot inherit a stale writer-time line or price",
  currentOnlyTotalMovement.open === null &&
    currentOnlyTotalMovement.openLine === null &&
    currentOnlyTotalMovement.current === -108 &&
    currentOnlyTotalMovement.currentLine === 8.5 &&
    currentOnlyTotalMovement.sportsbook === "onexbet",
);
check(
  "MLB Sharp panels expose complete, provider-limited, pending, and stale states",
  dailyEdgeApiSource.includes('status: "complete"') &&
    dailyEdgeApiSource.includes('status: "provider_limited"') &&
    dailyEdgeApiSource.includes('status: "pending"') &&
    dailyEdgeApiSource.includes('status: "stale"') &&
    candidateDailyEdgeSource.includes("Provider limited") &&
    candidateDailyEdgeSource.includes("Awaiting provider data"),
);
check(
  "first-inning reader distinguishes team results from starter-game context",
  candidateSource.includes("Starter opening frames") &&
    candidateSource.includes("not pitcher earned-run attribution"),
);
check(
  "first-inning Market Pulse uses the real two-sided FI price board alongside specialized evidence",
  candidateSource.includes('<CompactMarketPulse market={market} /><section className="rounded-xl border border-violet-400/20') &&
    candidateSource.includes("CompactFirstInningOddsMovement market={market}") &&
    candidateSource.includes('row("NRFI"') &&
    candidateSource.includes('row("YRFI"'),
);
check(
  "first-inning odds stack both sides and always expose First, Prior, and Current",
  candidateSource.includes('<div className="mt-3 flex flex-col gap-2">{row("NRFI"') &&
    candidateSource.includes('<PricePoint label="First observed"') &&
    candidateSource.includes('<PricePoint label="Prior observed"') &&
    candidateSource.includes('<PricePoint label="Current"'),
);
check(
  "legacy reader also prioritizes the vertically stacked two-sided FI board",
  legacyDailyEdgeSource.includes('<div className="flex flex-col gap-2">') &&
    legacyDailyEdgeSource.includes("{showFiBoardOddsTrail ? (") &&
    legacyDailyEdgeSource.includes(": persistedOddsTrail.length > 0 ? (") &&
    legacyDailyEdgeSource.indexOf("{showFiBoardOddsTrail ? (") <
      legacyDailyEdgeSource.indexOf(": persistedOddsTrail.length > 0 ? (") &&
    legacyDailyEdgeSource.includes('{hasYrfi && <Row label="YRFI" trail={yrfi} />}') &&
    legacyDailyEdgeSource.includes('{hasNrfi && <Row label="NRFI" trail={nrfi} />}'),
);
check(
  "finite recent-game rates use a segmented game tally instead of a continuous bar",
  candidateSource.includes('kind: "rate" | "record" | "average"') &&
    candidateSource.includes('comparison.kind === "rate"') &&
    candidateSource.includes("function SampleTally") &&
    candidateSource.includes("Each tile is one completed game") &&
    !candidateSource.includes("function StatBar"),
);
check(
  "recent-result tallies use semantic success and failure colors",
  candidateSource.includes("border-emerald-300/35 bg-emerald-400/80") &&
    candidateSource.includes("border-rose-300/30 bg-rose-500/65") &&
    candidateSource.includes("green = supports") &&
    candidateSource.includes("red = opposes"),
);
check(
  "play-grade scale inherits the active verdict color",
  candidateSource.includes("function gradeScaleColor") &&
    candidateSource.includes('key === "best_angle"') &&
    candidateSource.includes('key === "lean"') &&
    candidateSource.includes('key === "watchlist"') &&
    candidateSource.includes('key === "caution"'),
);
check(
  "recent records render actual chronological W/D/L tiles instead of text-only summaries",
  candidateSource.includes("function RecordComparison") &&
    candidateSource.includes('row.drawn ? "draw" : row.won') &&
    candidateSource.includes('hitLabel="Win" missLabel="Loss"') &&
    candidateSource.includes("Oldest → newest · green = win · amber = draw · red = loss"),
);
check(
  "recent averages use direct comparison cards with an explicit meaningful delta",
  candidateSource.includes("function AverageComparison") &&
    candidateSource.includes("Recent-game average") &&
    candidateSource.includes("difference.toFixed(1)") &&
    candidateSource.includes("is more supportive of") &&
    !candidateSource.includes("comparisonScaleMaximum") &&
    !candidateSource.includes("Same zero-based scale"),
);
check(
  "record and average comparisons use pick-contextual support cues",
  candidateSource.includes('comparison.advantage === "higher"') &&
    candidateSource.includes("comparison.supportLabel") &&
    candidateSource.includes("Challenges") &&
    candidateSource.includes("Lower is better defensively") &&
    !candidateSource.includes("Higher L10 win rate"),
);
check(
  "average comparison cards keep official team-color accents without arbitrary bar scaling",
  candidateSource.includes('style={{ backgroundColor: teamAccent(team) }}') &&
    candidateSource.includes("overflow-hidden rounded-xl border") &&
    !candidateSource.includes("comparisonTeamColors"),
);
check(
  "recent rate tiles explain their semantic colors",
  candidateSource.includes("Green = game supported") &&
    candidateSource.includes("green = supports") &&
    candidateSource.includes("red = opposes"),
);
check(
  "first-inning context pairs each team with its starter and does not duplicate complementary rate bars",
  candidateSource.includes("FirstInningEvidenceSide") &&
    candidateSource.includes("completed-game results paired with its probable starter") &&
    candidateSource.includes("Games with 1+ first-inning run") &&
    candidateSource.includes('marketKey === "first_inning" && sport === "mlb" ? null'),
);
check(
  "small first-inning samples show understandable counts and explain missing starter history",
  candidateSource.includes('`${supportingCount}/${rows.length}`') &&
    candidateSource.includes("Each tile is one completed game") &&
    candidateSource.includes("No verified recent sample") &&
    candidateSource.includes("This is a data-availability gap, not a 0% result"),
);
check(
  "first-inning result tiles preserve actual oldest-to-newest game order",
  candidateSource.includes("const chronologicalOutcomes = [...rows].reverse()") &&
    candidateSource.includes("outcomes={chronologicalOutcomes}") &&
    candidateSource.includes("Oldest → newest") &&
    candidateSource.includes("green = supports"),
);
check(
  "availability context cannot silently change the prediction",
  candidateSource.includes("It does not change the displayed OddSphere prediction, grade, or stake") &&
    candidateSource.includes("does not by itself prove causation"),
);
check(
  "MLB availability remains in the Market & Price column and fails visibly when unavailable",
  candidateSource.includes('availability ? <AvailabilityContext report={availability} market={market} /> : sport === "mlb" ? <MlbAvailabilityUnavailable />') &&
    candidateSource.includes('<IntegratedEvidence game={game} market={market} marketKey={marketKey} sport={sport} availability={availability} />') &&
    candidateSource.includes("Report temporarily unavailable") &&
    candidateSource.includes("missing report is not evidence that every player is available"),
);
check(
  "previous-day MLB reports are labeled instead of silently discarded or presented as current",
  candidateSource.includes("Previous report") &&
    candidateSource.includes("has not published a report dated for today") &&
    mlbAvailabilitySource.includes("isAcceptableReportDate"),
);
check(
  "availability uses a literal label instead of implying it caused the move",
  candidateSource.includes("Injuries &amp; Availability") &&
    candidateSource.includes("report.sourceLabel") &&
    !candidateSource.includes("What changed?"),
);
check(
  "redundant market-resolution card is not repeated after Market Pulse and splits",
  !candidateSource.includes("How OddSphere resolves the market") &&
    !candidateSource.includes("MarketResolutionPanel"),
);
check(
  "availability stays compact until the member requests player detail",
  candidateSource.includes("View {players.length} reported player") &&
    candidateSource.includes("<details className="),
);
check(
  "sports without formatted driver rows still show an honest core snapshot",
  candidateSource.includes("CoreDecisionSnapshot") &&
    candidateSource.includes("Core snapshot available"),
);
check(
  "every supplied key-stat row remains reachable in the candidate",
  candidateSource.includes("visibleStats = market.keyStats") &&
    candidateSource.includes("visibleStats.map((stat)") &&
    candidateSource.includes('game.markets[key as MarketKey].keyStats'),
);
check(
  "World Cup home and away tokens become team labels only in the candidate presentation",
  candidateSource.includes("normalizeCandidatePicks") &&
    candidateSource.includes('if (normalized === "home") return game.homeTeam') &&
    candidateSource.includes('if (normalized === "away") return game.awayTeam'),
);

console.log("\n━━━ Source-coherent WNBA evidence ━━━");
const wnbaAdapterSource = readFileSync(
  "lib/services/wnba/buildWnbaDailyEdgeAdapted.ts",
  "utf8",
);
const wnbaTrailSource = readFileSync(
  "lib/services/wnba/wnbaPriceTrail.ts",
  "utf8",
);
const wnbaModelWriterSource = readFileSync(
  "lib/services/wnba/runWnbaModel.ts",
  "utf8",
);
const wnbaRecordWriterSource = readFileSync(
  "lib/services/wnba/buildWnbaPredictionRecords.ts",
  "utf8",
);
check(
  "WNBA current lines and history both retain sportsbook identity",
  wnbaAdapterSource.includes('side, sportsbook, line_value, odds_american') &&
    wnbaAdapterSource.includes('side, sportsbook, line_value, odds_american, recorded_at'),
);
check(
  "WNBA directional reads require a coherent same-book trail",
  wnbaAdapterSource.includes("if (!trail?.coherent || pick === null) return null") &&
    wnbaAdapterSource.includes("coherentPriceTrail("),
);
check(
  "WNBA same-book trails terminate at the latest observation instead of looping back to the opener",
  wnbaAdapterSource.includes("selectWnbaSameBookTrail(") &&
    !wnbaAdapterSource.includes("? liveCandidates[0]"),
);
check(
  "WNBA history-only boards preserve both sides when the current lines table is temporarily empty",
  wnbaAdapterSource.includes("terminalSource: selection.terminalSource") &&
    wnbaAdapterSource.includes("opposingPriceTrail: game.pickedPrices?.opposingTotal") &&
    wnbaAdapterSource.includes("opposingPriceTrail: game.pickedPrices?.opposingSpread"),
);
check(
  "WNBA price trails stay on the current point line while total and spread line trails retain line changes",
  wnbaTrailSource.includes("history.filter((row) => closeLine(row.line_value, currentLine))") &&
    wnbaAdapterSource.includes('totalLine: coherentPriceTrail(rows, historyRows, "total"') &&
    wnbaAdapterSource.includes("totalCurrentContext.currentQuote ?? totalDecisionPrice, true") &&
    wnbaAdapterSource.includes('spreadLine: coherentPriceTrail(rows, historyRows, "spread"') &&
    wnbaAdapterSource.includes("spreadCurrentContext.currentQuote ?? spreadDecisionPrice, true") &&
    wnbaAdapterSource.includes("lineTrail: game.pickedPrices?.spreadLine"),
);
check(
  "WNBA number trackers use distinct line stops instead of repeated price polls",
  wnbaAdapterSource.includes("reduce<WnbaPriceTrailStop[]>") &&
    wnbaAdapterSource.includes("prior.line !== stop.line") &&
    wnbaAdapterSource.includes("lastMoveLinePrev: pointLineStops.length > 1"),
);
check(
  "WNBA preserves repeated observations so steady markets still have a verified prior stop",
  wnbaTrailSource.includes("prior.recorded_at === row.recorded_at") &&
    wnbaTrailSource.includes("if (rows.length >= 2) return selection"),
);
check(
  "WNBA retains current-only opposing context without calling it coherent movement",
  wnbaTrailSource.includes("currentOnlyFallback ??= selection") &&
    wnbaAdapterSource.includes("const coherent = stops.length >= 2") &&
    wnbaAdapterSource.includes('(opts.opposingPriceTrail?.stops?.length ?? 0) > 0'),
);
check(
  "WNBA authoritative writer freezes one exact decision tuple for every market",
  wnbaModelWriterSource.includes("buildWnbaDecisionTuple({") &&
    wnbaModelWriterSource.includes("decision_tuple_contract_version") &&
    wnbaModelWriterSource.includes("decision_tuples: decisionTuples") &&
    wnbaModelWriterSource.includes("observedAt: (l.fetched_at ?? l.recorded_at ?? null)"),
);
check(
  "WNBA tracking records copy the writer tuple instead of re-evaluating a later price",
  wnbaRecordWriterSource.includes("mlTuple?.evaluated_price_american") &&
    wnbaRecordWriterSource.includes("totalTuple?.evaluated_price_american") &&
    wnbaRecordWriterSource.includes("spreadTuple?.evaluated_price_american") &&
    wnbaRecordWriterSource.includes("decision_tuple: decisionTuple"),
);
check(
  "WNBA DTO keeps the grade price immutable while exposing a later current quote separately",
  wnbaAdapterSource.includes("const priceAmerican = opts.decisionTuple?.evaluated_price_american") &&
    wnbaAdapterSource.includes("currentPriceAmerican: opts.priceTrail?.currentQuote ?? priceAmerican") &&
    wnbaAdapterSource.includes("gradePriceAmerican: priceAmerican") &&
    wnbaAdapterSource.includes("currentQuoteObservedAt: terminal?.observedAt ?? null"),
);
check(
  "WNBA T-60 readers retain the locked tuple while current quotes continue independently",
  wnbaAdapterSource.includes("const lockedTuple = input.lockedRecord?.snapshot_json?.decision_tuple") &&
    wnbaAdapterSource.includes("if (isWnbaDecisionTuple(lockedTuple)) return lockedTuple") &&
    wnbaAdapterSource.includes("const currentPrice = pickedPrice(rows, market, side, currentLine)") &&
    wnbaAdapterSource.includes("currentQuoteSportsbook: currentTrail.sportsbook ?? null"),
);
check(
  "WNBA unlocked readers reuse only a compatible last-known-good v3 tuple",
  wnbaAdapterSource.includes("record.snapshot_json?.prediction_record_contract_version !== WNBA_V3_RECORD_CONTRACT_VERSION") &&
    wnbaAdapterSource.includes("return retainCompatibleWnbaDecisionTuple(candidate, input.currentDecision)") &&
    wnbaAdapterSource.includes("decisionTuples.total?.evaluated_price_american") &&
    wnbaAdapterSource.includes('decisionLineRows("total", totalSide, totalDecisionLine)'),
);

const parsedEvent = __WNBA_AVAILABILITY_TEST__.parseScoreboardEvent({
  id: "401857128",
  competitions: [{ competitors: [
    { homeAway: "home", team: { abbreviation: "NY" } },
    { homeAway: "away", team: { abbreviation: "LV" } },
  ] }],
});
check(
  "WNBA availability attaches the ESPN event to the exact matchup",
  parsedEvent?.eventId === "401857128" && parsedEvent.awayTeam === "LV" && parsedEvent.homeTeam === "NY",
);
const parsedInjuries = __WNBA_AVAILABILITY_TEST__.parseInjuryGroups([{ team: { abbreviation: "LV", displayName: "Las Vegas Aces" }, injuries: [{ status: "Out", date: "2026-08-09T14:04Z", athlete: { displayName: "A'ja Wilson", position: { abbreviation: "C" } }, details: { type: "Rest" } }] }]);
check(
  "WNBA availability preserves status, reason, position, and report time",
  parsedInjuries[0]?.players[0]?.name === "A'ja Wilson" &&
    parsedInjuries[0]?.players[0]?.status === "Out" &&
    parsedInjuries[0]?.players[0]?.detail === "Rest" &&
    parsedInjuries[0]?.players[0]?.position === "C" &&
    parsedInjuries[0]?.players[0]?.reportedAt === "2026-08-09T14:04Z",
);

const parsedMlbInjuries = __MLB_AVAILABILITY_TEST__.parsePlaybookMlbInjuries({
  reportDate: "2026-08-09",
  updatedAt: "2026-08-09T03:57:30.846Z",
  data: [{
    teamAbbr: "WAS",
    teamName: "Washington Nationals",
    players: [{ name: "James Wood", status: "Out", statusContext: "Injury", reason: "10-day injured list" }],
  }],
});
check(
  "MLB availability normalizes provider teams and preserves report freshness",
  parsedMlbInjuries?.reportDate === "2026-08-09" &&
    parsedMlbInjuries.updatedAt === "2026-08-09T03:57:30.846Z" &&
    parsedMlbInjuries.teams[0]?.abbreviation === "WSH" &&
    parsedMlbInjuries.teams[0]?.players[0]?.status === "Out" &&
    parsedMlbInjuries.teams[0]?.players[0]?.detail === "Injury · 10-day injured list",
);
check(
  "MLB availability accepts only the slate-date or immediately previous provider report",
  __MLB_AVAILABILITY_TEST__.isAcceptableReportDate("2026-08-20", "2026-08-20") &&
    __MLB_AVAILABILITY_TEST__.isAcceptableReportDate("2026-08-19", "2026-08-20") &&
    !__MLB_AVAILABILITY_TEST__.isAcceptableReportDate("2026-08-18", "2026-08-20"),
);
check(
  "MLB availability rejects an implausible all-Out provider payload",
  parsedMlbInjuries !== null &&
    !__MLB_AVAILABILITY_TEST__.hasPlausiblePlaybookReport({
      ...parsedMlbInjuries,
      teams: Array.from({ length: 2 }, (_, teamIndex) => ({
        abbreviation: teamIndex === 0 ? "CLE" : "COL",
        teamName: teamIndex === 0 ? "Cleveland Guardians" : "Colorado Rockies",
        players: Array.from({ length: 10 }, (_, playerIndex) => ({
          name: `Player ${teamIndex}-${playerIndex}`,
          status: "Out",
          detail: null,
          position: null,
          reportedAt: null,
        })),
      })),
    }),
);
const officialMlbTeam = __MLB_AVAILABILITY_TEST__.parseMlbStatsFortyManRoster("CLE", [
  { person: { id: 1, fullName: "Healthy Player" }, position: { abbreviation: "P" }, status: { code: "A", description: "Active" } },
  { person: { id: 2, fullName: "Injured Player" }, position: { abbreviation: "1B" }, status: { code: "D10", description: "Injured 10-Day" }, note: "Lower back inflammation." },
  { person: { id: 3, fullName: "Minor League Player" }, position: { abbreviation: "OF" }, status: { code: "RM", description: "Reassigned to Minors" } },
]);
check(
  "official MLB fallback includes only explicit injured-list statuses",
  officialMlbTeam?.abbreviation === "CLE" &&
    officialMlbTeam.players.length === 1 &&
    officialMlbTeam.players[0]?.name === "Injured Player" &&
    officialMlbTeam.players[0]?.detail === "Lower back inflammation.",
);
check(
  "availability endpoint accepts only bounded exact matchup tokens",
  parseDailyEdgeAvailabilityMatchup("mlb-42|WSH|PHI")?.homeTeam === "PHI" &&
    parseDailyEdgeAvailabilityMatchup("mlb-42|WSH|PHI|extra") === null &&
    parseDailyEdgeAvailabilityMatchup("../secret|WSH|PHI") === null,
);

console.log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
