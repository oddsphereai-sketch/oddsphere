import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { cfbTeamIdentity } from "../lib/services/football/cfbTeamIdentity";
import { __NHL_ADAPTER_TEST__ } from "../lib/services/nhl/adaptNhlToDailyEdgeResponse";

const virginiaIdentity = cfbTeamIdentity("UVA");
assert.equal(virginiaIdentity?.displayName, "Virginia Cavaliers");
assert.equal(
  virginiaIdentity?.logoUrl,
  "https://a.espncdn.com/i/teamlogos/ncaa/500/258.png",
);

assert.equal(
  __NHL_ADAPTER_TEST__.logoFor("LAK"),
  "https://a.espncdn.com/i/teamlogos/nhl/500/la.png",
);

const dailyEdgeShellSource = readFileSync(
  "app/lab/components/daily-edge/DailyEdgeShell.tsx",
  "utf8",
);
const activeDailyEdgeSource = readFileSync(
  "app/dev/experience-preview/ActualDailyEdgePreview.tsx",
  "utf8",
);
assert.ok(dailyEdgeShellSource.includes('LAK: "la"'));
assert.ok(dailyEdgeShellSource.includes("ESPN_NHL_SLUG[abbr.toUpperCase()]"));
assert.ok(dailyEdgeShellSource.includes('import { cfbTeamIdentity }'));
assert.ok(
  dailyEdgeShellSource.includes(
    'logo ?? (shellSport === "cfb" ? cfbTeamIdentity(abbr)?.logoUrl ?? null : null)',
  ),
);
assert.ok(activeDailyEdgeSource.includes('import { cfbTeamIdentity }'));
assert.ok(
  activeDailyEdgeSource.includes(
    'if (game.sport === "cfb") return cfbTeamIdentity(abbreviation)?.logoUrl ?? null;',
  ),
);

console.log("Daily Edge team-logo identity tests passed.");
