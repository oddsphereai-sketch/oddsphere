import { readFileSync } from "node:fs";

const homepage = readFileSync("app/page.tsx", "utf8");

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
