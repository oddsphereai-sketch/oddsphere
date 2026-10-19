import { readFileSync } from "node:fs";

const homepage = readFileSync("app/page.tsx", "utf8");
const dashboardPreview = readFileSync("app/components/HomepageDashboardPrototype.tsx", "utf8");
const dailyEdgeShell = readFileSync("app/lab/components/daily-edge/DailyEdgeShell.tsx", "utf8");
const actualDailyEdgePreview = readFileSync("app/dev/experience-preview/ActualDailyEdgePreview.tsx", "utf8");
const sportSelector = readFileSync("app/lab/components/SportSelector.tsx", "utf8");
const marketingSample = dailyEdgeShell.slice(
  dailyEdgeShell.indexOf("const marketingMlbPreviewGames"),
  dailyEdgeShell.indexOf("export function MarketingDailyEdgePreviewSurface"),
);

function check(label: string, condition: boolean): void {
  if (!condition) throw new Error(`FAIL: ${label}`);
  console.log(`  ✓ ${label}`);
}

console.log("\n━━━ homepage all-sports positioning ━━━\n");

check(
  "homepage hero explains the product before using detailed terminology",
  homepage.includes("Understand the matchup before you make your call."),
);
check(
  "homepage hero names the prediction, market, grade, and research workflow",
  homepage.includes("Explore model predictions, compare them with the market")
    && homepage.includes("Daily Edge brings projections, Play Grades, and matchup research into one place."),
);
check(
  "player-prop feature is sport-neutral",
  homepage.includes('title: "Player Props"')
    && !homepage.includes('title: "MLB Player Prop Research"'),
);
check(
  "homepage uses evergreen availability copy",
  homepage.includes("Coverage varies by sport, season, market, and data availability.")
    && !homepage.includes("ACTIVE_DAILY_EDGE_SPORT_COPY"),
);
check(
  "homepage distinguishes model projection, market comparison, and grade explanation",
  homepage.includes('title: "The model projects the game"')
    && homepage.includes('title: "The market is compared"')
    && homepage.includes('title: "The Play Grade is explained"'),
);
check(
  "homepage leads with the interactive member reader and keeps a genuine market-context capture as support",
  homepage.includes("<MarketingDailyEdgePreviewSurface />")
    && homepage.includes("/marketing/daily-edge-member-market-context-consensus-sample.jpg")
    && homepage.includes("Actual Daily Edge member interface")
    && homepage.includes("Genuine member capture")
    && homepage.includes("grid-cols-[minmax(0,1fr)]")
    && !homepage.includes("lg:grid-cols-[0.88fr_1.12fr]")
    && !homepage.includes("/marketing/daily-edge-expanded-reader.jpg"),
);
check(
  "historical member captures and the interactive preview are labeled as sample data",
  homepage.includes("Illustrative MLB example dated Aug. 10, 2026. Not a current recommendation or actual result.")
    && dashboardPreview.includes("illustrative sample data")
    && dailyEdgeShell.includes('"Illustrative NFL example dated Oct. 12, 2026."')
    && dailyEdgeShell.includes('"Illustrative MLB example dated Aug. 10, 2026."')
    && dailyEdgeShell.includes('"Illustrative CFB example dated Oct. 17, 2026."')
    && dailyEdgeShell.includes('"Illustrative NBA example dated Oct. 18, 2026."')
    && dailyEdgeShell.includes('"Illustrative NHL example dated Oct. 16, 2026."')
    && dailyEdgeShell.includes('"Illustrative Premier League example dated Oct. 18, 2026."')
    && dailyEdgeShell.includes('"Illustrative WNBA example dated Aug. 30, 2026."')
    && dailyEdgeShell.includes("Not a current recommendation or actual result."),
);
check(
  "visitor-facing product proof avoids developer language and labels consensus movement correctly",
  homepage.includes("Explore a matchup and the market context behind it.")
    && homepage.includes("Consensus price movement, public consensus")
    && !homepage.includes("Production reader components")
    && !marketingSample.toLowerCase().includes("same-book")
    && marketingSample.includes("consensus price movement"),
);
check(
  "interactive sample shows a complete two-sided consensus moneyline trail",
  marketingSample.includes('awayTeam: "BUF"')
    && marketingSample.includes('homeTeam: "KC"')
    && marketingSample.includes("opposingOddsTrail")
    && marketingSample.includes("{ american: -121")
    && marketingSample.includes("{ american: -115")
    && marketingSample.includes("{ american: -108"),
);
check(
  "interactive point-line samples retain their existing line history and distinguish totals from spreads",
  dailyEdgeShell.includes('lineTrail: input.lineTrail ?? (input.line !== null && input.line !== undefined ? input.oddsTrail ?? [] : [])')
    && dailyEdgeShell.includes('const isTotalMarket = /^(Over|Under)\\b/i.test(input.pick ?? "")')
    && dailyEdgeShell.includes('marketTotal: isTotalMarket ? input.marketTotal ?? input.line ?? null : null')
    && marketingSample.includes('pick: "Over"')
    && marketingSample.includes('line: 47.5')
    && marketingSample.includes('pick: "BUF +2.5"')
    && marketingSample.includes('line: 2.5'),
);
check(
  "interactive sample starts with NFL and every exposed sport has a complete working sample",
  dailyEdgeShell.includes('useState<MarketingPreviewSport>("nfl")')
    && dailyEdgeShell.includes('const MARKETING_PREVIEW_SPORTS = ["nfl", "cfb", "nba", "nhl", "mlb", "soccer", "wnba"]')
    && dailyEdgeShell.includes("activePreviewSports={[...MARKETING_PREVIEW_SPORTS]}")
    && dailyEdgeShell.includes("onEmbeddedSportChange")
    && ["marketing-nfl-2001", "marketing-cfb-3001", "marketing-nba-4001", "marketing-nhl-5001", "marketing-1001", "marketing-soccer-7001", "marketing-wnba-6001"].every((gameId) => dailyEdgeShell.includes(gameId))
    && actualDailyEdgePreview.includes('density={sample ? "sample" : "default"}')
    && actualDailyEdgePreview.includes('density={reader.sample ? "sample" : "compact"}')
    && sportSelector.includes('"grid min-w-[280px] grid-cols-7 gap-1"')
    && actualDailyEdgePreview.includes('marketingSample ? [] : [{ key: "caution" as const, label: "Caution" }]'),
);
check(
  "marketing sample uses the current four Play Grade terms without Caution",
  ["best_angle", "lean", "watchlist", "no_play"].every((grade) => marketingSample.includes(`verdict: "${grade}"`))
    && !marketingSample.includes('verdict: "caution"'),
);
check(
  "illustrative market probability is derived from displayed prices rather than model confidence",
  dailyEdgeShell.includes("marketingNoVigProbability(input.current, [input.opposingCurrent])")
    && !dailyEdgeShell.includes("input.confidence - 0.08")
    && dailyEdgeShell.includes("projected: { away: 113.5, home: 108.0 }")
    && dailyEdgeShell.includes("projected: { away: 81.5, home: 77.0 }"),
);
check(
  "illustrative reader labels sample evidence without changing authenticated verification language",
  actualDailyEdgePreview.includes('illustrativeSample ? "Illustrative market snapshot"')
    && actualDailyEdgePreview.includes('illustrativeSample ? "Sample supporting evidence" : "Verified evidence"')
    && actualDailyEdgePreview.includes('illustrativeSample ? "sample drivers" : "verified drivers"')
    && actualDailyEdgePreview.includes('illustrativeSample ? "Sample evidence" : evidenceRole')
    && actualDailyEdgePreview.includes('illustrativeSample ? "Sample" : "Actual"')
    && actualDailyEdgePreview.includes('illustrativeSample ? "Illustrative price history" : "Observed price history"')
    && actualDailyEdgePreview.includes('illustrativeSample ? "Illustrative consensus" : formatFiSource(board.source)')
    && actualDailyEdgePreview.includes('illustrativeSample ? "Sample source · consensus"')
    && actualDailyEdgePreview.includes('illustrativeSample={embeddedSample}')
    && actualDailyEdgePreview.includes('illustrativeSample ? "Not included in this sample"')
    && actualDailyEdgePreview.includes('"Verified evidence"')
    && actualDailyEdgePreview.includes('"Real market snapshot"'),
);
check(
  "illustrative expected scores, representative finals, first-inning projections, and league logos use real reader fields",
  dailyEdgeShell.includes('representativeScore: { away: 82, home: 77 }')
    && dailyEdgeShell.includes('projected: { away: 81.5, home: 77.0 }')
    && dailyEdgeShell.includes('label: "Representative final"')
    && dailyEdgeShell.includes('label: "Projected 1st-inning runs"')
    && dailyEdgeShell.includes('homeValue: "0.72"')
    && dailyEdgeShell.includes('homeValue: "1.18"')
    && dailyEdgeShell.includes('homeValue: "0.78"')
    && dailyEdgeShell.includes('awayTeamLogo: marketingTeamLogo(sport, input.awayTeam)')
    && dailyEdgeShell.includes('homeTeamLogo: marketingTeamLogo(sport, input.homeTeam)')
    && dailyEdgeShell.includes('ORE: "https://a.espncdn.com/i/teamlogos/ncaa/500/2483.png"')
    && dailyEdgeShell.includes('PSU: "https://a.espncdn.com/i/teamlogos/ncaa/500/213.png"')
    && dailyEdgeShell.includes('return eplTeamLogo(team)')
    && dailyEdgeShell.includes('return wnbaLogoUrl(team)')
    && actualDailyEdgePreview.includes('representativeScore ? <p')
    && actualDailyEdgePreview.includes('illustrativeSample ? "Expected score" : "Proj"'),
);
check(
  "search metadata represents baseball, football, basketball, soccer, and UCL",
  [
    "MLB predictions",
    "NFL predictions",
    "college football predictions",
    "NBA predictions",
    "college basketball predictions",
    "WNBA predictions",
    "soccer predictions",
    "World Cup predictions",
    "Champions League predictions",
    "NHL predictions",
  ].every((keyword) => homepage.includes(`"${keyword}"`)),
);

console.log("\nhomepage all-sports positioning: passed\n");
