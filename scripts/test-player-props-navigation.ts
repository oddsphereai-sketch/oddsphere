import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import {
  orderPlayerPropsLeagueDefinitions,
  playerPropsLeagueDefinitions,
  preferredPlayerPropsHref,
} from "../app/player-props/lib/playerPropsLeagues";

const definitions = playerPropsLeagueDefinitions({ nflEnabled: true, nbaEnabled: true });
const activity = {
  nfl: { gameCount: 0, propCount: 0, checkedAt: "2026-10-22T18:00:00.000Z" },
  nba: { gameCount: 2, propCount: 154, checkedAt: "2026-10-22T18:00:00.000Z" },
  mlb: { gameCount: 0, propCount: 0, checkedAt: "2026-10-22T18:00:00.000Z" },
} as const;

assert.deepEqual(
  orderPlayerPropsLeagueDefinitions(definitions, activity).slice(0, 3).map((row) => row.key),
  ["nba", "nfl", "mlb"],
  "a populated current board must precede empty enabled leagues while preserving the hierarchy",
);
assert.equal(
  preferredPlayerPropsHref(activity, { nflEnabled: true, nbaEnabled: true }),
  "/player-props?league=nba",
  "the neutral Player Props route must resolve the first active league",
);
assert.equal(
  preferredPlayerPropsHref({ mlb: { gameCount: 3, propCount: 80, checkedAt: "2026-10-22T18:00:00.000Z" } }, { nflEnabled: true, nbaEnabled: true }),
  "/mlb/props",
  "MLB remains reachable and becomes the landing league when it owns the active board",
);
assert.deepEqual(
  orderPlayerPropsLeagueDefinitions(definitions, {}).slice(0, 3).map((row) => row.key),
  ["nfl", "nba", "mlb"],
  "an unavailable activity response falls back to the stable product hierarchy",
);

const nav = readFileSync("app/lab/components/LabAppNav.tsx", "utf8");
const page = readFileSync("app/player-props/page.tsx", "utf8");
const rail = readFileSync("app/player-props/components/PlayerPropsLeaguePills.tsx", "utf8");
const activityService = readFileSync("lib/services/playerProps/playerPropsLeagueActivity.server.ts", "utf8");

assert.match(nav, /href: "\/player-props",\s+label: "Player Props"/);
assert.match(nav, /"\/mlb\/props": "\/player-props"/);
assert.match(page, /readPlayerPropsLeagueActivity/);
assert.match(page, /preferredPlayerPropsHref/);
assert.match(rail, /player-props-league-activity/);
assert.match(rail, /activeBoard \? "Active" : item\.href \? activityLoaded \? "No games today" : "View props" : "Coming soon"/);
assert.match(activityService, /Reads stored member snapshots only/);
for (const forbidden of ["BallDontLieProvider", "SharpApi", "TheOddsApi", "fetch("]) {
  assert.ok(!activityService.includes(forbidden), `activity discovery must not invoke a provider: ${forbidden}`);
}

console.log("Player Props active-league navigation contract passed.");
