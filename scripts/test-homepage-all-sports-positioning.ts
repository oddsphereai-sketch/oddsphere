import { readFileSync } from "node:fs";

const homepage = readFileSync("app/page.tsx", "utf8");

function check(label: string, condition: boolean): void {
  if (!condition) throw new Error(`FAIL: ${label}`);
  console.log(`  ✓ ${label}`);
}

console.log("\n━━━ homepage all-sports positioning ━━━\n");

check(
  "candidate hero describes the full slate rather than one sport",
  homepage.includes("The Full Slate Read—From Model Edge to Market Pulse."),
);
check(
  "candidate hero names the cross-sport product family",
  homepage.includes("across baseball, football, basketball, soccer, and hockey"),
);
check(
  "player-prop feature is sport-neutral",
  homepage.includes('title: "Player Prop Research"')
    && !homepage.includes('title: "MLB Player Prop Research"'),
);
check(
  "homepage uses evergreen league-availability copy",
  homepage.includes("major baseball, football, basketball, hockey, and soccer competitions")
    && !homepage.includes("ACTIVE_DAILY_EDGE_SPORT_COPY"),
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
