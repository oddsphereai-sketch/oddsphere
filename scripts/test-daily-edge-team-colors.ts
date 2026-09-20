import assert from "node:assert/strict";
import {
  FALLBACK_TEAM_COLOR,
  teamPrimaryColor,
} from "../app/lab/components/daily-edge/teamColors";

assert.equal(teamPrimaryColor("PHI", "mlb"), "#E81828");
assert.equal(teamPrimaryColor("PHI", "nfl"), "#004C54");
assert.equal(teamPrimaryColor("TEN", "nfl"), "#0C2340");
assert.equal(teamPrimaryColor("TCU", "cfb"), "#4D1979");
assert.equal(teamPrimaryColor("UVA", "cfb"), "#232D4B");
assert.equal(teamPrimaryColor("PHI", "cfb"), FALLBACK_TEAM_COLOR);
assert.equal(teamPrimaryColor("PHI", "cbb"), FALLBACK_TEAM_COLOR);

console.log("Daily Edge sport-aware team color tests passed.");
