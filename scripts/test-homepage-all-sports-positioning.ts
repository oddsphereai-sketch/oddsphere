import { readFileSync } from "node:fs";

const homepage = readFileSync("app/page.tsx", "utf8");
const dashboardPreview = readFileSync("app/components/HomepageDashboardPrototype.tsx", "utf8");
const dailyEdgeShell = readFileSync("app/lab/components/daily-edge/DailyEdgeShell.tsx", "utf8");
const actualDailyEdgePreview = readFileSync("app/dev/experience-preview/ActualDailyEdgePreview.tsx", "utf8");
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
  "homepage leads with genuine member overview and market-context captures",
  homepage.includes("/marketing/daily-edge-member-overview-desktop-consensus-sample.jpg")
    && homepage.includes("/marketing/daily-edge-member-overview-mobile-consensus-sample.jpg")
    && homepage.includes("/marketing/daily-edge-member-market-context-consensus-sample.jpg")
    && homepage.includes("Actual Daily Edge member interface")
    && !homepage.includes("/marketing/daily-edge-expanded-reader.jpg"),
);
check(
  "historical member captures and the interactive preview are labeled as sample data",
  homepage.includes("Illustrative MLB example dated Aug. 10, 2026. Not a current recommendation or actual result.")
    && dashboardPreview.includes("illustrative sample data")
    && dailyEdgeShell.includes('"Illustrative NFL example dated Oct. 12, 2026."')
    && dailyEdgeShell.includes('"Illustrative MLB example dated Aug. 10, 2026."')
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
  "interactive sample starts with NFL and exposes only working NFL and MLB sport tabs",
  dailyEdgeShell.includes('useState<"nfl" | "mlb">("nfl")')
    && dailyEdgeShell.includes('activePreviewSports={["nfl", "mlb"]}')
    && dailyEdgeShell.includes("onEmbeddedSportChange")
    && actualDailyEdgePreview.includes('marketingSample ? [] : [{ key: "caution" as const, label: "Caution" }]'),
);
check(
  "marketing sample uses the current four Play Grade terms without Caution",
  ["best_angle", "lean", "watchlist", "no_play"].every((grade) => marketingSample.includes(`verdict: "${grade}"`))
    && !marketingSample.includes('verdict: "caution"'),
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
