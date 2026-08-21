import { readFileSync } from "node:fs";
import {
  formatZonedDateTime,
  zonedWallTimeToIso,
} from "../app/lab/components/UserTimeZone";

let passed = 0;
let failed = 0;

function check(label: string, condition: boolean) {
  if (condition) {
    passed++;
    console.log(`PASS ${label}`);
    return;
  }
  failed++;
  console.error(`FAIL ${label}`);
}

const summerGame = "2026-08-02T17:35:00.000Z";
check(
  "Chicago summer time uses CDT",
  formatZonedDateTime(summerGame, "America/Chicago") === "12:35 PM CDT",
);
check(
  "New York summer time uses EDT",
  formatZonedDateTime(summerGame, "America/New_York") === "1:35 PM EDT",
);
check(
  "Los Angeles summer time uses PDT",
  formatZonedDateTime(summerGame, "America/Los_Angeles") === "10:35 AM PDT",
);
check(
  "date-time mode handles a local calendar-day change",
  formatZonedDateTime("2026-08-02T01:15:00.000Z", "America/Los_Angeles", "date-time") === "Aug 1, 6:15 PM PDT",
);
check("invalid timestamps fail safely", formatZonedDateTime("not-a-date", "America/Chicago") === null);
check("invalid timezones fail safely", formatZonedDateTime(summerGame, "Not/AZone") === null);
check("missing timestamps fail safely", formatZonedDateTime(null, "America/Chicago") === null);
const legacyMlbStart = zonedWallTimeToIso("2026-08-02", "1:35 PM", "America/New_York");
check("legacy ET game time resolves to canonical UTC", legacyMlbStart === "2026-08-02T17:35:00.000Z");
check(
  "legacy ET game time displays correctly in Chicago",
  formatZonedDateTime(legacyMlbStart, "America/Chicago") === "12:35 PM CDT",
);
check("invalid legacy game time fails safely", zonedWallTimeToIso("2026-08-02", "bad", "America/New_York") === null);

const dailyEdgeRoute = readFileSync("app/api/lab/daily-edge/route.ts", "utf8");
const dailyEdgeUi = readFileSync("app/lab/components/daily-edge/DailyEdgeShell.tsx", "utf8");
const candidateDailyEdgeUi = readFileSync("app/dev/experience-preview/ActualDailyEdgePreview.tsx", "utf8");
const propsUi = readFileSync("app/mlb/props/components/PlayerPropsDashboard.tsx", "utf8");
const provider = readFileSync("app/lab/components/UserTimeZone.tsx", "utf8");

check("Daily Edge publishes the canonical game timestamp", dailyEdgeRoute.includes("gameStartAt: row.game_date"));
check(
  "Daily Edge localizes legacy cached snapshots from their official slate time",
  dailyEdgeUi.includes("game.gameStartAt ?? legacyGameStartAt"),
);
check(
  "the redesigned Daily Edge localizes every rendered game-time surface",
  candidateDailyEdgeUi.includes('import { LocalTime } from "@/app/lab/components/UserTimeZone"') &&
    (candidateDailyEdgeUi.match(/<LocalTime value=\{/g) ?? []).length === 4 &&
    !candidateDailyEdgeUi.includes("{game.gameTime}</span>") &&
    !candidateDailyEdgeUi.includes("{reader.game.gameTime}</span>"),
);
check("Player Props uses shared local-time rendering", propsUi.includes("<LocalTime") && propsUi.includes("hourInZone(row.gameStartTime, userTimeZone)"));
check("timezone detection runs after hydration", provider.includes("useSyncExternalStore(") && provider.includes("resolvedOptions().timeZone"));
check("server fallback is deterministic", provider.includes("serverTimeZone") && provider.includes("return DEFAULT_DISPLAY_TIME_ZONE"));

console.log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
